/**
 * VSCode Semantic Search Extension
 * 
 * Provides semantic search capabilities for code using ChromaDB and DuckDB.
 * Integrates with GitHub Copilot through the Language Model Tool API.
 */

import * as vscode from 'vscode';
import { ChromaService } from './services/chromaService';
import { DuckDBService } from './services/duckdbService';
import { IndexingService } from './services/indexingService';
import { SearchService } from './services/searchService';
import { StatusBarManager } from './services/statusBarManager';
import { FileWatcherService } from './services/fileWatcherService';
import { registerBuildIndexCommand, registerIndexFilesCommand } from './commands/buildIndex';
import { registerSearchCommand, registerQuickSearchCommand, registerSearchWithPanelCommand } from './commands/search';
import { registerDeleteIndexCommand, registerDeleteFileIndexCommand } from './commands/deleteIndex';
import { registerIndexSidebarView } from './views/indexSidebar';
import { registerSemanticSearchTool } from './tools/semanticSearchTool';
import { getStoragePath, getIndexingConfigFromSettings } from './utils/fileUtils';

// Global service instances
let chromaService: ChromaService;
let duckdbService: DuckDBService;
let indexingService: IndexingService;
let searchService: SearchService;
let statusBarManager: StatusBarManager;
let fileWatcherService: FileWatcherService;

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Semantic Search extension is activating...');

    try {
        // Get storage path for databases
        const storagePath = getStoragePath(context);
        console.log(`Storage path: ${storagePath}`);

        // Initialize status bar manager
        statusBarManager = new StatusBarManager();
        context.subscriptions.push({ dispose: () => statusBarManager.dispose() });

        // Initialize services with extension context for server mode
        chromaService = new ChromaService(storagePath, context);
        duckdbService = new DuckDBService(storagePath);

        // Subscribe to server status changes
        const serverStatusDisposable = chromaService.onServerStatusChange((status) => {
            statusBarManager.updateChromaStatus(status);
        });
        context.subscriptions.push(serverStatusDisposable);

        // Initialize databases
        await Promise.all([
            chromaService.initialize(),
            duckdbService.initialize(),
        ]);

        console.log('Services initialized successfully');

        // Get indexing configuration from settings
        const indexingConfig = getIndexingConfigFromSettings();

        // Create indexing and search services
        indexingService = new IndexingService(chromaService, duckdbService, indexingConfig);
        searchService = new SearchService(chromaService);

        // Subscribe to indexing status changes
        const indexingStatusDisposable = indexingService.onStatusChange((status) => {
            statusBarManager.updateIndexingStatus(status);
        });
        context.subscriptions.push(indexingStatusDisposable);

        // Initialize file watcher service for auto-indexing
        fileWatcherService = new FileWatcherService(indexingService, indexingConfig);
        fileWatcherService.start();
        context.subscriptions.push({ dispose: () => fileWatcherService.dispose() });

        // Register commands
        context.subscriptions.push(
            registerBuildIndexCommand(context, indexingService),
            registerIndexFilesCommand(context, indexingService),
            registerSearchCommand(context, searchService),
            registerSearchWithPanelCommand(context, searchService),
            registerQuickSearchCommand(context, searchService),
            registerDeleteIndexCommand(context, indexingService),
            registerDeleteFileIndexCommand(context, indexingService)
        );

        // Register new server-related commands
        context.subscriptions.push(
            vscode.commands.registerCommand('semantic-search.showServerLogs', () => {
                vscode.commands.executeCommand('workbench.action.output.show', 'Chroma Server');
            }),
            vscode.commands.registerCommand('semantic-search.restartServer', async () => {
                try {
                    vscode.window.showInformationMessage('Restarting Chroma server...');
                    await chromaService.dispose();
                    await chromaService.initialize();
                    vscode.window.showInformationMessage('Chroma server restarted successfully');
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to restart Chroma server: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            })
        );

        // Register sidebar view
        const treeView = registerIndexSidebarView(context, indexingService);
        context.subscriptions.push(treeView);

        // Register Language Model Tool for Copilot integration
        registerSemanticSearchTool(context, searchService);

        // Listen for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('semanticSearch')) {
                    const newConfig = getIndexingConfigFromSettings();
                    fileWatcherService.updateConfig(newConfig);
                    
                    // Restart file watcher if autoIndex setting changed
                    if (event.affectsConfiguration('semanticSearch.autoIndex')) {
                        fileWatcherService.stop();
                        fileWatcherService.start();
                    }
                }
            })
        );

        // Show activation message
        vscode.window.showInformationMessage('Semantic Search is ready!');

        console.log('Semantic Search extension activated successfully');
    } catch (error) {
        console.error('Failed to activate Semantic Search extension:', error);
        vscode.window.showErrorMessage(
            `Failed to activate Semantic Search: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Deactivate the extension
 */
export async function deactivate() {
    console.log('Deactivating Semantic Search extension...');

    try {
        // Dispose file watcher
        if (fileWatcherService) {
            fileWatcherService.dispose();
        }

        // Dispose indexing service
        if (indexingService) {
            indexingService.dispose();
        }

        // Close Chroma service (stops the server)
        if (chromaService) {
            await chromaService.dispose();
        }

        // Close database connections
        if (duckdbService) {
            await duckdbService.close();
        }

        // Dispose status bar
        if (statusBarManager) {
            statusBarManager.dispose();
        }

        console.log('Semantic Search extension deactivated');
    } catch (error) {
        console.error('Error during deactivation:', error);
    }
}
