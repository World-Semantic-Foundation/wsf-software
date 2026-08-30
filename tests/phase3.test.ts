/**
 * WSF Semantic Engine : Phase 3 Tests
 *
 * Tests for the operationalized Supporting Semantics (Tier 2):
 *   Track A : TerminologyService (Term + Definition, ADR-WSF-20)
 *   Track B : EvidenceService (sufficiency policies, ADR-WSF-22)
 *   Track C : AuthorityService (registry + delegation, ADR-WSF-15)
 *   Track D : ReferenceService (external mappings, ADR-WSF-21)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine } from '../src/index.js';
import type { Term, Definition, EvidenceReference, AuthorityRecord, ExternalReference } from '../src/types/index.js';

const PROV = { actor: 'wsf:TestActor', authority: 'wsf:WSF', timestamp: new Date().toISOString() };

// ============================================================================
// Track A : Terminology
// ============================================================================

describe('TerminologyService', () => {
  test('registers preferred + admitted terms for a concept', async () => {
    const engine = new SemanticEngine();
    const t1: Term = { semantic_id: 'wsf:term:1', designation: 'Digital Twin', kind: 'preferred', concept: 'wsf:DigitalTwin', provenance: PROV, created_at: new Date().toISOString() };
    const t2: Term = { semantic_id: 'wsf:term:2', designation: 'Virtual Twin', kind: 'admitted', concept: 'wsf:DigitalTwin', provenance: PROV, created_at: new Date().toISOString() };
    assert.equal((await engine.services.terminology.registerTerm(t1)).success, true);
    assert.equal((await engine.services.terminology.registerTerm(t2)).success, true);

    const terms = await engine.services.terminology.getTermsForConcept('wsf:DigitalTwin');
    assert.equal(terms.data?.length, 2);
  });

  test('rejects a second preferred term in the same language', async () => {
    const engine = new SemanticEngine();
    const t1: Term = { semantic_id: 'wsf:term:3', designation: 'Entity', kind: 'preferred', concept: 'wsf:Entity', provenance: PROV, created_at: new Date().toISOString() };
    const t2: Term = { semantic_id: 'wsf:term:4', designation: 'Thing', kind: 'preferred', concept: 'wsf:Entity', provenance: PROV, created_at: new Date().toISOString() };
    await engine.services.terminology.registerTerm(t1);
    const clash = await engine.services.terminology.registerTerm(t2);
    assert.equal(clash.success, false);
    assert.equal(clash.error?.code, 'TERM_PREFERRED_CLASH');
  });

  test('allows preferred terms in different languages', async () => {
    const engine = new SemanticEngine();
    const en: Term = { semantic_id: 'wsf:term:5', designation: 'Entity', language: 'en', kind: 'preferred', concept: 'wsf:Entity', provenance: PROV, created_at: new Date().toISOString() };
    const fr: Term = { semantic_id: 'wsf:term:6', designation: 'Entite', language: 'fr', kind: 'preferred', concept: 'wsf:Entity', provenance: PROV, created_at: new Date().toISOString() };
    assert.equal((await engine.services.terminology.registerTerm(en)).success, true);
    assert.equal((await engine.services.terminology.registerTerm(fr)).success, true);
  });

  test('resolves designations to concepts (case-insensitive)', async () => {
    const engine = new SemanticEngine();
    const t: Term = { semantic_id: 'wsf:term:7', designation: 'Order Management', kind: 'preferred', concept: 'wsf:OrderManagementCapability', provenance: PROV, created_at: new Date().toISOString() };
    await engine.services.terminology.registerTerm(t);
    const result = await engine.services.terminology.resolveDesignation('order management');
    assert.deepEqual(result.data, ['wsf:OrderManagementCapability']);
  });

  test('deprecate retains the term for historical resolution', async () => {
    const engine = new SemanticEngine();
    const t: Term = { semantic_id: 'wsf:term:8', designation: 'Old Name', kind: 'admitted', concept: 'wsf:X', provenance: PROV, created_at: new Date().toISOString() };
    await engine.services.terminology.registerTerm(t);
    await engine.services.terminology.deprecateTerm('wsf:term:8');
    const resolved = await engine.services.terminology.resolveDesignation('Old Name');
    assert.deepEqual(resolved.data, ['wsf:X']);
    const deprecatedOnly = await engine.services.terminology.getTermsForConcept('wsf:X', 'deprecated');
    assert.equal(deprecatedOnly.data?.length, 1);
  });

  test('registers and retrieves definitions by kind', async () => {
    const engine = new SemanticEngine();
    const d1: Definition = { semantic_id: 'wsf:def:1', concept: 'wsf:Entity', text: 'Something that exists per se.', kind: 'intensional', provenance: PROV, created_at: new Date().toISOString() };
    const d2: Definition = { semantic_id: 'wsf:def:2', concept: 'wsf:Entity', text: 'For example: a person, an order, a machine.', kind: 'ostensive', provenance: PROV, created_at: new Date().toISOString() };
    await engine.services.terminology.registerDefinition(d1);
    await engine.services.terminology.registerDefinition(d2);
    const intensional = await engine.services.terminology.getDefinitionsForConcept('wsf:Entity', 'intensional');
    assert.equal(intensional.data?.length, 1);
    assert.equal(intensional.data?.[0].text, 'Something that exists per se.');
  });
});

// ============================================================================
// Track B : Evidence
// ============================================================================

function makeEvidence(id: string, assertion: string, type: EvidenceReference['type'], reliability?: number): EvidenceReference {
  return {
    semantic_id: `wsf:ev:${id}`,
    type,
    location: `https://example.org/evidence/${id}`,
    description: `Evidence ${id}`,
    reliability,
    provenance: { ...PROV, derived_from: [assertion] },
  };
}

describe('EvidenceService', () => {
  test('records and retrieves evidence for an assertion', async () => {
    const engine = new SemanticEngine();
    await engine.services.evidence.record(makeEvidence('1', 'wsf:assertion:X', 'document', 0.9));
    const result = await engine.services.evidence.getForAssertion('wsf:assertion:X');
    assert.equal(result.data?.length, 1);
    assert.equal(result.data?.[0].type, 'document');
  });

  test('sufficiency: policy satisfied', async () => {
    const engine = new SemanticEngine();
    await engine.services.evidence.record(makeEvidence('2', 'wsf:assertion:Y', 'document', 0.9));
    await engine.services.evidence.record(makeEvidence('3', 'wsf:assertion:Y', 'observation', 0.7));
    const report = await engine.services.evidence.evaluateSufficiency('wsf:assertion:Y', {
      min_count: 2,
      min_mean_reliability: 0.75,
      required_types: ['document'],
    });
    assert.equal(report.data?.sufficient, true);
    assert.equal(report.data?.evidence_count, 2);
    assert.equal(report.data?.mean_reliability, 0.8);
  });

  test('sufficiency: shortfalls reported', async () => {
    const engine = new SemanticEngine();
    await engine.services.evidence.record(makeEvidence('4', 'wsf:assertion:Z', 'observation', 0.4));
    const report = await engine.services.evidence.evaluateSufficiency('wsf:assertion:Z', {
      min_count: 2,
      min_mean_reliability: 0.6,
      required_types: ['document', 'measurement'],
    });
    assert.equal(report.data?.sufficient, false);
    assert.equal(report.data?.shortfalls.length, 4);
  });

  test('sufficiency with no evidence fails count and reliability checks', async () => {
    const engine = new SemanticEngine();
    const report = await engine.services.evidence.evaluateSufficiency('wsf:assertion:none', {
      min_count: 1,
      min_mean_reliability: 0.5,
    });
    assert.equal(report.data?.sufficient, false);
    assert.equal(report.data?.mean_reliability, null);
  });
});

// ============================================================================
// Track C : Authority
// ============================================================================

function makeAuthority(id: string, status: AuthorityRecord['status'] = 'Normative', delegates_to?: string): AuthorityRecord {
  return {
    semantic_id: `wsf:authority:${id}`,
    name: id,
    kind: 'organisation',
    status,
    delegates_to,
    provenance: PROV,
    registered_at: new Date().toISOString(),
  };
}

describe('AuthorityService', () => {
  test('registers authorities and rejects unknown delegation targets', async () => {
    const engine = new SemanticEngine();
    const orphan = makeAuthority('Orphan', 'Normative', 'wsf:authority:Missing');
    const result = await engine.services.authority.register(orphan);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'AUTHORITY_DELEGATION_TARGET_UNKNOWN');
  });

  test('resolves delegation chains transitively', async () => {
    const engine = new SemanticEngine();
    await engine.services.authority.register(makeAuthority('Root'));
    await engine.services.authority.register(makeAuthority('Regional', 'Normative', 'wsf:authority:Root'));
    await engine.services.authority.register(makeAuthority('Local', 'Normative', 'wsf:authority:Regional'));

    const chain = await engine.services.authority.resolveDelegationChain('wsf:authority:Local');
    assert.deepEqual(chain.data, ['wsf:authority:Local', 'wsf:authority:Regional', 'wsf:authority:Root']);
  });

  test('verifyActive accepts Normative and rejects Deprecated authorities', async () => {
    const engine = new SemanticEngine();
    await engine.services.authority.register(makeAuthority('Active'));
    await engine.services.authority.register(makeAuthority('Sunset', 'Deprecated'));

    assert.equal((await engine.services.authority.verifyActive('wsf:authority:Active')).data?.active, true);
    const sunset = await engine.services.authority.verifyActive('wsf:authority:Sunset');
    assert.equal(sunset.data?.active, false);
    assert.ok(sunset.data?.reason.includes('Deprecated'));
    assert.equal((await engine.services.authority.verifyActive('wsf:authority:Ghost')).data?.active, false);
  });

  test('namespace ownership lookup', async () => {
    const engine = new SemanticEngine();
    await engine.services.authority.register({ ...makeAuthority('WSF'), namespaces: ['wsf', 'wsf-ex'] });
    const owner = await engine.services.authority.getNamespaceOwner('wsf');
    assert.equal(owner.data?.semantic_id, 'wsf:authority:WSF');
    const none = await engine.services.authority.getNamespaceOwner('unknown');
    assert.equal(none.data, null);
  });
});

// ============================================================================
// Track D : Reference
// ============================================================================

function makeReference(id: string, concept: string, iri: string, system: string, kind: ExternalReference['kind']): ExternalReference {
  return {
    semantic_id: `wsf:ref:${id}`,
    concept,
    external_iri: iri,
    system,
    kind,
    provenance: PROV,
    created_at: new Date().toISOString(),
  };
}

describe('ReferenceService', () => {
  test('registers and retrieves mappings by system and kind', async () => {
    const engine = new SemanticEngine();
    await engine.services.reference.register(makeReference('1', 'wsf:Entity', 'https://schema.org/Thing', 'schema.org', 'exact'));
    await engine.services.reference.register(makeReference('2', 'wsf:Entity', 'http://www.w3.org/2002/07/owl#Thing', 'owl', 'close'));

    const all = await engine.services.reference.getForConcept('wsf:Entity');
    assert.equal(all.data?.length, 2);
    const exactOnly = await engine.services.reference.getForConcept('wsf:Entity', { kind: 'exact' });
    assert.equal(exactOnly.data?.length, 1);
  });

  test('exact mapping uniqueness per (concept, system)', async () => {
    const engine = new SemanticEngine();
    await engine.services.reference.register(makeReference('3', 'wsf:Entity', 'https://schema.org/Thing', 'schema.org', 'exact'));
    const clash = await engine.services.reference.register(makeReference('4', 'wsf:Entity', 'https://schema.org/Other', 'schema.org', 'exact'));
    assert.equal(clash.success, false);
    assert.equal(clash.error?.code, 'REFERENCE_EXACT_CLASH');
  });

  test('resolves external IRIs with exact mappings first', async () => {
    const engine = new SemanticEngine();
    await engine.services.reference.register(makeReference('5', 'wsf:Entity', 'https://example.org/x', 'ex', 'close'));
    await engine.services.reference.register(makeReference('6', 'wsf:Thing', 'https://example.org/x', 'ex', 'exact'));
    const resolved = await engine.services.reference.resolveExternal('https://example.org/x');
    assert.equal(resolved.data?.length, 2);
    assert.equal(resolved.data?.[0].kind, 'exact');
    assert.equal(resolved.data?.[0].concept, 'wsf:Thing');
  });

  test('exports exact mappings as a SKOS-style table', async () => {
    const engine = new SemanticEngine();
    await engine.services.reference.register(makeReference('7', 'wsf:Entity', 'https://schema.org/Thing', 'schema.org', 'exact'));
    await engine.services.reference.register(makeReference('8', 'wsf:Entity', 'https://www.wikidata.org/wiki/Q35120', 'wikidata', 'exact'));
    const table = await engine.services.reference.exportExactMappings('wsf:Entity');
    assert.deepEqual(table.data, {
      'schema.org': 'https://schema.org/Thing',
      wikidata: 'https://www.wikidata.org/wiki/Q35120',
    });
  });
});
