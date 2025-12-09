/**
 * Main exports for the Semantic Search extension
 */

// Models
export * from './models/types';

// Services
export { ChromaService } from './services/chromaService';
export { DuckDBService } from './services/duckdbService';
export { IndexingService } from './services/indexingService';
export { SearchService } from './services/searchService';

// Utils
export * from './utils/fileUtils';