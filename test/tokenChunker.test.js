"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const tokenChunker_1 = require("../src/utils/tokenChunker");
const types_1 = require("../src/models/types");
suite('tokenChunker', () => {
    test('returns single chunk for small content', () => {
        const content = 'line1\nline2\nline3';
        const chunks = (0, tokenChunker_1.splitIntoTokenChunks)(content, types_1.DEFAULT_INDEXING_CONFIG);
        assert_1.strict.equal(chunks.length, 1);
        assert_1.strict.equal(chunks[0].lineStart, 1);
        assert_1.strict.equal(chunks[0].lineEnd, 3);
    });
    test('respects max token configuration bounds', () => {
        const content = 'a '.repeat(5000);
        const config = {
            ...types_1.DEFAULT_INDEXING_CONFIG,
            chunkMaxTokens: 2048,
            chunkOverlapTokens: 256,
        };
        const chunks = (0, tokenChunker_1.splitIntoTokenChunks)(content, config);
        for (const chunk of chunks) {
            const tokenCount = chunk.tokenEnd - chunk.tokenStart;
            assert_1.strict.ok(tokenCount <= 2048);
        }
    });
    test('falls back gracefully when js-tiktoken is unavailable', () => {
        const originalRequire = require('module').prototype.require;
        require('module').prototype.require = function (id) {
            if (id === 'js-tiktoken') {
                throw new Error('Simulated missing module');
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return originalRequire.apply(this, arguments);
        };
        try {
            const content = 'line1\nline2\nline3';
            const chunks = (0, tokenChunker_1.splitIntoTokenChunks)(content, types_1.DEFAULT_INDEXING_CONFIG);
            assert_1.strict.equal(chunks.length, 1);
            assert_1.strict.equal(chunks[0].lineStart, 1);
            assert_1.strict.equal(chunks[0].lineEnd, 3);
        }
        finally {
            require('module').prototype.require = originalRequire;
        }
    });
});
//# sourceMappingURL=tokenChunker.test.js.map