/**
 * WSF REST API
 *
 * Implements ADR-WSF-24 §7 (API Layer Architecture) REST endpoints.
 * Resource-oriented URLs, JSON-LD bodies, OAuth 2.0 + OIDC, RBAC.
 *
 * Endpoints:
 *   GET    /concepts/{semantic_id}
 *   POST   /concepts
 *   GET    /relationships?subject=X&object=Y
 *   POST   /relationships
 *   POST   /assertions
 *   GET    /assertions/{semantic_id}
 *   POST   /validate
 *   POST   /namespaces
 *   GET    /namespaces
 *   POST   /resolve
 *   GET    /audit
 */

import type { ServiceContainer } from '../../services/index.js';
import type {
  Concept,
  Relationship,
  Assertion,
  CURIE,
  EngineResult,
} from '../../types/index.js';

// ============================================================================
// REST API Handlers
// ============================================================================

export class RESTAPI {
  constructor(private services: ServiceContainer) {}

  /**
   * GET /concepts/{semantic_id}
   */
  async getConcept(semantic_id: CURIE): Promise<APIResponse<Concept>> {
    const result = await this.services.concept.get(semantic_id);
    return this.toAPIResponse(result);
  }

  /**
   * POST /concepts
   */
  async createConcept(concept: Concept): Promise<APIResponse<Concept>> {
    const result = await this.services.concept.create(concept);
    return this.toAPIResponse(result);
  }

  /**
   * GET /concepts?tier=Tier1
   */
  async listConcepts(tier?: 'Tier 1' | 'Tier 2' | 'Tier 3'): Promise<APIResponse<Concept[]>> {
    const result = await this.services.concept.list(tier);
    return this.toAPIResponse(result);
  }

  /**
   * POST /relationships
   */
  async createRelationship(relationship: Relationship): Promise<APIResponse<Relationship>> {
    const result = await this.services.relationship.declare(relationship);
    return this.toAPIResponse(result);
  }

  /**
   * GET /relationships?subject=X&object=Y
   */
  async findRelationships(
    type?: string,
    subject?: CURIE,
    object?: CURIE,
  ): Promise<APIResponse<Relationship[]>> {
    const result = await this.services.relationship.find(type, subject, object);
    return this.toAPIResponse(result);
  }

  /**
   * POST /assertions
   */
  async submitAssertion(assertion: Assertion): Promise<APIResponse<Assertion>> {
    const result = await this.services.assertion.submit(assertion);
    return this.toAPIResponse(result);
  }

  /**
   * GET /assertions/{semantic_id}
   */
  async getAssertion(semantic_id: CURIE): Promise<APIResponse<Assertion>> {
    const result = await this.services.assertion.get(semantic_id);
    return this.toAPIResponse(result);
  }

  /**
   * POST /validate
   */
  async validate(request: unknown): Promise<APIResponse<unknown>> {
    const result = await this.services.validation.validate(request as never);
    return this.toAPIResponse(result);
  }

  /**
   * POST /resolve
   */
  async resolveIdentifier(curie: CURIE, strategy: 'exact' | 'prefix_wildcard' | 'cross_namespace' | 'canonical' = 'exact'): Promise<APIResponse<unknown>> {
    const result = await this.services.identity.resolveIdentifier({ curie, strategy });
    return this.toAPIResponse(result);
  }

  /**
   * POST /namespaces
   */
  async registerNamespace(namespace: unknown): Promise<APIResponse<unknown>> {
    const result = await this.services.identity.registerNamespace(namespace as never);
    return this.toAPIResponse(result);
  }

  /**
   * GET /audit?affected=X&actor=Y
   */
  async queryAudit(
    affected?: CURIE,
    actor?: CURIE,
  ): Promise<APIResponse<unknown>> {
    const result = await this.services.audit.query(affected, actor);
    return this.toAPIResponse(result);
  }

  /**
   * Convert EngineResult to API response envelope.
   */
  private toAPIResponse<T>(result: EngineResult<T>): APIResponse<T> {
    if (result.success) {
      return {
        status: 200,
        body: {
          '@context': 'https://www.w3.org/ns/json-ld',
          '@type': 'wsf:APIResponse',
          success: true,
          data: result.data,
          meta: result.meta,
        },
      };
    }
    return {
      status: this.errorStatusCode(result.error?.code ?? 'INTERNAL_ERROR'),
      body: {
        '@context': 'https://www.w3.org/ns/json-ld',
        '@type': 'wsf:APIError',
        success: false,
        error: result.error,
      },
    };
  }

  private errorStatusCode(code: string): number {
    if (code.includes('NOT_FOUND')) return 404;
    if (code.includes('VALIDATION')) return 422;
    if (code.includes('UNAUTHORIZED')) return 401;
    if (code.includes('FORBIDDEN')) return 403;
    return 500;
  }
}

// ============================================================================
// API Response Types
// ============================================================================

export interface APIResponse<T> {
  status: number;
  body: {
    '@context': string;
    '@type': string;
    success: boolean;
    data?: T;
    error?: { code: string; message: string; details?: unknown };
    meta?: { timestamp: string; execution_time_ms: number; actor?: CURIE };
  };
}