import { strict as assert } from 'assert';
import { splitIntoTokenChunks } from '../../utils/tokenChunker';
import { DEFAULT_INDEXING_CONFIG } from '../../models/types';

suite('tokenChunker', () => {
    test('returns single chunk for small content', () => {
        const content = 'line1\nline2\nline3';
        const chunks = splitIntoTokenChunks(content, DEFAULT_INDEXING_CONFIG);
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].lineStart, 1);
        assert.equal(chunks[0].lineEnd, 3);
    });

    test('respects max token configuration bounds', () => {
        // Create content with many lines to test chunking
        const lines = [];
        for (let i = 0; i < 500; i++) {
            lines.push(`function example${i}() { return ${i}; }`);
        }
        const content = lines.join('\n');
        
        const config = {
            ...DEFAULT_INDEXING_CONFIG,
            chunkMaxTokens: 512,
            chunkOverlapTokens: 64,
        };
        const chunks = splitIntoTokenChunks(content, config);
        
        // Should have multiple chunks
        assert.ok(chunks.length > 1, 'Should split large content into multiple chunks');
        
        // Each chunk should respect the token limit
        for (const chunk of chunks) {
            const tokenCount = chunk.tokenEnd - chunk.tokenStart;
            assert.ok(tokenCount > 0, 'Token count should be positive');
            assert.ok(tokenCount <= 512 + 10, `Token count ${tokenCount} should not exceed configured max with small tolerance`);
        }
    });
});
