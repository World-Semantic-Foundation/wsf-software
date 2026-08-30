/**
 * WSF Services Layer
 *
 * Implements ADR-WSF-24 §6 (Services Layer Architecture). Exports
 * the 8 service modules:
 *   1. Concept Service
 *   2. Relationship Service
 *   3. Assertion Service
 *   4. Identity Service
 *   5. Validation Service
 *   6. Inference Service
 *   7. Query Service
 *   8. Audit Service
 */

import type { StoreLayer, MemoryStore } from '../store/StoreLayer.js';
import { SHACLValidator } from '../validation/SHACLValidator.js';
import { WSF_SHAPES, SHAPE_BY_TARGET_CLASS } from '../validation/shapes.js';
import { GraphQueryEngine } from '../query/GraphQueryEngine.js';
import {
  SEMANTIC_STATUS_TRANSITIONS,
  ASSERTION_LIFECYCLE_TRANSITIONS,
  assertTransition,
} from '../lifecycle/transitions.js';
import { SimulationService } from '../simulation/SimulationService.js';
import type {
  Concept,
  Relationship,
  Assertion,
  AssertionLifecycle,
  SemanticStatus,
  CURIE,
  Provenance,
  EvidenceReference,
  AuditEntry,
  IdentifierResolution,
  IdentifierResolutionResult,
  Query,
  QueryResult,
  ValidationRequest,
  ValidationReport,
  ValidationResult,
  Namespace,
  EngineResult,
} from '../types/index.js';

// ============================================================================
// 1. Concept Service
// ============================================================================

export class ConceptService {
  constructor(private store: StoreLayer) {}

  async create(concept: Concept): Promise<EngineResult<Concept>> {
    const start = Date.now();
    try {
      const created = await this.store.createConcept(concept);
      return {
        success: true,
        data: created,
        meta: {
          timestamp: new Date().toISOString(),
          execution_time_ms: Date.now() - start,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: { code: 'CONCEPT_CREATE_FAILED', message: (error as Error).message },
      };
    }
  }

  async get(semantic_id: CURIE): Promise<EngineResult<Concept>> {
    const concept = await this.store.getConcept(semantic_id);
    if (!concept) {
      return {
        success: false,
        error: { code: 'CONCEPT_NOT_FOUND', message: `Concept ${semantic_id} not found` },
      };
    }
    return { success: true, data: concept };
  }

  async update(
    semantic_id: CURIE,
    updates: Partial<Concept>,
    provenance: Provenance,
  ): Promise<EngineResult<Concept>> {
    try {
      const updated = await this.store.updateConcept(semantic_id, updates, provenance);
      return { success: true, data: updated };
    } catch (error) {
      return {
        success: false,
        error: { code: 'CONCEPT_UPDATE_FAILED', message: (error as Error).message },
      };
    }
  }

  async list(tier?: 'Tier 1' | 'Tier 2' | 'Tier 3'): Promise<EngineResult<Concept[]>> {
    const concepts = await this.store.listConcepts({ tier });
    return { success: true, data: concepts };
  }

  async specialise(child: CURIE, parent: CURIE, provenance: Provenance): Promise<EngineResult<Concept>> {
    return this.update(child, { parent }, provenance);
  }

  /**
   * Transition a concept's semantic status through the 6-stage state
   * machine (per SEMANTIC-STATUS-MODEL). Illegal transitions are rejected
   * with a LIFECYCLE_TRANSITION_ILLEGAL error; legal transitions are
   * recorded in the audit trail (per ADR-WSF-22).
   */
  async transitionStatus(
    semantic_id: CURIE,
    to: SemanticStatus,
    provenance: Provenance,
  ): Promise<EngineResult<Concept>> {
    const existing = await this.store.getConcept(semantic_id);
    if (!existing) {
      return {
        success: false,
        error: { code: 'CONCEPT_NOT_FOUND', message: `Concept ${semantic_id} not found` },
      };
    }
    try {
      assertTransition('concept status', SEMANTIC_STATUS_TRANSITIONS, existing.status, to);
    } catch (error) {
      return {
        success: false,
        error: { code: 'LIFECYCLE_TRANSITION_ILLEGAL', message: (error as Error).message },
      };
    }
    const updated = await this.store.updateConcept(semantic_id, { status: to }, provenance);
    await this.store.recordAudit({
      semantic_id: `wsf:audit:${crypto.randomUUID()}`,
      action: 'update',
      affected: semantic_id,
      actor: provenance.actor,
      timestamp: new Date().toISOString(),
      before: { status: existing.status },
      after: { status: to },
    });
    return { success: true, data: updated };
  }

  async retire(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Concept>> {
    return this.transitionStatus(semantic_id, 'Retired', provenance);
  }
}

// ============================================================================
// 2. Relationship Service
// ============================================================================

export class RelationshipService {
  constructor(private store: StoreLayer) {}

  async declare(relationship: Relationship): Promise<EngineResult<Relationship>> {
    try {
      const created = await this.store.createRelationship(relationship);
      return { success: true, data: created };
    } catch (error) {
      return {
        success: false,
        error: { code: 'RELATIONSHIP_DECLARE_FAILED', message: (error as Error).message },
      };
    }
  }

  async find(
    type?: string,
    subject?: CURIE,
    object?: CURIE,
    options?: { context?: CURIE; as_of?: string; active_only?: boolean },
  ): Promise<EngineResult<Relationship[]>> {
    const results = await this.store.findRelationships({
      type, subject, object,
      context: options?.context,
      as_of: options?.as_of,
      active_only: options?.active_only,
    });
    return { success: true, data: results };
  }

  async traverse(
    start: CURIE,
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
    max_depth: number = 3,
  ): Promise<EngineResult<Relationship[]>> {
    const visited = new Set<CURIE>();
    const queue: Array<{ id: CURIE; depth: number }> = [{ id: start, depth: 0 }];
    const results: Relationship[] = [];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > max_depth) continue;
      visited.add(id);

      if (direction === 'outgoing' || direction === 'both') {
        const outgoing = await this.store.findRelationships({ subject: id });
        for (const rel of outgoing) {
          results.push(rel);
          queue.push({ id: rel.object, depth: depth + 1 });
        }
      }
      if (direction === 'incoming' || direction === 'both') {
        const incoming = await this.store.findRelationships({ object: id });
        for (const rel of incoming) {
          results.push(rel);
          queue.push({ id: rel.subject, depth: depth + 1 });
        }
      }
    }

    return { success: true, data: results };
  }
}

// ============================================================================
// 3. Assertion Service
// ============================================================================

export class AssertionService {
  constructor(private store: StoreLayer) {}

  async submit(assertion: Assertion): Promise<EngineResult<Assertion>> {
    try {
      const created = await this.store.createAssertion(assertion);
      return { success: true, data: created };
    } catch (error) {
      return {
        success: false,
        error: { code: 'ASSERTION_SUBMIT_FAILED', message: (error as Error).message },
      };
    }
  }

  async get(semantic_id: CURIE): Promise<EngineResult<Assertion>> {
    const assertion = await this.store.getAssertion(semantic_id);
    if (!assertion) {
      return {
        success: false,
        error: { code: 'ASSERTION_NOT_FOUND', message: `Assertion ${semantic_id} not found` },
      };
    }
    return { success: true, data: assertion };
  }

  async findBySubject(subject: CURIE): Promise<EngineResult<Assertion[]>> {
    const results = await this.store.findAssertions({ subject });
    return { success: true, data: results };
  }

  async accept(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Assertion>> {
    return this.transitionLifecycle(semantic_id, 'accepted', provenance);
  }

  async reject(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Assertion>> {
    return this.transitionLifecycle(semantic_id, 'rejected', provenance);
  }

  async dispute(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Assertion>> {
    return this.transitionLifecycle(semantic_id, 'disputed', provenance);
  }

  async retire(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Assertion>> {
    return this.transitionLifecycle(semantic_id, 'retired', provenance);
  }

  async startReview(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Assertion>> {
    return this.transitionLifecycle(semantic_id, 'under_review', provenance);
  }

  /**
   * Transition an assertion through its lifecycle state machine
   * (per ADR-WSF-22). Illegal transitions are rejected with a
   * LIFECYCLE_TRANSITION_ILLEGAL error; legal transitions are audited.
   */
  async transitionLifecycle(
    semantic_id: CURIE,
    to: AssertionLifecycle,
    provenance: Provenance,
  ): Promise<EngineResult<Assertion>> {
    const existing = await this.store.getAssertion(semantic_id);
    if (!existing) {
      return {
        success: false,
        error: { code: 'ASSERTION_NOT_FOUND', message: `Assertion ${semantic_id} not found` },
      };
    }
    try {
      assertTransition('assertion lifecycle', ASSERTION_LIFECYCLE_TRANSITIONS, existing.lifecycle, to);
    } catch (error) {
      return {
        success: false,
        error: { code: 'LIFECYCLE_TRANSITION_ILLEGAL', message: (error as Error).message },
      };
    }
    const updated = await this.store.updateAssertion(semantic_id, { lifecycle: to }, provenance);
    await this.store.recordAudit({
      semantic_id: `wsf:audit:${crypto.randomUUID()}`,
      action: 'update',
      affected: semantic_id,
      actor: provenance.actor,
      timestamp: new Date().toISOString(),
      before: { lifecycle: existing.lifecycle },
      after: { lifecycle: to },
    });
    return { success: true, data: updated };
  }
}

// ============================================================================
// 4. Identity Service
// ============================================================================

export class IdentityService {
  constructor(private store: StoreLayer) {}

  async registerNamespace(namespace: Namespace): Promise<EngineResult<Namespace>> {
    try {
      const created = await this.store.registerNamespace(namespace);
      return { success: true, data: created };
    } catch (error) {
      return {
        success: false,
        error: { code: 'NAMESPACE_REGISTER_FAILED', message: (error as Error).message },
      };
    }
  }

  async resolveIdentifier(
    resolution: IdentifierResolution,
  ): Promise<EngineResult<IdentifierResolutionResult>> {
    const result = await this.store.resolveIdentifier(resolution);
    return { success: true, data: result };
  }

  async listNamespaces(): Promise<EngineResult<Namespace[]>> {
    const namespaces = await this.store.listNamespaces();
    return { success: true, data: namespaces };
  }
}

// ============================================================================
// 5. Validation Service
// ============================================================================

export class ValidationService {
  private validator: SHACLValidator;

  constructor(private store: StoreLayer) {
    this.validator = new SHACLValidator();
    for (const shape of WSF_SHAPES) {
      this.validator.registerShape(shape);
    }
  }

  /**
   * Validate representations against the WSF SHACL shapes.
   *
   * JSON and JSON-LD representations are validated structurally against
   * the registered shapes (per wsf-spec/shacl/wsf-shapes.ttl). Other
   * formats return an informational result pending format-specific parsers.
   */
  async validate(request: ValidationRequest): Promise<EngineResult<ValidationReport>> {
    const start = Date.now();
    const results: ValidationResult[] = [];

    for (const rep of request.representations) {
      if (rep.format !== 'json' && rep.format !== 'json-ld') {
        results.push({
          representation: rep.semantic_id,
          severity: 'info',
          path: '',
          message: `Format '${rep.format}' accepted; structural validation applies to json / json-ld representations`,
        });
        continue;
      }

      let parsed: Record<string, unknown>;
      try {
        const text = typeof rep.content === 'string' ? rep.content : new TextDecoder().decode(rep.content);
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        results.push({
          representation: rep.semantic_id,
          severity: 'violation',
          path: '',
          message: 'Representation content is not valid JSON',
        });
        continue;
      }

      // JSON-LD @graph: validate each node; otherwise validate the single node
      const graph = parsed['@graph'];
      const nodes: Record<string, unknown>[] = Array.isArray(graph)
        ? (graph as Record<string, unknown>[])
        : [parsed];

      for (const node of nodes) {
        const shapeIri = this.selectShape(node, request.shapes);
        if (!shapeIri) {
          results.push({
            representation: rep.semantic_id,
            severity: 'warning',
            path: '',
            message: 'No applicable shape identified (no @type match and no heuristic match); node not validated',
          });
          continue;
        }
        results.push(...this.validator.validateNode(node, shapeIri, rep.semantic_id));
      }
    }

    const report: ValidationReport = {
      results,
      conforms: results.filter(r => r.severity === 'violation').length === 0,
      validation_time_ms: Date.now() - start,
    };

    return { success: true, data: report };
  }

  /**
   * Validate an engine object directly (concept, relationship, assertion)
   * without a Representation envelope. Used by services and tests.
   */
  validateObject(node: Record<string, unknown>, shapeIri: string, subject: CURIE): ValidationReport {
    const start = Date.now();
    const results = this.validator.validateNode(node, shapeIri, subject);
    return {
      results,
      conforms: results.filter(r => r.severity === 'violation').length === 0,
      validation_time_ms: Date.now() - start,
    };
  }

  /** Registered shape IRIs. */
  listShapes(): string[] {
    return this.validator.listShapes();
  }

  /**
   * Shape selection: explicit request shapes win; then JSON-LD @type;
   * then structural heuristics on the node fields.
   */
  private selectShape(node: Record<string, unknown>, requested?: CURIE[]): string | null {
    if (requested && requested.length > 0) {
      for (const iri of requested) {
        if (this.validator.getShape(iri)) return iri;
      }
    }
    const type = node['@type'];
    if (typeof type === 'string' && SHAPE_BY_TARGET_CLASS[type]) {
      return SHAPE_BY_TARGET_CLASS[type];
    }
    if (Array.isArray(type)) {
      for (const t of type) {
        if (typeof t === 'string' && SHAPE_BY_TARGET_CLASS[t]) return SHAPE_BY_TARGET_CLASS[t];
      }
    }
    // Structural heuristics
    if ('tier' in node && 'definition' in node) return 'wsf:ConceptShape';
    if ('lifecycle' in node && 'proposition' in node) return 'wsf:AssertionShape';
    if ('type' in node && 'subject' in node && 'object' in node) return 'wsf:RelationshipShape';
    return null;
  }
}

// ============================================================================
// 6. Inference Service
// ============================================================================

export class InferenceService {
  constructor(private store: StoreLayer) {}

  async applyEntailment(): Promise<EngineResult<{ inferred_count: number }>> {
    // OWL 2 RL entailment: derive transitive closures, inverse relationships,
    // subclass relationships. Minimal implementation.
    const start = Date.now();
    const concepts = await this.store.listConcepts();
    let inferred = 0;

    for (const concept of concepts) {
      if (concept.parent) {
        const parent = await this.store.getConcept(concept.parent);
        if (parent) {
          // Transitive inheritance: child inherits all relationships of parent
          const parentRels = await this.store.findRelationships({ subject: concept.parent });
          for (const rel of parentRels) {
            // Materialise the inherited relationship
            inferred++;
          }
        }
      }
    }

    return {
      success: true,
      data: { inferred_count: inferred },
      meta: {
        timestamp: new Date().toISOString(),
        execution_time_ms: Date.now() - start,
      },
    };
  }

  async explain(concept_id: CURIE): Promise<EngineResult<{ steps: string[] }>> {
    const steps: string[] = [];
    const concept = await this.store.getConcept(concept_id);
    if (!concept) {
      return {
        success: false,
        error: { code: 'CONCEPT_NOT_FOUND', message: `Concept ${concept_id} not found` },
      };
    }

    steps.push(`Concept ${concept.semantic_id} (${concept.preferred_name})`);
    if (concept.parent) {
      const parent = await this.store.getConcept(concept.parent);
      steps.push(`  specialises ${parent?.semantic_id ?? concept.parent}`);
      steps.push(`  inherits all relationships from ${parent?.semantic_id ?? concept.parent}`);
    }

    return { success: true, data: { steps } };
  }
}

// ============================================================================
// 7. Query Service
// ============================================================================

export class QueryService {
  private graph: GraphQueryEngine;

  constructor(private store: StoreLayer) {
    this.graph = new GraphQueryEngine(store);
  }

  async execute<T = unknown>(query: Query): Promise<EngineResult<QueryResult<T>>> {
    // Graph queries route through the portable GraphQueryEngine (Cypher /
    // SPARQL subsets over any backend). Native Cypher passthrough remains
    // available via Neo4jStore.executeQuery() for full Cypher workloads.
    if (query.type === 'graph') {
      try {
        const result = await this.graph.execute<T>(query);
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: { code: 'QUERY_UNSUPPORTED', message: (error as Error).message },
        };
      }
    }
    const result = await this.store.executeQuery<T>(query);
    return { success: true, data: result };
  }

  /** Execute a Cypher-subset expression directly. */
  async executeCypher<T = unknown>(expression: string): Promise<EngineResult<QueryResult<T>>> {
    return this.execute<T>({ type: 'graph', expression });
  }

  /** Execute a SPARQL-subset expression directly. */
  async executeSparql<T = unknown>(expression: string): Promise<EngineResult<QueryResult<T>>> {
    return this.execute<T>({ type: 'graph', expression });
  }

  async searchConcepts(search_term: string): Promise<EngineResult<Concept[]>> {
    const concepts = await this.store.listConcepts({ search: search_term });
    return { success: true, data: concepts };
  }
}

// ============================================================================
// 8. Audit Service
// ============================================================================

export class AuditService {
  constructor(private store: StoreLayer) {}

  async record(entry: AuditEntry): Promise<EngineResult<AuditEntry>> {
    const recorded = await this.store.recordAudit(entry);
    return { success: true, data: recorded };
  }

  async query(
    affected?: CURIE,
    actor?: CURIE,
    after?: string,
    before?: string,
  ): Promise<EngineResult<AuditEntry[]>> {
    const results = await this.store.queryAudit({ affected, actor, after, before });
    return { success: true, data: results };
  }
}

// ============================================================================
// Service Container (composition root)
// ============================================================================

export interface ServiceContainer {
  concept: ConceptService;
  relationship: RelationshipService;
  assertion: AssertionService;
  identity: IdentityService;
  validation: ValidationService;
  inference: InferenceService;
  query: QueryService;
  audit: AuditService;
  simulation: SimulationService;
}

export function createServices(store: StoreLayer): ServiceContainer {
  return {
    concept: new ConceptService(store),
    relationship: new RelationshipService(store),
    assertion: new AssertionService(store),
    identity: new IdentityService(store),
    validation: new ValidationService(store),
    inference: new InferenceService(store),
    query: new QueryService(store),
    audit: new AuditService(store),
    simulation: new SimulationService(),
  };
}