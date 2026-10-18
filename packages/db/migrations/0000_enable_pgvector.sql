-- pgvector, for chunks.embedding. The pgvector/pgvector image ships it; docker/postgres/init.sql
-- also enables it locally, but CI's service container and managed hosts start without it.
CREATE EXTENSION IF NOT EXISTS vector;
