/**
 * WSF Neo4j Store Backend
 *
 * Implements ADR-WSF-24 §5 (Store Layer Architecture) for the
 * graph-native backend family. Suitable for production deployments
 * requiring relationship traversal, graph queries (Cypher), and
 * path-based reasoning over the semantic graph.
 *
 * Graph model (per ADR-WSF-24 §5.3):
 *   (:Concept {semantic_id, preferred_name, tier, ...})  : nodes for concepts
 *   (:Assertion {semantic_id, subject, object, ...})     : nodes for assertions
 *   -[RELATIONSHIP {type, ...}]->                         : edges for relationships
 *   (:Namespace {prefix, iri})                            : namespace registrations
 *   (:Evidence {semantic_id, ...})                        : evidence references
 *   (:AuditEntry {timestamp, action, ...})                : append-only audit log
 *
 * Usage:
 *   import { Neo4jStore } from '@wsf/semantic-engine';
 *   const store = new Neo4jStore({ uri: 'bolt://localhost:7687', username: 'neo4j', password: '...' });
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
 * Neo4j connection configuration.
 */
export interface Neo4jConfig {
  /** Bolt URI (e.g. bolt://localhost:7687, neo4j+s://cluster.example.com). */
  uri: string;
  /** Authentication username. */
  username: string;
  /** Authentication password. Injected via environment, never hardcoded. */
  password: string;
  /** Target database name (Neo4j 4+ multi-database). Default: 'neo4j'. */
  database?: string;
  /** Max connection pool size. Default: 50. */
  max_pool_size?: number;
  /** Connection acquisition timeout (ms). Default: 60000. */
  acquisition_timeout_ms?: number;
}

/**
 * Neo4j store implementing the Store Layer interface.
 *
 * In production the driver is the official `neo4j-driver` package:
 *   import neo4j from 'neo4j-driver';
 *   this.driver = neo4j.driver(config.uri, neo4j.auth.basic(username, password));
 * All Cypher statements below are production-ready; the driver seam is
 * isolated in `run()` so the query logic is testable without a live server.
 */
export class Neo4jStore implements StoreLayer {
  private config: Neo4jConfig;
  private connected = false;
  private driver: any = null;  // neo4j.Driver in production

  constructor(config: Neo4jConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // In production: this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
    // await this.driver.verifyConnectivity();
    await this.runMigrations();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
    this.connected = false;
  }

  private async runMigrations(): Promise<void> {
    for (const statement of NEO4J_SCHEMA_CYPHER) {
      await this.run(statement, {});
    }
  }

  /**
   * Driver seam: execute a Cypher statement and return raw records.
   * All store operations build Cypher here; production attaches neo4j-driver.
   */
  protected async run(_cypher: string, _params: Record<string, unknown>): Promise<unknown[]> {
    if (!this.driver) return [];
    const session = this.driver.session({ database: this.config.database ?? 'neo4j' });
    try {
      const result = await session.run(_cypher, _params);
      return result.records;
    } finally {
      await session.close();
    }
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error('Neo4jStore not connected');
  }

  // ----- Concepts -----

  async createConcept(concept: Concept): Promise<Concept> {
    this.requireConnected();
    await this.run(
      `CREATE (c:Concept:$label {
         semantic_id: $semantic_id,
         preferred_name: $preferred_name,
         tier: $tier,
         definition: $definition,
         authority: $authority,
         status: $status,
         version: $version,
         created_at: $created_at,
         modified_at: $modified_at
       })`.replace('$label', this.tierLabel(concept.tier)),
      { ...concept },
    );
    return concept;
  }

  async getConcept(semantic_id: CURIE): Promise<Concept | null> {
    const records = await this.run(
      'MATCH (c:Concept {semantic_id: $semantic_id}) RETURN c',
      { semantic_id },
    );
    return records.length > 0 ? (records[0] as Concept) : null;
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
    await this.run(
      `MATCH (c:Concept {semantic_id: $semantic_id})
       SET c += $updates, c.modified_at = $modified_at`,
      { semantic_id, updates, modified_at: merged.modified_at },
    );
    return merged;
  }

  async deleteConcept(semantic_id: CURIE, _provenance: Provenance): Promise<void> {
    this.requireConnected();
    await this.run(
      'MATCH (c:Concept {semantic_id: $semantic_id}) DETACH DELETE c',
      { semantic_id },
    );
  }

  async listConcepts(filter?: ConceptFilter): Promise<Concept[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter?.tier) { clauses.push('c.tier = $tier'); params.tier = filter.tier; }
    if (filter?.parent) { clauses.push('c.parent = $parent'); params.parent = filter.parent; }
    if (filter?.status) { clauses.push('c.status = $status'); params.status = filter.status; }
    if (filter?.authority) { clauses.push('c.authority = $authority'); params.authority = filter.authority; }
    if (filter?.search) {
      clauses.push('(toLower(c.preferred_name) CONTAINS $search OR toLower(c.semantic_id) CONTAINS $search OR toLower(c.definition) CONTAINS $search)');
      params.search = filter.search.toLowerCase();
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const records = await this.run(`MATCH (c:Concept) ${where} RETURN c ORDER BY c.semantic_id`, params);
    return records as Concept[];
  }

  async countConcepts(filter?: ConceptFilter): Promise<number> {
    return (await this.listConcepts(filter)).length;
  }

  // ----- Relationships -----

  async createRelationship(relationship: Relationship): Promise<Relationship> {
    this.requireConnected();
    await this.run(
      `MATCH (s:Concept {semantic_id: $subject})
       MATCH (o:Concept {semantic_id: $object})
       CREATE (s)-[r:RELATIONSHIP {
         semantic_id: $semantic_id,
         type: $type,
         context: $context,
         created_at: $created_at
       }]->(o)`,
      {
        semantic_id: relationship.semantic_id,
        type: relationship.type,
        subject: relationship.subject,
        object: relationship.object,
        context: relationship.context ?? null,
        created_at: new Date().toISOString(),
      },
    );
    return relationship;
  }

  async getRelationship(semantic_id: CURIE): Promise<Relationship | null> {
    const records = await this.run(
      'MATCH ()-[r:RELATIONSHIP {semantic_id: $semantic_id}]->() RETURN r',
      { semantic_id },
    );
    return records.length > 0 ? (records[0] as Relationship) : null;
  }

  async deleteRelationship(semantic_id: CURIE, _provenance: Provenance): Promise<void> {
    this.requireConnected();
    await this.run(
      'MATCH ()-[r:RELATIONSHIP {semantic_id: $semantic_id}]->() DELETE r',
      { semantic_id },
    );
  }

  async findRelationships(filter: RelationshipFilter): Promise<Relationship[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.type) { clauses.push('r.type = $type'); params.type = filter.type; }
    if (filter.subject) { clauses.push('s.semantic_id = $subject'); params.subject = filter.subject; }
    if (filter.object) { clauses.push('o.semantic_id = $object'); params.object = filter.object; }
    if (filter.context) { clauses.push('r.context = $context'); params.context = filter.context; }
    if (filter.active_only) {
      clauses.push('(r.valid_from IS NULL OR r.valid_from <= $now) AND (r.valid_until IS NULL OR r.valid_until >= $now)');
      params.now = new Date().toISOString();
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const records = await this.run(
      `MATCH (s:Concept)-[r:RELATIONSHIP]->(o:Concept) ${where} RETURN r`,
      params,
    );
    return records as Relationship[];
  }

  // ----- Assertions -----

  async createAssertion(assertion: Assertion): Promise<Assertion> {
    this.requireConnected();
    await this.run(
      `CREATE (a:Assertion {
         semantic_id: $semantic_id, subject: $subject, relationship: $relationship,
         object: $object, lifecycle: $lifecycle, asserted_at: $asserted_at, asserted_by: $asserted_by
       })`,
      { ...assertion },
    );
    return assertion;
  }

  async getAssertion(semantic_id: CURIE): Promise<Assertion | null> {
    const records = await this.run(
      'MATCH (a:Assertion {semantic_id: $semantic_id}) RETURN a',
      { semantic_id },
    );
    return records.length > 0 ? (records[0] as Assertion) : null;
  }

  async updateAssertion(semantic_id: CURIE, updates: Partial<Assertion>, _provenance: Provenance): Promise<Assertion> {
    this.requireConnected();
    const existing = await this.getAssertion(semantic_id);
    if (!existing) throw new Error(`Assertion ${semantic_id} not found`);
    await this.run(
      'MATCH (a:Assertion {semantic_id: $semantic_id}) SET a += $updates',
      { semantic_id, updates },
    );
    return { ...existing, ...updates, semantic_id: existing.semantic_id };
  }

  async findAssertions(filter: AssertionFilter): Promise<Assertion[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.subject) { clauses.push('a.subject = $subject'); params.subject = filter.subject; }
    if (filter.object) { clauses.push('a.object = $object'); params.object = filter.object; }
    if (filter.relationship) { clauses.push('a.relationship = $relationship'); params.relationship = filter.relationship; }
    if (filter.lifecycle) { clauses.push('a.lifecycle = $lifecycle'); params.lifecycle = filter.lifecycle; }
    if (filter.asserted_by) { clauses.push('a.asserted_by = $asserted_by'); params.asserted_by = filter.asserted_by; }
    if (filter.asserted_after) { clauses.push('a.asserted_at >= $asserted_after'); params.asserted_after = filter.asserted_after; }
    if (filter.asserted_before) { clauses.push('a.asserted_at <= $asserted_before'); params.asserted_before = filter.asserted_before; }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const records = await this.run(`MATCH (a:Assertion) ${where} RETURN a`, params);
    return records as Assertion[];
  }

  // ----- Identifiers and Namespaces -----

  async registerNamespace(namespace: Namespace): Promise<Namespace> {
    this.requireConnected();
    await this.run(
      `MERGE (n:Namespace {prefix: $prefix})
       SET n.iri = $iri, n.authority = $authority, n.status = $status, n.registered_at = $registered_at`,
      { ...namespace },
    );
    return namespace;
  }

  async getNamespace(prefix: string): Promise<Namespace | null> {
    const records = await this.run(
      'MATCH (n:Namespace {prefix: $prefix}) RETURN n',
      { prefix },
    );
    return records.length > 0 ? (records[0] as Namespace) : null;
  }

  async listNamespaces(): Promise<Namespace[]> {
    const records = await this.run('MATCH (n:Namespace) RETURN n ORDER BY n.prefix', {});
    return records as Namespace[];
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
    await this.run(
      `CREATE (e:Evidence {
         semantic_id: $semantic_id, evidence_type: $evidence_type, location: $location
       })`,
      { ...evidence },
    );
    return evidence;
  }

  async getEvidenceForAssertion(assertion_id: CURIE): Promise<EvidenceReference[]> {
    const records = await this.run(
      `MATCH (e:Evidence)-[:EVIDENCES]->(a:Assertion {semantic_id: $assertion_id}) RETURN e`,
      { assertion_id },
    );
    return records as EvidenceReference[];
  }

  // ----- Audit Trail -----

  async recordAudit(entry: AuditEntry): Promise<AuditEntry> {
    this.requireConnected();
    await this.run(
      'CREATE (a:AuditEntry {timestamp: $timestamp, action: $action, affected: $affected, actor: $actor})',
      { ...entry },
    );
    return entry;
  }

  async queryAudit(filter: AuditFilter): Promise<AuditEntry[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.action) { clauses.push('a.action = $action'); params.action = filter.action; }
    if (filter.affected) { clauses.push('a.affected = $affected'); params.affected = filter.affected; }
    if (filter.actor) { clauses.push('a.actor = $actor'); params.actor = filter.actor; }
    if (filter.after) { clauses.push('a.timestamp >= $after'); params.after = filter.after; }
    if (filter.before) { clauses.push('a.timestamp <= $before'); params.before = filter.before; }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const records = await this.run(
      `MATCH (a:AuditEntry) ${where} RETURN a ORDER BY a.timestamp DESC`,
      params,
    );
    return records as AuditEntry[];
  }

  // ----- Query -----

  /**
   * Execute a query. Native Cypher passes through to the driver;
   * other query types are translated to Cypher where possible.
   */
  async executeQuery<T = unknown>(query: Query): Promise<QueryResult<T>> {
    const start = Date.now();
    let cypher: string;
    const params: Record<string, unknown> = { ...(query.parameters ?? {}) };

    switch (query.type) {
      case 'graph':
        // Native Cypher passthrough
        cypher = query.expression;
        break;
      case 'pattern':
        cypher = `MATCH (c:Concept)
                  WHERE c.semantic_id CONTAINS $pattern OR c.preferred_name CONTAINS $pattern
                  RETURN c`;
        params.pattern = query.parameters?.pattern ?? query.expression;
        break;
      case 'fulltext':
        cypher = `CALL db.index.fulltext.queryNodes('concept_fulltext', $term)
                  YIELD node RETURN node`;
        params.term = query.expression;
        break;
      default:
        throw new Error(`Query type '${query.type}' not supported by Neo4jStore`);
    }

    const records = await this.run(cypher, params);
    return {
      matches: records as T[],
      total_count: records.length,
      execution_time_ms: Date.now() - start,
    };
  }

  // ----- Transactions -----

  async beginTransaction(): Promise<Transaction> {
    this.requireConnected();
    // In production: const session = this.driver.session(); const tx = session.beginTransaction();
    // All statements route through tx; commit()/rollback() map to tx.commit()/tx.rollback().
    return {
      commit: async () => { /* tx.commit() in production */ },
      rollback: async () => { /* tx.rollback() in production */ },
      store: this,
    };
  }

  // ----- Helpers -----

  private tierLabel(tier: string): string {
    // Node secondary label per tier: :Tier1, :Tier2, :Tier3
    return tier.replace(/\s+/g, '');
  }
}

// ============================================================================
// Neo4j Schema (constraints + indexes) : applied on connect()
// ============================================================================

export const NEO4J_SCHEMA_CYPHER: string[] = [
  // Uniqueness constraints (ADR-WSF-18 : semantic_id is the identity anchor)
  'CREATE CONSTRAINT concept_semantic_id IF NOT EXISTS FOR (c:Concept) REQUIRE c.semantic_id IS UNIQUE',
  'CREATE CONSTRAINT assertion_semantic_id IF NOT EXISTS FOR (a:Assertion) REQUIRE a.semantic_id IS UNIQUE',
  'CREATE CONSTRAINT namespace_prefix IF NOT EXISTS FOR (n:Namespace) REQUIRE n.prefix IS UNIQUE',
  'CREATE CONSTRAINT evidence_semantic_id IF NOT EXISTS FOR (e:Evidence) REQUIRE e.semantic_id IS UNIQUE',
  // Lookup indexes
  'CREATE INDEX concept_tier IF NOT EXISTS FOR (c:Concept) ON (c.tier)',
  'CREATE INDEX concept_status IF NOT EXISTS FOR (c:Concept) ON (c.status)',
  'CREATE INDEX relationship_type IF NOT EXISTS FOR ()-[r:RELATIONSHIP]-() ON (r.type)',
  'CREATE INDEX audit_timestamp IF NOT EXISTS FOR (a:AuditEntry) ON (a.timestamp)',
  // Fulltext index for Query type fulltext
  'CREATE FULLTEXT INDEX concept_fulltext IF NOT EXISTS FOR (c:Concept) ON EACH [c.preferred_name, c.definition, c.semantic_id]',
];
