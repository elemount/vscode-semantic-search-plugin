/**
 * Build Index Command
 */

import * as vscode from 'vscode';
import { IndexingService } from '../services/indexingService';
import { normalizePath } from '../utils/fileUtils';
import { EmbeddingService } from '../services/embeddingService';
import { StatusBarManager } from '../services/statusBarManager';

export function registerBuildIndexCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.buildIndex', async () => {
        // Ensure embedding model is loaded
        if (embeddingService && statusBarManager) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Semantic Search',
                    cancellable: false,
                },
                async (progress) => {
                    const state = embeddingService.getState();
                    if (state === 'not-loaded') {
                        progress.report({ message: 'Loading embedding model...' });
                        statusBarManager.updateModelStatus('loading');
                        
                        await embeddingService.ensureInitialized((p) => {
                            if (p.status === 'progress' && p.total) {
                                const percent = Math.round((p.loaded || 0) / p.total * 100);
                                progress.report({ 
                                    message: `Loading model: ${percent}%`,
                                    increment: 0
                                });
                                statusBarManager.updateModelStatus('loading', percent);
                            }
                        });
                        
                        statusBarManager.updateModelStatus('ready');
                    }
                }
            );
        }
        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // If multiple workspaces, let user choose
        let selectedFolder: vscode.WorkspaceFolder;
        if (workspaceFolders.length === 1) {
            selectedFolder = workspaceFolders[0];
        } else {
            const selected = await vscode.window.showQuickPick(
                workspaceFolders.map((f) => ({
                    label: f.name,
                    description: f.uri.fsPath,
                    folder: f,
                })),
                {
                    placeHolder: 'Select workspace folder to index',
                }
            );

            if (!selected) {
                return;
            }

            selectedFolder = selected.folder;
        }

        // Run indexing with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Building Semantic Search Index',
                cancellable: false,
            },
            async (progress) => {
                try {
                    await indexingService.indexWorkspace(selectedFolder, progress);
                    vscode.window.showInformationMessage(
                        `Indexing complete for ${selectedFolder.name}`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Indexing failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        );
    });
}

/**
 * Add workspace to index command - allows adding external folders to the index
 */
export function registerAddWorkspaceToIndexCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): vscode.Disposable {
    return vscode.commands.registerCommand(
        'semantic-search.addWorkspaceToIndex',
        async () => {
            // Open folder picker to select a folder to add
            const selectedFolders = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Add to Index',
                title: 'Select a folder to add to the semantic search index',
            });

            if (!selectedFolders || selectedFolders.length === 0) {
                return;
            }

            const folderUri = selectedFolders[0];
            const folderPath = normalizePath(folderUri.fsPath);
            const folderName = folderPath.replace(/\\/g, '/').split('/').pop() || folderPath;

            // Ensure embedding model is loaded
            if (embeddingService && statusBarManager) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Semantic Search',
                        cancellable: false,
                    },
                    async (progress) => {
                        const state = embeddingService.getState();
                        if (state === 'not-loaded') {
                            progress.report({ message: 'Loading embedding model...' });
                            statusBarManager.updateModelStatus('loading');
                            
                            await embeddingService.ensureInitialized((p) => {
                                if (p.status === 'progress' && p.total) {
                                    const percent = Math.round((p.loaded || 0) / p.total * 100);
                                    progress.report({ 
                                        message: `Loading model: ${percent}%`,
                                        increment: 0
                                    });
                                    statusBarManager.updateModelStatus('loading', percent);
                                }
                            });
                            
                            statusBarManager.updateModelStatus('ready');
                        }
                    }
                );
            }

            // Run indexing with progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Adding ${folderName} to Index`,
                    cancellable: false,
                },
                async (progress) => {
                    try {
                        // Create a pseudo workspace folder for indexing
                        const pseudoWorkspaceFolder: vscode.WorkspaceFolder = {
                            uri: folderUri,
                            name: folderName,
                            index: -1, // Indicates it's not a real workspace folder
                        };
                        await indexingService.indexWorkspace(pseudoWorkspaceFolder, progress);
                        vscode.window.showInformationMessage(
                            `Successfully added ${folderName} to the index`
                        );
                        // Refresh the index view
                        await vscode.commands.executeCommand('semantic-search.refreshIndex');
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to add folder to index: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            );
        }
    );
}

/**
 * Index specific files/folders command
 */
export function registerIndexFilesCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): vscode.Disposable {
    return vscode.commands.registerCommand(
        'semantic-search.indexFiles',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            // Ensure embedding model is loaded
            if (embeddingService && statusBarManager) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Semantic Search',
                        cancellable: false,
                    },
                    async (progress) => {
                        const state = embeddingService.getState();
                        if (state === 'not-loaded') {
                            progress.report({ message: 'Loading embedding model...' });
                            statusBarManager.updateModelStatus('loading');
                            
                            await embeddingService.ensureInitialized((p) => {
                                if (p.status === 'progress' && p.total) {
                                    const percent = Math.round((p.loaded || 0) / p.total * 100);
                                    progress.report({ 
                                        message: `Loading model: ${percent}%`,
                                        increment: 0
                                    });
                                    statusBarManager.updateModelStatus('loading', percent);
                                }
                            });
                            
                            statusBarManager.updateModelStatus('ready');
                        }
                    }
                );
            }
            // Get files to index
            let filesToIndex: vscode.Uri[] = [];

            if (uris && uris.length > 0) {
                filesToIndex = uris;
            } else if (uri) {
                filesToIndex = [uri];
            } else {
                // Open file picker
                const selected = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: true,
                    canSelectMany: true,
                    title: 'Select files or folders to index',
                });

                if (!selected || selected.length === 0) {
                    return;
                }

                filesToIndex = selected;
            }

            // Get workspace folder
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(filesToIndex[0]);
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Selected files must be within a workspace folder');
                return;
            }

            const workspacePath = normalizePath(workspaceFolder.uri.fsPath);

            // Expand folders to files
            const expandedFiles: vscode.Uri[] = [];
            for (const fileUri of filesToIndex) {
                const stat = await vscode.workspace.fs.stat(fileUri);
                if (stat.type === vscode.FileType.Directory) {
                    // Find all files in the directory
                    const pattern = new vscode.RelativePattern(fileUri, '**/*');
                    const files = await vscode.workspace.findFiles(pattern);
                    expandedFiles.push(...files);
                } else {
                    expandedFiles.push(fileUri);
                }
            }

            // Run indexing with progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Indexing Selected Files',
                    cancellable: false,
                },
                async (progress) => {
                    try {
                        await indexingService.indexFiles(expandedFiles, workspacePath, progress);
                        vscode.window.showInformationMessage(
                            `Indexed ${expandedFiles.length} file(s)`
                        );
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Indexing failed: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            );
        }
    );
}
