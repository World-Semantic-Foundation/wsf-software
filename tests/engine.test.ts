/**
 * WSF Semantic Engine : Tests
 *
 * Integration tests for the core engine functionality.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine } from '../src/index.js';
import type { Concept, Assertion, Relationship } from '../src/types/index.js';

describe('SemanticEngine', () => {
  test('initialises with default config', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();
    const health = await engine.healthCheck();
    assert.equal(health.status, 'healthy');
  });

  test('health check reports correct details', async () => {
    const engine = new SemanticEngine({ store_backend: 'memory' });
    await engine.initialise();
    const health = await engine.healthCheck();
    assert.equal(health.status, 'healthy');
    assert.ok(health.details.includes('memory'));
  });
});

describe('Concept Service', () => {
  test('creates and retrieves a concept', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const concept: Concept = {
      semantic_id: 'wsf:TestConcept',
      preferred_name: 'Test Concept',
      tier: 'Tier 1',
      definition: 'A test concept',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };

    const createResult = await engine.services.concept.create(concept);
    assert.equal(createResult.success, true);

    const getResult = await engine.services.concept.get('wsf:TestConcept');
    assert.equal(getResult.success, true);
    assert.equal(getResult.data?.preferred_name, 'Test Concept');
  });

  test('lists concepts by tier', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const concept: Concept = {
      semantic_id: 'wsf:Tier2Test',
      preferred_name: 'Tier 2 Test',
      tier: 'Tier 2',
      definition: 'Test',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    await engine.services.concept.create(concept);

    const result = await engine.services.concept.list('Tier 2');
    assert.equal(result.success, true);
    assert.ok(result.data && result.data.length >= 1);
  });

  test('specialises a concept', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const parent: Concept = {
      semantic_id: 'wsf:Parent',
      preferred_name: 'Parent',
      tier: 'Tier 1',
      definition: 'Parent',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    const child: Concept = {
      semantic_id: 'wsf:Child',
      preferred_name: 'Child',
      tier: 'Tier 2',
      definition: 'Child',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    await engine.services.concept.create(parent);
    await engine.services.concept.create(child);

    const result = await engine.services.concept.specialise(
      'wsf:Child',
      'wsf:Parent',
      {
        actor: 'wsf:Actor',
        authority: 'wsf:Authority',
        timestamp: new Date().toISOString(),
      },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.parent, 'wsf:Parent');
  });
});

describe('Relationship Service', () => {
  test('declares and finds a relationship', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const relationship: Relationship = {
      semantic_id: 'wsf:rel:test',
      type: 'specialises',
      subject: 'wsf:Child',
      object: 'wsf:Parent',
      provenance: {
        actor: 'wsf:Actor',
        authority: 'wsf:Authority',
        timestamp: new Date().toISOString(),
      },
    };

    const declareResult = await engine.services.relationship.declare(relationship);
    assert.equal(declareResult.success, true);

    const findResult = await engine.services.relationship.find(
      'specialises',
      'wsf:Child',
      'wsf:Parent',
    );
    assert.equal(findResult.success, true);
    assert.ok(findResult.data && findResult.data.length >= 1);
  });
});

describe('Assertion Service', () => {
  test('submits and retrieves an assertion', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const assertion: Assertion = {
      semantic_id: 'wsf:assertion:test',
      subject: 'wsf:Entity',
      relationship: 'specialises',
      object: 'wsf:Role',
      proposition: {
        semantic_id: 'wsf:prop:test',
        subject: 'wsf:Entity',
        predicate: 'specialises',
        object: 'wsf:Role',
        modality: 'asserted',
      },
      provenance: {
        actor: 'wsf:Actor',
        authority: 'wsf:Authority',
        timestamp: new Date().toISOString(),
      },
      lifecycle: 'submitted',
      asserted_at: new Date().toISOString(),
      asserted_by: 'wsf:Actor',
    };

    const submitResult = await engine.services.assertion.submit(assertion);
    assert.equal(submitResult.success, true);

    const getResult = await engine.services.assertion.get('wsf:assertion:test');
    assert.equal(getResult.success, true);
    assert.equal(getResult.data?.lifecycle, 'submitted');
  });

  test('accepts an assertion', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const assertion: Assertion = {
      semantic_id: 'wsf:assertion:accept-test',
      subject: 'wsf:A',
      relationship: 'relates',
      object: 'wsf:B',
      proposition: {
        semantic_id: 'wsf:prop:accept-test',
        subject: 'wsf:A',
        predicate: 'relates',
        object: 'wsf:B',
        modality: 'asserted',
      },
      provenance: {
        actor: 'wsf:Actor',
        authority: 'wsf:Authority',
        timestamp: new Date().toISOString(),
      },
      lifecycle: 'submitted',
      asserted_at: new Date().toISOString(),
      asserted_by: 'wsf:Actor',
    };
    await engine.services.assertion.submit(assertion);

    const prov = { actor: 'wsf:Actor', authority: 'wsf:Authority', timestamp: new Date().toISOString() };
    const reviewResult = await engine.services.assertion.startReview('wsf:assertion:accept-test', prov);
    assert.equal(reviewResult.success, true);

    const acceptResult = await engine.services.assertion.accept(
      'wsf:assertion:accept-test',
      prov,
    );
    assert.equal(acceptResult.success, true);
    assert.equal(acceptResult.data?.lifecycle, 'accepted');
  });
});

describe('Identity Service', () => {
  test('registers and lists namespaces', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const result = await engine.services.identity.listNamespaces();
    assert.equal(result.success, true);
    assert.ok(result.data && result.data.length >= 1);
  });

  test('resolves a CURIE identifier', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const concept: Concept = {
      semantic_id: 'wsf:Entity',
      preferred_name: 'Entity',
      tier: 'Tier 1',
      definition: 'An entity',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    await engine.services.concept.create(concept);

    const result = await engine.services.identity.resolveIdentifier({
      curie: 'wsf:Entity',
      strategy: 'exact',
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.confidence, 1.0);
  });
});

describe('Validation Service', () => {
  test('validates a representation', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const result = await engine.services.validation.validate({
      representations: [{
        semantic_id: 'wsf:rep:test',
        subject: 'wsf:Entity',
        format: 'json-ld',
        content: '{}',
        media_type: 'application/ld+json',
        encoded_at: new Date().toISOString(),
        encoded_by: 'wsf:Actor',
      }],
      language: 'shacl',
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.conforms, true);
  });
});

describe('Inference Service', () => {
  test('explains a concept derivation', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const parent: Concept = {
      semantic_id: 'wsf:InfParent',
      preferred_name: 'Inference Parent',
      tier: 'Tier 1',
      definition: 'Parent for inference test',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    const child: Concept = {
      semantic_id: 'wsf:InfChild',
      preferred_name: 'Inference Child',
      tier: 'Tier 2',
      parent: 'wsf:InfParent',
      definition: 'Child for inference test',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    await engine.services.concept.create(parent);
    await engine.services.concept.create(child);

    const result = await engine.services.inference.explain('wsf:InfChild');
    assert.equal(result.success, true);
    assert.ok(result.data && result.data.steps.length >= 2);
  });
});

describe('Audit Service', () => {
  test('records and queries audit entries', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const entry = {
      semantic_id: 'wsf:audit:test',
      action: 'create' as const,
      affected: 'wsf:Test',
      actor: 'wsf:Actor',
      timestamp: new Date().toISOString(),
    };

    const recordResult = await engine.services.audit.record(entry);
    assert.equal(recordResult.success, true);

    const queryResult = await engine.services.audit.query('wsf:Test');
    assert.equal(queryResult.success, true);
    assert.ok(queryResult.data && queryResult.data.length >= 1);
  });
});

describe('Query Service', () => {
  test('searches concepts by term', async () => {
    const engine = new SemanticEngine();
    await engine.initialise();

    const concept: Concept = {
      semantic_id: 'wsf:Searchable',
      preferred_name: 'SearchableConcept',
      tier: 'Tier 1',
      definition: 'A searchable test concept',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    await engine.services.concept.create(concept);

    const result = await engine.services.query.searchConcepts('Searchable');
    assert.equal(result.success, true);
    assert.ok(result.data && result.data.length >= 1);
  });
});

describe('WSF_CONCEPT_CATALOG', () => {
  test('contains all 38 concept semantic_ids', async () => {
    const { WSF_CONCEPT_CATALOG } = await import('../src/types/index.js');
    const count = Object.keys(WSF_CONCEPT_CATALOG).length;
    assert.equal(count, 38);
  });
});