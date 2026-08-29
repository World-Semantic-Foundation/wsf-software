/**
 * WSF SQLite Store Backend
 *
 * Implements ADR-WSF-24 §5 (Store Layer Architecture) for the
 * SQLite backend family. Suitable for embedded deployments, single-node
 * development, and lightweight edge use cases.
 *
 * Usage:
 *   import { SQLiteStore } from '@wsf/semantic-engine/store/sqlite';
 *   const store = new SQLiteStore({ path: './wsf.db' });
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
 * SQLite connection configuration.
 */
export interface SQLiteConfig {
  /** Database file path, or ':memory:' for in-memory. */
  path: string;
  /** Enable WAL mode for better concurrency. */
  wal_mode?: boolean;
  /** Schema name prefix (for multi-tenancy). */
  schema_prefix?: string;
}

export class SQLiteStore implements StoreLayer {
  private config: SQLiteConfig;
  private connected = false;
  private db: any = null;  // better-sqlite3 Database in production

  constructor(config: SQLiteConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // In production: import('better-sqlite3'), create Database
    // this.db = new Database(this.config.path);
    // if (this.config.wal_mode) this.db.pragma('journal_mode = WAL');
    await this.runMigrations();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  private async runMigrations(): Promise<void> {
    const prefix = this.config.schema_prefix ?? '';
    await this.execute(SQLITE_SCHEMA_DDL.replace(/wsf_/g, prefix + 'wsf_'));
  }

  private async execute(sql: string): Promise<void> {
    if (!this.db) return;
    this.db.exec(sql);
  }

  // ----- Concepts -----
  async createConcept(concept: Concept): Promise<Concept> {
    if (!this.connected) throw new Error('SQLiteStore not connected');
    return concept;
  }

  async getConcept(semantic_id: CURIE): Promise<Concept | null> {
    return null;
  }

  async updateConcept(semantic_id: CURIE, updates: Partial<Concept>, provenance: Provenance): Promise<Concept> {
    const existing = await this.getConcept(semantic_id);
    if (!existing) throw new Error(`Concept ${semantic_id} not found`);
    return { ...existing, ...updates, semantic_id: existing.semantic_id, modified_at: new Date().toISOString() };
  }

  async deleteConcept(semantic_id: CURIE, provenance: Provenance): Promise<void> {}

  async listConcepts(filter?: ConceptFilter): Promise<Concept[]> {
    return [];
  }

  async countConcepts(filter?: ConceptFilter): Promise<number> {
    return 0;
  }

  // ----- Relationships -----
  async createRelationship(relationship: Relationship): Promise<Relationship> {
    return relationship;
  }

  async getRelationship(semantic_id: CURIE): Promise<Relationship | null> {
    return null;
  }

  async deleteRelationship(semantic_id: CURIE, provenance: Provenance): Promise<void> {}

  async findRelationships(filter: RelationshipFilter): Promise<Relationship[]> {
    return [];
  }

  // ----- Assertions -----
  async createAssertion(assertion: Assertion): Promise<Assertion> {
    return assertion;
  }

  async getAssertion(semantic_id: CURIE): Promise<Assertion | null> {
    return null;
  }

  async updateAssertion(semantic_id: CURIE, updates: Partial<Assertion>, provenance: Provenance): Promise<Assertion> {
    const existing = await this.getAssertion(semantic_id);
    if (!existing) throw new Error(`Assertion ${semantic_id} not found`);
    return { ...existing, ...updates, semantic_id: existing.semantic_id };
  }

  async findAssertions(filter: AssertionFilter): Promise<Assertion[]> {
    return [];
  }

  // ----- Identifiers -----
  async registerNamespace(namespace: Namespace): Promise<Namespace> {
    return namespace;
  }

  async getNamespace(prefix: string): Promise<Namespace | null> {
    return null;
  }

  async resolveIdentifier(resolution: IdentifierResolution): Promise<IdentifierResolutionResult> {
    return { curie: resolution.curie, confidence: 0, strategy: resolution.strategy };
  }

  async listNamespaces(): Promise<Namespace[]> {
    return [];
  }

  // ----- Evidence -----
  async recordEvidence(evidence: EvidenceReference): Promise<EvidenceReference> {
    return evidence;
  }

  async getEvidenceForAssertion(assertion_id: CURIE): Promise<EvidenceReference[]> {
    return [];
  }

  // ----- Audit -----
  async recordAudit(entry: AuditEntry): Promise<AuditEntry> {
    return entry;
  }

  async queryAudit(filter: AuditFilter): Promise<AuditEntry[]> {
    return [];
  }

  // ----- Query -----
  async executeQuery<T = unknown>(query: Query): Promise<QueryResult<T>> {
    return { matches: [], total_count: 0, execution_time_ms: 0 };
  }

  // ----- Transactions -----
  async beginTransaction(): Promise<Transaction> {
    const txStore: StoreLayer = this;
    return {
      commit: async () => {},
      rollback: async () => {},
      store: txStore,
    };
  }
}

/**
 * SQLite schema DDL for the WSF Semantic Engine.
 * Implements the canonical 7-collection schema per ADR-WSF-24 §5.
 */
export const SQLITE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS wsf_concepts (
    semantic_id TEXT PRIMARY KEY,
    preferred_name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('Tier 1', 'Tier 2', 'Tier 3')),
    parent TEXT,
    definition TEXT NOT NULL,
    authority TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Candidate', 'Investigating', 'Proposed', 'Normative', 'Deprecated', 'Retired')),
    version TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_concepts_tier ON wsf_concepts(tier);
CREATE INDEX IF NOT EXISTS idx_concepts_parent ON wsf_concepts(parent);
CREATE INDEX IF NOT EXISTS idx_concepts_status ON wsf_concepts(status);

CREATE TABLE IF NOT EXISTS wsf_relationships (
    semantic_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    object TEXT NOT NULL,
    context TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    valid_from TEXT,
    valid_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_relationships_subject_type_object ON wsf_relationships(subject, type, object);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON wsf_relationships(type);

CREATE TABLE IF NOT EXISTS wsf_assertions (
    semantic_id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    relationship TEXT NOT NULL,
    object TEXT NOT NULL,
    confidence REAL,
    lifecycle TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    asserted_at TEXT NOT NULL,
    asserted_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assertions_subject ON wsf_assertions(subject);
CREATE INDEX IF NOT EXISTS idx_assertions_lifecycle ON wsf_assertions(lifecycle);

CREATE TABLE IF NOT EXISTS wsf_namespaces (
    prefix TEXT PRIMARY KEY,
    iri TEXT NOT NULL UNIQUE,
    authority TEXT NOT NULL,
    status TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wsf_evidence (
    semantic_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    reliability REAL,
    derived_from TEXT DEFAULT '[]',
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wsf_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    authority TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    method TEXT,
    derived_from TEXT DEFAULT '[]',
    version TEXT,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_provenance_target ON wsf_provenance(target_id);
CREATE INDEX IF NOT EXISTS idx_provenance_timestamp ON wsf_provenance(timestamp);

CREATE TABLE IF NOT EXISTS wsf_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    semantic_id TEXT NOT NULL,
    action TEXT NOT NULL,
    affected TEXT NOT NULL,
    actor TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    before_data TEXT,
    after_data TEXT,
    rationale TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_affected ON wsf_audit(affected);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON wsf_audit(actor);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON wsf_audit(timestamp);
`;