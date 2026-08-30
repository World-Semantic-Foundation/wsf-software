/**
 * WSF Semantic Engine : Main Entry Point
 *
 * Implements ADR-WSF-24 (Software Architecture). Bootstraps the
 * Semantic Engine with default configuration and provides the
 * unified API surface.
 */

import { MemoryStore, type StoreLayer } from './store/StoreLayer.js';
import { createServices, type ServiceContainer } from './services/index.js';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from './types/index.js';

// ============================================================================
// SemanticEngine Class
// ============================================================================

export class SemanticEngine {
  readonly config: EngineConfig;
  readonly store: StoreLayer;
  readonly services: ServiceContainer;

  constructor(config: Partial<EngineConfig> = {}, store?: StoreLayer) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.store = store ?? new MemoryStore();
    this.services = createServices(this.store);
  }

  /**
   * Initialise the engine with seed data (the 38 WSF concepts).
   */
  async initialise(): Promise<void> {
    // Register wsf namespace
    await this.services.identity.registerNamespace({
      prefix: 'wsf',
      iri: 'https://world-semantic-foundation.org/ns/',
      authority: 'WSF',
      status: 'Normative',
      registered_at: new Date().toISOString(),
    });

    // Note: full concept seeding requires reading from /wsf/concepts/*.md files.
    // In production, a concept loader would parse those files. For now, the
    // engine boots with an empty concept catalog and consumers can populate it.
  }

  /**
   * Get service accessor.
   */
  getServices(): ServiceContainer {
    return this.services;
  }

  /**
   * Health check.
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded'; details: string }> {
    try {
      const namespaces = await this.services.identity.listNamespaces();
      return {
        status: 'healthy',
        details: `Engine operational: ${this.config.store_backend} backend, ` +
                 `${this.config.api_surface.join(',')} API, ` +
                 `${namespaces.data?.length ?? 0} namespaces registered`,
      };
    } catch (error) {
      return {
        status: 'degraded',
        details: `Engine degraded: ${(error as Error).message}`,
      };
    }
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default SemanticEngine;
export * from './types/index.js';
export * from './store/StoreLayer.js';
export * from './services/index.js';
export { PostgreSQLStore, type PostgreSQLConfig, POSTGRES_SCHEMA_DDL as POSTGRES_SCHEMA_DDL } from './store/postgresql/PostgreSQLStore.js';
export { SQLiteStore, type SQLiteConfig, SQLITE_SCHEMA_DDL as SQLITE_SCHEMA_DDL } from './store/sqlite/SQLiteStore.js';
export { Neo4jStore, type Neo4jConfig, NEO4J_SCHEMA_CYPHER } from './store/neo4j/Neo4jStore.js';
export { MongoDBStore, type MongoDBConfig, type MongoCollection, MONGODB_COLLECTIONS, MONGODB_SCHEMA_VALIDATORS, MONGODB_INDEXES } from './store/mongodb/MongoDBStore.js';
export { SHACLValidator, type NodeShape, type PropertyShape, type SHACLDatatype } from './validation/SHACLValidator.js';
export { WSF_SHAPES, SHAPE_BY_TARGET_CLASS, CONCEPT_SHAPE, RELATIONSHIP_SHAPE, ASSERTION_SHAPE, PROVENANCE_SHAPE, VALIDITY_SHAPE, PROPOSITION_SHAPE, EVIDENCE_SHAPE } from './validation/shapes.js';
export { GraphQueryEngine, QueryUnsupportedError } from './query/GraphQueryEngine.js';
export * from './server/RESTServer.js';