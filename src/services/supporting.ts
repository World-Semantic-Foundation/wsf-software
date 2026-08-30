/**
 * WSF Supporting Semantics Services
 *
 * Phase 3 of the WSF program (per PLAN-INDEX roadmap: Supporting
 * Semantics). Operationalises the Tier 2 constructs not already covered
 * by the core services:
 *
 *   TerminologyService : Term + Definition management (ADR-WSF-20)
 *   EvidenceService    : evidence recording + sufficiency policies (ADR-WSF-22)
 *   AuthorityService   : authority registry + delegation chains (ADR-WSF-15)
 *   ReferenceService   : external IRI mappings, SKOS kinds (ADR-WSF-21)
 *
 * Identifier / Namespace / Validity semantics ship with the core engine
 * (IdentityService, Phase 2 temporal semantics).
 *
 * Persistence: Terminology, Authority and Reference services keep
 * in-memory registries with documented seams, consistent with the
 * SimulationService pattern. EvidenceService is store-backed through
 * the StoreLayer evidence methods.
 */

import type { StoreLayer } from '../store/StoreLayer.js';
import type {
  AuthorityRecord,
  CURIE,
  Definition,
  EngineResult,
  EvidenceReference,
  ExternalReference,
  Term,
} from '../types/index.js';

// ============================================================================
// 9. Terminology Service (ADR-WSF-20)
// ============================================================================

export class TerminologyService {
  private terms = new Map<CURIE, Term>();
  private definitions = new Map<CURIE, Definition>();

  constructor(private store: StoreLayer) {}

  /**
   * Register a term. Enforces the designation rule: at most one
   * preferred term per concept per language.
   */
  async registerTerm(term: Term): Promise<EngineResult<Term>> {
    if (this.terms.has(term.semantic_id)) {
      return {
        success: false,
        error: { code: 'TERM_DUPLICATE', message: `Term ${term.semantic_id} already registered` },
      };
    }
    if (term.kind === 'preferred') {
      const language = term.language ?? 'en';
      const clash = Array.from(this.terms.values()).find(t =>
        t.concept === term.concept && t.kind === 'preferred' && (t.language ?? 'en') === language,
      );
      if (clash) {
        return {
          success: false,
          error: {
            code: 'TERM_PREFERRED_CLASH',
            message: `Concept ${term.concept} already has a preferred term in '${language}': '${clash.designation}' (${clash.semantic_id})`,
          },
        };
      }
    }
    this.terms.set(term.semantic_id, term);
    return { success: true, data: term };
  }

  /** Terms designating a concept, optionally filtered by kind. */
  async getTermsForConcept(concept: CURIE, kind?: Term['kind']): Promise<EngineResult<Term[]>> {
    let results = Array.from(this.terms.values()).filter(t => t.concept === concept);
    if (kind) results = results.filter(t => t.kind === kind);
    return { success: true, data: results };
  }

  /** Resolve a designation string to the concept(s) it designates. */
  async resolveDesignation(designation: string, language?: string): Promise<EngineResult<CURIE[]>> {
    const normalised = designation.toLowerCase();
    const matches = Array.from(this.terms.values()).filter(t =>
      t.designation.toLowerCase() === normalised &&
      (!language || (t.language ?? 'en') === language),
    );
    return { success: true, data: matches.map(t => t.concept) };
  }

  /** Deprecate a term (retained for historical resolution). */
  async deprecateTerm(semantic_id: CURIE): Promise<EngineResult<Term>> {
    const term = this.terms.get(semantic_id);
    if (!term) {
      return { success: false, error: { code: 'TERM_NOT_FOUND', message: `Term ${semantic_id} not found` } };
    }
    const updated: Term = { ...term, kind: 'deprecated' };
    this.terms.set(semantic_id, updated);
    return { success: true, data: updated };
  }

  /** Register a definition for a concept. */
  async registerDefinition(definition: Definition): Promise<EngineResult<Definition>> {
    if (this.definitions.has(definition.semantic_id)) {
      return {
        success: false,
        error: { code: 'DEFINITION_DUPLICATE', message: `Definition ${definition.semantic_id} already registered` },
      };
    }
    this.definitions.set(definition.semantic_id, definition);
    return { success: true, data: definition };
  }

  /** Definitions of a concept, optionally filtered by kind. */
  async getDefinitionsForConcept(concept: CURIE, kind?: Definition['kind']): Promise<EngineResult<Definition[]>> {
    let results = Array.from(this.definitions.values()).filter(d => d.concept === concept);
    if (kind) results = results.filter(d => d.kind === kind);
    return { success: true, data: results };
  }
}

// ============================================================================
// 10. Evidence Service (ADR-WSF-22)
// ============================================================================

/**
 * Evidence sufficiency policy: the minimum evidence an assertion must
 * carry before a lifecycle acceptance is considered well-grounded.
 */
export interface EvidencePolicy {
  /** Minimum number of evidence items. */
  min_count?: number;
  /** Minimum mean reliability across the evidence set. */
  min_mean_reliability?: number;
  /** Required evidence types (at least one item of each). */
  required_types?: Array<EvidenceReference['type']>;
}

export interface EvidenceSufficiencyReport {
  assertion: CURIE;
  evidence_count: number;
  mean_reliability: number | null;
  types_present: Array<EvidenceReference['type']>;
  sufficient: boolean;
  shortfalls: string[];
}

export class EvidenceService {
  constructor(private store: StoreLayer) {}

  /** Record an evidence reference (store-backed). */
  async record(evidence: EvidenceReference): Promise<EngineResult<EvidenceReference>> {
    try {
      const recorded = await this.store.recordEvidence(evidence);
      return { success: true, data: recorded };
    } catch (error) {
      return { success: false, error: { code: 'EVIDENCE_RECORD_FAILED', message: (error as Error).message } };
    }
  }

  /** All evidence supporting an assertion. */
  async getForAssertion(assertion_id: CURIE): Promise<EngineResult<EvidenceReference[]>> {
    const evidence = await this.store.getEvidenceForAssertion(assertion_id);
    return { success: true, data: evidence };
  }

  /**
   * Evaluate an assertion's evidence set against a sufficiency policy.
   * This is a check, not a gate: AssertionService.accept() does not
   * enforce policies automatically; governance tooling calls this to
   * decide whether acceptance is well-grounded (per ADR-WSF-22 §evidence).
   */
  async evaluateSufficiency(assertion_id: CURIE, policy: EvidencePolicy): Promise<EngineResult<EvidenceSufficiencyReport>> {
    const evidence = await this.store.getEvidenceForAssertion(assertion_id);
    const reliabilities = evidence.map(e => e.reliability).filter((r): r is number => typeof r === 'number');
    const mean = reliabilities.length > 0
      ? reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length
      : null;
    const typesPresent = [...new Set(evidence.map(e => e.type))];
    const shortfalls: string[] = [];

    if (policy.min_count !== undefined && evidence.length < policy.min_count) {
      shortfalls.push(`evidence count ${evidence.length} below minimum ${policy.min_count}`);
    }
    if (policy.min_mean_reliability !== undefined && (mean === null || mean < policy.min_mean_reliability)) {
      shortfalls.push(`mean reliability ${mean === null ? 'n/a' : mean.toFixed(3)} below minimum ${policy.min_mean_reliability}`);
    }
    for (const required of policy.required_types ?? []) {
      if (!typesPresent.includes(required)) {
        shortfalls.push(`required evidence type '${required}' not present`);
      }
    }

    return {
      success: true,
      data: {
        assertion: assertion_id,
        evidence_count: evidence.length,
        mean_reliability: mean,
        types_present: typesPresent,
        sufficient: shortfalls.length === 0,
        shortfalls,
      },
    };
  }
}

// ============================================================================
// 11. Authority Service (ADR-WSF-15)
// ============================================================================

export class AuthorityService {
  private authorities = new Map<CURIE, AuthorityRecord>();

  constructor(private store: StoreLayer) {}

  /** Register an authority. */
  async register(authority: AuthorityRecord): Promise<EngineResult<AuthorityRecord>> {
    if (this.authorities.has(authority.semantic_id)) {
      return {
        success: false,
        error: { code: 'AUTHORITY_DUPLICATE', message: `Authority ${authority.semantic_id} already registered` },
      };
    }
    if (authority.delegates_to && !this.authorities.has(authority.delegates_to)) {
      return {
        success: false,
        error: {
          code: 'AUTHORITY_DELEGATION_TARGET_UNKNOWN',
          message: `Delegation target ${authority.delegates_to} is not a registered authority`,
        },
      };
    }
    this.authorities.set(authority.semantic_id, authority);
    return { success: true, data: authority };
  }

  /** Retrieve an authority record. */
  async get(semantic_id: CURIE): Promise<EngineResult<AuthorityRecord>> {
    const authority = this.authorities.get(semantic_id);
    if (!authority) {
      return { success: false, error: { code: 'AUTHORITY_NOT_FOUND', message: `Authority ${semantic_id} not found` } };
    }
    return { success: true, data: authority };
  }

  /**
   * Resolve the delegation chain from an authority to its root,
   * cycle-safe. Returns the chain ordered from the given authority to
   * the final decision authority.
   */
  async resolveDelegationChain(semantic_id: CURIE): Promise<EngineResult<CURIE[]>> {
    const chain: CURIE[] = [];
    const seen = new Set<CURIE>();
    let current: CURIE | undefined = semantic_id;

    while (current) {
      if (seen.has(current)) {
        return {
          success: false,
          error: { code: 'AUTHORITY_DELEGATION_CYCLE', message: `Delegation cycle detected at ${current}` },
        };
      }
      seen.add(current);
      const record = this.authorities.get(current);
      if (!record) {
        return {
          success: false,
          error: { code: 'AUTHORITY_NOT_FOUND', message: `Authority ${current} not found in delegation chain` },
        };
      }
      chain.push(current);
      current = record.delegates_to;
    }

    return { success: true, data: chain };
  }

  /**
   * Verify that a provenance authority is registered and active
   * (status Normative). Deprecated or retired authorities are not
   * accepted for new actions.
   */
  async verifyActive(authority_id: CURIE): Promise<EngineResult<{ active: boolean; reason: string }>> {
    const record = this.authorities.get(authority_id);
    if (!record) {
      return {
        success: true,
        data: { active: false, reason: `authority ${authority_id} is not registered` },
      };
    }
    if (record.status !== 'Normative') {
      return {
        success: true,
        data: { active: false, reason: `authority ${authority_id} status is ${record.status}; only Normative authorities are active` },
      };
    }
    return { success: true, data: { active: true, reason: 'authority registered and Normative' } };
  }

  /** The authority owning a namespace prefix, if registered. */
  async getNamespaceOwner(prefix: string): Promise<EngineResult<AuthorityRecord | null>> {
    const owner = Array.from(this.authorities.values()).find(a => (a.namespaces ?? []).includes(prefix));
    return { success: true, data: owner ?? null };
  }
}

// ============================================================================
// 12. Reference Service (ADR-WSF-21)
// ============================================================================

export class ReferenceService {
  private references = new Map<CURIE, ExternalReference>();

  constructor(private store: StoreLayer) {}

  /** Register an external reference mapping. */
  async register(reference: ExternalReference): Promise<EngineResult<ExternalReference>> {
    if (this.references.has(reference.semantic_id)) {
      return {
        success: false,
        error: { code: 'REFERENCE_DUPLICATE', message: `Reference ${reference.semantic_id} already registered` },
      };
    }
    // An exact mapping must be unique per (concept, system)
    if (reference.kind === 'exact') {
      const clash = Array.from(this.references.values()).find(r =>
        r.concept === reference.concept && r.system === reference.system && r.kind === 'exact',
      );
      if (clash) {
        return {
          success: false,
          error: {
            code: 'REFERENCE_EXACT_CLASH',
            message: `Concept ${reference.concept} already has an exact mapping in system '${reference.system}': ${clash.external_iri}`,
          },
        };
      }
    }
    this.references.set(reference.semantic_id, reference);
    return { success: true, data: reference };
  }

  /** All external references for a concept, optionally filtered. */
  async getForConcept(
    concept: CURIE,
    filter?: { system?: string; kind?: ExternalReference['kind'] },
  ): Promise<EngineResult<ExternalReference[]>> {
    let results = Array.from(this.references.values()).filter(r => r.concept === concept);
    if (filter?.system) results = results.filter(r => r.system === filter.system);
    if (filter?.kind) results = results.filter(r => r.kind === filter.kind);
    return { success: true, data: results };
  }

  /**
   * Resolve an external IRI to the internal concept(s) it maps to.
   * Exact mappings take precedence; close mappings follow.
   */
  async resolveExternal(external_iri: string): Promise<EngineResult<{ concept: CURIE; kind: ExternalReference['kind'] }[]>> {
    const matches = Array.from(this.references.values())
      .filter(r => r.external_iri === external_iri)
      .sort((a, b) => (a.kind === 'exact' ? 0 : 1) - (b.kind === 'exact' ? 0 : 1));
    return { success: true, data: matches.map(r => ({ concept: r.concept, kind: r.kind })) };
  }

  /**
   * Export a concept's exact mappings as a SKOS-style mapping table
   * (concept → { system: external_iri }).
   */
  async exportExactMappings(concept: CURIE): Promise<EngineResult<Record<string, string>>> {
    const result = await this.getForConcept(concept, { kind: 'exact' });
    const table: Record<string, string> = {};
    for (const ref of result.data ?? []) {
      table[ref.system] = ref.external_iri;
    }
    return { success: true, data: table };
  }
}
