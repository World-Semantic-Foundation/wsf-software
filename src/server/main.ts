/**
 * WSF Semantic Engine : Production Server Entrypoint
 *
 * Environment-configured entrypoint for service deployments
 * (per ADR-WSF-24 §9, Deployment Modes : service mode).
 *
 * Configuration is via environment variables only; no secrets are
 * hardcoded or committed. See deploy/.env.example for the full list.
 *
 *   WSF_HOST              Bind host (default: 0.0.0.0)
 *   WSF_PORT              Bind port (default: 8080)
 *   WSF_API_PREFIX        API route prefix (default: /v1)
 *   WSF_CORS_ORIGINS      Comma-separated CORS origins (default: *)
 *   WSF_STORE_BACKEND     memory | postgresql | sqlite | neo4j | mongodb
 *
 * Backend-specific:
 *   WSF_PG_HOST / WSF_PG_PORT / WSF_PG_DATABASE / WSF_PG_USER / WSF_PG_PASSWORD / WSF_PG_SSL
 *   WSF_SQLITE_PATH / WSF_SQLITE_WAL
 *   WSF_NEO4J_URI / WSF_NEO4J_USERNAME / WSF_NEO4J_PASSWORD / WSF_NEO4J_DATABASE
 *   WSF_MONGO_URI / WSF_MONGO_DATABASE
 */

import { SemanticEngine } from '../index.js';
import type { EngineConfig } from '../types/index.js';
import { MemoryStore, type StoreLayer } from '../store/StoreLayer.js';
import { PostgreSQLStore } from '../store/postgresql/PostgreSQLStore.js';
import { SQLiteStore } from '../store/sqlite/SQLiteStore.js';
import { Neo4jStore } from '../store/neo4j/Neo4jStore.js';
import { MongoDBStore } from '../store/mongodb/MongoDBStore.js';
import { startRESTServer } from './RESTServer.js';

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: required environment variable ${name} is not set`);
    process.exit(1);
  }
  return value;
}

function buildStore(): StoreLayer {
  const backend = (process.env.WSF_STORE_BACKEND ?? 'memory').toLowerCase();

  switch (backend) {
    case 'memory':
      return new MemoryStore();

    case 'postgresql':
      return new PostgreSQLStore({
        host: mustEnv('WSF_PG_HOST'),
        port: parseInt(process.env.WSF_PG_PORT ?? '5432', 10),
        database: mustEnv('WSF_PG_DATABASE'),
        user: mustEnv('WSF_PG_USER'),
        password: mustEnv('WSF_PG_PASSWORD'),
        ssl: (process.env.WSF_PG_SSL ?? 'false').toLowerCase() === 'true',
      });

    case 'sqlite':
      return new SQLiteStore({
        path: process.env.WSF_SQLITE_PATH ?? './wsf.db',
        wal_mode: (process.env.WSF_SQLITE_WAL ?? 'true').toLowerCase() === 'true',
      });

    case 'neo4j':
      return new Neo4jStore({
        uri: mustEnv('WSF_NEO4J_URI'),
        username: mustEnv('WSF_NEO4J_USERNAME'),
        password: mustEnv('WSF_NEO4J_PASSWORD'),
        database: process.env.WSF_NEO4J_DATABASE ?? 'neo4j',
      });

    case 'mongodb':
      return new MongoDBStore({
        uri: mustEnv('WSF_MONGO_URI'),
        database: process.env.WSF_MONGO_DATABASE ?? 'wsf',
      });

    default:
      console.error(`FATAL: unknown WSF_STORE_BACKEND '${backend}'; expected memory | postgresql | sqlite | neo4j | mongodb`);
      process.exit(1);
  }
}

async function main(): Promise<void> {
  const store = buildStore();
  if ('connect' in store && typeof (store as { connect?: () => Promise<void> }).connect === 'function') {
    await (store as { connect: () => Promise<void> }).connect();
  }

  const engine = new SemanticEngine(
    { store_backend: (process.env.WSF_STORE_BACKEND ?? 'memory') as EngineConfig['store_backend'] },
    store,
  );
  await engine.initialise();

  const server = await startRESTServer(engine, {
    host: process.env.WSF_HOST ?? '0.0.0.0',
    port: parseInt(process.env.WSF_PORT ?? '8080', 10),
    prefix: process.env.WSF_API_PREFIX ?? '/v1',
    cors_origins: (process.env.WSF_CORS_ORIGINS ?? '*').split(',').map(s => s.trim()),
  });

  const health = await engine.healthCheck();
  console.log(`WSF Semantic Engine listening: ${health.details}`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; shutting down`);
    await server.stop();
    if ('disconnect' in store && typeof (store as { disconnect?: () => Promise<void> }).disconnect === 'function') {
      await (store as { disconnect: () => Promise<void> }).disconnect();
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(error => {
  console.error(`FATAL: engine failed to start: ${(error as Error).message}`);
  process.exit(1);
});
