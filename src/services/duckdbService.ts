/**
 * DuckDB Service for metadata persistence
 */

import * as path from 'path';
import * as fs from 'fs';
import { IndexedFile } from '../models/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let duckdb: any;

export class DuckDBService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private db: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private connection: any = null;
    private storagePath: string;
    private dbPath: string;
    private initialized: boolean = false;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.dbPath = path.join(storagePath, 'metadata.duckdb');
    }

    /**
     * Initialize DuckDB connection and create tables
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Ensure storage directory exists
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }

        // Dynamically import duckdb
        duckdb = require('duckdb');

        return new Promise((resolve, reject) => {
            this.db = new duckdb.Database(this.dbPath, (err: Error | null) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.connection = this.db!.connect();
                this.createTables()
                    .then(() => {
                        this.initialized = true;
                        resolve();
                    })
                    .catch(reject);
            });
        });
    }

    /**
     * Create necessary tables
     */
    private async createTables(): Promise<void> {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS indexed_files (
                file_id VARCHAR PRIMARY KEY,
                file_path VARCHAR NOT NULL,
                workspace_path VARCHAR NOT NULL,
                md5_hash VARCHAR NOT NULL,
                last_indexed_at BIGINT NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_workspace_path ON indexed_files(workspace_path);
            CREATE INDEX IF NOT EXISTS idx_file_path ON indexed_files(file_path);
        `;

        return this.runSQL(createTableSQL);
    }

    /**
     * Run SQL statement
     */
    private runSQL(sql: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.connection.run(sql, (err: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Query and return results
     */
    private querySQL<T>(sql: string, ...params: unknown[]): Promise<T[]> {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.connection.all(sql, ...params, (err: Error | null, rows: T[]) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows as T[]);
                }
            });
        });
    }

    /**
     * Add or update an indexed file record
     */
    async upsertIndexedFile(file: IndexedFile): Promise<void> {
        const sql = `
            INSERT INTO indexed_files (file_id, file_path, workspace_path, md5_hash, last_indexed_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (file_id) DO UPDATE SET
                file_path = excluded.file_path,
                workspace_path = excluded.workspace_path,
                md5_hash = excluded.md5_hash,
                last_indexed_at = excluded.last_indexed_at
        `;

        return new Promise((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.connection.run(
                sql,
                file.fileId,
                file.filePath,
                file.workspacePath,
                file.md5Hash,
                file.lastIndexedAt,
                (err: Error | null) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    /**
     * Get indexed file by file ID
     */
    async getIndexedFile(fileId: string): Promise<IndexedFile | null> {
        const sql = `SELECT * FROM indexed_files WHERE file_id = ?`;
        const rows = await this.querySQL<{
            file_id: string;
            file_path: string;
            workspace_path: string;
            md5_hash: string;
            last_indexed_at: number;
        }>(sql, fileId);

        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            fileId: row.file_id,
            filePath: row.file_path,
            workspacePath: row.workspace_path,
            md5Hash: row.md5_hash,
            lastIndexedAt: row.last_indexed_at,
        };
    }

    /**
     * Get indexed file by file path
     */
    async getIndexedFileByPath(filePath: string): Promise<IndexedFile | null> {
        const sql = `SELECT * FROM indexed_files WHERE file_path = ?`;
        const rows = await this.querySQL<{
            file_id: string;
            file_path: string;
            workspace_path: string;
            md5_hash: string;
            last_indexed_at: number;
        }>(sql, filePath);

        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            fileId: row.file_id,
            filePath: row.file_path,
            workspacePath: row.workspace_path,
            md5Hash: row.md5_hash,
            lastIndexedAt: row.last_indexed_at,
        };
    }

    /**
     * Get all indexed files for a workspace
     */
    async getIndexedFilesForWorkspace(workspacePath: string): Promise<IndexedFile[]> {
        const sql = `SELECT * FROM indexed_files WHERE workspace_path = ?`;
        const rows = await this.querySQL<{
            file_id: string;
            file_path: string;
            workspace_path: string;
            md5_hash: string;
            last_indexed_at: number;
        }>(sql, workspacePath);

        return rows.map((row) => ({
            fileId: row.file_id,
            filePath: row.file_path,
            workspacePath: row.workspace_path,
            md5Hash: row.md5_hash,
            lastIndexedAt: row.last_indexed_at,
        }));
    }

    /**
     * Get all indexed files
     */
    async getAllIndexedFiles(): Promise<IndexedFile[]> {
        const sql = `SELECT * FROM indexed_files`;
        const rows = await this.querySQL<{
            file_id: string;
            file_path: string;
            workspace_path: string;
            md5_hash: string;
            last_indexed_at: number;
        }>(sql);

        return rows.map((row) => ({
            fileId: row.file_id,
            filePath: row.file_path,
            workspacePath: row.workspace_path,
            md5Hash: row.md5_hash,
            lastIndexedAt: row.last_indexed_at,
        }));
    }

    /**
     * Delete indexed file by file ID
     */
    async deleteIndexedFile(fileId: string): Promise<void> {
        const sql = `DELETE FROM indexed_files WHERE file_id = ?`;
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.connection.run(sql, fileId, (err: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Delete all indexed files for a workspace
     */
    async deleteWorkspaceIndex(workspacePath: string): Promise<void> {
        const sql = `DELETE FROM indexed_files WHERE workspace_path = ?`;
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.connection.run(sql, workspacePath, (err: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Get count of indexed files for a workspace
     */
    async getIndexedFileCount(workspacePath?: string): Promise<number> {
        let sql = `SELECT COUNT(*) as count FROM indexed_files`;
        let params: unknown[] = [];
        
        if (workspacePath) {
            sql += ` WHERE workspace_path = ?`;
            params = [workspacePath];
        }

        const rows = await this.querySQL<{ count: number }>(sql, ...params);
        return rows[0]?.count ?? 0;
    }

    /**
     * Close database connection
     */
    async close(): Promise<void> {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close(() => {
                    this.db = null;
                    this.connection = null;
                    this.initialized = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
