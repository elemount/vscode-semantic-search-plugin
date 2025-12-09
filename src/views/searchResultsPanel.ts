/**
 * Search Results Webview
 * Provides a rich UI for displaying semantic search results with syntax highlighting
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SearchResult } from '../models/types';

export class SearchResultsPanel {
    public static currentPanel: SearchResultsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _results: SearchResult[] = [];
    private _query: string = '';
    private _workspacePath?: string;

    public static createOrShow(
        extensionUri: vscode.Uri,
        results: SearchResult[],
        query: string,
        workspacePath?: string
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (SearchResultsPanel.currentPanel) {
            SearchResultsPanel.currentPanel._panel.reveal(column);
            SearchResultsPanel.currentPanel.updateResults(results, query, workspacePath);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'semanticSearchResults',
            'Semantic Search Results',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        SearchResultsPanel.currentPanel = new SearchResultsPanel(
            panel,
            extensionUri,
            results,
            query,
            workspacePath
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        results: SearchResult[],
        query: string,
        workspacePath?: string
    ) {
        this._panel = panel;
        this._results = results;
        this._query = query;
        this._workspacePath = workspacePath;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'openFile':
                        await this._openFile(message.filePath, message.lineStart, message.lineEnd);
                        break;
                    case 'filterByType':
                        this._filterByType(message.extension);
                        break;
                    case 'filterByFolder':
                        this._filterByFolder(message.folder);
                        break;
                    case 'sortBy':
                        this._sortBy(message.sortField);
                        break;
                    case 'clearFilters':
                        this._clearFilters();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public updateResults(results: SearchResult[], query: string, workspacePath?: string): void {
        this._results = results;
        this._query = query;
        this._workspacePath = workspacePath;
        this._update();
    }

    private async _openFile(filePath: string, lineStart: number, lineEnd: number): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

            const startLine = Math.max(0, lineStart - 1);
            const endLine = lineEnd - 1;
            const range = new vscode.Range(startLine, 0, endLine, 0);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(startLine, 0, endLine, 0);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
        }
    }

    private _filterByType(extension: string): void {
        // Filter results by file extension
        const filtered = this._results.filter((r) =>
            extension === 'all' ? true : path.extname(r.filePath).toLowerCase() === extension
        );
        this._panel.webview.postMessage({
            command: 'updateResults',
            results: this._formatResults(filtered),
        });
    }

    private _filterByFolder(folder: string): void {
        // Filter results by folder
        const filtered = this._results.filter((r) =>
            folder === 'all' ? true : r.filePath.includes(folder)
        );
        this._panel.webview.postMessage({
            command: 'updateResults',
            results: this._formatResults(filtered),
        });
    }

    private _sortBy(field: 'relevance' | 'path' | 'lines'): void {
        const sorted = [...this._results];
        switch (field) {
            case 'relevance':
                sorted.sort((a, b) => b.score - a.score);
                break;
            case 'path':
                sorted.sort((a, b) => a.filePath.localeCompare(b.filePath));
                break;
            case 'lines':
                sorted.sort((a, b) => a.lineStart - b.lineStart);
                break;
        }
        this._panel.webview.postMessage({
            command: 'updateResults',
            results: this._formatResults(sorted),
        });
    }

    private _clearFilters(): void {
        this._panel.webview.postMessage({
            command: 'updateResults',
            results: this._formatResults(this._results),
        });
    }

    private _formatResults(results: SearchResult[]): object[] {
        return results.map((r, index) => ({
            index: index + 1,
            filePath: r.filePath,
            relativePath: this._workspacePath
                ? r.filePath.replace(this._workspacePath, '').replace(/^[/\\]/, '')
                : r.filePath,
            lineStart: r.lineStart,
            lineEnd: r.lineEnd,
            content: r.content,
            score: r.score,
            scorePercent: Math.round(r.score * 100),
            extension: path.extname(r.filePath).toLowerCase(),
            folder: path.dirname(
                this._workspacePath
                    ? r.filePath.replace(this._workspacePath, '').replace(/^[/\\]/, '')
                    : r.filePath
            ),
        }));
    }

    private _getFileTypeFilters(): { label: string; value: string }[] {
        const extensions = new Set(this._results.map((r) => path.extname(r.filePath).toLowerCase()));
        const filters = [{ label: 'All types', value: 'all' }];
        for (const ext of extensions) {
            if (ext) {
                filters.push({ label: ext, value: ext });
            }
        }
        return filters;
    }

    private _getFolderFilters(): { label: string; value: string }[] {
        const folders = new Set(
            this._results.map((r) => {
                const relativePath = this._workspacePath
                    ? r.filePath.replace(this._workspacePath, '').replace(/^[/\\]/, '')
                    : r.filePath;
                return path.dirname(relativePath);
            })
        );
        const filters = [{ label: 'All folders', value: 'all' }];
        for (const folder of folders) {
            if (folder && folder !== '.') {
                filters.push({ label: folder, value: folder });
            }
        }
        return filters;
    }

    private _update(): void {
        this._panel.title = `Search: ${this._query}`;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const results = this._formatResults(this._results);
        const typeFilters = this._getFileTypeFilters();
        const folderFilters = this._getFolderFilters();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Search Results</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
        }
        body {
            font-family: var(--vscode-font-family);
            padding: 10px 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h1 {
            margin: 0;
            font-size: 1.4em;
            font-weight: 500;
        }
        .query {
            color: var(--vscode-textLink-foreground);
        }
        .filters {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            flex-wrap: wrap;
            align-items: center;
        }
        .filter-group {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .filter-group label {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 0.9em;
        }
        .result-count {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }
        .results {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .result-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
            transition: border-color 0.2s;
        }
        .result-card:hover {
            border-color: var(--vscode-focusBorder);
        }
        .result-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background-color: var(--vscode-sideBar-background);
            cursor: pointer;
        }
        .result-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .result-path {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .result-path .icon {
            opacity: 0.7;
        }
        .result-file {
            font-weight: 500;
            color: var(--vscode-textLink-foreground);
        }
        .result-lines {
            color: var(--vscode-descriptionForeground);
            font-size: 0.85em;
        }
        .result-score {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .score-bar {
            width: 60px;
            height: 6px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 3px;
            overflow: hidden;
        }
        .score-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-background);
            background-color: var(--vscode-textLink-foreground);
            transition: width 0.3s;
        }
        .score-text {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            min-width: 35px;
        }
        .result-content {
            padding: 12px;
            background-color: var(--vscode-editor-background);
        }
        pre {
            margin: 0;
            padding: 10px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            overflow-x: auto;
            font-size: 0.9em;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        code {
            font-family: var(--vscode-editor-font-family);
        }
        .no-results {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .result-index {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            min-width: 25px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Results for "<span class="query">${this._escapeHtml(this._query)}</span>"</h1>
        <span class="result-count" id="resultCount">${results.length} result(s)</span>
    </div>
    
    <div class="filters">
        <div class="filter-group">
            <label>File type:</label>
            <select id="typeFilter" onchange="filterByType(this.value)">
                ${typeFilters.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
            </select>
        </div>
        <div class="filter-group">
            <label>Folder:</label>
            <select id="folderFilter" onchange="filterByFolder(this.value)">
                ${folderFilters.map((f) => `<option value="${f.value}">${this._escapeHtml(f.label)}</option>`).join('')}
            </select>
        </div>
        <div class="filter-group">
            <label>Sort by:</label>
            <select id="sortBy" onchange="sortBy(this.value)">
                <option value="relevance">Relevance</option>
                <option value="path">File path</option>
                <option value="lines">Line number</option>
            </select>
        </div>
    </div>
    
    <div class="results" id="results">
        ${this._renderResults(results)}
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function openFile(filePath, lineStart, lineEnd) {
            vscode.postMessage({
                command: 'openFile',
                filePath: filePath,
                lineStart: lineStart,
                lineEnd: lineEnd
            });
        }
        
        function filterByType(extension) {
            vscode.postMessage({
                command: 'filterByType',
                extension: extension
            });
        }
        
        function filterByFolder(folder) {
            vscode.postMessage({
                command: 'filterByFolder',
                folder: folder
            });
        }
        
        function sortBy(field) {
            vscode.postMessage({
                command: 'sortBy',
                sortField: field
            });
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateResults') {
                document.getElementById('results').innerHTML = renderResults(message.results);
                document.getElementById('resultCount').textContent = message.results.length + ' result(s)';
            }
        });
        
        function renderResults(results) {
            if (results.length === 0) {
                return '<div class="no-results">No results match your filters</div>';
            }
            return results.map(r => \`
                <div class="result-card">
                    <div class="result-header" onclick="openFile('\${escapeHtml(r.filePath)}', \${r.lineStart}, \${r.lineEnd})">
                        <div class="result-path">
                            <span class="result-index">#\${r.index}</span>
                            <span class="icon">📄</span>
                            <span class="result-file">\${escapeHtml(r.relativePath)}</span>
                            <span class="result-lines">Lines \${r.lineStart}-\${r.lineEnd}</span>
                        </div>
                        <div class="result-score">
                            <div class="score-bar">
                                <div class="score-fill" style="width: \${r.scorePercent}%"></div>
                            </div>
                            <span class="score-text">\${r.scorePercent}%</span>
                        </div>
                    </div>
                    <div class="result-content">
                        <pre><code>\${escapeHtml(r.content.substring(0, 500))}\${r.content.length > 500 ? '...' : ''}</code></pre>
                    </div>
                </div>
            \`).join('');
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }

    private _renderResults(results: object[]): string {
        if (results.length === 0) {
            return '<div class="no-results">No results found</div>';
        }

        return results
            .map(
                (r: any) => `
            <div class="result-card">
                <div class="result-header" onclick="openFile('${this._escapeHtml(r.filePath)}', ${r.lineStart}, ${r.lineEnd})">
                    <div class="result-path">
                        <span class="result-index">#${r.index}</span>
                        <span class="icon">📄</span>
                        <span class="result-file">${this._escapeHtml(r.relativePath)}</span>
                        <span class="result-lines">Lines ${r.lineStart}-${r.lineEnd}</span>
                    </div>
                    <div class="result-score">
                        <div class="score-bar">
                            <div class="score-fill" style="width: ${r.scorePercent}%"></div>
                        </div>
                        <span class="score-text">${r.scorePercent}%</span>
                    </div>
                </div>
                <div class="result-content">
                    <pre><code>${this._escapeHtml(r.content.substring(0, 500))}${r.content.length > 500 ? '...' : ''}</code></pre>
                </div>
            </div>
        `
            )
            .join('');
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\\/g, '\\\\');
    }

    public dispose(): void {
        SearchResultsPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
