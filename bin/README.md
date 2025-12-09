# Chroma Binaries

This directory contains platform-specific Chroma server executables.

## Directory Structure

```
bin/
├── win32-x64/
│   └── chroma.exe
├── linux-x64/
│   └── chroma
├── darwin-x64/
│   └── chroma
└── darwin-arm64/
    └── chroma
```

## Obtaining Binaries

You can obtain Chroma binaries in several ways:

### Option 1: Download from Chroma Releases

Visit the [Chroma GitHub releases](https://github.com/chroma-core/chroma/releases) and download the appropriate binary for each platform.

### Option 2: Build from Source

1. Clone the Chroma repository:
   ```bash
   git clone https://github.com/chroma-core/chroma.git
   cd chroma
   ```

2. Build for each platform using their build system.

### Option 3: Use pip to install and locate

1. Install chroma via pip:
   ```bash
   pip install chromadb
   ```

2. Locate the installed binary and copy it to the appropriate directory.

## Note

The extension will fall back to in-memory mode if the Chroma executable is not found. In this mode, the index will not persist between sessions.

## Permissions

On Unix-based systems (Linux, macOS), ensure the binaries have execute permissions:

```bash
chmod +x bin/linux-x64/chroma
chmod +x bin/darwin-x64/chroma
chmod +x bin/darwin-arm64/chroma
```
