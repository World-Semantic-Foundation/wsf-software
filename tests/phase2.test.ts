/**
 * WSF Semantic Engine : Phase 2 Tests
 *
 * Tests for the operationalized Foundational Model:
 *   Track A : lifecycle state machines (concept status, assertion lifecycle)
 *   Track B : identity resolution strategies (per ADR-WSF-21)
 *   Track C : temporal (as-of) + context scoping
 *   Track D : event/state modeling (per ADR-WSF-27 simulation pattern)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine, legalTransitions, SEMANTIC_STATUS_TRANSITIONS } from '../src/index.js';
import type { Concept, Assertion, Relationship, SemanticEvent } from '../src/types/index.js';

const PROV = { actor: 'wsf:TestActor', authority: 'wsf:WSF', timestamp: new Date().toISOString() };

function makeConcept(id: string, status: Concept['status'] = 'Normative', aliases?: string[]): Concept {
  return {
    semantic_id: `wsf:${id}`,
    preferred_name: id,
    tier: 'Tier 1',
    definition: `Definition of ${id}`,
    authority: 'WSF',
    status,
    version: '1.0.0',
    aliases,
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
  };
}

function makeAssertion(id: string, lifecycle: Assertion['lifecycle'] = 'submitted'): Assertion {
  return {
    semantic_id: `wsf:${id}`,
    subject: 'wsf:A',
    relationship: 'relates',
    object: 'wsf:B',
    proposition: { semantic_id: `wsf:prop:${id}`, subject: 'wsf:A', predicate: 'relates', object: 'wsf:B', modality: 'asserted' },
    provenance: PROV,
    lifecycle,
    asserted_at: new Date().toISOString(),
    asserted_by: 'wsf:TestActor',
  };
}

// ============================================================================
// Track A : Lifecycle state machines
// ============================================================================

describe('Lifecycle : concept status state machine', () => {
  test('legal forward path Candidate → Investigating → Proposed → Normative', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('LifecycleConcept', 'Candidate'));

    for (const to of ['Investigating', 'Proposed', 'Normative'] as const) {
      const result = await engine.services.concept.transitionStatus('wsf:LifecycleConcept', to, PROV);
      assert.equal(result.success, true, `transition to ${to} should succeed`);
      assert.equal(result.data?.status, to);
    }
  });

  test('illegal transition is rejected (Normative → Proposed)', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('NormConcept', 'Normative'));
    const result = await engine.services.concept.transitionStatus('wsf:NormConcept', 'Proposed', PROV);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'LIFECYCLE_TRANSITION_ILLEGAL');
  });

  test('Retired is terminal', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('OldConcept', 'Candidate'));
    await engine.services.concept.transitionStatus('wsf:OldConcept', 'Retired', PROV);
    const result = await engine.services.concept.transitionStatus('wsf:OldConcept', 'Candidate', PROV);
    assert.equal(result.success, false);
  });

  test('reinstatement path Deprecated → Normative is legal', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('ReinstateConcept', 'Normative'));
    await engine.services.concept.transitionStatus('wsf:ReinstateConcept', 'Deprecated', PROV);
    const result = await engine.services.concept.transitionStatus('wsf:ReinstateConcept', 'Normative', PROV);
    assert.equal(result.success, true);
  });

  test('transitions are audited with before/after', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('AuditedConcept', 'Candidate'));
    await engine.services.concept.transitionStatus('wsf:AuditedConcept', 'Investigating', PROV);
    const audit = await engine.services.audit.query('wsf:AuditedConcept');
    assert.ok(audit.data && audit.data.length >= 1);
    const entry = audit.data[0] as { before?: { status: string }; after?: { status: string } };
    assert.equal(entry.before?.status, 'Candidate');
    assert.equal(entry.after?.status, 'Investigating');
  });

  test('legalTransitions exposes the machine', () => {
    assert.deepEqual(legalTransitions(SEMANTIC_STATUS_TRANSITIONS, 'Retired'), []);
    assert.ok(legalTransitions(SEMANTIC_STATUS_TRANSITIONS, 'Candidate').includes('Investigating'));
  });
});

describe('Lifecycle : assertion lifecycle state machine', () => {
  test('review path: submitted → under_review → accepted', async () => {
    const engine = new SemanticEngine();
    await engine.services.assertion.submit(makeAssertion('assert1'));
    assert.equal((await engine.services.assertion.accept('wsf:assert1', PROV)).success, false);
    await engine.services.assertion.startReview('wsf:assert1', PROV);
    const accepted = await engine.services.assertion.accept('wsf:assert1', PROV);
    assert.equal(accepted.success, true);
    assert.equal(accepted.data?.lifecycle, 'accepted');
  });

  test('dispute path: accepted → disputed → accepted', async () => {
    const engine = new SemanticEngine();
    await engine.services.assertion.submit(makeAssertion('assert2'));
    await engine.services.assertion.startReview('wsf:assert2', PROV);
    await engine.services.assertion.accept('wsf:assert2', PROV);
    assert.equal((await engine.services.assertion.dispute('wsf:assert2', PROV)).success, true);
    assert.equal((await engine.services.assertion.accept('wsf:assert2', PROV)).success, true);
  });

  test('submitted assertion cannot be disputed directly', async () => {
    const engine = new SemanticEngine();
    await engine.services.assertion.submit(makeAssertion('assert3'));
    const result = await engine.services.assertion.dispute('wsf:assert3', PROV);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'LIFECYCLE_TRANSITION_ILLEGAL');
  });
});

// ============================================================================
// Track B : Identity resolution strategies
// ============================================================================

describe('Identity : resolution strategies (ADR-WSF-21)', () => {
  test('exact resolves with confidence 1.0', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('Entity'));
    const result = await engine.services.identity.resolveIdentifier({ curie: 'wsf:Entity', strategy: 'exact' });
    assert.equal(result.data?.resolved_to, 'wsf:Entity');
    assert.equal(result.data?.confidence, 1.0);
  });

  test('prefix_wildcard resolves a unique namespace match', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('UniqueThing'));
    const result = await engine.services.identity.resolveIdentifier({ curie: 'wsf:*', strategy: 'prefix_wildcard' });
    assert.equal(result.data?.resolved_to, 'wsf:UniqueThing');
    assert.equal(result.data?.confidence, 0.9);
  });

  test('prefix_wildcard with multiple matches returns alternatives', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('ThingOne'));
    await engine.services.concept.create(makeConcept('ThingTwo'));
    const result = await engine.services.identity.resolveIdentifier({ curie: 'wsf:*', strategy: 'prefix_wildcard' });
    assert.equal(result.data?.resolved_to, undefined);
    assert.equal(result.data?.alternatives?.length, 2);
  });

  test('cross_namespace resolves same local name in another namespace', async () => {
    const engine = new SemanticEngine();
    const concept = makeConcept('Entity');
    await engine.services.concept.create({ ...concept, semantic_id: 'opendea:Entity' });
    const result = await engine.services.identity.resolveIdentifier({ curie: 'wsf:Entity', strategy: 'cross_namespace' });
    assert.equal(result.data?.resolved_to, 'opendea:Entity');
    assert.equal(result.data?.confidence, 0.7);
  });

  test('canonical resolves case-normalised local names', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('Entity'));
    const result = await engine.services.identity.resolveIdentifier({ curie: 'wsf:entity', strategy: 'canonical' });
    assert.equal(result.data?.resolved_to, 'wsf:Entity');
    assert.equal(result.data?.confidence, 0.8);
  });

  test('canonical resolves via alias', async () => {
    const engine = new SemanticEngine();
    await engine.services.concept.create(makeConcept('Entity', 'Normative', ['https://schema.org/Thing']));
    const result = await engine.services.identity.resolveIdentifier({ curie: 'wsf:thing', strategy: 'canonical' });
    assert.equal(result.data?.resolved_to, 'wsf:Entity');
  });
});

// ============================================================================
// Track C : Temporal (as-of) + context scoping
// ============================================================================

describe('Temporal : as-of queries and context scoping', () => {
  test('as_of filters relationships by validity window', async () => {
    const engine = new SemanticEngine();
    const rel: Relationship = {
      semantic_id: 'wsf:RelTemporal',
      type: 'relates',
      subject: 'wsf:A',
      object: 'wsf:B',
      provenance: PROV,
      validity: { valid_from: '2026-01-01T00:00:00Z', valid_until: '2026-06-30T23:59:59Z', status: 'active' },
    };
    await engine.services.relationship.declare(rel);

    const before = await engine.services.relationship.find(undefined, undefined, undefined, { as_of: '2025-06-01T00:00:00Z' });
    assert.equal(before.data?.length, 0);

    const during = await engine.services.relationship.find(undefined, undefined, undefined, { as_of: '2026-03-01T00:00:00Z' });
    assert.equal(during.data?.length, 1);

    const after = await engine.services.relationship.find(undefined, undefined, undefined, { as_of: '2026-09-01T00:00:00Z' });
    assert.equal(after.data?.length, 0);
  });

  test('context-scoped relationship queries', async () => {
    const engine = new SemanticEngine();
    const relA: Relationship = { semantic_id: 'wsf:RelCtxA', type: 'relates', subject: 'wsf:A', object: 'wsf:B', context: 'wsf:ContextX', provenance: PROV };
    const relB: Relationship = { semantic_id: 'wsf:RelCtxB', type: 'relates', subject: 'wsf:A', object: 'wsf:B', context: 'wsf:ContextY', provenance: PROV };
    await engine.services.relationship.declare(relA);
    await engine.services.relationship.declare(relB);

    const result = await engine.services.relationship.find(undefined, undefined, undefined, { context: 'wsf:ContextX' });
    assert.equal(result.data?.length, 1);
    assert.equal(result.data?.[0].semantic_id, 'wsf:RelCtxA');
  });

  test('assertion as_of filtering via store', async () => {
    const engine = new SemanticEngine();
    const assertion: Assertion = {
      ...makeAssertion('assertTemporal'),
      validity: { valid_from: '2026-01-01T00:00:00Z', valid_until: null, status: 'active' },
    };
    await engine.services.assertion.submit(assertion);

    const before = await engine.services.assertion.findBySubject('wsf:A');
    assert.equal(before.data?.length, 1);  // no as_of: all returned

    // as_of before validity start: excluded
    const store = engine.store;
    const filtered = await store.findAssertions({ subject: 'wsf:A', as_of: '2025-01-01T00:00:00Z' });
    assert.equal(filtered.length, 0);
    const included = await store.findAssertions({ subject: 'wsf:A', as_of: '2026-02-01T00:00:00Z' });
    assert.equal(included.length, 1);
  });
});

// ============================================================================
// Track D : Event/State modeling (ADR-WSF-27 simulation pattern)
// ============================================================================

function makeEvent(id: string, subject: string, at: string, changes: Record<string, unknown>): SemanticEvent {
  return {
    semantic_id: `wsf:event:${id}`,
    type: id.split('.')[0],
    subject,
    occurred_at: at,
    changes,
    provenance: PROV,
  };
}

describe('Simulation : event sourcing and state derivation', () => {
  test('current state is the fold of all events in order', async () => {
    const engine = new SemanticEngine();
    const sim = engine.services.simulation;
    await sim.recordEvent(makeEvent('order.created', 'ex:Order42', '2026-08-01T10:00:00Z', { status: 'created', total: 100 }));
    await sim.recordEvent(makeEvent('order.paid', 'ex:Order42', '2026-08-01T11:00:00Z', { status: 'paid' }));
    await sim.recordEvent(makeEvent('order.shipped', 'ex:Order42', '2026-08-02T09:00:00Z', { status: 'shipped', tracking: 'TRK-1' }));

    const state = await sim.getCurrentState('ex:Order42');
    assert.equal(state.success, true);
    assert.equal(state.data?.properties.status, 'shipped');
    assert.equal(state.data?.properties.total, 100);
    assert.equal(state.data?.properties.tracking, 'TRK-1');
    assert.equal(state.data?.derived_from.length, 3);
  });

  test('as-of state derivation reconstructs past states', async () => {
    const engine = new SemanticEngine();
    const sim = engine.services.simulation;
    await sim.recordEvent(makeEvent('order.created', 'ex:Order43', '2026-08-01T10:00:00Z', { status: 'created' }));
    await sim.recordEvent(makeEvent('order.paid', 'ex:Order43', '2026-08-01T11:00:00Z', { status: 'paid' }));

    const early = await sim.getStateAt('ex:Order43', '2026-08-01T10:30:00Z');
    assert.equal(early.data?.properties.status, 'created');
    assert.equal(early.data?.derived_from.length, 1);

    const later = await sim.getStateAt('ex:Order43', '2026-08-01T12:00:00Z');
    assert.equal(later.data?.properties.status, 'paid');
  });

  test('events out of recording order are applied in occurrence order', async () => {
    const engine = new SemanticEngine();
    const sim = engine.services.simulation;
    // Record the later event first
    await sim.recordEvent(makeEvent('order.paid', 'ex:Order44', '2026-08-01T11:00:00Z', { status: 'paid' }));
    await sim.recordEvent(makeEvent('order.created', 'ex:Order44', '2026-08-01T10:00:00Z', { status: 'created', total: 55 }));

    const state = await sim.getCurrentState('ex:Order44');
    assert.equal(state.data?.properties.status, 'paid');
    assert.equal(state.data?.properties.total, 55);
  });

  test('simulate applies prospective events without recording them', async () => {
    const engine = new SemanticEngine();
    const sim = engine.services.simulation;
    await sim.recordEvent(makeEvent('order.created', 'ex:Order45', '2026-08-01T10:00:00Z', { status: 'created' }));

    const hypothetical = await sim.simulate('ex:Order45', [
      makeEvent('order.cancelled', 'ex:Order45', '2026-08-03T00:00:00Z', { status: 'cancelled' }),
    ]);
    assert.equal(hypothetical.data?.properties.status, 'cancelled');

    // History unchanged: the simulated event was not recorded
    const actual = await sim.getCurrentState('ex:Order45');
    assert.equal(actual.data?.properties.status, 'created');
    assert.equal(actual.data?.derived_from.length, 1);
  });

  test('duplicate event semantic_id is rejected', async () => {
    const engine = new SemanticEngine();
    const sim = engine.services.simulation;
    const event = makeEvent('order.created', 'ex:Order46', '2026-08-01T10:00:00Z', { status: 'created' });
    await sim.recordEvent(event);
    const dup = await sim.recordEvent(event);
    assert.equal(dup.success, false);
    assert.equal(dup.error?.code, 'EVENT_DUPLICATE');
  });

  test('getHistory returns ordered events for one entity only', async () => {
    const engine = new SemanticEngine();
    const sim = engine.services.simulation;
    await sim.recordEvent(makeEvent('order.created', 'ex:Order47', '2026-08-01T10:00:00Z', { status: 'created' }));
    await sim.recordEvent(makeEvent('order.created', 'ex:Order48', '2026-08-01T10:05:00Z', { status: 'created' }));
    const history = await sim.getHistory('ex:Order47');
    assert.equal(history.data?.length, 1);
    assert.equal(history.data?.[0].subject, 'ex:Order47');
  });
});
