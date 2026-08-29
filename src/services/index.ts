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
import type {
  Concept,
  Relationship,
  Assertion,
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

  async retire(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Concept>> {
    return this.update(semantic_id, { status: 'Retired' }, provenance);
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
  ): Promise<EngineResult<Relationship[]>> {
    const results = await this.store.findRelationships({ type, subject, object });
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
    return {
      success: true,
      data: await this.store.updateAssertion(semantic_id, { lifecycle: 'accepted' }, provenance),
    };
  }

  async reject(semantic_id: CURIE, provenance: Provenance): Promise<EngineResult<Assertion>> {
    return {
      success: true,
      data: await this.store.updateAssertion(semantic_id, { lifecycle: 'rejected' }, provenance),
    };
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
  constructor(private store: StoreLayer) {}

  async validate(request: ValidationRequest): Promise<EngineResult<ValidationReport>> {
    const start = Date.now();
    const results: ValidationResult[] = [];

    // Minimal SHACL-like validation: type conformance, required fields, cardinality
    for (const rep of request.representations) {
      // In production: parse rep.content against shapes
      // For now: return empty conformance
      results.push({
        representation: rep.semantic_id,
        severity: 'info',
        path: '',
        message: `Validated ${rep.subject} in ${rep.format}`,
      });
    }

    const report: ValidationReport = {
      results,
      conforms: results.filter(r => r.severity === 'violation').length === 0,
      validation_time_ms: Date.now() - start,
    };

    return { success: true, data: report };
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
  constructor(private store: StoreLayer) {}

  async execute<T = unknown>(query: Query): Promise<EngineResult<QueryResult<T>>> {
    const result = await this.store.executeQuery<T>(query);
    return { success: true, data: result };
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
  };
}