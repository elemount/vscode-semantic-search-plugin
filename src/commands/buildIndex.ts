/**
 * Build Index Command
 */

import * as vscode from 'vscode';
import { IndexingService } from '../services/indexingService';
import { normalizePath } from '../utils/fileUtils';

export function registerBuildIndexCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService
): vscode.Disposable {
    return vscode.commands.registerCommand('semantic-search.buildIndex', async () => {
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
 * Index specific files/folders command
 */
export function registerIndexFilesCommand(
    context: vscode.ExtensionContext,
    indexingService: IndexingService
): vscode.Disposable {
    return vscode.commands.registerCommand(
        'semantic-search.indexFiles',
        async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
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
