/**
 * Delete Index Command
 */

import * as vscode from 'vscode';
import { IndexingService } from '../services/indexingService';
import { normalizePath } from '../utils/fileUtils';

export function registerDeleteIndexCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.deleteIndex', async () => {
        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Let user choose what to delete
        const options = [
            { label: '$(trash) Delete entire workspace index', type: 'workspace' },
            { label: '$(file) Delete specific file index', type: 'file' },
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select what to delete',
        });

        if (!selected) {
            return;
        }

        if (selected.type === 'workspace') {
            // Select workspace if multiple
            let selectedFolder: vscode.WorkspaceFolder;
            if (workspaceFolders.length === 1) {
                selectedFolder = workspaceFolders[0];
            } else {
                const folderChoice = await vscode.window.showQuickPick(
                    workspaceFolders.map((f) => ({
                        label: f.name,
                        description: f.uri.fsPath,
                        folder: f,
                    })),
                    {
                        placeHolder: 'Select workspace folder to delete index for',
                    }
                );

                if (!folderChoice) {
                    return;
                }

                selectedFolder = folderChoice.folder;
            }

            // Confirm deletion
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete the entire index for ${selectedFolder.name}?`,
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') {
                return;
            }

            // Delete workspace index
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Deleting Index',
                    cancellable: false,
                },
                async () => {
                    try {
                        await indexingService.deleteWorkspaceIndex(
                            normalizePath(selectedFolder.uri.fsPath)
                        );
                        vscode.window.showInformationMessage(
                            `Index deleted for ${selectedFolder.name}`
                        );
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to delete index: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            );
        } else if (selected.type === 'file') {
            // Get indexed files and let user choose
            const workspacePath = normalizePath(workspaceFolders[0].uri.fsPath);
            const entries = await indexingService.getIndexEntries(workspacePath);

            if (entries.length === 0) {
                vscode.window.showInformationMessage('No indexed files found.');
                return;
            }

            const fileChoices = entries.map((entry) => ({
                label: `$(file) ${entry.relativePath}`,
                description: entry.isStale ? '(stale)' : '',
                detail: `Last indexed: ${entry.lastIndexedAt.toLocaleString()}`,
                entry,
            }));

            const selectedFile = await vscode.window.showQuickPick(fileChoices, {
                placeHolder: 'Select file to delete from index',
                canPickMany: true,
            });

            if (!selectedFile || selectedFile.length === 0) {
                return;
            }

            // Delete selected files
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Deleting File Index',
                    cancellable: false,
                },
                async () => {
                    try {
                        for (const file of selectedFile) {
                            await indexingService.deleteFileIndex(file.entry.filePath);
                        }
                        vscode.window.showInformationMessage(
                            `Deleted index for ${selectedFile.length} file(s)`
                        );
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to delete index: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            );
        }
    });
}

/**
 * Delete file index from context menu
 */
export function registerDeleteFileIndexCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService
): vscode.Disposable {
    return vscode.commands.registerCommand(
        'semantic-search.deleteFileIndex',
        async (uri?: vscode.Uri) => {
            if (!uri) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Delete index for ${uri.fsPath}?`,
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') {
                return;
            }

            try {
                await indexingService.deleteFileIndex(uri.fsPath);
                vscode.window.showInformationMessage('File index deleted');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to delete index: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
}
