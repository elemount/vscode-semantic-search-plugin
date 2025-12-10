import { strict as assert } from 'assert';
import { splitIntoTokenChunks } from '../src/utils/tokenChunker';
import { DEFAULT_INDEXING_CONFIG } from '../src/models/types';

suite('tokenChunker', () => {
    test('returns single chunk for small content', () => {
        const content = 'line1\nline2\nline3';
        const chunks = splitIntoTokenChunks(content, DEFAULT_INDEXING_CONFIG);
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].lineStart, 1);
        assert.equal(chunks[0].lineEnd, 3);
    });

    test('respects max token configuration bounds', () => {
        const content = 'a '.repeat(5000);
        const config = {
            ...DEFAULT_INDEXING_CONFIG,
            chunkMaxTokens: 2048,
            chunkOverlapTokens: 256,
        };
        const chunks = splitIntoTokenChunks(content, config);
        for (const chunk of chunks) {
            const tokenCount = chunk.tokenEnd - chunk.tokenStart;
            assert.ok(tokenCount <= 2048);
        }
    });

    test('falls back gracefully when js-tiktoken is unavailable', () => {
        const originalRequire = require('module').prototype.require;
        require('module').prototype.require = function (id: string) {
            if (id === 'js-tiktoken') {
                throw new Error('Simulated missing module');
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (originalRequire as any).apply(this, arguments as any);
        };

        try {
            const content = 'line1\nline2\nline3';
            const chunks = splitIntoTokenChunks(content, DEFAULT_INDEXING_CONFIG);
            assert.equal(chunks.length, 1);
            assert.equal(chunks[0].lineStart, 1);
            assert.equal(chunks[0].lineEnd, 3);
        } finally {
            require('module').prototype.require = originalRequire;
        }
    });
});
