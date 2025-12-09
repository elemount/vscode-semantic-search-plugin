/**
 * Indexing Service - orchestrates file indexing
 */

import * as vscode from 'vscode';
import { ChromaService } from './chromaService';
import { DuckDBService } from './duckdbService';
import {
    DocumentChunk,
    IndexedFile,
    IndexingConfig,
    IndexingStatus,
    IndexEntry,
    DEFAULT_INDEXING_CONFIG,
} from '../models/types';
import {
    calculateMD5,
    generateFileId,
    generateChunkId,
    getWorkspaceFiles,
    readFileContent,
    splitIntoChunks,
    getRelativePath,
    normalizePath,
} from '../utils/fileUtils';

export class IndexingService {
    private chromaService: ChromaService;
    private duckdbService: DuckDBService;
    private config: IndexingConfig;
    private status: IndexingStatus;
    private statusEmitter: vscode.EventEmitter<IndexingStatus>;

    public readonly onStatusChange: vscode.Event<IndexingStatus>;

    constructor(
        chromaService: ChromaService,
        duckdbService: DuckDBService,
        config: IndexingConfig = DEFAULT_INDEXING_CONFIG
    ) {
        this.chromaService = chromaService;
        this.duckdbService = duckdbService;
        this.config = config;
        this.status = {
            isIndexing: false,
            totalFiles: 0,
            processedFiles: 0,
        };
        this.statusEmitter = new vscode.EventEmitter<IndexingStatus>();
        this.onStatusChange = this.statusEmitter.event;
    }

    /**
     * Update and emit status
     */
    private updateStatus(partial: Partial<IndexingStatus>): void {
        this.status = { ...this.status, ...partial };
        this.statusEmitter.fire(this.status);
    }

    /**
     * Get current indexing status
     */
    getStatus(): IndexingStatus {
        return { ...this.status };
    }

    /**
     * Index all files in a workspace folder
     */
    async indexWorkspace(
        workspaceFolder: vscode.WorkspaceFolder,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        if (this.status.isIndexing) {
            throw new Error('Indexing already in progress');
        }

        const workspacePath = normalizePath(workspaceFolder.uri.fsPath);

        try {
            this.updateStatus({ isIndexing: true, processedFiles: 0, totalFiles: 0 });

            // Get all files to index
            const files = await getWorkspaceFiles(workspaceFolder, this.config);
            this.updateStatus({ totalFiles: files.length });

            progress?.report({ message: `Found ${files.length} files to index` });

            // Index each file
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const relativePath = getRelativePath(workspacePath, file.fsPath);

                progress?.report({
                    message: `Indexing ${relativePath}`,
                    increment: (1 / files.length) * 100,
                });

                this.updateStatus({ currentFile: relativePath });

                try {
                    await this.indexFile(file, workspacePath);
                } catch (error) {
                    console.error(`Error indexing file ${file.fsPath}:`, error);
                    // Continue with other files
                }

                this.updateStatus({ processedFiles: i + 1 });
            }

            progress?.report({ message: 'Indexing complete' });
        } finally {
            this.updateStatus({
                isIndexing: false,
                currentFile: undefined,
            });
        }
    }

    /**
     * Index a single file
     */
    async indexFile(fileUri: vscode.Uri, workspacePath: string): Promise<void> {
        const filePath = normalizePath(fileUri.fsPath);
        const fileId = generateFileId(workspacePath, filePath);

        // Read file content
        const content = await readFileContent(fileUri);
        const md5Hash = calculateMD5(content);

        // Check if file is already indexed with same hash
        const existingFile = await this.duckdbService.getIndexedFile(fileId);
        if (existingFile && existingFile.md5Hash === md5Hash) {
            // File hasn't changed, skip
            return;
        }

        // Delete existing chunks if any
        if (existingFile) {
            await this.chromaService.deleteFileChunks(fileId);
        }

        // Split content into chunks
        const rawChunks = splitIntoChunks(content, this.config.chunkSize, this.config.chunkOverlap);

        // Create document chunks
        const chunks: DocumentChunk[] = rawChunks.map((chunk) => ({
            id: generateChunkId(fileId, chunk.lineStart, chunk.lineEnd),
            fileId,
            filePath,
            content: chunk.content,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
        }));

        // Add chunks to ChromaDB
        if (chunks.length > 0) {
            await this.chromaService.addChunks(chunks);
        }

        // Update metadata in DuckDB
        const indexedFile: IndexedFile = {
            fileId,
            filePath,
            workspacePath,
            md5Hash,
            lastIndexedAt: Date.now(),
        };
        await this.duckdbService.upsertIndexedFile(indexedFile);
    }

    /**
     * Index specific files
     */
    async indexFiles(
        fileUris: vscode.Uri[],
        workspacePath: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        if (this.status.isIndexing) {
            throw new Error('Indexing already in progress');
        }

        try {
            this.updateStatus({ isIndexing: true, totalFiles: fileUris.length, processedFiles: 0 });

            for (let i = 0; i < fileUris.length; i++) {
                const fileUri = fileUris[i];
                const relativePath = getRelativePath(workspacePath, fileUri.fsPath);

                progress?.report({
                    message: `Indexing ${relativePath}`,
                    increment: (1 / fileUris.length) * 100,
                });

                this.updateStatus({ currentFile: relativePath });

                try {
                    await this.indexFile(fileUri, workspacePath);
                } catch (error) {
                    console.error(`Error indexing file ${fileUri.fsPath}:`, error);
                }

                this.updateStatus({ processedFiles: i + 1 });
            }
        } finally {
            this.updateStatus({
                isIndexing: false,
                currentFile: undefined,
            });
        }
    }

    /**
     * Delete index for a file
     */
    async deleteFileIndex(filePath: string): Promise<void> {
        const indexedFile = await this.duckdbService.getIndexedFileByPath(normalizePath(filePath));
        if (!indexedFile) {
            return;
        }

        await this.chromaService.deleteFileChunks(indexedFile.fileId);
        await this.duckdbService.deleteIndexedFile(indexedFile.fileId);
    }

    /**
     * Delete index for a workspace
     */
    async deleteWorkspaceIndex(workspacePath: string): Promise<void> {
        const normalizedPath = normalizePath(workspacePath);
        const files = await this.duckdbService.getIndexedFilesForWorkspace(normalizedPath);

        // Delete chunks for all files
        for (const file of files) {
            await this.chromaService.deleteFileChunks(file.fileId);
        }

        // Delete metadata
        await this.duckdbService.deleteWorkspaceIndex(normalizedPath);
    }

    /**
     * Get index entries for the sidebar view
     */
    async getIndexEntries(workspacePath?: string): Promise<IndexEntry[]> {
        let files: IndexedFile[];

        if (workspacePath) {
            files = await this.duckdbService.getIndexedFilesForWorkspace(normalizePath(workspacePath));
        } else {
            files = await this.duckdbService.getAllIndexedFiles();
        }

        const entries: IndexEntry[] = [];

        for (const file of files) {
            // Check if file is stale (content changed since indexing)
            let isStale = false;
            try {
                const uri = vscode.Uri.file(file.filePath);
                const content = await readFileContent(uri);
                const currentHash = calculateMD5(content);
                isStale = currentHash !== file.md5Hash;
            } catch {
                // File might have been deleted
                isStale = true;
            }

            const chunkCount = await this.chromaService.getFileChunkCount(file.fileId);

            entries.push({
                fileId: file.fileId,
                filePath: file.filePath,
                relativePath: getRelativePath(file.workspacePath, file.filePath),
                isStale,
                lastIndexedAt: new Date(file.lastIndexedAt),
                chunkCount,
            });
        }

        return entries;
    }

    /**
     * Check if a file needs reindexing
     */
    async isFileStale(filePath: string): Promise<boolean> {
        const indexedFile = await this.duckdbService.getIndexedFileByPath(normalizePath(filePath));
        if (!indexedFile) {
            return true; // Not indexed
        }

        try {
            const uri = vscode.Uri.file(filePath);
            const content = await readFileContent(uri);
            const currentHash = calculateMD5(content);
            return currentHash !== indexedFile.md5Hash;
        } catch {
            return true; // File might have been deleted
        }
    }

    /**
     * Reindex stale files
     */
    async reindexStaleFiles(
        workspacePath: string,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<void> {
        const entries = await this.getIndexEntries(workspacePath);
        const staleEntries = entries.filter((e) => e.isStale);

        if (staleEntries.length === 0) {
            return;
        }

        const fileUris = staleEntries.map((e) => vscode.Uri.file(e.filePath));
        await this.indexFiles(fileUris, workspacePath, progress);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.statusEmitter.dispose();
    }
}
