-- Runs once, when the Postgres data directory is first created (docker-entrypoint-initdb.d).
-- pgvector ships in the pgvector/pgvector image; the extension's SQL name is `vector`.
CREATE EXTENSION IF NOT EXISTS vector;
