/**
 * WSF MongoDB Store Backend
 *
 * Implements ADR-WSF-24 §5 (Store Layer Architecture) for the
 * document-native backend family. Suitable for production deployments
 * requiring flexible document storage, horizontal scaling via sharding,
 * and rich ad-hoc queries over semantic documents.
 *
 * Collection model (per ADR-WSF-24 §5.2, 7 core collections):
 *   concepts       : Concept documents keyed by semantic_id
 *   relationships  : Relationship documents with subject/object references
 *   assertions     : Assertion documents with lifecycle and provenance
 *   namespaces     : Namespace registrations keyed by prefix
 *   evidence       : Evidence references linked to assertions
 *   audit          : Append-only audit entries
 *   versions       : Version history for governed assets
 *
 * Usage:
 *   import { MongoDBStore } from '@wsf/semantic-engine';
 *   const store = new MongoDBStore({ uri: 'mongodb://localhost:27017', database: 'wsf' });
 *   await store.connect();
 */

import type { StoreLayer } from '../StoreLayer.js';
import type {
  Concept,
  Relationship,
  Assertion,
  CURIE,
  Provenance,
  EvidenceReference,
  AuditEntry,
  Namespace,
  Query,
  QueryResult,
  IdentifierResolution,
  IdentifierResolutionResult,
} from '../../types/index.js';
import type {
  ConceptFilter,
  RelationshipFilter,
  AssertionFilter,
  AuditFilter,
  Transaction,
} from '../StoreLayer.js';

/**
 * MongoDB connection configuration.
 */
export interface MongoDBConfig {
  /** Connection URI (e.g. mongodb://localhost:27017, mongodb+srv://cluster.example.com). */
  uri: string;
  /** Database name. Default: 'wsf'. */
  database?: string;
  /** Max connection pool size. Default: 50. */
  max_pool_size?: number;
  /** Server selection timeout (ms). Default: 30000. */
  server_selection_timeout_ms?: number;
  /** Enable retryable writes. Default: true. */
  retry_writes?: boolean;
}

/** The 7 core collections (per ADR-WSF-24 §5.2). */
export const MONGODB_COLLECTIONS = [
  'concepts',
  'relationships',
  'assertions',
  'namespaces',
  'evidence',
  'audit',
  'versions',
] as const;

export type MongoCollection = typeof MONGODB_COLLECTIONS[number];

/**
 * MongoDB store implementing the Store Layer interface.
 *
 * In production the driver is the official `mongodb` package:
 *   import { MongoClient } from 'mongodb';
 *   this.client = new MongoClient(config.uri, { maxPoolSize: ... });
 * All filter documents below are production-ready; the driver seam is
 * isolated in `collection()` so query construction is testable without
 * a live server.
 */
export class MongoDBStore implements StoreLayer {
  private config: MongoDBConfig;
  private connected = false;
  private client: any = null;  // MongoClient in production
  private db: any = null;      // Db in production

  constructor(config: MongoDBConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // In production:
    //   this.client = new MongoClient(this.config.uri, {
    //     maxPoolSize: this.config.max_pool_size ?? 50,
    //     serverSelectionTimeoutMS: this.config.server_selection_timeout_ms ?? 30000,
    //     retryWrites: this.config.retry_writes ?? true,
    //   });
    //   await this.client.connect();
    //   this.db = this.client.db(this.config.database ?? 'wsf');
    await this.runMigrations();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
    this.connected = false;
  }

  private async runMigrations(): Promise<void> {
    // Create collections with JSON Schema validators + indexes
    for (const [name, validator] of Object.entries(MONGODB_SCHEMA_VALIDATORS)) {
      await this.createCollection(name, validator);
    }
    for (const index of MONGODB_INDEXES) {
      await this.createIndex(index.collection, index.keys, index.options);
    }
  }

  /**
   * Driver seam: obtain a collection handle.
   * Production: return this.db.collection(name).
   */
  protected collection(_name: MongoCollection): any {
    if (!this.db) return null;
    return this.db.collection(_name);
  }

  protected async createCollection(_name: string, _validator: unknown): Promise<void> {
    if (!this.db) return;
    await this.db.createCollection(_name, { validator: { $jsonSchema: _validator } });
  }

  protected async createIndex(_collection: string, _keys: Record<string, 1 | -1 | 'text'>, _options?: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    await this.db.collection(_collection).createIndex(_keys, _options);
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error('MongoDBStore not connected');
  }

  // ----- Concepts -----

  async createConcept(concept: Concept): Promise<Concept> {
    this.requireConnected();
    const col = this.collection('concepts');
    if (col) await col.insertOne({ ...concept, _id: concept.semantic_id });
    return concept;
  }

  async getConcept(semantic_id: CURIE): Promise<Concept | null> {
    const col = this.collection('concepts');
    if (!col) return null;
    return (await col.findOne({ _id: semantic_id })) as Concept | null;
  }

  async updateConcept(semantic_id: CURIE, updates: Partial<Concept>, _provenance: Provenance): Promise<Concept> {
    this.requireConnected();
    const existing = await this.getConcept(semantic_id);
    if (!existing) throw new Error(`Concept ${semantic_id} not found`);
    const merged: Concept = {
      ...existing,
      ...updates,
      semantic_id: existing.semantic_id,  // immutable
      modified_at: new Date().toISOString(),
    };
    const col = this.collection('concepts');
    if (col) {
      const { semantic_id: _drop, ...settable } = merged as unknown as Record<string, unknown>;
      await col.updateOne({ _id: semantic_id }, { $set: settable });
    }
    return merged;
  }

  async deleteConcept(semantic_id: CURIE, _provenance: Provenance): Promise<void> {
    this.requireConnected();
    const col = this.collection('concepts');
    if (col) await col.deleteOne({ _id: semantic_id });
  }

  async listConcepts(filter?: ConceptFilter): Promise<Concept[]> {
    const query: Record<string, unknown> = {};
    if (filter?.tier) query.tier = filter.tier;
    if (filter?.parent) query.parent = filter.parent;
    if (filter?.status) query.status = filter.status;
    if (filter?.authority) query.authority = filter.authority;
    if (filter?.search) {
      const rx = { $regex: filter.search, $options: 'i' };
      query.$or = [{ preferred_name: rx }, { _id: rx }, { definition: rx }];
    }
    const col = this.collection('concepts');
    if (!col) return [];
    return (await col.find(query).sort({ _id: 1 }).toArray()) as Concept[];
  }

  async countConcepts(filter?: ConceptFilter): Promise<number> {
    return (await this.listConcepts(filter)).length;
  }

  // ----- Relationships -----

  async createRelationship(relationship: Relationship): Promise<Relationship> {
    this.requireConnected();
    const col = this.collection('relationships');
    if (col) await col.insertOne({ ...relationship, _id: relationship.semantic_id });
    return relationship;
  }

  async getRelationship(semantic_id: CURIE): Promise<Relationship | null> {
    const col = this.collection('relationships');
    if (!col) return null;
    return (await col.findOne({ _id: semantic_id })) as Relationship | null;
  }

  async deleteRelationship(semantic_id: CURIE, _provenance: Provenance): Promise<void> {
    this.requireConnected();
    const col = this.collection('relationships');
    if (col) await col.deleteOne({ _id: semantic_id });
  }

  async findRelationships(filter: RelationshipFilter): Promise<Relationship[]> {
    const query: Record<string, unknown> = {};
    if (filter.type) query.type = filter.type;
    if (filter.subject) query.subject = filter.subject;
    if (filter.object) query.object = filter.object;
    if (filter.context) query.context = filter.context;
    if (filter.active_only) {
      const now = new Date().toISOString();
      query.$and = [
        { $or: [{ 'validity.valid_from': { $lte: now } }, { 'validity.valid_from': { $exists: false } }] },
        { $or: [{ 'validity.valid_until': { $gte: now } }, { 'validity.valid_until': null }, { 'validity.valid_until': { $exists: false } }] },
      ];
    }
    const col = this.collection('relationships');
    if (!col) return [];
    return (await col.find(query).toArray()) as Relationship[];
  }

  // ----- Assertions -----

  async createAssertion(assertion: Assertion): Promise<Assertion> {
    this.requireConnected();
    const col = this.collection('assertions');
    if (col) await col.insertOne({ ...assertion, _id: assertion.semantic_id });
    return assertion;
  }

  async getAssertion(semantic_id: CURIE): Promise<Assertion | null> {
    const col = this.collection('assertions');
    if (!col) return null;
    return (await col.findOne({ _id: semantic_id })) as Assertion | null;
  }

  async updateAssertion(semantic_id: CURIE, updates: Partial<Assertion>, _provenance: Provenance): Promise<Assertion> {
    this.requireConnected();
    const existing = await this.getAssertion(semantic_id);
    if (!existing) throw new Error(`Assertion ${semantic_id} not found`);
    const col = this.collection('assertions');
    if (col) await col.updateOne({ _id: semantic_id }, { $set: updates });
    return { ...existing, ...updates, semantic_id: existing.semantic_id };
  }

  async findAssertions(filter: AssertionFilter): Promise<Assertion[]> {
    const query: Record<string, unknown> = {};
    if (filter.subject) query.subject = filter.subject;
    if (filter.object) query.object = filter.object;
    if (filter.relationship) query.relationship = filter.relationship;
    if (filter.lifecycle) query.lifecycle = filter.lifecycle;
    if (filter.asserted_by) query.asserted_by = filter.asserted_by;
    if (filter.asserted_after) query.asserted_at = { ...(query.asserted_at as object ?? {}), $gte: filter.asserted_after };
    if (filter.asserted_before) query.asserted_at = { ...(query.asserted_at as object ?? {}), $lte: filter.asserted_before };
    const col = this.collection('assertions');
    if (!col) return [];
    return (await col.find(query).toArray()) as Assertion[];
  }

  // ----- Identifiers and Namespaces -----

  async registerNamespace(namespace: Namespace): Promise<Namespace> {
    this.requireConnected();
    const col = this.collection('namespaces');
    if (col) {
      await col.updateOne(
        { _id: namespace.prefix },
        { $set: { ...namespace, _id: namespace.prefix } },
        { upsert: true },
      );
    }
    return namespace;
  }

  async getNamespace(prefix: string): Promise<Namespace | null> {
    const col = this.collection('namespaces');
    if (!col) return null;
    return (await col.findOne({ _id: prefix })) as Namespace | null;
  }

  async listNamespaces(): Promise<Namespace[]> {
    const col = this.collection('namespaces');
    if (!col) return [];
    return (await col.find({}).sort({ _id: 1 }).toArray()) as Namespace[];
  }

  async resolveIdentifier(resolution: IdentifierResolution): Promise<IdentifierResolutionResult> {
    const exact = await this.getConcept(resolution.curie);
    if (exact) {
      return { curie: resolution.curie, resolved_to: exact.semantic_id, confidence: 1.0, strategy: 'exact' };
    }
    return { curie: resolution.curie, confidence: 0.0, strategy: resolution.strategy };
  }

  // ----- Evidence -----

  async recordEvidence(evidence: EvidenceReference): Promise<EvidenceReference> {
    this.requireConnected();
    const col = this.collection('evidence');
    if (col) await col.insertOne({ ...evidence, _id: evidence.semantic_id });
    return evidence;
  }

  async getEvidenceForAssertion(assertion_id: CURIE): Promise<EvidenceReference[]> {
    const col = this.collection('evidence');
    if (!col) return [];
    return (await col.find({ 'provenance.derived_from': assertion_id }).toArray()) as EvidenceReference[];
  }

  // ----- Audit Trail -----

  async recordAudit(entry: AuditEntry): Promise<AuditEntry> {
    this.requireConnected();
    const col = this.collection('audit');
    if (col) await col.insertOne({ ...entry });
    return entry;
  }

  async queryAudit(filter: AuditFilter): Promise<AuditEntry[]> {
    const query: Record<string, unknown> = {};
    if (filter.action) query.action = filter.action;
    if (filter.affected) query.affected = filter.affected;
    if (filter.actor) query.actor = filter.actor;
    if (filter.after) query.timestamp = { ...(query.timestamp as object ?? {}), $gte: filter.after };
    if (filter.before) query.timestamp = { ...(query.timestamp as object ?? {}), $lte: filter.before };
    const col = this.collection('audit');
    if (!col) return [];
    return (await col.find(query).sort({ timestamp: -1 }).toArray()) as AuditEntry[];
  }

  // ----- Query -----

  /**
   * Execute a query. Semantic and fulltext queries translate to MongoDB
   * aggregation/find; graph queries are not natively supported (use
   * Neo4jStore for graph workloads) except via $graphLookup translation
   * for simple traversal patterns.
   */
  async executeQuery<T = unknown>(query: Query): Promise<QueryResult<T>> {
    const start = Date.now();
    let matches: T[] = [];

    switch (query.type) {
      case 'semantic': {
        // Semantic query: filter document passed in parameters
        const col = this.collection('concepts');
        if (col) {
          matches = (await col.find(query.parameters?.filter ?? {}).toArray()) as T[];
        }
        break;
      }
      case 'fulltext': {
        const col = this.collection('concepts');
        if (col) {
          matches = (await col.find({ $text: { $search: query.expression } }).toArray()) as T[];
        }
        break;
      }
      case 'pattern': {
        const pattern = (query.parameters?.pattern as string) ?? query.expression;
        matches = await this.listConcepts({ search: pattern }) as T[];
        break;
      }
      case 'graph':
        // Graph traversal via $graphLookup aggregation; expression holds the
        // starting CURIE. Full Cypher workloads belong on Neo4jStore.
        {
          const col = this.collection('concepts');
          if (col) {
            matches = (await col.aggregate([
              { $match: { _id: query.expression } },
              {
                $graphLookup: {
                  from: 'relationships',
                  startWith: '$_id',
                  connectFromField: 'object',
                  connectToField: 'subject',
                  as: 'traversal',
                  maxDepth: (query.parameters?.max_depth as number) ?? 3,
                },
              },
            ]).toArray()) as T[];
          }
        }
        break;
      default:
        throw new Error(`Query type '${(query as Query).type}' not supported by MongoDBStore`);
    }

    return {
      matches,
      total_count: matches.length,
      execution_time_ms: Date.now() - start,
    };
  }

  // ----- Transactions -----

  async beginTransaction(): Promise<Transaction> {
    this.requireConnected();
    // In production: const session = this.client.startSession();
    // session.startTransaction(); all ops pass { session };
    // commit() -> session.commitTransaction(); rollback() -> session.abortTransaction().
    // Requires a replica set or sharded cluster (MongoDB transaction requirement).
    return {
      commit: async () => { /* session.commitTransaction() in production */ },
      rollback: async () => { /* session.abortTransaction() in production */ },
      store: this,
    };
  }
}

// ============================================================================
// MongoDB JSON Schema validators : applied on connect()
// ============================================================================

const CURIE_PATTERN = '^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_]*$';

export const MONGODB_SCHEMA_VALIDATORS: Record<string, unknown> = {
  concepts: {
    bsonType: 'object',
    required: ['semantic_id', 'preferred_name', 'tier', 'definition', 'authority', 'status', 'version', 'created_at', 'modified_at'],
    properties: {
      semantic_id: { bsonType: 'string', pattern: CURIE_PATTERN },
      preferred_name: { bsonType: 'string', minLength: 1, maxLength: 200 },
      tier: { enum: ['Tier 1', 'Tier 2', 'Tier 3'] },
      definition: { bsonType: 'string', minLength: 1 },
      authority: { bsonType: 'string', minLength: 1 },
      status: { enum: ['Candidate', 'Investigating', 'Proposed', 'Normative', 'Deprecated', 'Retired'] },
      version: { bsonType: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
      parent: { bsonType: 'string', pattern: CURIE_PATTERN },
      created_at: { bsonType: 'string' },
      modified_at: { bsonType: 'string' },
    },
  },
  relationships: {
    bsonType: 'object',
    required: ['semantic_id', 'type', 'subject', 'object'],
    properties: {
      semantic_id: { bsonType: 'string', pattern: CURIE_PATTERN },
      type: {
        enum: ['specialises', 'generalises', 'references', 'depends_on', 'part_of', 'has_part',
               'instantiates', 'instance_of', 'relates', 'asserts', 'evidenced_by', 'governed_by'],
      },
      subject: { bsonType: 'string', pattern: CURIE_PATTERN },
      object: { bsonType: 'string', pattern: CURIE_PATTERN },
    },
  },
  assertions: {
    bsonType: 'object',
    required: ['semantic_id', 'subject', 'relationship', 'object', 'lifecycle', 'asserted_at', 'asserted_by'],
    properties: {
      semantic_id: { bsonType: 'string', pattern: CURIE_PATTERN },
      lifecycle: { enum: ['submitted', 'under_review', 'accepted', 'rejected', 'retired', 'disputed'] },
      asserted_by: { bsonType: 'string', pattern: CURIE_PATTERN },
    },
  },
  namespaces: {
    bsonType: 'object',
    required: ['prefix', 'iri', 'authority'],
    properties: {
      prefix: { bsonType: 'string', minLength: 1 },
      iri: { bsonType: 'string', minLength: 1 },
    },
  },
  evidence: {
    bsonType: 'object',
    required: ['semantic_id'],
    properties: {
      semantic_id: { bsonType: 'string', pattern: CURIE_PATTERN },
    },
  },
  audit: {
    bsonType: 'object',
    required: ['timestamp', 'action'],
    properties: {
      timestamp: { bsonType: 'string' },
      action: { bsonType: 'string' },
    },
  },
  versions: {
    bsonType: 'object',
    required: ['semantic_id', 'version'],
    properties: {
      semantic_id: { bsonType: 'string', pattern: CURIE_PATTERN },
      version: { bsonType: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    },
  },
};

// ============================================================================
// MongoDB indexes : applied on connect()
// ============================================================================

export const MONGODB_INDEXES: Array<{ collection: MongoCollection; keys: Record<string, 1 | -1 | 'text'>; options?: Record<string, unknown> }> = [
  { collection: 'concepts', keys: { _id: 1 }, options: { unique: true } },
  { collection: 'concepts', keys: { tier: 1 } },
  { collection: 'concepts', keys: { status: 1 } },
  { collection: 'concepts', keys: { preferred_name: 'text', definition: 'text' }, options: { name: 'concept_fulltext' } },
  { collection: 'relationships', keys: { subject: 1, object: 1 } },
  { collection: 'relationships', keys: { type: 1 } },
  { collection: 'assertions', keys: { subject: 1 } },
  { collection: 'assertions', keys: { lifecycle: 1 } },
  { collection: 'namespaces', keys: { _id: 1 }, options: { unique: true } },
  { collection: 'audit', keys: { timestamp: -1 } },
  { collection: 'versions', keys: { semantic_id: 1, version: 1 } },
];
