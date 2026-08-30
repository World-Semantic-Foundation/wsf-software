/**
 * WSF Semantic Engine : Graph Query Tests
 *
 * Tests for the GraphQueryEngine Cypher/SPARQL subsets and QueryService
 * routing (per ADR-WSF-24 §6 Query Service).
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine } from '../src/index.js';
import type { Concept, Relationship } from '../src/types/index.js';

const PROV = { actor: 'wsf:TestActor', authority: 'wsf:WSF', timestamp: new Date().toISOString() };

function makeConcept(id: string, name: string, tier: 'Tier 1' | 'Tier 2' | 'Tier 3', parent?: string): Concept {
  return {
    semantic_id: `wsf:${id}`,
    preferred_name: name,
    tier,
    parent,
    definition: `Definition of ${name}`,
    authority: 'WSF',
    status: 'Normative',
    version: '1.0.0',
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
  };
}

async function seededEngine(): Promise<SemanticEngine> {
  const engine = new SemanticEngine();
  await engine.initialise();

  await engine.services.concept.create(makeConcept('Entity', 'Entity', 'Tier 1'));
  await engine.services.concept.create(makeConcept('Event', 'Event', 'Tier 1'));
  await engine.services.concept.create(makeConcept('Identifier', 'Identifier', 'Tier 2'));
  await engine.services.concept.create(makeConcept('Role', 'Role', 'Tier 3', 'wsf:Entity'));
  await engine.services.concept.create(makeConcept('Process', 'Process', 'Tier 3', 'wsf:Event'));

  const rels: Relationship[] = [
    { semantic_id: 'wsf:Rel1', type: 'specialises', subject: 'wsf:Role', object: 'wsf:Entity', provenance: PROV },
    { semantic_id: 'wsf:Rel2', type: 'specialises', subject: 'wsf:Process', object: 'wsf:Event', provenance: PROV },
    { semantic_id: 'wsf:Rel3', type: 'references', subject: 'wsf:Role', object: 'wsf:Identifier', provenance: PROV },
  ];
  for (const rel of rels) await engine.services.relationship.declare(rel);

  return engine;
}

describe('GraphQueryEngine : Cypher subset', () => {
  let engine: SemanticEngine;
  beforeEach(async () => { engine = await seededEngine(); });

  test('MATCH (c:Concept) RETURN c returns all concepts', async () => {
    const result = await engine.services.query.executeCypher<Concept>('MATCH (c:Concept) RETURN c');
    assert.equal(result.success, true);
    assert.equal(result.data?.total_count, 5);
  });

  test('MATCH (c:Tier3) RETURN c filters by tier label', async () => {
    const result = await engine.services.query.executeCypher<Concept>('MATCH (c:Tier3) RETURN c');
    assert.equal(result.data?.total_count, 2);
    assert.ok(result.data?.matches.every(c => c.tier === 'Tier 3'));
  });

  test('MATCH with WHERE equality filter', async () => {
    const result = await engine.services.query.executeCypher<Concept>(
      "MATCH (c:Concept) WHERE c.status = 'Normative' AND c.tier = 'Tier 2' RETURN c",
    );
    assert.equal(result.data?.total_count, 1);
    assert.equal(result.data?.matches[0].semantic_id, 'wsf:Identifier');
  });

  test('MATCH with ORDER BY and LIMIT', async () => {
    const result = await engine.services.query.executeCypher<Concept>(
      'MATCH (c:Concept) RETURN c ORDER BY c.semantic_id DESC LIMIT 2',
    );
    assert.equal(result.data?.total_count, 2);
    const ids = result.data?.matches.map(c => c.semantic_id) ?? [];
    assert.deepEqual(ids, ['wsf:Role', 'wsf:Process']);
  });

  test('relationship pattern returns edges', async () => {
    const result = await engine.services.query.executeCypher<Relationship>(
      'MATCH (s)-[r:specialises]->(o) RETURN r',
    );
    assert.equal(result.data?.total_count, 2);
  });

  test('relationship pattern with WHERE on edge property', async () => {
    const result = await engine.services.query.executeCypher<Relationship>(
      "MATCH (s)-[r]->(o) WHERE r.type = 'references' RETURN r",
    );
    assert.equal(result.data?.total_count, 1);
    assert.equal(result.data?.matches[0].semantic_id, 'wsf:Rel3');
  });

  test('unsupported expression returns QUERY_UNSUPPORTED', async () => {
    const result = await engine.services.query.executeCypher(
      'MATCH (c:Concept)-[*1..5]->(d) RETURN d',
    );
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'QUERY_UNSUPPORTED');
  });
});

describe('GraphQueryEngine : SPARQL subset', () => {
  let engine: SemanticEngine;
  beforeEach(async () => { engine = await seededEngine(); });

  test('SELECT with single equality triple', async () => {
    const result = await engine.services.query.executeSparql<Record<string, unknown>>(
      'SELECT ?s WHERE { ?s wsf:tier "Tier 1" . }',
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.total_count, 2);
  });

  test('SELECT with multiple triple patterns (AND semantics)', async () => {
    const result = await engine.services.query.executeSparql<Record<string, unknown>>(
      'SELECT ?s WHERE { ?s wsf:tier "Tier 3" . ?s wsf:parent "wsf:Entity" . }',
    );
    assert.equal(result.data?.total_count, 1);
    assert.equal(result.data?.matches[0].s, 'wsf:Role');
  });

  test('variable object acts as existence check and binds value', async () => {
    const result = await engine.services.query.executeSparql<Record<string, unknown>>(
      'SELECT ?s ?p WHERE { ?s wsf:tier "Tier 3" . ?s wsf:parent ?p . }',
    );
    assert.equal(result.data?.total_count, 2);
    assert.ok(result.data?.matches.every(row => typeof row.p === 'string'));
  });

  test('unsupported predicate returns QUERY_UNSUPPORTED', async () => {
    const result = await engine.services.query.executeSparql(
      'SELECT ?s WHERE { ?s wsf:favourite_colour "blue" . }',
    );
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'QUERY_UNSUPPORTED');
  });
});

describe('QueryService : routing', () => {
  test('pattern queries still route to the store', async () => {
    const engine = await seededEngine();
    const result = await engine.services.query.execute({
      type: 'pattern',
      expression: 'Role',
      parameters: { pattern: 'Role' },
    });
    assert.equal(result.success, true);
    assert.ok((result.data?.total_count ?? 0) >= 1);
  });

  test('graph queries route to the GraphQueryEngine', async () => {
    const engine = await seededEngine();
    const result = await engine.services.query.execute<Concept>({
      type: 'graph',
      expression: 'MATCH (c:Tier2) RETURN c',
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.total_count, 1);
  });
});
