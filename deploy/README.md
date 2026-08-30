# WSF Semantic Engine : Deployment

Production deployment templates for the WSF Semantic Engine
(per ADR-WSF-24 §9, Deployment Modes).

## Deployment Modes

The engine supports three deployment modes:

| Mode | Description | Entry |
|---|---|---|
| Embedded | In-process within a host application | `new SemanticEngine(config, store)` |
| Library | Imported package, programmatic services | `@wsf/semantic-engine` exports |
| Service | Standalone REST service | `node dist/server/main.js` (this directory) |

This directory covers the **service mode**.

## Contents

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage production image (build + minimal runtime, non-root user, healthcheck) |
| `docker-compose.yml` | Reference topology: engine + PostgreSQL / Neo4j / MongoDB (profile per backend) |
| `.env.example` | Environment template; copy to `.env` and fill in credentials |

## Quick Start (PostgreSQL backend)

```bash
cp .env.example .env
# edit .env: set WSF_PG_PASSWORD
docker compose --env-file .env --profile postgres up -d
curl http://localhost:8080/v1/health
```

## Backend Selection

`WSF_STORE_BACKEND` selects the store backend:

| Value | Service required | Compose profile |
|---|---|---|
| `memory` | none (embedded, ephemeral) | ; |
| `sqlite` | none (embedded, file-backed) | ; |
| `postgresql` | PostgreSQL 16 | `postgres` |
| `neo4j` | Neo4j 5 | `neo4j` |
| `mongodb` | MongoDB 7 (replica set for transactions) | `mongodb` |

Memory and SQLite backends are embedded in the engine process; the
compose topology is unnecessary for them. MongoDB transactions require
a replica set; the single-node compose service suits development, and
production deployments SHALL use a replica set or sharded cluster.

## Configuration

All configuration is environment-driven; see `src/server/main.ts` for the
authoritative variable list and `.env.example` for the template. No
secrets are committed; `.env` is excluded by `.gitignore` and
`.dockerignore`.

## Health and Observability

- `GET /v1/health` : engine health (backend, API surface, namespaces)
- Container `HEALTHCHECK` probes the same endpoint every 30s
- Graceful shutdown on SIGTERM/SIGINT (stops REST server, disconnects store)

## Rollback

- Image is tagged `wsf/semantic-engine:<version>`; rollback is a redeploy of
  the previous tag
- Store schemas are created idempotently on connect (`IF NOT EXISTS`
  constraints/indexes, `createCollection` guards); rolling the engine back
  does not require schema rollback while the data model is additive
- Data volumes (`postgres_data`, `neo4j_data`, `mongodb_data`) persist
  independently of engine containers
