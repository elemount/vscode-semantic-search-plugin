/**
 * Vector Database Service - Uses DuckDB with VSS extension
 * Combines vector storage and metadata in a single database
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { EmbeddingService } from './embeddingService';
import { IndexedFile, SearchResult, Workspace, Folder, FolderInfo, CodeChunk } from '../models/types';
import { MigrationService } from './migrationService';
import { getLogger } from './logger';

 
let DuckDBInstance: any;

interface CodeChunkInput {
    chunkId: string;
    fileId: string;
    filePath: string;
    workspaceId: string;
    workspacePath: string;
    content: string;
    lineStart: number;
    linePosStart: number;
    lineEnd: number;
    linePosEnd: number;
    chunkIndex?: number;
}

export class VectorDbService {
     
    private instance: any = null;
     
    private connection: any = null;
    private storagePath: string;
    private dbPath: string;
    private initialized: boolean = false;
    private dimensions: number;
    
    constructor(
        storagePath: string,
        private embeddingService: EmbeddingService
    ) {
        this.storagePath = storagePath;
        this.dbPath = path.join(storagePath, 'semanticsearch.duckdb');
        this.dimensions = embeddingService.getDimensions();
    }
    
    /**
     * Initialize DuckDB with VSS extension
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        
        const logger = getLogger();
        
        // Ensure storage directory exists
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
        
        // Dynamically import @duckdb/node-api
        const duckdb = require('@duckdb/node-api');
        DuckDBInstance = duckdb.DuckDBInstance;
        
        // Create instance and connection
        this.instance = await DuckDBInstance.create(this.dbPath);
        this.connection = await this.instance.connect();
        
        // Install and load VSS extension
        await this.connection.run('INSTALL vss');
        await this.connection.run('LOAD vss');
        await this.connection.run('SET hnsw_enable_experimental_persistence = true');
        
        // Run migrations to ensure schema is up to date
        const migrationService = new MigrationService(this.connection, this.dimensions);
        if (await migrationService.needsMigration()) {
            logger.info('VectorDbService', 'Running database migrations...');
            await migrationService.migrate();
            logger.info('VectorDbService', 'Database migrations completed');
        }
        
        // Create HNSW index if not exists
        await this.createHnswIndex();
        
        this.initialized = true;
    }
    
    /**
     * Create HNSW index for vector search
     */
    private async createHnswIndex(): Promise<void> {
        try {
            await this.connection.run(`
                CREATE INDEX IF NOT EXISTS idx_chunks_embedding 
                ON file_chunks_small_v1 
                USING HNSW (embedding)
                WITH (metric = 'cosine')
            `);
        } catch {
            // Index may already exist
        }
    }
    
    /**
     * Run SQL statement
     */
    private async runSQL(sql: string): Promise<void> {
        if (!this.connection) {
            throw new Error('Database not initialized');
        }
        await this.connection.run(sql);
    }
    
    /**
     * Query and return results
     */
     
    private async querySQL<T>(sql: string, ...params: unknown[]): Promise<T[]> {
        if (!this.connection) {
            throw new Error('Database not initialized');
        }

        // Prepare statement if we have parameters
        if (params.length > 0) {
            const stmt = await this.connection.prepare(sql);
            for (let i = 0; i < params.length; i++) {
                stmt.bindValue(i + 1, params[i]);
            }
            const result = await stmt.run();
            const rows = await result.getRows();
            return this.convertRows<T>(rows, result);
        }

        const result = await this.connection.run(sql);
        const rows = await result.getRows();
        return this.convertRows<T>(rows, result);
    }
    
    /**
     * Convert DuckDB rows to objects
     */
     
    private convertRows<T>(rows: any[], result: any): T[] {
        if (!rows || rows.length === 0) {
            return [];
        }

        const columnNames = result.columnNames();
        return rows.map(row => {
             
            const obj: any = {};
            for (let i = 0; i < columnNames.length; i++) {
                // Convert BigInt to Number for JavaScript compatibility
                const value = row[i];
                obj[columnNames[i]] = typeof value === 'bigint' ? Number(value) : value;
            }
            return obj as T;
        });
    }
    
    /**
     * Add a code chunk with its embedding
     */
    async addChunk(chunk: CodeChunkInput): Promise<void> {
        // Generate embedding using document task format
        const embedding = await this.embeddingService.embedDocument(chunk.content, chunk.filePath);
        
        // Format embedding as DuckDB array literal
        const embeddingStr = `[${embedding.join(',')}]::FLOAT[${this.dimensions}]`;
        
        // Escape content for SQL
        const escapedContent = chunk.content.replace(/'/g, "''");
        const escapedFilePath = chunk.filePath.replace(/'/g, "''");
        const escapedWorkspacePath = chunk.workspacePath.replace(/'/g, "''");
        const chunkIndex = chunk.chunkIndex ?? 0;
        
        const sql = `
            INSERT INTO file_chunks_small_v1 
            (chunk_id, file_id, file_path, workspace_id, workspace_path, content, 
             line_start, line_pos_start, line_end, line_pos_end, chunk_index, embedding, created_at)
            VALUES ('${chunk.chunkId}', '${chunk.fileId}', '${escapedFilePath}', 
                    '${chunk.workspaceId}', '${escapedWorkspacePath}', '${escapedContent}', 
                    ${chunk.lineStart}, ${chunk.linePosStart}, ${chunk.lineEnd}, ${chunk.linePosEnd}, 
                    ${chunkIndex}, ${embeddingStr}, ${Date.now()})
            ON CONFLICT (chunk_id) DO UPDATE SET
                content = excluded.content,
                line_start = excluded.line_start,
                line_pos_start = excluded.line_pos_start,
                line_end = excluded.line_end,
                line_pos_end = excluded.line_pos_end,
                chunk_index = excluded.chunk_index,
                embedding = excluded.embedding,
                created_at = excluded.created_at
        `;
        
        await this.connection.run(sql);
    }
    
    /**
     * Add multiple code chunks (batch operation)
     */
    async addChunks(chunks: CodeChunkInput[]): Promise<void> {
        for (const chunk of chunks) {
            await this.addChunk(chunk);
        }
    }
    
    /**
     * Search for similar code chunks
     */
    async search(
        query: string,
        workspacePath?: string,
        limit: number = 10
    ): Promise<SearchResult[]> {
        // Generate query embedding using query task format
        const queryEmbedding = await this.embeddingService.embedQuery(query);
        const embeddingStr = `[${queryEmbedding.join(',')}]::FLOAT[${this.dimensions}]`;
        
        let sql = `
            SELECT 
                chunk_id,
                file_path,
                content,
                line_start,
                line_pos_start,
                line_end,
                line_pos_end,
                array_cosine_distance(embedding, ${embeddingStr}) AS distance
            FROM file_chunks_small_v1
        `;
        
        if (workspacePath) {
            sql += ` WHERE workspace_path = '${workspacePath.replace(/'/g, "''")}'`;
        }
        
        sql += `
            ORDER BY array_cosine_distance(embedding, ${embeddingStr})
            LIMIT ${limit}
        `;
        
        const result = await this.connection.run(sql);
        const rows = await result.getRows();
        const columnNames = result.columnNames();
        
         
        return rows.map((row: any[]) => {
             
            const obj: any = {};
            columnNames.forEach((col: string, i: number) => {
                // Convert BigInt to Number if necessary
                const value = row[i];
                obj[col] = typeof value === 'bigint' ? Number(value) : value;
            });
            return {
                filePath: obj.file_path,
                content: obj.content,
                lineStart: obj.line_start,
                lineEnd: obj.line_end,
                score: 1 - obj.distance  // Convert distance to similarity score
            };
        });
    }
    
    /**
     * Delete all chunks for a file
     */
    async deleteFileChunks(fileId: string): Promise<void> {
        await this.connection.run(
            `DELETE FROM file_chunks_small_v1 WHERE file_id = '${fileId.replace(/'/g, "''")}'`
        );
    }
    
    /**
     * Get chunk count for a file
     */
    async getFileChunkCount(fileId: string): Promise<number> {
        const sql = `SELECT COUNT(*) as count FROM file_chunks_small_v1 WHERE file_id = $1`;
        const rows = await this.querySQL<{ count: number }>(sql, fileId);
        return rows[0]?.count ?? 0;
    }
    
    /**
     * Get total chunk count
     */
    async getTotalChunkCount(): Promise<number> {
        const sql = `SELECT COUNT(*) as count FROM file_chunks_small_v1`;
        const rows = await this.querySQL<{ count: number }>(sql);
        return rows[0]?.count ?? 0;
    }
    
    /**
     * Check if file is indexed
     */
    async isFileIndexed(fileId: string): Promise<boolean> {
        const count = await this.getFileChunkCount(fileId);
        return count > 0;
    }
    
    /**
     * Clear all chunks data
     */
    async clearAllChunks(): Promise<void> {
        await this.runSQL('DELETE FROM file_chunks_small_v1');
    }
    
    // =====================
    // Indexed Files Methods
    // =====================
    
    /**
     * Add or update an indexed file record
     */
    async upsertIndexedFile(file: IndexedFile): Promise<void> {
        if (!this.connection) {
            throw new Error('Database not initialized');
        }

        const fileName = file.fileName || this.extractFileName(file.filePath);
        const workspaceId = file.workspaceId || await this.getOrCreateWorkspaceId(file.workspacePath || '');
        const folderId = file.folderId || await this.getOrCreateFolderId(workspaceId, file.filePath);
        
        const sql = `
            INSERT INTO indexed_files_v1 (file_id, workspace_id, folder_id, file_path, file_name, 
                                          absolute_path, file_size, last_indexed_at, md5_hash)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (file_id) DO UPDATE SET
                file_path = excluded.file_path,
                folder_id = excluded.folder_id,
                file_name = excluded.file_name,
                absolute_path = excluded.absolute_path,
                file_size = excluded.file_size,
                last_indexed_at = excluded.last_indexed_at,
                md5_hash = excluded.md5_hash
        `;

        const stmt = await this.connection.prepare(sql);
        stmt.bindValue(1, file.fileId);
        stmt.bindValue(2, workspaceId);
        stmt.bindValue(3, folderId);
        stmt.bindValue(4, file.filePath);
        stmt.bindValue(5, fileName);
        stmt.bindValue(6, file.absolutePath);
        stmt.bindValue(7, file.fileSize || null);
        stmt.bindValue(8, file.lastIndexedAt);
        stmt.bindValue(9, file.md5Hash);
        await stmt.run();
    }

    /**
     * Extract folder path from full file path
     */
    private extractFolderPath(filePath: string): string {
        const normalized = filePath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
    }

    /**
     * Extract file name from full file path
     */
    private extractFileName(filePath: string): string {
        const normalized = filePath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
    }

    /**
     * Extract folder name from folder path
     */
    private extractFolderName(folderPath: string): string {
        const normalized = folderPath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
    }

    /**
     * Generate folder ID from workspace ID and folder path
     */
    private generateFolderId(workspaceId: string, folderPath: string): string {
        return crypto.createHash('md5').update(workspaceId + folderPath).digest('hex').substring(0, 16);
    }

    /**
     * Get or create workspace ID from workspace path
     */
    async getOrCreateWorkspaceId(workspacePath: string): Promise<string> {
        if (!workspacePath) {
            return '';
        }
        
        // Check if workspace exists
        const existingWorkspace = await this.getWorkspaceByPath(workspacePath);
        if (existingWorkspace) {
            return existingWorkspace.workspaceId;
        }

        // Create new workspace
        const workspaceId = crypto.createHash('md5').update(workspacePath).digest('hex').substring(0, 16);
        const workspaceName = workspacePath.split(/[/\\]/).pop() || workspacePath;
        
        await this.connection.run(`
            INSERT INTO workspaces_v1 (workspace_id, workspace_path, workspace_name, status, created_at)
            VALUES ('${workspaceId}', '${workspacePath.replace(/'/g, "''")}', '${workspaceName.replace(/'/g, "''")}', 'active', ${Date.now()})
            ON CONFLICT (workspace_id) DO NOTHING
        `);

        return workspaceId;
    }

    /**
     * Get or create folder ID from workspace ID and file path
     * Creates all parent folders as needed
     */
    private async getOrCreateFolderId(workspaceId: string, filePath: string): Promise<string> {
        const folderPath = this.extractFolderPath(filePath);
        if (!folderPath) {
            return '';
        }

        const folderId = this.generateFolderId(workspaceId, folderPath);
        
        // Check if folder already exists
        const existingResult = await this.connection.run(`
            SELECT folder_id FROM folders_v1 WHERE folder_id = '${folderId}'
        `);
        const existingRows = await existingResult.getRows();
        
        if (existingRows && existingRows.length > 0) {
            return folderId;
        }

        // Create parent folders recursively
        const parentFolderPath = this.extractFolderPath(folderPath);
        let parentFolderId: string | null = null;
        if (parentFolderPath) {
            parentFolderId = await this.getOrCreateFolderId(workspaceId, folderPath);
        }

        // Create the folder
        const folderName = this.extractFolderName(folderPath);
        await this.connection.run(`
            INSERT INTO folders_v1 (folder_id, workspace_id, parent_folder_id, folder_path, folder_name, created_at)
            VALUES ('${folderId}', '${workspaceId}', ${parentFolderId ? `'${parentFolderId}'` : 'NULL'}, 
                    '${folderPath.replace(/'/g, "''")}', '${folderName.replace(/'/g, "''")}', ${Date.now()})
            ON CONFLICT (folder_id) DO NOTHING
        `);

        return folderId;
    }

    /**
     * Get indexed file by file ID
     */
    async getIndexedFile(fileId: string): Promise<IndexedFile | null> {
        const sql = `
            SELECT f.*, w.workspace_path 
            FROM indexed_files_v1 f
            LEFT JOIN workspaces_v1 w ON f.workspace_id = w.workspace_id
            WHERE f.file_id = $1
        `;
        const rows = await this.querySQL<{
            file_id: string;
            workspace_id: string;
            folder_id: string;
            file_path: string;
            file_name: string;
            absolute_path: string;
            file_size: number | null;
            last_indexed_at: number;
            md5_hash: string;
            workspace_path: string | null;
        }>(sql, fileId);

        if (rows.length === 0) {
            return null;
        }

        return this.mapRowToIndexedFile(rows[0]);
    }

    /**
     * Get indexed file by file path
     */
    async getIndexedFileByPath(filePath: string): Promise<IndexedFile | null> {
        const sql = `
            SELECT f.*, w.workspace_path 
            FROM indexed_files_v1 f
            LEFT JOIN workspaces_v1 w ON f.workspace_id = w.workspace_id
            WHERE f.file_path = $1
        `;
        const rows = await this.querySQL<{
            file_id: string;
            workspace_id: string;
            folder_id: string;
            file_path: string;
            file_name: string;
            absolute_path: string;
            file_size: number | null;
            last_indexed_at: number;
            md5_hash: string;
            workspace_path: string | null;
        }>(sql, filePath);

        if (rows.length === 0) {
            return null;
        }

        return this.mapRowToIndexedFile(rows[0]);
    }

    /**
     * Map database row to IndexedFile interface
     */
    private mapRowToIndexedFile(row: {
        file_id: string;
        workspace_id: string;
        folder_id: string;
        file_path: string;
        file_name: string;
        absolute_path: string;
        file_size: number | null;
        last_indexed_at: number;
        md5_hash: string;
        workspace_path?: string | null;
    }): IndexedFile {
        return {
            fileId: row.file_id,
            workspaceId: row.workspace_id || '',
            folderId: row.folder_id || '',
            filePath: row.file_path,
            fileName: row.file_name || this.extractFileName(row.file_path),
            absolutePath: row.absolute_path,
            fileSize: row.file_size || undefined,
            lastIndexedAt: row.last_indexed_at,
            md5Hash: row.md5_hash,
            workspacePath: row.workspace_path || undefined,
        };
    }

    /**
     * Get all indexed files for a workspace
     */
    async getIndexedFilesForWorkspace(workspacePath: string): Promise<IndexedFile[]> {
        const sql = `
            SELECT f.*, w.workspace_path 
            FROM indexed_files_v1 f
            INNER JOIN workspaces_v1 w ON f.workspace_id = w.workspace_id
            WHERE w.workspace_path = $1
        `;
        const rows = await this.querySQL<{
            file_id: string;
            workspace_id: string;
            folder_id: string;
            file_path: string;
            file_name: string;
            absolute_path: string;
            file_size: number | null;
            last_indexed_at: number;
            md5_hash: string;
            workspace_path: string;
        }>(sql, workspacePath);

        return rows.map((row) => this.mapRowToIndexedFile(row));
    }

    /**
     * Get all indexed files
     */
    async getAllIndexedFiles(): Promise<IndexedFile[]> {
        const sql = `
            SELECT f.*, w.workspace_path 
            FROM indexed_files_v1 f
            LEFT JOIN workspaces_v1 w ON f.workspace_id = w.workspace_id
        `;
        const rows = await this.querySQL<{
            file_id: string;
            workspace_id: string;
            folder_id: string;
            file_path: string;
            file_name: string;
            absolute_path: string;
            file_size: number | null;
            last_indexed_at: number;
            md5_hash: string;
            workspace_path: string | null;
        }>(sql);

        return rows.map((row) => this.mapRowToIndexedFile(row));
    }

    /**
     * Delete indexed file by file ID
     */
    async deleteIndexedFile(fileId: string): Promise<void> {
        if (!this.connection) {
            throw new Error('Database not initialized');
        }

        const sql = `DELETE FROM indexed_files_v1 WHERE file_id = $1`;
        const stmt = await this.connection.prepare(sql);
        stmt.bindValue(1, fileId);
        await stmt.run();
    }

    /**
     * Delete all indexed files for a workspace
     */
    async deleteWorkspaceIndex(workspacePath: string): Promise<void> {
        if (!this.connection) {
            throw new Error('Database not initialized');
        }

        // Get workspace ID
        const workspace = await this.getWorkspaceByPath(workspacePath);
        if (!workspace) {
            return;
        }

        // Delete all chunks for workspace
        await this.connection.run(
            `DELETE FROM file_chunks_small_v1 WHERE workspace_path = '${workspacePath.replace(/'/g, "''")}'`
        );
        
        // Delete indexed file records
        await this.connection.run(
            `DELETE FROM indexed_files_v1 WHERE workspace_id = '${workspace.workspaceId}'`
        );

        // Delete folders
        await this.connection.run(
            `DELETE FROM folders_v1 WHERE workspace_id = '${workspace.workspaceId}'`
        );
    }

    /**
     * Get count of indexed files for a workspace
     */
    async getIndexedFileCount(workspacePath?: string): Promise<number> {
        if (workspacePath) {
            const workspace = await this.getWorkspaceByPath(workspacePath);
            if (!workspace) {
                return 0;
            }
            const sql = `SELECT COUNT(*) as count FROM indexed_files_v1 WHERE workspace_id = $1`;
            const rows = await this.querySQL<{ count: number }>(sql, workspace.workspaceId);
            return rows[0]?.count ?? 0;
        }
        
        const sql = `SELECT COUNT(*) as count FROM indexed_files_v1`;
        const rows = await this.querySQL<{ count: number }>(sql);
        return rows[0]?.count ?? 0;
    }

    // =====================
    // Workspace Methods
    // =====================

    /**
     * Get workspace by path
     */
    async getWorkspaceByPath(workspacePath: string): Promise<Workspace | null> {
        try {
            const sql = `SELECT * FROM workspaces_v1 WHERE workspace_path = $1`;
            const rows = await this.querySQL<{
                workspace_id: string;
                workspace_path: string;
                workspace_name: string;
                status: string;
                created_at: number;
            }>(sql, workspacePath);

            if (rows.length === 0) {
                return null;
            }

            const row = rows[0];
            return {
                workspaceId: row.workspace_id,
                workspacePath: row.workspace_path,
                workspaceName: row.workspace_name,
                status: row.status as 'active' | 'indexing' | 'error',
                createdAt: row.created_at,
            };
        } catch {
            // Workspaces table may not exist in older databases
            return null;
        }
    }

    /**
     * Get all workspaces
     */
    async getAllWorkspaces(): Promise<Workspace[]> {
        try {
            const sql = `SELECT * FROM workspaces_v1 ORDER BY workspace_name`;
            const rows = await this.querySQL<{
                workspace_id: string;
                workspace_path: string;
                workspace_name: string;
                status: string;
                created_at: number;
            }>(sql);

            return rows.map((row) => ({
                workspaceId: row.workspace_id,
                workspacePath: row.workspace_path,
                workspaceName: row.workspace_name,
                status: row.status as 'active' | 'indexing' | 'error',
                createdAt: row.created_at,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Update workspace status
     */
    async updateWorkspaceStatus(workspacePath: string, status: 'active' | 'indexing' | 'error'): Promise<void> {
        try {
            await this.connection.run(`
                UPDATE workspaces_v1 
                SET status = '${status}'
                WHERE workspace_path = '${workspacePath.replace(/'/g, "''")}'
            `);
        } catch {
            // Workspaces table may not exist
        }
    }

    /**
     * Get total chunk count for a workspace
     */
    async getTotalChunkCountForWorkspace(workspacePath: string): Promise<number> {
        const sql = `SELECT COUNT(*) as count FROM file_chunks_small_v1 WHERE workspace_path = $1`;
        const rows = await this.querySQL<{ count: number }>(sql, workspacePath);
        return rows[0]?.count ?? 0;
    }

    // =====================
    // Folder Methods
    // =====================

    /**
     * Get folder hierarchy with file counts for a workspace
     */
    async getFolderHierarchy(workspacePath: string): Promise<FolderInfo[]> {
        const workspace = await this.getWorkspaceByPath(workspacePath);
        if (!workspace) {
            return [];
        }

        const sql = `
            SELECT 
                f.folder_id,
                f.folder_path,
                f.folder_name,
                COUNT(if2.file_id) as file_count
            FROM folders_v1 f
            LEFT JOIN indexed_files_v1 if2 ON f.folder_id = if2.folder_id
            WHERE f.workspace_id = $1
            GROUP BY f.folder_id, f.folder_path, f.folder_name
            ORDER BY f.folder_path
        `;
        
        const rows = await this.querySQL<{
            folder_id: string;
            folder_path: string;
            folder_name: string;
            file_count: number;
        }>(sql, workspace.workspaceId);

        return rows.map((row) => ({
            folderId: row.folder_id,
            folderPath: row.folder_path || '',
            folderName: row.folder_name || '',
            fileCount: row.file_count,
        }));
    }

    /**
     * Get files in a specific folder
     */
    async getFilesInFolder(workspacePath: string, folderId: string): Promise<IndexedFile[]> {
        const sql = `
            SELECT f.*, w.workspace_path 
            FROM indexed_files_v1 f
            INNER JOIN workspaces_v1 w ON f.workspace_id = w.workspace_id
            WHERE f.folder_id = $1
            ORDER BY f.file_name
        `;
        
        const rows = await this.querySQL<{
            file_id: string;
            workspace_id: string;
            folder_id: string;
            file_path: string;
            file_name: string;
            absolute_path: string;
            file_size: number | null;
            last_indexed_at: number;
            md5_hash: string;
            workspace_path: string;
        }>(sql, folderId);

        return rows.map((row) => this.mapRowToIndexedFile(row));
    }

    // =====================
    // Chunk Methods for Tree View
    // =====================

    /**
     * Get chunks for a file
     */
    async getChunksForFile(fileId: string): Promise<CodeChunk[]> {
        const sql = `
            SELECT chunk_id, file_id, file_path, workspace_id, workspace_path, content, 
                   line_start, line_pos_start, line_end, line_pos_end,
                   COALESCE(chunk_index, 0) as chunk_index, created_at
            FROM file_chunks_small_v1 
            WHERE file_id = $1
            ORDER BY chunk_index, line_start
        `;
        
        const rows = await this.querySQL<{
            chunk_id: string;
            file_id: string;
            file_path: string;
            workspace_id: string;
            workspace_path: string;
            content: string;
            line_start: number;
            line_pos_start: number;
            line_end: number;
            line_pos_end: number;
            chunk_index: number;
            created_at: number;
        }>(sql, fileId);

        return rows.map((row) => ({
            chunkId: row.chunk_id,
            fileId: row.file_id,
            filePath: row.file_path,
            workspaceId: row.workspace_id,
            workspacePath: row.workspace_path,
            content: row.content,
            lineStart: row.line_start,
            linePosStart: row.line_pos_start,
            lineEnd: row.line_end,
            linePosEnd: row.line_pos_end,
            chunkIndex: row.chunk_index,
            createdAt: row.created_at,
        }));
    }
    
    /**
     * Compact the HNSW index (removes deleted entries)
     */
    async compactIndex(): Promise<void> {
        try {
            await this.connection.run(`PRAGMA hnsw_compact_index('idx_chunks_embedding')`);
        } catch {
            // Index might not exist yet
        }
    }
    
    /**
     * Close database connection
     */
    async close(): Promise<void> {
        if (this.connection) {
            this.connection.closeSync();
            this.connection = null;
        }
        if (this.instance) {
            this.instance.closeSync();
            this.instance = null;
        }
        this.initialized = false;
    }
}
