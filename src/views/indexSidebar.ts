/**
 * Index Sidebar View Provider
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IndexingService } from '../services/indexingService';
import { IndexEntry, WorkspaceIndex } from '../models/types';
import { normalizePath } from '../utils/fileUtils';

/**
 * Get file type icon based on extension
 */
function getFileIcon(filePath: string): vscode.ThemeIcon {
    const ext = path.extname(filePath).toLowerCase();
    const iconMap: Record<string, string> = {
        '.ts': 'symbol-method',
        '.tsx': 'symbol-method',
        '.js': 'symbol-method',
        '.jsx': 'symbol-method',
        '.py': 'symbol-method',
        '.java': 'symbol-class',
        '.cs': 'symbol-class',
        '.go': 'symbol-method',
        '.rs': 'symbol-method',
        '.cpp': 'symbol-method',
        '.c': 'symbol-method',
        '.h': 'symbol-interface',
        '.hpp': 'symbol-interface',
        '.md': 'markdown',
        '.json': 'json',
        '.yaml': 'symbol-property',
        '.yml': 'symbol-property',
        '.xml': 'symbol-structure',
        '.html': 'symbol-structure',
        '.css': 'symbol-color',
        '.scss': 'symbol-color',
        '.less': 'symbol-color',
    };
    return new vscode.ThemeIcon(iconMap[ext] || 'file');
}

/**
 * Group entries by folder
 */
function groupEntriesByFolder(entries: IndexEntry[]): Map<string, IndexEntry[]> {
    const groups = new Map<string, IndexEntry[]>();
    
    for (const entry of entries) {
        const folder = path.dirname(entry.relativePath);
        const folderKey = folder === '.' ? '(root)' : folder;
        
        if (!groups.has(folderKey)) {
            groups.set(folderKey, []);
        }
        groups.get(folderKey)!.push(entry);
    }
    
    // Sort groups by folder name
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

type TreeItemType = 'workspace' | 'folder' | 'indexedFile' | 'placeholder';

/**
 * Tree item for the index sidebar
 */
class IndexTreeItem extends vscode.TreeItem {
    public readonly itemType: TreeItemType;
    
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly entry?: IndexEntry,
        public readonly workspaceInfo?: WorkspaceIndex,
        public readonly folderPath?: string,
        public readonly workspacePath?: string
    ) {
        super(label, collapsibleState);

        if (entry) {
            this.itemType = 'indexedFile';
            const staleIndicator = entry.isStale ? ' $(warning)' : '';
            this.tooltip = new vscode.MarkdownString(
                `**${entry.relativePath}**${staleIndicator}\n\n` +
                `- **Chunks:** ${entry.chunkCount}\n` +
                `- **Last indexed:** ${entry.lastIndexedAt.toLocaleString()}\n` +
                `- **Status:** ${entry.isStale ? '⚠️ Stale (file changed)' : '✅ Up to date'}`
            );
            this.description = entry.isStale ? `${entry.chunkCount} chunks (stale)` : `${entry.chunkCount} chunks`;
            this.iconPath = entry.isStale 
                ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
                : getFileIcon(entry.filePath);
            this.contextValue = 'indexedFile';
            
            // Add command to open file
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(entry.filePath)],
            };
        } else if (workspaceInfo) {
            this.itemType = 'workspace';
            const staleCount = 0; // Will be updated dynamically
            this.tooltip = new vscode.MarkdownString(
                `**${workspaceInfo.workspacePath}**\n\n` +
                `- **Files:** ${workspaceInfo.totalFiles}\n` +
                `- **Chunks:** ${workspaceInfo.totalChunks}\n` +
                `- **Last updated:** ${workspaceInfo.lastUpdated.toLocaleString()}`
            );
            this.description = `${workspaceInfo.totalFiles} files, ${workspaceInfo.totalChunks} chunks`;
            this.iconPath = new vscode.ThemeIcon('folder-library');
            this.contextValue = 'workspace';
        } else if (folderPath) {
            this.itemType = 'folder';
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'indexedFolder';
        } else {
            this.itemType = 'placeholder';
            this.iconPath = new vscode.ThemeIcon('info');
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
    private cachedEntries: Map<string, IndexEntry[]> = new Map();
    private groupByFolder: boolean = true;

    constructor(indexingService: IndexingService) {
        this.indexingService = indexingService;

        // Refresh when indexing status changes
        this.indexingService.onStatusChange((status) => {
            if (!status.isIndexing) {
                this.clearCache();
                this.refresh();
            }
        });
    }

    setGroupByFolder(enabled: boolean): void {
        this.groupByFolder = enabled;
        this.refresh();
    }

    clearCache(): void {
        this.cachedEntries.clear();
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
                this.cachedEntries.set(workspacePath, entries);

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
            // Workspace level - show folders or files
            const entries = this.cachedEntries.get(element.workspaceInfo.workspacePath) 
                || await this.indexingService.getIndexEntries(element.workspaceInfo.workspacePath);

            if (entries.length === 0) {
                return [
                    new IndexTreeItem(
                        'No files indexed. Click "Build Index" to start.',
                        vscode.TreeItemCollapsibleState.None
                    ),
                ];
            }

            if (this.groupByFolder) {
                // Group by folder
                const grouped = groupEntriesByFolder(entries);
                const items: IndexTreeItem[] = [];
                
                for (const [folderName, folderEntries] of grouped) {
                    const staleCount = folderEntries.filter(e => e.isStale).length;
                    const item = new IndexTreeItem(
                        folderName,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        undefined,
                        undefined,
                        folderName,
                        element.workspaceInfo.workspacePath
                    );
                    item.description = `${folderEntries.length} files${staleCount > 0 ? ` (${staleCount} stale)` : ''}`;
                    items.push(item);
                }
                
                return items;
            } else {
                // Flat list
                return entries
                    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
                    .map(entry => new IndexTreeItem(
                        entry.relativePath,
                        vscode.TreeItemCollapsibleState.None,
                        entry
                    ));
            }
        } else if (element.folderPath && element.workspacePath) {
            // Folder level - show files in folder
            const entries = this.cachedEntries.get(element.workspacePath) || [];
            const folderKey = element.folderPath;
            
            const folderEntries = entries.filter(entry => {
                const folder = path.dirname(entry.relativePath);
                const entryFolderKey = folder === '.' ? '(root)' : folder;
                return entryFolderKey === folderKey;
            });
            
            return folderEntries
                .sort((a, b) => path.basename(a.relativePath).localeCompare(path.basename(b.relativePath)))
                .map(entry => new IndexTreeItem(
                    path.basename(entry.relativePath),
                    vscode.TreeItemCollapsibleState.None,
                    entry
                ));
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
            treeDataProvider.clearCache();
            treeDataProvider.refresh();
        })
    );

    // Register toggle group by folder command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.toggleGroupByFolder', () => {
            const current = treeDataProvider['groupByFolder'];
            treeDataProvider.setGroupByFolder(!current);
        })
    );

    // Register reindex single file command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.reindexFile', async (item: IndexTreeItem) => {
            if (item?.entry) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(
                    vscode.Uri.file(item.entry.filePath)
                );
                if (workspaceFolder) {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Reindexing ${item.entry.relativePath}...`,
                        },
                        async () => {
                            await indexingService.indexFile(
                                vscode.Uri.file(item.entry!.filePath),
                                workspaceFolder.uri.fsPath
                            );
                            treeDataProvider.clearCache();
                            treeDataProvider.refresh();
                        }
                    );
                    vscode.window.showInformationMessage(`Reindexed ${item.entry.relativePath}`);
                }
            }
        })
    );

    return treeView;
}
