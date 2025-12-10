/**
 * Embedding Service - Uses Transformers.js for embedding generation
 * Uses onnx-community/embeddinggemma-300m-ONNX model (768 dimensions)
 */

import * as vscode from 'vscode';
import * as path from 'path';

 
type Pipeline = any;

export interface EmbeddingProgress {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
}

export type EmbeddingServiceState = 'not-loaded' | 'loading' | 'ready' | 'error';

export class EmbeddingService {
    private extractor: Pipeline | null = null;
    private modelId = 'onnx-community/embeddinggemma-300m-ONNX';
    private dimensions = 768;
    private initPromise: Promise<void> | null = null;
    private state: EmbeddingServiceState = 'not-loaded';
    
    constructor(private context: vscode.ExtensionContext) {}
    
    /**
     * Ensure the model is initialized, loading it if needed
     * This is the main entry point for lazy loading
     */
    async ensureInitialized(
        onProgress?: (progress: EmbeddingProgress) => void
    ): Promise<void> {
        if (this.state === 'ready') {
            return;
        }
        if (this.state === 'error') {
            throw new Error('Embedding service failed to initialize. Please reload the window.');
        }
        if (this.initPromise) {
            return this.initPromise;
        }
        
        this.state = 'loading';
        this.initPromise = this.loadModel(onProgress);
        
        try {
            await this.initPromise;
            this.state = 'ready';
        } catch (error) {
            this.state = 'error';
            throw error;
        }
    }
    
    /**
     * Initialize the embedding model using pipeline (deprecated - use ensureInitialized)
     */
    async initialize(
        onProgress?: (progress: EmbeddingProgress) => void
    ): Promise<void> {
        return this.ensureInitialized(onProgress);
    }
    
    private async loadModel(
        onProgress?: (progress: EmbeddingProgress) => void
    ): Promise<void> {
        const { pipeline } = await import('@huggingface/transformers');
        
        // Custom cache directory in extension storage
        const cacheDir = path.join(
            this.context.globalStorageUri.fsPath,
            'models'
        );
        
        // Use feature-extraction pipeline which handles pooling automatically
        this.extractor = await pipeline('feature-extraction', this.modelId, {
            dtype: 'q4',  // Use smallest quantized model
            cache_dir: cacheDir,
            progress_callback: onProgress
        });
    }
    
    /**
     * Generate embedding for a single text
     */
    async embed(text: string): Promise<number[]> {
        const embeddings = await this.embedBatch([text]);
        return embeddings[0];
    }
    
    /**
     * Generate embedding for a search query
     * Uses retrieval query task format
     */
    async embedQuery(query: string): Promise<number[]> {
        const formattedQuery = `task: search result | query: ${query}`;
        return this.embed(formattedQuery);
    }
    
    /**
     * Generate embedding for a document chunk
     * Uses retrieval document task format
     */
    async embedDocument(content: string, title?: string): Promise<number[]> {
        const formattedDoc = `title: ${title || 'none'} | text: ${content}`;
        return this.embed(formattedDoc);
    }
    
    /**
     * Generate embeddings for multiple texts
     */
    async embedBatch(texts: string[]): Promise<number[][]> {
        if (!this.extractor) {
            throw new Error('EmbeddingService not initialized');
        }
        
        if (texts.length === 0) {
            return [];
        }
        
        const results: number[][] = [];
        
        // Process each text through the pipeline
        for (const text of texts) {
            const output = await this.extractor(text, { 
                pooling: 'mean', 
                normalize: true 
            });
            // Output is a Tensor, convert to array
            results.push(Array.from(output.data));
        }
        
        return results;
    }
    
    /**
     * Get embedding dimensions
     */
    getDimensions(): number {
        return this.dimensions;
    }
    
    /**
     * Get model name
     */
    getModelId(): string {
        return this.modelId;
    }
    
    /**
     * Check if service is initialized
     */
    isInitialized(): boolean {
        return this.extractor !== null;
    }
    
    /**
     * Get current initialization state
     */
    getState(): EmbeddingServiceState {
        return this.state;
    }
}
