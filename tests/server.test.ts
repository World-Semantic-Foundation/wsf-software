/**
 * WSF REST Server Tests
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine } from '../src/index.js';
import { RESTServer } from '../src/server/RESTServer.js';
import type { Concept } from '../src/types/index.js';

describe('RESTServer', () => {
  let engine: SemanticEngine;
  let server: RESTServer;

  before(async () => {
    engine = new SemanticEngine();
    await engine.initialise();
    server = new RESTServer(engine, {
      host: '127.0.0.1',
      port: 0,
      prefix: '/v1',
      cors_origins: ['*'],
    });
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  test('responds to GET /v1/health', async () => {
    const port = server.bound_port;
    if (port === null) {
      throw new Error('server did not bind a port');
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { success?: boolean; data?: { status?: string } };
    assert.equal(body.success, true);
    assert.equal(body.data?.status, 'healthy');
  });

  test('rejects unknown routes with 404', async () => {
    const port = server.bound_port;
    if (port === null) {
      throw new Error('server did not bind a port');
    }
    const response = await fetch(`http://127.0.0.1:${port}/v1/unknown-route`);
    assert.equal(response.status, 404);
  });
});

describe('REST Endpoints (in-process)', () => {
  let engine: SemanticEngine;

  before(async () => {
    engine = new SemanticEngine();
    await engine.initialise();
  });

  test('engine boots and namespaces registered', async () => {
    const result = await engine.services.identity.listNamespaces();
    assert.equal(result.success, true);
    assert.ok(result.data && result.data.length >= 1);
  });

  test('createConcept + getConcept round trip', async () => {
    const concept: Concept = {
      semantic_id: 'wsf:TestRest',
      preferred_name: 'Test REST',
      tier: 'Tier 1',
      definition: 'A test',
      authority: 'WSF',
      status: 'Normative',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };
    const create = await engine.services.concept.create(concept);
    assert.equal(create.success, true);
    const get = await engine.services.concept.get('wsf:TestRest');
    assert.equal(get.success, true);
  });
});