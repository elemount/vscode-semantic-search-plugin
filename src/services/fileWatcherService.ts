/**
 * File Watcher Service
 * Watches for file changes and triggers incremental indexing
 */

import * as vscode from 'vscode';
import { IndexingService } from './indexingService';
import { IndexingConfig, DEFAULT_INDEXING_CONFIG } from '../models/types';
import { minimatch } from 'minimatch';
import { getLogger } from './logger';

export class FileWatcherService {
    private disposables: vscode.Disposable[] = [];
    private pendingFiles: Map<string, NodeJS.Timeout> = new Map();
    private debounceMs: number = 1000; // Debounce file changes

    constructor(
        private indexingService: IndexingService,
        private config: IndexingConfig = DEFAULT_INDEXING_CONFIG
    ) {}

    /**
     * Start watching for file changes
     */
    start(): void {
        // Check if auto-indexing is enabled
        const autoIndex = vscode.workspace.getConfiguration('semanticSearch').get<boolean>('autoIndex', false);
        if (!autoIndex) {
            getLogger().debug('FileWatcher', 'Auto-indexing is disabled');
            return;
        }

        getLogger().info('FileWatcher', 'Starting file watcher for auto-indexing...');

        // Watch for file saves
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                this.handleFileChange(document.uri, 'save');
            })
        );

        // Watch for file creations
        this.disposables.push(
            vscode.workspace.onDidCreateFiles((event) => {
                for (const uri of event.files) {
                    this.handleFileChange(uri, 'create');
                }
            })
        );

        // Watch for file deletions
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles((event) => {
                for (const uri of event.files) {
                    this.handleFileDelete(uri);
                }
            })
        );

        // Watch for file renames
        this.disposables.push(
            vscode.workspace.onDidRenameFiles((event) => {
                for (const { oldUri, newUri } of event.files) {
                    this.handleFileDelete(oldUri);
                    this.handleFileChange(newUri, 'rename');
                }
            })
        );

        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('semanticSearch.autoIndex')) {
                    const enabled = vscode.workspace.getConfiguration('semanticSearch').get<boolean>('autoIndex', false);
                    if (!enabled) {
                        this.stop();
                    }
                }
            })
        );

        getLogger().info('FileWatcher', 'File watcher started');
    }

    /**
     * Stop watching for file changes
     */
    stop(): void {
        getLogger().info('FileWatcher', 'Stopping file watcher...');
        
        // Clear pending file operations
        for (const timeout of this.pendingFiles.values()) {
            clearTimeout(timeout);
        }
        this.pendingFiles.clear();

        // Dispose all watchers
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }

    /**
     * Handle file change (save, create, rename)
     */
    private async handleFileChange(uri: vscode.Uri, changeType: 'save' | 'create' | 'rename'): Promise<void> {
        const filePath = uri.fsPath;

        // Check if file should be indexed
        if (!this.shouldIndexFile(filePath)) {
            return;
        }

        // Get workspace folder for the file
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
        }

        getLogger().debug('FileWatcher', `File ${changeType}: ${filePath}`);

        // Debounce rapid changes to the same file
        const existingTimeout = this.pendingFiles.get(filePath);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(async () => {
            this.pendingFiles.delete(filePath);
            
            try {
                await this.indexingService.indexFile(uri, workspaceFolder.uri.fsPath);
                getLogger().info('FileWatcher', `Auto-indexed: ${filePath}`);
            } catch (error) {
                getLogger().error('FileWatcher', `Failed to auto-index ${filePath}`, error);
            }
        }, this.debounceMs);

        this.pendingFiles.set(filePath, timeout);
    }

    /**
     * Handle file deletion
     */
    private async handleFileDelete(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;

        // Clear any pending index operation for this file
        const existingTimeout = this.pendingFiles.get(filePath);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.pendingFiles.delete(filePath);
        }

        try {
            await this.indexingService.deleteFileIndex(filePath);
            getLogger().info('FileWatcher', `Removed index for deleted file: ${filePath}`);
        } catch (error) {
            getLogger().error('FileWatcher', `Failed to remove index for ${filePath}`, error);
        }
    }

    /**
     * Check if a file should be indexed based on include/exclude patterns
     */
    private shouldIndexFile(filePath: string): boolean {
        // Normalize path for pattern matching
        const normalizedPath = filePath.replace(/\\/g, '/');

        // Check exclude patterns
        for (const pattern of this.config.excludePatterns) {
            if (minimatch(normalizedPath, pattern, { dot: true })) {
                return false;
            }
        }

        // Check include patterns
        for (const pattern of this.config.includePatterns) {
            if (minimatch(normalizedPath, pattern, { dot: true })) {
                return true;
            }
        }

        return false;
    }

    /**
     * Update configuration
     */
    updateConfig(config: IndexingConfig): void {
        this.config = config;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.stop();
    }
}
