/**
 * WSF Semantic Engine : SHACL Validation Tests
 *
 * Tests for the SHACL validator and ValidationService wiring
 * (per ADR-WSF-13 and ADR-WSF-24 §6).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine, SHACLValidator, WSF_SHAPES } from '../src/index.js';
import type { Concept, Relationship, Assertion, Representation } from '../src/types/index.js';

const PROV = { actor: 'wsf:TestActor', authority: 'wsf:WSF', timestamp: new Date().toISOString() };

const VALID_CONCEPT: Concept = {
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

describe('SHACLValidator : ConceptShape', () => {
  test('valid concept conforms', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const results = v.validateNode(VALID_CONCEPT as unknown as Record<string, unknown>, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.equal(results.filter(r => r.severity === 'violation').length, 0);
  });

  test('concept with all optional documentation fields conforms', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const rich = {
      ...VALID_CONCEPT,
      parent: 'wsf:ParentConcept',
      aliases: ['https://example.org/alias/TestConcept'],
      defined_by: ['https://github.com/World-Semantic-Foundation/wsf-governance/ADR/ADR-WSF-18.md'],
      related_concepts: ['wsf:Entity'],
      definition_markdown: '# Test',
      differentia: 'distinguished by testing',
      scope_notes: 'applies to tests',
      counter_examples: ['not a test'],
      canonical_examples: ['example one'],
    };
    const results = v.validateNode(rich, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.equal(results.filter(r => r.severity === 'violation').length, 0);
  });

  test('invalid CURIE semantic_id violates', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_CONCEPT, semantic_id: 'Not A CURIE' };
    const results = v.validateNode(bad, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.ok(results.some(r => r.path === 'semantic_id' && r.severity === 'violation'));
  });

  test('invalid tier violates enumeration', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_CONCEPT, tier: 'Tier 9' };
    const results = v.validateNode(bad, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.ok(results.some(r => r.path === 'tier' && r.severity === 'violation'));
  });

  test('missing definition violates minCount', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const { definition: _dropped, ...bad } = VALID_CONCEPT;
    const results = v.validateNode(bad, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.ok(results.some(r => r.path === 'definition' && r.severity === 'violation'));
  });

  test('non-semver version violates pattern', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_CONCEPT, version: 'v1' };
    const results = v.validateNode(bad, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.ok(results.some(r => r.path === 'version' && r.severity === 'violation'));
  });

  test('closed shape rejects undeclared property', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_CONCEPT, undeclared_field: 'x' };
    const results = v.validateNode(bad, 'wsf:ConceptShape', 'wsf:TestConcept');
    assert.ok(results.some(r => r.path === 'undeclared_field' && r.message.includes('closed shape')));
  });
});

describe('SHACLValidator : RelationshipShape', () => {
  const VALID_REL: Relationship = {
    semantic_id: 'wsf:RelTest',
    type: 'specialises',
    subject: 'wsf:Child',
    object: 'wsf:Parent',
    provenance: PROV,
  };

  test('valid relationship conforms', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const results = v.validateNode(VALID_REL as unknown as Record<string, unknown>, 'wsf:RelationshipShape', 'wsf:RelTest');
    assert.equal(results.filter(r => r.severity === 'violation').length, 0);
  });

  test('invalid relationship type violates enumeration', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_REL, type: 'flies_over' };
    const results = v.validateNode(bad, 'wsf:RelationshipShape', 'wsf:RelTest');
    assert.ok(results.some(r => r.path === 'type' && r.severity === 'violation'));
  });

  test('nested provenance violation reports prefixed path', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_REL, provenance: { actor: 'not a curie', authority: 'wsf:WSF', timestamp: PROV.timestamp } };
    const results = v.validateNode(bad, 'wsf:RelationshipShape', 'wsf:RelTest');
    assert.ok(results.some(r => r.path === 'provenance.actor' && r.severity === 'violation'));
  });

  test('validity with status enum conforms; bad status violates', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const good = { ...VALID_REL, validity: { valid_from: PROV.timestamp, valid_until: null, status: 'active' } };
    assert.equal(v.validateNode(good, 'wsf:RelationshipShape', 'wsf:RelTest').filter(r => r.severity === 'violation').length, 0);
    const bad = { ...VALID_REL, validity: { valid_from: PROV.timestamp, valid_until: null, status: 'limbo' } };
    assert.ok(v.validateNode(bad, 'wsf:RelationshipShape', 'wsf:RelTest').some(r => r.path === 'validity.status'));
  });
});

describe('SHACLValidator : AssertionShape', () => {
  const VALID_ASSERTION: Assertion = {
    semantic_id: 'wsf:AssertTest',
    subject: 'wsf:Child',
    relationship: 'specialises',
    object: 'wsf:Parent',
    proposition: {
      semantic_id: 'wsf:PropTest',
      subject: 'wsf:Child',
      predicate: 'specialises',
      object: 'wsf:Parent',
      modality: 'asserted',
    },
    provenance: PROV,
    lifecycle: 'submitted',
    asserted_at: new Date().toISOString(),
    asserted_by: 'wsf:TestActor',
  };

  test('valid assertion conforms', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const results = v.validateNode(VALID_ASSERTION as unknown as Record<string, unknown>, 'wsf:AssertionShape', 'wsf:AssertTest');
    assert.equal(results.filter(r => r.severity === 'violation').length, 0);
  });

  test('confidence outside 0.0:1.0 violates range', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_ASSERTION, confidence: 1.5 };
    const results = v.validateNode(bad, 'wsf:AssertionShape', 'wsf:AssertTest');
    assert.ok(results.some(r => r.path === 'confidence' && r.severity === 'violation'));
  });

  test('invalid lifecycle violates enumeration', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = { ...VALID_ASSERTION, lifecycle: 'maybe' };
    const results = v.validateNode(bad, 'wsf:AssertionShape', 'wsf:AssertTest');
    assert.ok(results.some(r => r.path === 'lifecycle' && r.severity === 'violation'));
  });

  test('proposition with invalid predicate kind violates', () => {
    const v = new SHACLValidator();
    for (const s of WSF_SHAPES) v.registerShape(s);
    const bad = {
      ...VALID_ASSERTION,
      proposition: { ...VALID_ASSERTION.proposition, predicate: 'flies_over' },
    };
    const results = v.validateNode(bad, 'wsf:AssertionShape', 'wsf:AssertTest');
    assert.ok(results.some(r => r.path === 'proposition.predicate' && r.severity === 'violation'));
  });
});

describe('ValidationService (engine wiring)', () => {
  test('registers all 7 WSF shapes', async () => {
    const engine = new SemanticEngine();
    const shapes = engine.services.validation.listShapes();
    assert.equal(shapes.length, 7);
    assert.ok(shapes.includes('wsf:ConceptShape'));
    assert.ok(shapes.includes('wsf:AssertionShape'));
  });

  test('validate() conforms a valid JSON concept representation', async () => {
    const engine = new SemanticEngine();
    const rep: Representation = {
      semantic_id: 'wsf:RepTest1',
      subject: 'wsf:TestConcept',
      format: 'json',
      content: JSON.stringify(VALID_CONCEPT),
      media_type: 'application/json',
      encoded_at: new Date().toISOString(),
      encoded_by: 'wsf:TestActor',
    };
    const result = await engine.services.validation.validate({ representations: [rep], language: 'shacl' });
    assert.equal(result.success, true);
    assert.equal(result.data?.conforms, true);
  });

  test('validate() flags violations in an invalid concept representation', async () => {
    const engine = new SemanticEngine();
    const rep: Representation = {
      semantic_id: 'wsf:RepTest2',
      subject: 'wsf:TestConcept',
      format: 'json',
      content: JSON.stringify({ ...VALID_CONCEPT, tier: 'Tier 9', version: 'v1' }),
      media_type: 'application/json',
      encoded_at: new Date().toISOString(),
      encoded_by: 'wsf:TestActor',
    };
    const result = await engine.services.validation.validate({ representations: [rep], language: 'shacl' });
    assert.equal(result.data?.conforms, false);
    const paths = result.data?.results.map(r => r.path) ?? [];
    assert.ok(paths.includes('tier'));
    assert.ok(paths.includes('version'));
  });

  test('validate() selects shape from JSON-LD @type', async () => {
    const engine = new SemanticEngine();
    const jsonld = { '@type': 'wsf:Concept', ...VALID_CONCEPT };
    const rep: Representation = {
      semantic_id: 'wsf:RepTest3',
      subject: 'wsf:TestConcept',
      format: 'json-ld',
      content: JSON.stringify(jsonld),
      media_type: 'application/ld+json',
      encoded_at: new Date().toISOString(),
      encoded_by: 'wsf:TestActor',
    };
    const result = await engine.services.validation.validate({ representations: [rep], language: 'shacl' });
    assert.equal(result.data?.conforms, true);
  });

  test('validate() reports violation for invalid JSON content', async () => {
    const engine = new SemanticEngine();
    const rep: Representation = {
      semantic_id: 'wsf:RepTest4',
      subject: 'wsf:TestConcept',
      format: 'json',
      content: '{not json',
      media_type: 'application/json',
      encoded_at: new Date().toISOString(),
      encoded_by: 'wsf:TestActor',
    };
    const result = await engine.services.validation.validate({ representations: [rep], language: 'shacl' });
    assert.equal(result.data?.conforms, false);
    assert.ok(result.data?.results.some(r => r.message.includes('not valid JSON')));
  });

  test('non-JSON formats produce informational results', async () => {
    const engine = new SemanticEngine();
    const rep: Representation = {
      semantic_id: 'wsf:RepTest5',
      subject: 'wsf:TestConcept',
      format: 'turtle',
      content: '@prefix wsf: <https://world-semantic-foundation.org/ns/> .',
      media_type: 'text/turtle',
      encoded_at: new Date().toISOString(),
      encoded_by: 'wsf:TestActor',
    };
    const result = await engine.services.validation.validate({ representations: [rep], language: 'shacl' });
    assert.equal(result.data?.conforms, true);
    assert.ok(result.data?.results.every(r => r.severity === 'info'));
  });

  test('validateObject validates engine objects directly', async () => {
    const engine = new SemanticEngine();
    const report = engine.services.validation.validateObject(
      VALID_CONCEPT as unknown as Record<string, unknown>,
      'wsf:ConceptShape',
      'wsf:TestConcept',
    );
    assert.equal(report.conforms, true);
  });
});
