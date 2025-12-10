/**
 * Migration Service - Simple drop and create schema management
 */

import { getLogger } from './logger';

// Schema version constant
export const SCHEMA_VERSION = 1;

/**
 * Migration Service for managing database schema
 * Uses a simple drop-and-create pattern
 */
export class MigrationService {
    private connection: any;
    private dimensions: number;

    constructor(connection: any, dimensions: number) {
        this.connection = connection;
        this.dimensions = dimensions;
    }

    /**
     * Get current schema version from database
     */
    async getCurrentVersion(): Promise<number> {
        try {
            const result = await this.connection.run(`
                SELECT table_name FROM information_schema.tables 
                WHERE table_schema = 'main' AND table_name = 'schema_migrations'
            `);
            const rows = await result.getRows();
            
            if (!rows || rows.length === 0) {
                return 0;
            }

            const versionResult = await this.connection.run(`
                SELECT MAX(version) as version FROM schema_migrations
            `);
            const versionRows = await versionResult.getRows();
            
            if (!versionRows || versionRows.length === 0 || versionRows[0][0] === null) {
                return 0;
            }

            return Number(versionRows[0][0]);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if database needs migration
     */
    async needsMigration(): Promise<boolean> {
        const currentVersion = await this.getCurrentVersion();
        return currentVersion < SCHEMA_VERSION;
    }

    /**
     * Drop all existing tables and recreate schema
     */
    async migrate(): Promise<void> {
        const logger = getLogger();
        logger.info('MigrationService', 'Starting schema migration (drop and create)...');

        // Drop existing tables in reverse dependency order
        await this.dropAllTables();

        // Create fresh schema
        await this.createSchema();

        logger.info('MigrationService', 'Schema migration completed');
    }

    /**
     * Drop all existing tables
     */
    private async dropAllTables(): Promise<void> {
        const logger = getLogger();
        logger.info('MigrationService', 'Dropping existing tables...');

        const tablesToDrop = [
            'file_chunks_small_v1',
            'indexed_files_v1',
            'folders_v1',
            'workspaces_v1',
            'schema_migrations',
            // Legacy tables from older schema versions
            'code_chunks',
            'indexed_files',
            'workspaces',
        ];

        for (const table of tablesToDrop) {
            try {
                await this.connection.run(`DROP TABLE IF EXISTS ${table}`);
            } catch (error) {
                logger.warn('MigrationService', `Could not drop table ${table}`, error);
            }
        }
    }

    /**
     * Create the full schema
     */
    private async createSchema(): Promise<void> {
        const logger = getLogger();
        logger.info('MigrationService', 'Creating schema...');

        // 1. Create schema_migrations table
        await this.connection.run(`
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY
            )
        `);

        // 2. Create workspaces_v1 table
        await this.connection.run(`
            CREATE TABLE workspaces_v1 (
                workspace_id VARCHAR PRIMARY KEY,
                workspace_path VARCHAR NOT NULL,
                workspace_name VARCHAR,
                status VARCHAR DEFAULT 'active',
                created_at BIGINT NOT NULL
            )
        `);
        await this.connection.run(`
            CREATE UNIQUE INDEX idx_workspace_unique_path ON workspaces_v1(workspace_path)
        `);

        // 3. Create folders_v1 table
        await this.connection.run(`
            CREATE TABLE folders_v1 (
                folder_id VARCHAR PRIMARY KEY,
                workspace_id VARCHAR NOT NULL,
                parent_folder_id VARCHAR,
                folder_path VARCHAR NOT NULL,
                folder_name VARCHAR,
                created_at BIGINT NOT NULL
            )
        `);
        await this.connection.run(`
            CREATE INDEX idx_folder_workspace ON folders_v1(workspace_id)
        `);
        await this.connection.run(`
            CREATE UNIQUE INDEX idx_folder_unique_path ON folders_v1(workspace_id, folder_path)
        `);
        await this.connection.run(`
            CREATE INDEX idx_folder_parent ON folders_v1(parent_folder_id)
        `);

        // 4. Create indexed_files_v1 table
        await this.connection.run(`
            CREATE TABLE indexed_files_v1 (
                file_id VARCHAR PRIMARY KEY,
                workspace_id VARCHAR,
                folder_id VARCHAR,
                file_path VARCHAR NOT NULL,
                file_name VARCHAR,
                absolute_path VARCHAR NOT NULL,
                file_size BIGINT,
                last_indexed_at BIGINT NOT NULL,
                md5_hash VARCHAR NOT NULL
            )
        `);
        await this.connection.run(`
            CREATE INDEX idx_file_workspace_id ON indexed_files_v1(workspace_id)
        `);
        await this.connection.run(`
            CREATE INDEX idx_file_folder_id ON indexed_files_v1(folder_id)
        `);
        await this.connection.run(`
            CREATE UNIQUE INDEX idx_file_unique_path ON indexed_files_v1(workspace_id, file_path)
        `);

        // 5. Create file_chunks_small_v1 table
        await this.connection.run(`
            CREATE TABLE file_chunks_small_v1 (
                chunk_id VARCHAR PRIMARY KEY,
                file_id VARCHAR NOT NULL,
                file_path VARCHAR NOT NULL,
                workspace_id VARCHAR NOT NULL,
                workspace_path VARCHAR NOT NULL,
                content TEXT NOT NULL,
                line_start INTEGER NOT NULL,
                line_pos_start INTEGER NOT NULL,
                line_end INTEGER NOT NULL,
                line_pos_end INTEGER NOT NULL,
                chunk_index INTEGER DEFAULT 0,
                embedding FLOAT[${this.dimensions}],
                created_at BIGINT NOT NULL
            )
        `);
        await this.connection.run(`
            CREATE INDEX idx_chunks_file ON file_chunks_small_v1(file_id)
        `);
        await this.connection.run(`
            CREATE INDEX idx_chunks_workspace ON file_chunks_small_v1(workspace_id)
        `);

        // Record migration
        await this.connection.run(`
            INSERT INTO schema_migrations (version) VALUES (${SCHEMA_VERSION})
        `);

        logger.info('MigrationService', 'Schema created successfully');
    }
}
