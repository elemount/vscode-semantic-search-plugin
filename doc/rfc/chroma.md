# RFC: ChromaDB Integration for VSCode Semantic Search Extension

## Status
- **Status**: Draft
- **Author**: @elemount
- **Created**: 2024-12-09
- **Target Version**: v0.0.2

## Summary

This RFC proposes a design for integrating ChromaDB with the VSCode Semantic Search extension. Due to limitations in the Node.js ChromaDB client (which requires a running Chroma server rather than embedded mode), we need to bundle and manage a Chroma executable within the extension.

## Background

### Current Situation
The current v0.0.1 implementation uses `chromadb` npm package with the assumption of embedded/in-memory mode. However, the Node.js ChromaDB client (`chromadb` package) does not support true embedded mode like the Python client does.

### Problem Statement
- The `chromadb` npm package is a **client library** that communicates with a Chroma server via HTTP/TCP
- There is no embedded mode for Node.js - a Chroma server must be running
- The current implementation works in-memory but loses all data on extension restart
- We need persistent storage for the vector database across extension sessions

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Bundle Chroma executable** | Full ChromaDB features, persistent storage, official support | Larger extension size, process management complexity |
| **B. Use SQLite + custom similarity search** | Pure JS, no external deps | Limited performance, no proper vector indexing |
| **C. Use alternative vector DB (LanceDB)** | Native Node.js support | Different API, less mature ecosystem |
| **D. External Chroma server (user-managed)** | Simple implementation | Poor UX, requires user setup |

**Decision**: Option A - Bundle Chroma executable

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    VSCode Extension                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Extension Host                         ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ ││
│  │  │ IndexService │  │ SearchService│  │ ChromaService │ ││
│  │  └──────────────┘  └──────────────┘  └───────┬───────┘ ││
│  └──────────────────────────────────────────────┼──────────┘│
│                                                  │           │
│  ┌──────────────────────────────────────────────┼──────────┐│
│  │              Chroma Process Manager          │          ││
│  │  ┌─────────────────────────────────────────┐ │          ││
│  │  │  - Lifecycle management                 │ │          ││
│  │  │  - Health checks                        │ │          ││
│  │  │  - Port allocation                      │ │          ││
│  │  │  - Graceful shutdown                    │ │          ││
│  │  └─────────────────────────────────────────┘ │          ││
│  └──────────────────────────────────────────────┼──────────┘│
│                                                  │ HTTP      │
│                                                  ▼           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Chroma Server (Bundled Exe)                ││
│  │  ┌─────────────────┐  ┌────────────────────────────┐   ││
│  │  │  HTTP API       │  │  Persistent Storage        │   ││
│  │  │  (localhost)    │  │  (Extension globalStorage) │   ││
│  │  └─────────────────┘  └────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Chroma Executable Distribution

**Platform-specific binaries:**
- `chroma-win-x64.exe` - Windows x64
- `chroma-linux-x64` - Linux x64
- `chroma-darwin-x64` - macOS Intel
- `chroma-darwin-arm64` - macOS Apple Silicon

**Distribution Strategy:**
- Bundle binaries in extension package under `bin/` directory
- Use VS Code's platform-specific extension mechanism if available
- Consider lazy download on first use to reduce initial extension size

**Directory Structure:**
```
extension/
├── bin/
│   ├── win32-x64/
│   │   └── chroma.exe
│   ├── linux-x64/
│   │   └── chroma
│   ├── darwin-x64/
│   │   └── chroma
│   └── darwin-arm64/
│       └── chroma
├── out/
├── src/
└── package.json
```

#### 2. Chroma Process Manager

New service class to manage the Chroma server lifecycle:

```typescript
// src/services/chromaProcessManager.ts

export interface ChromaServerConfig {
    port: number;
    host: string;
    persistPath: string;
    logLevel: 'debug' | 'info' | 'warning' | 'error';
}

export class ChromaProcessManager {
    private process: ChildProcess | null = null;
    private config: ChromaServerConfig;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    
    constructor(private context: vscode.ExtensionContext) {}
    
    /**
     * Start the Chroma server process
     */
    async start(): Promise<void>;
    
    /**
     * Stop the Chroma server gracefully
     */
    async stop(): Promise<void>;
    
    /**
     * Check if server is healthy and responsive
     */
    async healthCheck(): Promise<boolean>;
    
    /**
     * Get the server URL for client connection
     */
    getServerUrl(): string;
    
    /**
     * Find an available port for the server
     */
    private async findAvailablePort(): Promise<number>;
    
    /**
     * Get the path to the Chroma executable for current platform
     */
    private getChromaExecutablePath(): string;
}
```

#### 3. Updated ChromaService

Modify existing `ChromaService` to connect to the managed server:

```typescript
// src/services/chromaService.ts

export class ChromaService {
    private client: ChromaClient | null = null;
    private processManager: ChromaProcessManager;
    
    constructor(
        private context: vscode.ExtensionContext,
        private storagePath: string
    ) {
        this.processManager = new ChromaProcessManager(context);
    }
    
    async initialize(): Promise<void> {
        // Start the Chroma server process
        await this.processManager.start();
        
        // Connect client to the server
        const { ChromaClient } = require('chromadb');
        this.client = new ChromaClient({
            path: this.processManager.getServerUrl()
        });
        
        // Initialize collection...
    }
    
    async dispose(): Promise<void> {
        await this.processManager.stop();
    }
}
```

### Lifecycle Management

#### Extension Activation
```
1. Extension activates
2. ChromaProcessManager.start() called
   a. Find available port (default: 8765, fallback to random)
   b. Spawn Chroma executable with persist directory
   c. Wait for server to be ready (health check)
   d. Store port in extension state for reconnection
3. ChromaService connects to server
4. Extension ready for indexing/search
```

#### Extension Deactivation
```
1. Extension deactivate() called
2. ChromaService.dispose() called
3. ChromaProcessManager.stop() called
   a. Send graceful shutdown signal
   b. Wait for process to exit (timeout: 5s)
   c. Force kill if needed
4. Cleanup completed
```

#### Crash Recovery
```
1. Health check fails
2. Attempt restart (max 3 attempts)
3. If restart fails:
   a. Show error notification to user
   b. Offer manual retry option
   c. Log detailed error for debugging
```

### Data Persistence

**Storage Location:**
```
Windows: %APPDATA%/Code/User/globalStorage/semantic-search/chroma/
Linux:   ~/.config/Code/User/globalStorage/semantic-search/chroma/
macOS:   ~/Library/Application Support/Code/User/globalStorage/semantic-search/chroma/
```

**Directory Structure:**
```
globalStorage/semantic-search/
├── chroma/
│   ├── chroma.sqlite3      # ChromaDB metadata
│   └── [collection-uuid]/  # Vector data
├── duckdb/
│   └── metadata.db         # File metadata
└── config.json             # Extension settings
```

### Configuration

New settings in `package.json`:

```json
{
    "semanticSearch.chroma.port": {
        "type": "number",
        "default": 0,
        "description": "Port for Chroma server (0 = auto-assign)"
    },
    "semanticSearch.chroma.logLevel": {
        "type": "string",
        "enum": ["debug", "info", "warning", "error"],
        "default": "warning",
        "description": "Chroma server log level"
    },
    "semanticSearch.chroma.startupTimeout": {
        "type": "number",
        "default": 30000,
        "description": "Timeout in ms for Chroma server to start"
    }
}
```

### Error Handling

| Error | Handling Strategy |
|-------|-------------------|
| Port in use | Auto-select different port, retry |
| Executable not found | Show installation instructions |
| Server crash | Auto-restart with backoff |
| Connection timeout | Retry with exponential backoff |
| Disk full | Show warning, suggest cleanup |
| Permission denied | Guide user to fix permissions |

### Security Considerations

1. **Localhost only**: Chroma server binds to `127.0.0.1` only
2. **No authentication**: Acceptable for localhost-only access
3. **Process isolation**: Runs in separate process with limited permissions
4. **Data encryption**: Consider encrypting persist directory (future)

### Performance Considerations

1. **Startup time**: ~2-5 seconds for server initialization
2. **Memory usage**: ~100-200MB base, scales with index size
3. **Disk usage**: ~1-2x raw text size for embeddings
4. **Cold start**: First query may be slower while loading indices

### Testing Strategy

1. **Unit tests**: Mock ChromaProcessManager for service tests
2. **Integration tests**: Test with real Chroma server
3. **Platform tests**: Verify on Windows, macOS, Linux
4. **Stress tests**: Large workspaces (10k+ files)
5. **Recovery tests**: Server crash, restart, reconnection

## Implementation Plan

### Phase 1: Process Manager (Week 1)
- [ ] Create `ChromaProcessManager` class
- [ ] Implement start/stop lifecycle
- [ ] Add health check mechanism
- [ ] Port allocation logic

### Phase 2: Binary Distribution (Week 1-2)
- [ ] Download/build Chroma binaries for each platform
- [ ] Add binaries to extension package
- [ ] Platform detection logic
- [ ] Executable permission handling (Unix)

### Phase 3: Integration (Week 2)
- [ ] Update `ChromaService` to use process manager
- [ ] Add configuration settings
- [ ] Error handling and recovery
- [ ] Logging and diagnostics

### Phase 4: Testing & Polish (Week 3)
- [ ] Cross-platform testing
- [ ] Performance optimization
- [ ] Documentation
- [ ] Edge case handling

## Alternatives Rejected

### LanceDB
- **Reason**: While LanceDB has native Node.js bindings, the ecosystem is less mature and documentation is sparse. ChromaDB has better community support and more features.

### SQLite + pgvector-like extension
- **Reason**: No mature Node.js solution exists for vector similarity in SQLite. Would require custom implementation with suboptimal performance.

### User-managed Chroma server
- **Reason**: Poor user experience. Extension should be self-contained and work out of the box.

## Open Questions

1. **Binary size**: Each platform binary is ~50-100MB. Should we lazy-download on first use?
2. **Version management**: How to handle Chroma version upgrades and data migrations?
3. **Multi-window**: Should multiple VS Code windows share one Chroma instance?
4. **Remote development**: How to handle VS Code Remote scenarios (SSH, Containers)?

## References

- [ChromaDB Documentation](https://docs.trychroma.com/)
- [ChromaDB GitHub](https://github.com/chroma-core/chroma)
- [VS Code Extension API - Global Storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)
