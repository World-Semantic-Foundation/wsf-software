/**
 * WSF Store Layer Interface Contract
 *
 * Implements ADR-WSF-24 §5 (Store Layer Architecture). Defines the
 * abstract interface that all storage backends (PostgreSQL, Neo4j,
 * MongoDB, SQLite, in-memory) MUST implement.
 *
 * Schema includes 7 core collections per ADR-WSF-24 §5.2:
 * concepts, relationships, assertions, identities, provenance, evidence, versions.
 */

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
} from '../types';

// ============================================================================
// Store Layer Interface
// ============================================================================

/**
 * The canonical Store Layer interface.
 *
 * Implementations: MemoryStore, PostgreSQLStore, Neo4jStore,
 * MongoDBStore, SQLiteStore.
 */
export interface StoreLayer {
  // ----- Concepts -----
  createConcept(concept: Concept): Promise<Concept>;
  getConcept(semantic_id: CURIE): Promise<Concept | null>;
  updateConcept(semantic_id: CURIE, concept: Partial<Concept>, provenance: Provenance): Promise<Concept>;
  deleteConcept(semantic_id: CURIE, provenance: Provenance): Promise<void>;
  listConcepts(filter?: ConceptFilter): Promise<Concept[]>;
  countConcepts(filter?: ConceptFilter): Promise<number>;

  // ----- Relationships -----
  createRelationship(relationship: Relationship): Promise<Relationship>;
  getRelationship(semantic_id: CURIE): Promise<Relationship | null>;
  deleteRelationship(semantic_id: CURIE, provenance: Provenance): Promise<void>;
  findRelationships(filter: RelationshipFilter): Promise<Relationship[]>;

  // ----- Assertions -----
  createAssertion(assertion: Assertion): Promise<Assertion>;
  getAssertion(semantic_id: CURIE): Promise<Assertion | null>;
  updateAssertion(semantic_id: CURIE, assertion: Partial<Assertion>, provenance: Provenance): Promise<Assertion>;
  findAssertions(filter: AssertionFilter): Promise<Assertion[]>;

  // ----- Identifiers and Namespaces -----
  registerNamespace(namespace: Namespace): Promise<Namespace>;
  getNamespace(prefix: string): Promise<Namespace | null>;
  resolveIdentifier(resolution: IdentifierResolution): Promise<IdentifierResolutionResult>;
  listNamespaces(): Promise<Namespace[]>;

  // ----- Evidence -----
  recordEvidence(evidence: EvidenceReference): Promise<EvidenceReference>;
  getEvidenceForAssertion(assertion_id: CURIE): Promise<EvidenceReference[]>;

  // ----- Audit Trail -----
  recordAudit(entry: AuditEntry): Promise<AuditEntry>;
  queryAudit(filter: AuditFilter): Promise<AuditEntry[]>;

  // ----- Query (Cypher/SPARQL/fulltext) -----
  executeQuery<T = unknown>(query: Query): Promise<QueryResult<T>>;

  // ----- Transactions -----
  beginTransaction(): Promise<Transaction>;
}

// ============================================================================
// Filter Types
// ============================================================================

export interface ConceptFilter {
  tier?: 'Tier 1' | 'Tier 2' | 'Tier 3';
  parent?: CURIE;
  status?: string;
  authority?: string;
  search?: string;
}

export interface RelationshipFilter {
  type?: string;
  subject?: CURIE;
  object?: CURIE;
  context?: CURIE;
  active_only?: boolean;
  /** Bitemporal as-of timestamp (ISO 8601): only relationships whose
   * validity window covers this instant are returned. */
  as_of?: string;
}

export interface AssertionFilter {
  subject?: CURIE;
  object?: CURIE;
  relationship?: string;
  lifecycle?: string;
  asserted_by?: CURIE;
  asserted_after?: string;
  asserted_before?: string;
  /** Context qualifier (per ADR-WSF-14). */
  context?: CURIE;
  /** Bitemporal as-of timestamp (ISO 8601): assertion validity window
   * must cover this instant. */
  as_of?: string;
}

export interface AuditFilter {
  action?: string;
  affected?: CURIE;
  actor?: CURIE;
  after?: string;
  before?: string;
}

// ============================================================================
// Transaction Interface
// ============================================================================

export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** Operations on the transaction. */
  store: StoreLayer;
}

// ============================================================================
// In-Memory Store Implementation (for development/testing)
// ============================================================================

/**
 * In-memory implementation of the Store Layer interface.
 *
 * Useful for development, testing, and embedded deployments.
 * Not suitable for production distributed deployments.
 */
export class MemoryStore implements StoreLayer {
  private concepts = new Map<CURIE, Concept>();
  private relationships = new Map<CURIE, Relationship>();
  private assertions = new Map<CURIE, Assertion>();
  private namespaces = new Map<string, Namespace>();
  private evidence = new Map<CURIE, EvidenceReference>();
  private auditTrail: AuditEntry[] = [];

  // ----- Concepts -----
  async createConcept(concept: Concept): Promise<Concept> {
    if (this.concepts.has(concept.semantic_id)) {
      throw new Error(`Concept ${concept.semantic_id} already exists`);
    }
    this.concepts.set(concept.semantic_id, concept);
    return concept;
  }

  async getConcept(semantic_id: CURIE): Promise<Concept | null> {
    return this.concepts.get(semantic_id) ?? null;
  }

  async updateConcept(
    semantic_id: CURIE,
    updates: Partial<Concept>,
    _provenance: Provenance,
  ): Promise<Concept> {
    const existing = this.concepts.get(semantic_id);
    if (!existing) {
      throw new Error(`Concept ${semantic_id} not found`);
    }
    const updated: Concept = {
      ...existing,
      ...updates,
      semantic_id: existing.semantic_id,  // immutable
      modified_at: new Date().toISOString(),
    };
    this.concepts.set(semantic_id, updated);
    return updated;
  }

  async deleteConcept(semantic_id: CURIE, _provenance: Provenance): Promise<void> {
    if (!this.concepts.has(semantic_id)) {
      throw new Error(`Concept ${semantic_id} not found`);
    }
    this.concepts.delete(semantic_id);
  }

  async listConcepts(filter?: ConceptFilter): Promise<Concept[]> {
    let results = Array.from(this.concepts.values());
    if (filter?.tier) {
      results = results.filter(c => c.tier === filter.tier);
    }
    if (filter?.parent) {
      results = results.filter(c => c.parent === filter.parent);
    }
    if (filter?.status) {
      results = results.filter(c => c.status === filter.status);
    }
    if (filter?.authority) {
      results = results.filter(c => c.authority === filter.authority);
    }
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(c =>
        c.preferred_name.toLowerCase().includes(search) ||
        c.semantic_id.toLowerCase().includes(search) ||
        c.definition.toLowerCase().includes(search)
      );
    }
    return results;
  }

  async countConcepts(filter?: ConceptFilter): Promise<number> {
    return (await this.listConcepts(filter)).length;
  }

  // ----- Relationships -----
  async createRelationship(relationship: Relationship): Promise<Relationship> {
    if (this.relationships.has(relationship.semantic_id)) {
      throw new Error(`Relationship ${relationship.semantic_id} already exists`);
    }
    this.relationships.set(relationship.semantic_id, relationship);
    return relationship;
  }

  async getRelationship(semantic_id: CURIE): Promise<Relationship | null> {
    return this.relationships.get(semantic_id) ?? null;
  }

  async deleteRelationship(semantic_id: CURIE, _provenance: Provenance): Promise<void> {
    this.relationships.delete(semantic_id);
  }

  async findRelationships(filter: RelationshipFilter): Promise<Relationship[]> {
    let results = Array.from(this.relationships.values());
    if (filter.type) {
      results = results.filter(r => r.type === filter.type);
    }
    if (filter.subject) {
      results = results.filter(r => r.subject === filter.subject);
    }
    if (filter.object) {
      results = results.filter(r => r.object === filter.object);
    }
    if (filter.context) {
      results = results.filter(r => r.context === filter.context);
    }
    if (filter.active_only || filter.as_of) {
      const instant = filter.as_of ?? new Date().toISOString();
      results = results.filter(r => {
        if (!r.validity) return true;
        const validFrom = r.validity.valid_from <= instant;
        const validUntil = r.validity.valid_until === null || r.validity.valid_until >= instant;
        return validFrom && validUntil;
      });
    }
    return results;
  }

  // ----- Assertions -----
  async createAssertion(assertion: Assertion): Promise<Assertion> {
    if (this.assertions.has(assertion.semantic_id)) {
      throw new Error(`Assertion ${assertion.semantic_id} already exists`);
    }
    this.assertions.set(assertion.semantic_id, assertion);
    return assertion;
  }

  async getAssertion(semantic_id: CURIE): Promise<Assertion | null> {
    return this.assertions.get(semantic_id) ?? null;
  }

  async updateAssertion(
    semantic_id: CURIE,
    updates: Partial<Assertion>,
    _provenance: Provenance,
  ): Promise<Assertion> {
    const existing = this.assertions.get(semantic_id);
    if (!existing) {
      throw new Error(`Assertion ${semantic_id} not found`);
    }
    const updated: Assertion = {
      ...existing,
      ...updates,
      semantic_id: existing.semantic_id,
    };
    this.assertions.set(semantic_id, updated);
    return updated;
  }

  async findAssertions(filter: AssertionFilter): Promise<Assertion[]> {
    let results = Array.from(this.assertions.values());
    if (filter.subject) {
      results = results.filter(a => a.subject === filter.subject);
    }
    if (filter.object) {
      results = results.filter(a => a.object === filter.object);
    }
    if (filter.relationship) {
      results = results.filter(a => a.relationship === filter.relationship);
    }
    if (filter.lifecycle) {
      results = results.filter(a => a.lifecycle === filter.lifecycle);
    }
    if (filter.asserted_by) {
      results = results.filter(a => a.asserted_by === filter.asserted_by);
    }
    if (filter.asserted_after) {
      results = results.filter(a => a.asserted_at >= filter.asserted_after!);
    }
    if (filter.asserted_before) {
      results = results.filter(a => a.asserted_at <= filter.asserted_before!);
    }
    if (filter.context) {
      results = results.filter(a => a.context === filter.context);
    }
    if (filter.as_of) {
      const instant = filter.as_of;
      results = results.filter(a => {
        if (!a.validity) return true;
        const validFrom = a.validity.valid_from <= instant;
        const validUntil = a.validity.valid_until === null || a.validity.valid_until >= instant;
        return validFrom && validUntil;
      });
    }
    return results;
  }

  // ----- Identifiers and Namespaces -----
  async registerNamespace(namespace: Namespace): Promise<Namespace> {
    if (this.namespaces.has(namespace.prefix)) {
      throw new Error(`Namespace ${namespace.prefix} already registered`);
    }
    this.namespaces.set(namespace.prefix, namespace);
    return namespace;
  }

  async getNamespace(prefix: string): Promise<Namespace | null> {
    return this.namespaces.get(prefix) ?? null;
  }

  async listNamespaces(): Promise<Namespace[]> {
    return Array.from(this.namespaces.values());
  }

  /**
   * Resolve an identifier per ADR-WSF-21. Strategies:
   *   exact            : direct CURIE lookup (confidence 1.0)
   *   prefix_wildcard  : 'prefix:*' or namespace-scoped match (0.9 single, alternatives otherwise)
   *   cross_namespace  : same local name resolved across all registered namespaces (0.7)
   *   canonical        : case-normalised local name + alias match (0.8)
   */
  async resolveIdentifier(resolution: IdentifierResolution): Promise<IdentifierResolutionResult> {
    // exact is always attempted first
    const exact = this.concepts.get(resolution.curie);
    if (exact) {
      return {
        curie: resolution.curie,
        resolved_to: exact.semantic_id,
        confidence: 1.0,
        strategy: 'exact',
      };
    }

    const all = Array.from(this.concepts.values());
    const [prefix, local] = resolution.curie.split(':');

    switch (resolution.strategy) {
      case 'exact':
        return { curie: resolution.curie, confidence: 0.0, strategy: 'exact' };

      case 'prefix_wildcard': {
        // 'wsf:*' or 'wsf:' matches every concept in the namespace
        const matches = local === '*' || local === undefined || local === ''
          ? all.filter(c => c.semantic_id.startsWith(prefix + ':'))
          : all.filter(c => c.semantic_id.startsWith(prefix + ':') && c.semantic_id.includes(local));
        if (matches.length === 1) {
          return { curie: resolution.curie, resolved_to: matches[0].semantic_id, confidence: 0.9, strategy: 'prefix_wildcard' };
        }
        return {
          curie: resolution.curie,
          confidence: 0.0,
          strategy: 'prefix_wildcard',
          alternatives: matches.map(c => c.semantic_id),
        };
      }

      case 'cross_namespace': {
        // Same local name in every registered namespace
        const localName = local ?? resolution.curie;
        const matches = all.filter(c => c.semantic_id.split(':')[1] === localName);
        if (matches.length === 1) {
          return { curie: resolution.curie, resolved_to: matches[0].semantic_id, confidence: 0.7, strategy: 'cross_namespace' };
        }
        return {
          curie: resolution.curie,
          confidence: 0.0,
          strategy: 'cross_namespace',
          alternatives: matches.map(c => c.semantic_id),
        };
      }

      case 'canonical': {
        // Case-normalised local name, then alias match
        const normalised = (local ?? resolution.curie).toLowerCase();
        const byName = all.filter(c => c.semantic_id.split(':')[1]?.toLowerCase() === normalised);
        const byAlias = all.filter(c => (c.aliases ?? []).some(a => a.toLowerCase() === normalised || a.toLowerCase().endsWith('/' + normalised)));
        const matches = [...byName, ...byAlias.filter(c => !byName.includes(c))];
        if (matches.length === 1) {
          return { curie: resolution.curie, resolved_to: matches[0].semantic_id, confidence: 0.8, strategy: 'canonical' };
        }
        return {
          curie: resolution.curie,
          confidence: 0.0,
          strategy: 'canonical',
          alternatives: matches.map(c => c.semantic_id),
        };
      }

      default:
        return { curie: resolution.curie, confidence: 0.0, strategy: resolution.strategy };
    }
  }

  // ----- Evidence -----
  async recordEvidence(evidence: EvidenceReference): Promise<EvidenceReference> {
    this.evidence.set(evidence.semantic_id, evidence);
    return evidence;
  }

  async getEvidenceForAssertion(assertion_id: CURIE): Promise<EvidenceReference[]> {
    return Array.from(this.evidence.values()).filter(e =>
      e.provenance.derived_from?.includes(assertion_id),
    );
  }

  // ----- Audit Trail -----
  async recordAudit(entry: AuditEntry): Promise<AuditEntry> {
    this.auditTrail.push(entry);
    return entry;
  }

  async queryAudit(filter: AuditFilter): Promise<AuditEntry[]> {
    let results = this.auditTrail;
    if (filter.action) {
      results = results.filter(a => a.action === filter.action);
    }
    if (filter.affected) {
      results = results.filter(a => a.affected === filter.affected);
    }
    if (filter.actor) {
      results = results.filter(a => a.actor === filter.actor);
    }
    if (filter.after) {
      results = results.filter(a => a.timestamp >= filter.after!);
    }
    if (filter.before) {
      results = results.filter(a => a.timestamp <= filter.before!);
    }
    return results;
  }

  // ----- Query -----
  async executeQuery<T = unknown>(query: Query): Promise<QueryResult<T>> {
    const start = Date.now();
    let matches: T[] = [];

    // Minimal query implementation: pattern matching
    if (query.type === 'pattern') {
      const pattern = query.parameters?.pattern as string | undefined;
      if (pattern) {
        matches = (await this.listConcepts()).filter(c =>
          c.semantic_id.includes(pattern) || c.preferred_name.includes(pattern),
        ) as unknown as T[];
      }
    }

    return {
      matches,
      total_count: matches.length,
      execution_time_ms: Date.now() - start,
    };
  }

  // ----- Transactions -----
  async beginTransaction(): Promise<Transaction> {
    const snapshot = {
      concepts: new Map(this.concepts),
      relationships: new Map(this.relationships),
      assertions: new Map(this.assertions),
      namespaces: new Map(this.namespaces),
      evidence: new Map(this.evidence),
      auditTrail: [...this.auditTrail],
    };
    const txStore: StoreLayer = this;
    return {
      commit: async () => { /* live data already committed per operation */ },
      rollback: async () => {
        this.concepts = snapshot.concepts;
        this.relationships = snapshot.relationships;
        this.assertions = snapshot.assertions;
        this.namespaces = snapshot.namespaces;
        this.evidence = snapshot.evidence;
        this.auditTrail = snapshot.auditTrail;
      },
      store: txStore,
    };
  }
}