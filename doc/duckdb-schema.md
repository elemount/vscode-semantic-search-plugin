# DuckDB Schema Documentation

This document describes the database schema used by the Semantic Search VS Code extension for storing indexed code and vector embeddings.

## Schema Version

Current schema version: **1**

## Overview

The database uses DuckDB with the VSS (Vector Similarity Search) extension to provide efficient vector search capabilities. The schema follows a hierarchical structure:

```
workspaces
    └── folders
        └── indexed_files
            └── code_chunks (with embeddings)
```

## Tables

### `schema_migrations`

Tracks applied schema migrations for version control.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `version` | INTEGER | PRIMARY KEY | Migration version number |

### `workspaces_v1`

Top-level workspace tracking. Each VS Code workspace folder gets an entry.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `workspace_id` | VARCHAR | PRIMARY KEY | | UUID (MD5 hash of path, first 16 chars) |
| `workspace_path` | VARCHAR | NOT NULL, UNIQUE | | Absolute path to workspace folder |
| `workspace_name` | VARCHAR | | | Display name (folder name) |
| `status` | VARCHAR | | 'active' | Status: 'active', 'indexing', 'error' |
| `created_at` | BIGINT | NOT NULL | | Unix timestamp when workspace was added |


**Indexes:**
- `idx_workspace_unique_path` - UNIQUE index on `workspace_path`

### `folders_v1`
| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `folder_id` | VARCHAR | PRIMARY KEY | | UUID (MD5 hash of workspace + folder path) |
| `workspace_id` | VARCHAR | NOT NULL | | Reference to workspaces table |
| `parent_folder_id` | VARCHAR | | | Reference to parent folder (nullable, if it is the root folder of the workspace) |
| `folder_path` | VARCHAR | NOT NULL | | Full relative folder path, e.g., 'src/components' |
| `folder_name` | VARCHAR | | | Just the folder name, e.g., 'components' |
| `created_at` | BIGINT | NOT NULL | | Unix timestamp when folder was first indexed |

**Indexes:**
- `idx_folder_workspace` - Index on `workspace_id`
- `idx_folder_unique_path` - UNIQUE index on `(workspace_id, folder_path)`
- `idx_folder_parent` - Index on `parent_folder_id`

### `indexed_files_v1`

File metadata with derived folder structure for tree view.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `file_id` | VARCHAR | PRIMARY KEY | | UUID (MD5 hash of workspace + file path) |
| `workspace_id` | VARCHAR | | | Reference to workspaces table |
| `folder_id` | VARCHAR | | | Reference to folders table |
| `file_path` | VARCHAR | NOT NULL | | Full relative path, e.g., 'src/components/Button.tsx' |
| `file_name` | VARCHAR | | | Just the filename, e.g., 'Button.tsx' |
| `absolute_path` | VARCHAR | NOT NULL | | Absolute file path |
| `file_size` | BIGINT | | | File size in bytes |
| `last_indexed_at` | BIGINT | NOT NULL | | Unix timestamp of last indexing |
| `md5_hash` | VARCHAR | NOT NULL | | MD5 hash of file content for change detection |

**Indexes:**
- `idx_workspace_path` - Index on `workspace_path`
- `idx_file_workspace_id` - Index on `workspace_id`
- `idx_file_folder_id` - Index on `folder_id`
- `idx_file_unique_path` - UNIQUE index on `(workspace_id, file_path)`

### `file_chunks_small_v1`

Vector embeddings and content for code segments.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `chunk_id` | VARCHAR | PRIMARY KEY | | UUID (derived from file_id + line range(line:pos-line:pos)) |
| `file_id` | VARCHAR | NOT NULL | | Reference to indexed_files table |
| `file_path` | VARCHAR | NOT NULL | | File path (denormalized for query efficiency) |
| `workspace_id` | VARCHAR | NOT NULL | | Reference to workspaces table |
| `workspace_path` | VARCHAR | NOT NULL | | Workspace path (denormalized) |
| `content` | TEXT | NOT NULL | | The actual code content |
| `line_start` | INTEGER | NOT NULL | | Starting line number (1-indexed) |
| `line_pos_start` | INTEGER | NOT NULL | | Starting line position (1-indexed) |
| `line_end` | INTEGER | NOT NULL | | Ending line number (1-indexed) |
| `line_pos_end` | INTEGER | NOT NULL | | Ending line position (1-indexed) |
| `chunk_index` | INTEGER | | 0 | Order of chunk within file |
| `embedding` | FLOAT[768] | | | Vector embedding (dimension depends on model) |
| `created_at` | BIGINT | NOT NULL | | Unix timestamp when chunk was created |

**Indexes:**
- `idx_chunks_file` - Index on `file_id`
- `idx_chunks_workspace` - Index on `workspace_id`
- `idx_chunks_embedding` - HNSW index on `embedding` (cosine metric)

## Relationships

```
workspaces_v1 (1) ─────────────────────── (N) folders_v1
                   workspace_id

folders_v1 (1) ────────────────────────── (N) folders_v1 (self-referential)
               parent_folder_id = folder_id

folders_v1 (1) ────────────────────────── (N) indexed_files_v1
               folder_id

workspaces_v1 (1) ─────────────────────── (N) indexed_files_v1
                   workspace_id

indexed_files_v1 (1) ──────────────────── (N) file_chunks_small_v1
                     file_id
```

## Common Queries

### Get folder hierarchy with file counts

```sql
SELECT 
    f.folder_path,
    f.folder_name,
    COUNT(if2.file_id) as file_count
FROM folders_v1 f
LEFT JOIN indexed_files_v1 if2 ON f.folder_id = if2.folder_id
WHERE f.workspace_id = ?
GROUP BY f.folder_id, f.folder_path, f.folder_name
ORDER BY f.folder_path;
```

### Get files in a specific folder

```sql
SELECT file_id, file_name, last_indexed_at
FROM indexed_files_v1
WHERE workspace_id = ? AND folder_id = ?
ORDER BY file_name;
```

### Search for similar code (vector search)

```sql
SELECT 
    chunk_id,
    file_path,
    content,
    line_start,
    line_pos_start,
    line_end,
    line_pos_end,
    array_cosine_distance(embedding, ?::FLOAT[768]) AS distance
FROM file_chunks_small_v1
WHERE workspace_path = ?
ORDER BY array_cosine_distance(embedding, ?::FLOAT[768])
LIMIT 10;
```

### Get workspace statistics

```sql
SELECT 
    w.workspace_name,
    w.status,
    w.created_at,
    (SELECT COUNT(*) FROM indexed_files_v1 WHERE workspace_id = w.workspace_id) as total_files,
    (SELECT COUNT(*) FROM file_chunks_small_v1 WHERE workspace_id = w.workspace_id) as total_chunks
FROM workspaces_v1 w
WHERE w.workspace_path = ?;
```

### Get chunks for a file (for tree view)

```sql
SELECT chunk_id, content, line_start, line_pos_start, line_end, line_pos_end, chunk_index
FROM file_chunks_small_v1
WHERE file_id = ?
ORDER BY chunk_index, line_start;
```

## Design Decisions

### Explicit Folder Hierarchy

The folder structure is maintained in a dedicated `folders_v1` table with self-referential parent relationships:

**Benefits:**
- Efficient tree view rendering - folder hierarchy is pre-computed
- Parent-child relationships are explicit via `parent_folder_id`
- Supports folder-level operations (collapse/expand, folder stats)
- Enables folder-specific queries without parsing paths
- Clear separation between folder metadata and file metadata

**Trade-offs:**
- Requires maintaining folder records when files are added/removed
- Additional JOINs for some queries

### Denormalized Paths in file_chunks_small_v1

`file_path` and `workspace_path` are duplicated in `file_chunks_small_v1` to:
- Enable efficient workspace-scoped searches without JOINs
- Support vector search filtering in a single query
- Optimize the most common operation (semantic search)

### HNSW Index for Vector Search

Uses DuckDB's HNSW (Hierarchical Navigable Small World) index:
- Metric: cosine similarity
- Enables sub-linear time approximate nearest neighbor search
- Persistent across sessions with `hnsw_enable_experimental_persistence`

## Schema Migration History

| Version | Description |
|---------|-------------|
| 1 | Initial schema with workspaces_v1, folders_v1, indexed_files_v1, and file_chunks_small_v1 |

## Embedding Dimensions

The embedding dimension (768 by default) depends on the model used.
