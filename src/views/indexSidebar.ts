/**
 * Index Sidebar View Provider
 */

import * as vscode from 'vscode';
import { IndexingService } from '../services/indexingService';
import { IndexEntry, WorkspaceIndex } from '../models/types';
import { normalizePath } from '../utils/fileUtils';

/**
 * Tree item for the index sidebar
 */
class IndexTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly entry?: IndexEntry,
        public readonly workspaceInfo?: WorkspaceIndex
    ) {
        super(label, collapsibleState);

        if (entry) {
            this.tooltip = `${entry.filePath}\nChunks: ${entry.chunkCount}\nLast indexed: ${entry.lastIndexedAt.toLocaleString()}`;
            this.description = entry.isStale ? '(stale)' : `${entry.chunkCount} chunks`;
            this.iconPath = new vscode.ThemeIcon(entry.isStale ? 'warning' : 'file');
            this.contextValue = 'indexedFile';
            
            // Add command to open file
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(entry.filePath)],
            };
        } else if (workspaceInfo) {
            this.tooltip = `${workspaceInfo.totalFiles} files, ${workspaceInfo.totalChunks} chunks\nLast updated: ${workspaceInfo.lastUpdated.toLocaleString()}`;
            this.description = `${workspaceInfo.totalFiles} files`;
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'workspace';
        }
    }
}

/**
 * Tree data provider for the index sidebar
 */
export class IndexTreeDataProvider implements vscode.TreeDataProvider<IndexTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<IndexTreeItem | undefined | null | void> =
        new vscode.EventEmitter<IndexTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IndexTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private indexingService: IndexingService;

    constructor(indexingService: IndexingService) {
        this.indexingService = indexingService;

        // Refresh when indexing status changes
        this.indexingService.onStatusChange(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: IndexTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IndexTreeItem): Promise<IndexTreeItem[]> {
        if (!element) {
            // Root level - show workspace folders
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return [
                    new IndexTreeItem(
                        'No workspace open',
                        vscode.TreeItemCollapsibleState.None
                    ),
                ];
            }

            const items: IndexTreeItem[] = [];

            for (const folder of workspaceFolders) {
                const workspacePath = normalizePath(folder.uri.fsPath);
                const entries = await this.indexingService.getIndexEntries(workspacePath);

                const workspaceInfo: WorkspaceIndex = {
                    workspacePath,
                    totalFiles: entries.length,
                    totalChunks: entries.reduce((sum, e) => sum + e.chunkCount, 0),
                    lastUpdated: entries.length > 0
                        ? new Date(Math.max(...entries.map((e) => e.lastIndexedAt.getTime())))
                        : new Date(),
                };

                items.push(
                    new IndexTreeItem(
                        folder.name,
                        entries.length > 0
                            ? vscode.TreeItemCollapsibleState.Collapsed
                            : vscode.TreeItemCollapsibleState.None,
                        undefined,
                        workspaceInfo
                    )
                );
            }

            return items;
        } else if (element.workspaceInfo) {
            // Workspace level - show indexed files
            const entries = await this.indexingService.getIndexEntries(
                element.workspaceInfo.workspacePath
            );

            if (entries.length === 0) {
                return [
                    new IndexTreeItem(
                        'No files indexed',
                        vscode.TreeItemCollapsibleState.None
                    ),
                ];
            }

            return entries.map(
                (entry) =>
                    new IndexTreeItem(
                        entry.relativePath,
                        vscode.TreeItemCollapsibleState.None,
                        entry
                    )
            );
        }

        return [];
    }
}

/**
 * Register the index sidebar view
 */
export function registerIndexSidebarView(
    context: vscode.ExtensionContext,
    indexingService: IndexingService
): vscode.TreeView<IndexTreeItem> {
    const treeDataProvider = new IndexTreeDataProvider(indexingService);

    const treeView = vscode.window.createTreeView('semanticSearchIndex', {
        treeDataProvider,
        showCollapseAll: true,
    });

    // Register refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.refreshIndex', () => {
            treeDataProvider.refresh();
        })
    );

    return treeView;
}
