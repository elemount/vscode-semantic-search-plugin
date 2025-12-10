/**
 * Index Sidebar View Provider
 * Tree view with workspace → folder → file → chunk hierarchy
 * Uses database folder structure (folders_v1) instead of path parsing
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IndexingService } from '../services/indexingService';
import { VectorDbService } from '../services/vectorDbService';
import { Workspace, Folder, IndexedFile, CodeChunk } from '../models/types';

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

type TreeItemType = 'workspace' | 'folder' | 'file' | 'chunk' | 'placeholder';

/**
 * Tree item for the index sidebar
 */
class IndexTreeItem extends vscode.TreeItem {
    public readonly itemType: TreeItemType;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        // Data for different node types
        public readonly workspace?: Workspace,
        public readonly folder?: Folder,
        public readonly file?: IndexedFile,
        public readonly chunk?: CodeChunk,
    ) {
        super(label, collapsibleState);

        if (chunk && file) {
            this.itemType = 'chunk';
            const lineRange = `Lines ${chunk.lineStart}-${chunk.lineEnd}`;
            this.tooltip = new vscode.MarkdownString(
                `**${lineRange}**\n\n` +
                `\`\`\`\n${chunk.content.substring(0, 200)}${chunk.content.length > 200 ? '...' : ''}\n\`\`\``
            );
            this.description = lineRange;
            this.iconPath = new vscode.ThemeIcon('symbol-snippet');
            this.contextValue = 'chunk';

            // Command to open file at specific line
            this.command = {
                command: 'vscode.open',
                title: 'Open Chunk',
                arguments: [
                    vscode.Uri.file(file.filePath),
                    {
                        selection: new vscode.Range(
                            new vscode.Position(chunk.lineStart - 1, 0),
                            new vscode.Position(chunk.lineEnd, 2147483647)
                        )
                    }
                ],
            };
        } else if (file) {
            this.itemType = 'file';
            this.tooltip = new vscode.MarkdownString(
                `**${file.fileName}**\n\n` +
                `- **Path:** ${file.filePath}\n` +
                `- **Last indexed:** ${new Date(file.lastIndexedAt).toLocaleString()}`
            );
            this.iconPath = getFileIcon(file.filePath);
            this.contextValue = 'indexedFile';

            // If not expandable (no chunks), clicking opens the file
            if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
                this.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [vscode.Uri.file(file.filePath)],
                };
            }
        } else if (folder) {
            this.itemType = 'folder';
            this.tooltip = folder.folderPath;
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'indexedFolder';
        } else if (workspace) {
            this.itemType = 'workspace';
            this.tooltip = new vscode.MarkdownString(
                `**${workspace.workspacePath}**\n\n` +
                `- **Status:** ${workspace.status}\n` +
                `- **Created:** ${new Date(workspace.createdAt).toLocaleString()}`
            );
            this.iconPath = new vscode.ThemeIcon('folder-library');
            this.contextValue = 'workspace';
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
    private vectorDbService: VectorDbService | null = null;
    private showChunks: boolean = true;

    constructor(indexingService: IndexingService, vectorDbService?: VectorDbService) {
        this.indexingService = indexingService;
        this.vectorDbService = vectorDbService || null;

        // Refresh when indexing status changes
        this.indexingService.onStatusChange((status) => {
            if (!status.isIndexing) {
                this.refresh();
            }
        });
    }

    setVectorDbService(service: VectorDbService): void {
        this.vectorDbService = service;
    }

    setShowChunks(enabled: boolean): void {
        this.showChunks = enabled;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: IndexTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IndexTreeItem): Promise<IndexTreeItem[]> {
        if (!this.vectorDbService) {
            return [
                new IndexTreeItem(
                    'Database not initialized',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }

        try {
            if (!element) {
                // Root level - show indexed workspaces
                return this.getWorkspaceItems();
            } else if (element.workspace) {
                // Workspace level - show root folders and root files
                return this.getWorkspaceChildren(element.workspace);
            } else if (element.folder) {
                // Folder level - show subfolders and files
                return this.getFolderChildren(element.folder);
            } else if (element.file && this.showChunks) {
                // File level - show chunks
                return this.getFileChunks(element.file);
            }
        } catch (error) {
            console.error('IndexSidebar: Error getting children:', error);
            return [
                new IndexTreeItem(
                    `Error: ${error instanceof Error ? error.message : String(error)}`,
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }

        return [];
    }

    /**
     * Get workspace tree items from database
     */
    private async getWorkspaceItems(): Promise<IndexTreeItem[]> {
        const workspaces = await this.vectorDbService!.getAllWorkspaces();

        if (workspaces.length === 0) {
            return [
                new IndexTreeItem(
                    'No workspaces indexed. Click "+" to add a workspace.',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }

        return workspaces.map(workspace => new IndexTreeItem(
            workspace.workspaceName,
            vscode.TreeItemCollapsibleState.Collapsed,
            workspace
        ));
    }

    /**
     * Get children of a workspace (root folders + root files)
     */
    private async getWorkspaceChildren(workspace: Workspace): Promise<IndexTreeItem[]> {
        const items: IndexTreeItem[] = [];

        // Get root folders (folders with no parent)
        const rootFolders = await this.vectorDbService!.getChildFolders(workspace.workspaceId, null);
        for (const folder of rootFolders.sort((a, b) => a.folderName.localeCompare(b.folderName))) {
            items.push(new IndexTreeItem(
                folder.folderName,
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                folder
            ));
        }

        // Get root files (files without a folder)
        const rootFiles = await this.vectorDbService!.getRootFiles(workspace.workspaceId);
        for (const file of rootFiles.sort((a, b) => a.fileName.localeCompare(b.fileName))) {
            const chunkCount = await this.vectorDbService!.getFileChunkCount(file.fileId);
            const hasChunks = this.showChunks && chunkCount > 0;
            items.push(new IndexTreeItem(
                file.fileName,
                hasChunks ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                file
            ));
        }

        if (items.length === 0) {
            return [
                new IndexTreeItem(
                    'No files indexed yet',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }

        return items;
    }

    /**
     * Get children of a folder (subfolders + files)
     */
    private async getFolderChildren(folder: Folder): Promise<IndexTreeItem[]> {
        const items: IndexTreeItem[] = [];

        // Get subfolders
        const subfolders = await this.vectorDbService!.getChildFolders(folder.workspaceId, folder.folderId);
        for (const subfolder of subfolders.sort((a, b) => a.folderName.localeCompare(b.folderName))) {
            items.push(new IndexTreeItem(
                subfolder.folderName,
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                subfolder
            ));
        }

        // Get files in this folder
        const files = await this.vectorDbService!.getFilesByFolderId(folder.folderId);
        for (const file of files.sort((a, b) => a.fileName.localeCompare(b.fileName))) {
            const chunkCount = await this.vectorDbService!.getFileChunkCount(file.fileId);
            const hasChunks = this.showChunks && chunkCount > 0;
            items.push(new IndexTreeItem(
                file.fileName,
                hasChunks ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                undefined,
                undefined,
                file
            ));
        }

        return items;
    }

    /**
     * Get chunks for a file
     */
    private async getFileChunks(file: IndexedFile): Promise<IndexTreeItem[]> {
        const chunks = await this.vectorDbService!.getChunksForFile(file.fileId);

        if (chunks.length === 0) {
            return [];
        }

        return chunks.map((chunk, index) => new IndexTreeItem(
            `Chunk ${index + 1}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            file,  // Pass file for opening
            chunk
        ));
    }
}

/**
 * Register the index sidebar view
 */
export function registerIndexSidebarView(
    context: vscode.ExtensionContext,
    indexingService: IndexingService,
    vectorDbService?: VectorDbService
): vscode.TreeView<IndexTreeItem> {
    const treeDataProvider = new IndexTreeDataProvider(indexingService, vectorDbService);

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

    // Register toggle show chunks command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.toggleShowChunks', () => {
            const current = treeDataProvider['showChunks'];
            treeDataProvider.setShowChunks(!current);
        })
    );

    // Register reindex single file command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.reindexFile', async (item: IndexTreeItem) => {
            if (item?.file) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Reindexing ${item.file.fileName}...`,
                    },
                    async () => {
                        await indexingService.indexFile(
                            vscode.Uri.file(item.file!.filePath),
                            item.file!.workspacePath || ''
                        );
                        treeDataProvider.refresh();
                    }
                );
                vscode.window.showInformationMessage(`Reindexed ${item.file.fileName}`);
            }
        })
    );

    // Register reindex folder command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.reindexFolder', async (item: IndexTreeItem) => {
            if (item?.folder && vectorDbService) {
                const files = await vectorDbService.getFilesByFolderId(item.folder.folderId);
                
                if (files.length === 0) {
                    vscode.window.showInformationMessage(`No indexed files in folder ${item.folder.folderName}`);
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Reindexing folder ${item.folder.folderName}...`,
                        cancellable: true,
                    },
                    async (progress, token) => {
                        let indexed = 0;
                        for (const file of files) {
                            if (token.isCancellationRequested) {
                                break;
                            }
                            progress.report({ 
                                message: `${indexed + 1}/${files.length}: ${file.fileName}`,
                                increment: 100 / files.length 
                            });
                            await indexingService.indexFile(
                                vscode.Uri.file(file.filePath),
                                file.workspacePath || ''
                            );
                            indexed++;
                        }
                        treeDataProvider.refresh();
                        vscode.window.showInformationMessage(`Reindexed ${indexed} files in ${item.folder!.folderName}`);
                    }
                );
            }
        })
    );

    // Register delete folder index command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.deleteFolderIndex', async (item: IndexTreeItem) => {
            if (item?.folder && vectorDbService) {
                const files = await vectorDbService.getFilesByFolderId(item.folder.folderId);
                
                if (files.length === 0) {
                    vscode.window.showInformationMessage(`No indexed files in folder ${item.folder.folderName}`);
                    return;
                }

                const confirm = await vscode.window.showWarningMessage(
                    `Delete index for ${files.length} files in folder ${item.folder.folderName}?`,
                    { modal: true },
                    'Delete'
                );

                if (confirm !== 'Delete') {
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Deleting folder index ${item.folder.folderName}...`,
                    },
                    async () => {
                        for (const file of files) {
                            await indexingService.deleteFileIndex(file.filePath);
                        }
                        treeDataProvider.refresh();
                        vscode.window.showInformationMessage(`Deleted index for ${files.length} files in ${item.folder!.folderName}`);
                    }
                );
            }
        })
    );

    // Register reindex workspace command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.reindexWorkspace', async (item: IndexTreeItem) => {
            if (item?.workspace) {
                // Create a pseudo workspace folder for indexing
                const pseudoWorkspaceFolder: vscode.WorkspaceFolder = {
                    uri: vscode.Uri.file(item.workspace.workspacePath),
                    name: item.workspace.workspaceName,
                    index: -1,
                };
                
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Reindexing workspace ${item.workspace.workspaceName}...`,
                        cancellable: false,
                    },
                    async (progress) => {
                        await indexingService.indexWorkspace(pseudoWorkspaceFolder, progress);
                        treeDataProvider.refresh();
                    }
                );
                vscode.window.showInformationMessage(`Reindexed workspace ${item.workspace.workspaceName}`);
            }
        })
    );

    // Register delete workspace index command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.deleteWorkspaceIndex', async (item: IndexTreeItem) => {
            if (item?.workspace) {
                const confirm = await vscode.window.showWarningMessage(
                    `Delete entire index for workspace ${item.workspace.workspaceName}?`,
                    { modal: true },
                    'Delete'
                );

                if (confirm !== 'Delete') {
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Deleting workspace index...`,
                    },
                    async () => {
                        await indexingService.deleteWorkspaceIndex(item.workspace!.workspacePath);
                        treeDataProvider.refresh();
                        vscode.window.showInformationMessage(`Workspace index deleted`);
                    }
                );
            }
        })
    );

    // Register reveal in explorer command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.revealInExplorer', async (item: IndexTreeItem) => {
            if (item?.file) {
                const uri = vscode.Uri.file(item.file.filePath);
                await vscode.commands.executeCommand('revealInExplorer', uri);
            }
        })
    );

    // Register copy path command
    context.subscriptions.push(
        vscode.commands.registerCommand('semantic-search.copyPath', async (item: IndexTreeItem) => {
            if (item?.file) {
                await vscode.env.clipboard.writeText(item.file.filePath);
                vscode.window.showInformationMessage('Path copied to clipboard');
            }
        })
    );

    return treeView;
}
