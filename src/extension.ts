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
import { registerBuildIndexCommand, registerIndexFilesCommand } from './commands/buildIndex';
import { registerSearchCommand, registerQuickSearchCommand } from './commands/search';
import { registerDeleteIndexCommand, registerDeleteFileIndexCommand } from './commands/deleteIndex';
import { registerIndexSidebarView } from './views/indexSidebar';
import { registerSemanticSearchTool } from './tools/semanticSearchTool';
import { getStoragePath } from './utils/fileUtils';

// Global service instances
let chromaService: ChromaService;
let duckdbService: DuckDBService;
let indexingService: IndexingService;
let searchService: SearchService;

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Semantic Search extension is activating...');

    try {
        // Get storage path for databases
        const storagePath = getStoragePath(context);
        console.log(`Storage path: ${storagePath}`);

        // Initialize services
        chromaService = new ChromaService(storagePath);
        duckdbService = new DuckDBService(storagePath);

        // Initialize databases
        await Promise.all([
            chromaService.initialize(),
            duckdbService.initialize(),
        ]);

        console.log('Services initialized successfully');

        // Create indexing and search services
        indexingService = new IndexingService(chromaService, duckdbService);
        searchService = new SearchService(chromaService);

        // Register commands
        context.subscriptions.push(
            registerBuildIndexCommand(context, indexingService),
            registerIndexFilesCommand(context, indexingService),
            registerSearchCommand(context, searchService),
            registerQuickSearchCommand(context, searchService),
            registerDeleteIndexCommand(context, indexingService),
            registerDeleteFileIndexCommand(context, indexingService)
        );

        // Register sidebar view
        const treeView = registerIndexSidebarView(context, indexingService);
        context.subscriptions.push(treeView);

        // Register Language Model Tool for Copilot integration
        registerSemanticSearchTool(context, searchService);

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
        // Dispose services
        if (indexingService) {
            indexingService.dispose();
        }

        // Close database connections
        if (duckdbService) {
            await duckdbService.close();
        }

        console.log('Semantic Search extension deactivated');
    } catch (error) {
        console.error('Error during deactivation:', error);
    }
}
