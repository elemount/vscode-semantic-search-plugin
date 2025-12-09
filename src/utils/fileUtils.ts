/**
 * File utility functions for the Semantic Search extension
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { IndexingConfig, DEFAULT_INDEXING_CONFIG } from '../models/types';

/**
 * Calculate MD5 hash of file content
 */
export function calculateMD5(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Generate a unique file ID from workspace path and file path
 */
export function generateFileId(workspacePath: string, filePath: string): string {
    const relativePath = path.relative(workspacePath, filePath);
    const combined = `${workspacePath}:${relativePath}`;
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

/**
 * Generate a unique chunk ID
 */
export function generateChunkId(fileId: string, lineStart: number, lineEnd: number): string {
    return `${fileId}:${lineStart}-${lineEnd}`;
}

/**
 * Get all files in a workspace folder matching the include patterns
 */
export async function getWorkspaceFiles(
    workspaceFolder: vscode.WorkspaceFolder,
    config: IndexingConfig = DEFAULT_INDEXING_CONFIG
): Promise<vscode.Uri[]> {
    const includePattern = `{${config.includePatterns.join(',')}}`;
    const excludePattern = `{${config.excludePatterns.join(',')}}`;
    
    const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, includePattern),
        new vscode.RelativePattern(workspaceFolder, excludePattern)
    );
    
    return files;
}

/**
 * Read file content
 */
export async function readFileContent(uri: vscode.Uri): Promise<string> {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf-8');
}

/**
 * Split file content into chunks
 */
export function splitIntoChunks(
    content: string,
    chunkSize: number = DEFAULT_INDEXING_CONFIG.chunkSize,
    chunkOverlap: number = DEFAULT_INDEXING_CONFIG.chunkOverlap
): { content: string; lineStart: number; lineEnd: number }[] {
    const lines = content.split('\n');
    const chunks: { content: string; lineStart: number; lineEnd: number }[] = [];
    
    if (lines.length === 0) {
        return chunks;
    }
    
    // For small files, return as single chunk
    if (lines.length <= chunkSize) {
        chunks.push({
            content: content,
            lineStart: 1,
            lineEnd: lines.length,
        });
        return chunks;
    }
    
    // Split into overlapping chunks
    let startLine = 0;
    while (startLine < lines.length) {
        const endLine = Math.min(startLine + chunkSize, lines.length);
        const chunkLines = lines.slice(startLine, endLine);
        
        chunks.push({
            content: chunkLines.join('\n'),
            lineStart: startLine + 1, // 1-indexed
            lineEnd: endLine, // 1-indexed
        });
        
        // Move to next chunk with overlap
        startLine = endLine - chunkOverlap;
        
        // Prevent infinite loop for edge cases
        if (endLine >= lines.length) {
            break;
        }
    }
    
    return chunks;
}

/**
 * Get relative path from workspace
 */
export function getRelativePath(workspacePath: string, filePath: string): string {
    return path.relative(workspacePath, filePath);
}

/**
 * Normalize file path for consistent storage
 */
export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * Check if a file should be indexed based on config
 */
export function shouldIndexFile(
    filePath: string,
    config: IndexingConfig = DEFAULT_INDEXING_CONFIG
): boolean {
    const minimatch = require('minimatch');
    const normalizedPath = normalizePath(filePath);
    
    // Check exclusions first
    for (const pattern of config.excludePatterns) {
        if (minimatch(normalizedPath, pattern, { dot: true })) {
            return false;
        }
    }
    
    // Check inclusions
    for (const pattern of config.includePatterns) {
        if (minimatch(normalizedPath, pattern, { dot: true })) {
            return true;
        }
    }
    
    return false;
}

/**
 * Get the storage path for the extension
 */
export function getStoragePath(context: vscode.ExtensionContext): string {
    const storagePath = context.globalStorageUri.fsPath;
    return storagePath;
}

/**
 * Get indexing configuration from VS Code settings
 */
export function getIndexingConfigFromSettings(): IndexingConfig {
    const config = vscode.workspace.getConfiguration('semanticSearch');
    
    // Get user-configured exclude patterns and merge with defaults
    const userExcludePatterns = config.get<string[]>('excludePatterns', []);
    const excludePatterns = [...DEFAULT_INDEXING_CONFIG.excludePatterns, ...userExcludePatterns];
    
    // Get user-configured include patterns and merge with defaults
    const userIncludePatterns = config.get<string[]>('includePatterns', []);
    const includePatterns = userIncludePatterns.length > 0 
        ? userIncludePatterns 
        : DEFAULT_INDEXING_CONFIG.includePatterns;
    
    return {
        chunkSize: config.get<number>('chunkSize', DEFAULT_INDEXING_CONFIG.chunkSize),
        chunkOverlap: config.get<number>('chunkOverlap', DEFAULT_INDEXING_CONFIG.chunkOverlap),
        excludePatterns,
        includePatterns,
    };
}
