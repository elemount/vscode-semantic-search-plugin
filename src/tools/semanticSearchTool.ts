/**
 * Semantic Search Tool for GitHub Copilot Language Model Tool API
 */

import * as vscode from 'vscode';
import { SearchService } from '../services/searchService';
import { normalizePath } from '../utils/fileUtils';
import { EmbeddingService } from '../services/embeddingService';
import { StatusBarManager } from '../services/statusBarManager';

/**
 * Tool input interface
 */
interface SemanticSearchToolInput {
    query: string;
    maxResults?: number;
}

/**
 * Register the semantic search tool for Copilot
 */
export function registerSemanticSearchTool(
    context: vscode.ExtensionContext,
    searchService: SearchService,
    embeddingService?: EmbeddingService,
    statusBarManager?: StatusBarManager
): void {
    // Register the language model tool
    const tool = vscode.lm.registerTool('semantic-search_ask', {
        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<SemanticSearchToolInput>,
            token: vscode.CancellationToken
        ): Promise<vscode.LanguageModelToolResult> {
            const { query, maxResults = 10 } = options.input;

            // Ensure embedding model is loaded (silent loading for tool)
            if (embeddingService && statusBarManager) {
                const state = embeddingService.getState();
                if (state === 'not-loaded') {
                    statusBarManager.updateModelStatus('loading');
                    await embeddingService.ensureInitialized((p) => {
                        if (p.status === 'progress' && p.total) {
                            const percent = Math.round((p.loaded || 0) / p.total * 100);
                            statusBarManager.updateModelStatus('loading', percent);
                        }
                    });
                    statusBarManager.updateModelStatus('ready');
                }
            }

            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const workspacePath = workspaceFolders?.[0]
                ? normalizePath(workspaceFolders[0].uri.fsPath)
                : undefined;

            try {
                const results = workspacePath
                    ? await searchService.searchInWorkspace(query, workspacePath, maxResults)
                    : await searchService.search(query, maxResults);

                if (results.length === 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No results found for the query.'),
                    ]);
                }

                // Format results for the model
                let output = `Found ${results.length} relevant code snippet(s):\n\n`;

                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    const relativePath = workspacePath
                        ? result.filePath.replace(workspacePath + '/', '')
                        : result.filePath;

                    output += `### ${i + 1}. ${relativePath} (lines ${result.lineStart}-${result.lineEnd})\n`;
                    output += `Relevance: ${(result.score * 100).toFixed(1)}%\n\n`;
                    output += `\`\`\`\n${result.content}\n\`\`\`\n\n`;
                }

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(output),
                ]);
            } catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Error performing semantic search: ${error instanceof Error ? error.message : String(error)}`
                    ),
                ]);
            }
        },

        async prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<SemanticSearchToolInput>,
            token: vscode.CancellationToken
        ): Promise<vscode.PreparedToolInvocation> {
            return {
                invocationMessage: `Searching for: "${options.input.query}"`,
            };
        },
    });

    context.subscriptions.push(tool);
}
