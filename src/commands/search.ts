/**
 * Search Command
 */

import * as vscode from 'vscode';
import { SearchService } from '../services/searchService';
import { SearchResultsPanel } from '../views/searchResultsPanel';
import { normalizePath } from '../utils/fileUtils';
import { EmbeddingService } from '../services/embeddingService';
import { StatusBarManager } from '../services/statusBarManager';

export function registerSearchCommand(
    context: vscode.ExtensionContext,
    searchService: SearchService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.search', async () => {
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
        
        // Get query from user
        const query = await vscode.window.showInputBox({
            prompt: 'Enter your search query',
            placeHolder: 'e.g., function that handles user authentication',
        });

        if (!query) {
            return;
        }

        // Get workspace path if available
        let workspacePath: string | undefined;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length === 1) {
            workspacePath = normalizePath(workspaceFolders[0].uri.fsPath);
        } else if (workspaceFolders && workspaceFolders.length > 1) {
            const selected = await vscode.window.showQuickPick(
                [
                    { label: 'All workspaces', path: undefined },
                    ...workspaceFolders.map((f) => ({
                        label: f.name,
                        description: f.uri.fsPath,
                        path: normalizePath(f.uri.fsPath),
                    })),
                ],
                {
                    placeHolder: 'Select workspace to search in',
                }
            );

            if (selected && 'path' in selected) {
                workspacePath = selected.path;
            }
        }

        // Get max results from settings
        const maxResults = vscode.workspace.getConfiguration('semanticSearch').get<number>('maxResults', 10);

        // Perform search with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Searching...',
                cancellable: false,
            },
            async () => {
                try {
                    const results = workspacePath
                        ? await searchService.searchInWorkspace(query, workspacePath, maxResults)
                        : await searchService.search(query, maxResults);

                    if (results.length === 0) {
                        vscode.window.showInformationMessage('No results found.');
                        return;
                    }

                    // Show results in quick pick
                    const items = results.map((result, index) => {
                        const relativePath = workspacePath
                            ? result.filePath.replace(workspacePath + '/', '')
                            : result.filePath;

                        return {
                            label: `$(file) ${relativePath}`,
                            description: `Lines ${result.lineStart}-${result.lineEnd}`,
                            detail: result.content.substring(0, 200).replace(/\n/g, ' '),
                            result,
                        };
                    });

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: `Found ${results.length} result(s). Select to open.`,
                        matchOnDescription: true,
                        matchOnDetail: true,
                    });

                    if (selected) {
                        // Open the file at the relevant location
                        const uri = vscode.Uri.file(selected.result.filePath);
                        const document = await vscode.workspace.openTextDocument(uri);
                        const editor = await vscode.window.showTextDocument(document);

                        // Scroll to the relevant lines
                        const startLine = Math.max(0, selected.result.lineStart - 1);
                        const endLine = selected.result.lineEnd - 1;
                        const range = new vscode.Range(startLine, 0, endLine, 0);
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                        editor.selection = new vscode.Selection(startLine, 0, startLine, 0);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Search failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        );
    });
}

/**
 * Search with rich webview panel results
 */
export function registerSearchWithPanelCommand(
    context: vscode.ExtensionContext,
    searchService: SearchService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.searchWithPanel', async () => {
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
        
        // Get query from user
        const query = await vscode.window.showInputBox({
            prompt: 'Enter your search query',
            placeHolder: 'e.g., function that handles user authentication',
        });

        if (!query) {
            return;
        }

        // Get workspace path if available
        let workspacePath: string | undefined;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length === 1) {
            workspacePath = normalizePath(workspaceFolders[0].uri.fsPath);
        } else if (workspaceFolders && workspaceFolders.length > 1) {
            const selected = await vscode.window.showQuickPick(
                [
                    { label: 'All workspaces', path: undefined },
                    ...workspaceFolders.map((f) => ({
                        label: f.name,
                        description: f.uri.fsPath,
                        path: normalizePath(f.uri.fsPath),
                    })),
                ],
                {
                    placeHolder: 'Select workspace to search in',
                }
            );

            if (selected && 'path' in selected) {
                workspacePath = selected.path;
            }
        }

        // Get max results from settings
        const maxResults = vscode.workspace.getConfiguration('semanticSearch').get<number>('maxResults', 10);

        // Perform search with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Searching...',
                cancellable: false,
            },
            async () => {
                try {
                    const results = workspacePath
                        ? await searchService.searchInWorkspace(query, workspacePath, maxResults)
                        : await searchService.search(query, maxResults);

                    if (results.length === 0) {
                        vscode.window.showInformationMessage('No results found.');
                        return;
                    }

                    // Show results in webview panel
                    SearchResultsPanel.createOrShow(
                        context.extensionUri,
                        results,
                        query,
                        workspacePath
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Search failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        );
    });
}

/**
 * Quick search command - searches and opens first result
 */
export function registerQuickSearchCommand(
    context: vscode.ExtensionContext,
    searchService: SearchService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.quickSearch', async () => {
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
        
        const query = await vscode.window.showInputBox({
            prompt: 'Enter your search query (will open top result)',
            placeHolder: 'e.g., main entry point',
        });

        if (!query) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders?.[0]
            ? normalizePath(workspaceFolders[0].uri.fsPath)
            : undefined;

        try {
            await searchService.searchAndOpen(query, workspacePath);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Search failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });
}
