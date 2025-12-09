/**
 * Search Command
 */

import * as vscode from 'vscode';
import { SearchService } from '../services/searchService';
import { normalizePath } from '../utils/fileUtils';

export function registerSearchCommand(
    context: vscode.ExtensionContext,
    searchService: SearchService
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.search', async () => {
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
                        ? await searchService.searchInWorkspace(query, workspacePath, 20)
                        : await searchService.search(query, 20);

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
 * Quick search command - searches and opens first result
 */
export function registerQuickSearchCommand(
    context: vscode.ExtensionContext,
    searchService: SearchService
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.quickSearch', async () => {
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
