/**
 * Status Bar Manager
 * Manages status bar items for indexing progress and Chroma server status
 */

import * as vscode from 'vscode';
import { ChromaServerStatus } from './chromaProcessManager';
import { IndexingStatus } from '../models/types';

export class StatusBarManager {
    private chromaStatusItem: vscode.StatusBarItem;
    private indexingStatusItem: vscode.StatusBarItem;

    constructor() {
        // Create Chroma server status item
        this.chromaStatusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.chromaStatusItem.name = 'Chroma Server Status';
        this.chromaStatusItem.command = 'semantic-search.showServerLogs';
        this.updateChromaStatus('stopped');
        this.chromaStatusItem.show();

        // Create indexing status item
        this.indexingStatusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        this.indexingStatusItem.name = 'Semantic Search Indexing';
        this.indexingStatusItem.hide(); // Only show when indexing
    }

    /**
     * Update Chroma server status display
     */
    updateChromaStatus(status: ChromaServerStatus): void {
        switch (status) {
            case 'stopped':
                this.chromaStatusItem.text = '$(circle-slash) Chroma';
                this.chromaStatusItem.tooltip = 'Chroma server is stopped';
                this.chromaStatusItem.backgroundColor = undefined;
                break;
            case 'starting':
                this.chromaStatusItem.text = '$(sync~spin) Chroma';
                this.chromaStatusItem.tooltip = 'Chroma server is starting...';
                this.chromaStatusItem.backgroundColor = undefined;
                break;
            case 'running':
                this.chromaStatusItem.text = '$(check) Chroma';
                this.chromaStatusItem.tooltip = 'Chroma server is running';
                this.chromaStatusItem.backgroundColor = undefined;
                break;
            case 'error':
                this.chromaStatusItem.text = '$(error) Chroma';
                this.chromaStatusItem.tooltip = 'Chroma server error - click for logs';
                this.chromaStatusItem.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.errorBackground'
                );
                break;
        }
    }

    /**
     * Update indexing status display
     */
    updateIndexingStatus(status: IndexingStatus): void {
        if (!status.isIndexing) {
            this.indexingStatusItem.hide();
            return;
        }

        const progress = status.totalFiles > 0
            ? Math.round((status.processedFiles / status.totalFiles) * 100)
            : 0;

        this.indexingStatusItem.text = `$(sync~spin) Indexing ${progress}%`;
        this.indexingStatusItem.tooltip = status.currentFile
            ? `Indexing: ${status.currentFile}\n${status.processedFiles}/${status.totalFiles} files`
            : `Indexing: ${status.processedFiles}/${status.totalFiles} files`;
        this.indexingStatusItem.show();
    }

    /**
     * Show stale index indicator
     */
    showStaleIndicator(staleCount: number): void {
        if (staleCount > 0) {
            this.indexingStatusItem.text = `$(warning) ${staleCount} stale`;
            this.indexingStatusItem.tooltip = `${staleCount} files have changed since last indexing`;
            this.indexingStatusItem.command = 'semantic-search.buildIndex';
            this.indexingStatusItem.show();
        } else {
            this.indexingStatusItem.hide();
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.chromaStatusItem.dispose();
        this.indexingStatusItem.dispose();
    }
}
