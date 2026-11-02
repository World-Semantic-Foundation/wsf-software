/**
 * WSF REST API Server
 *
 * Implements ADR-WSF-24 §7.1 (REST API). HTTP server using Node.js
 * built-in http module (zero dependencies for maximum portability).
 *
 * Production deployment would use Express/Fastify; this minimal
 * implementation is for development, testing, and embedded use cases.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SemanticEngine } from '../index.js';
import { RESTAPI } from '../api/rest/index.js';
import type { CURIE } from '../types/index.js';

/**
 * REST server configuration.
 */
export interface RESTServerConfig {
  /** Host to bind. */
  host: string;
  /** Port to bind. */
  port: number;
  /** Path prefix for all routes. */
  prefix?: string;
  /** CORS allowed origins. */
  cors_origins?: string[];
  /** Authentication verifier. */
  auth_verifier?: (token: string) => Promise<{ actor: CURIE; scopes: string[] } | null>;
}

export class RESTServer {
  private engine: SemanticEngine;
  private api: RESTAPI;
  private config: RESTServerConfig;
  private server: ReturnType<typeof createServer> | null = null;

  constructor(engine: SemanticEngine, config: RESTServerConfig) {
    this.engine = engine;
    this.api = new RESTAPI(engine.services);
    this.config = config;
  }

  /** The actual bound port; resolves the assigned port when configured with port 0. */
  get bound_port(): number | null {
    const address = this.server?.address();
    if (address && typeof address === 'object' && 'port' in address) {
      return address.port;
    }
    return null;
  }

  async start(): Promise<void> {
    const prefix = this.config.prefix ?? '';
    const engine = this.engine;
    const api = this.api;
    const config = this.config;

    this.server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const path = url.pathname;
        const method = req.method ?? 'GET';

        // CORS headers
        if (config.cors_origins) {
          const origin = req.headers.origin;
          if (origin && config.cors_origins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          }
          if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }
        }

        // Read body for POST/PUT
        let body: string | undefined;
        if (method === 'POST' || method === 'PUT') {
          body = await readBody(req);
        }

        // Route handlers
        await this.route(method, path, body, res, prefix, api);
      } catch (err) {
        sendJson(res, 500, {
          '@context': 'https://www.w3.org/ns/json-ld',
          '@type': 'wsf:APIError',
          success: false,
          error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
        });
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async route(
    method: string,
    path: string,
    body: string | undefined,
    res: ServerResponse,
    prefix: string,
    api: RESTAPI,
  ): Promise<void> {
    const normalisedPath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const parts = normalisedPath.split('/').filter(Boolean);

    // GET /health
    if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
      const health = await this.engine.healthCheck();
      sendJson(res, 200, { success: true, data: health });
      return;
    }

    // GET /concepts?tier=X
    if (parts.length === 1 && parts[0] === 'concepts' && method === 'GET') {
      const url = new URL(`http://x${path}`, 'http://x');
      const tier = url.searchParams.get('tier') as 'Tier 1' | 'Tier 2' | 'Tier 3' | null;
      const response = await api.listConcepts(tier ?? undefined);
      sendJson(res, response.status, response.body);
      return;
    }

    // POST /concepts
    if (parts.length === 1 && parts[0] === 'concepts' && method === 'POST') {
      const concept = JSON.parse(body ?? '{}');
      const response = await api.createConcept(concept);
      sendJson(res, response.status === 200 ? 201 : response.status, response.body);
      return;
    }

    // GET /concepts/{semantic_id}
    if (parts.length === 2 && parts[0] === 'concepts' && method === 'GET') {
      const semantic_id = parts[1] as CURIE;
      const response = await api.getConcept(semantic_id);
      sendJson(res, response.status, response.body);
      return;
    }

    // GET /relationships
    if (parts.length === 1 && parts[0] === 'relationships' && method === 'GET') {
      const url = new URL(`http://x${path}`, 'http://x');
      const type = url.searchParams.get('type') ?? undefined;
      const subject = (url.searchParams.get('subject') as CURIE) ?? undefined;
      const object = (url.searchParams.get('object') as CURIE) ?? undefined;
      const response = await api.findRelationships(type, subject, object);
      sendJson(res, response.status, response.body);
      return;
    }

    // POST /relationships
    if (parts.length === 1 && parts[0] === 'relationships' && method === 'POST') {
      const relationship = JSON.parse(body ?? '{}');
      const response = await api.createRelationship(relationship);
      sendJson(res, response.status === 200 ? 201 : response.status, response.body);
      return;
    }

    // POST /assertions
    if (parts.length === 1 && parts[0] === 'assertions' && method === 'POST') {
      const assertion = JSON.parse(body ?? '{}');
      const response = await api.submitAssertion(assertion);
      sendJson(res, response.status === 200 ? 201 : response.status, response.body);
      return;
    }

    // GET /assertions/{semantic_id}
    if (parts.length === 2 && parts[0] === 'assertions' && method === 'GET') {
      const semantic_id = parts[1] as CURIE;
      const response = await api.getAssertion(semantic_id);
      sendJson(res, response.status, response.body);
      return;
    }

    // POST /validate
    if (parts.length === 1 && parts[0] === 'validate' && method === 'POST') {
      const request = JSON.parse(body ?? '{}');
      const response = await api.validate(request);
      sendJson(res, response.status, response.body);
      return;
    }

    // POST /resolve
    if (parts.length === 1 && parts[0] === 'resolve' && method === 'POST') {
      const { curie, strategy = 'exact' } = JSON.parse(body ?? '{}');
      const response = await api.resolveIdentifier(curie, strategy);
      sendJson(res, response.status, response.body);
      return;
    }

    // GET /namespaces
    if (parts.length === 1 && parts[0] === 'namespaces' && method === 'GET') {
      const result = await this.engine.services.identity.listNamespaces();
      sendJson(res, result.success ? 200 : 500, { success: result.success, data: result.data, error: result.error });
      return;
    }

    // POST /namespaces
    if (parts.length === 1 && parts[0] === 'namespaces' && method === 'POST') {
      const namespace = JSON.parse(body ?? '{}');
      const response = await api.registerNamespace(namespace);
      sendJson(res, response.status === 200 ? 201 : response.status, response.body);
      return;
    }

    // GET /audit
    if (parts.length === 1 && parts[0] === 'audit' && method === 'GET') {
      const url = new URL(`http://x${path}`, 'http://x');
      const affected = (url.searchParams.get('affected') as CURIE) ?? undefined;
      const actor = (url.searchParams.get('actor') as CURIE) ?? undefined;
      const response = await api.queryAudit(affected, actor);
      sendJson(res, response.status, response.body);
      return;
    }

    // 404 for unknown routes
    sendJson(res, 404, {
      '@context': 'https://www.w3.org/ns/json-ld',
      '@type': 'wsf:APIError',
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${method} ${path} not found` },
    });
  }
}

// ============================================================================
// Helper functions
// ============================================================================

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/ld+json' });
  res.end(JSON.stringify(body));
}

/**
 * Start a WSF REST server with default configuration.
 */
export async function startRESTServer(engine: SemanticEngine, options?: Partial<RESTServerConfig>): Promise<RESTServer> {
  const config: RESTServerConfig = {
    host: options?.host ?? '0.0.0.0',
    port: options?.port ?? 8080,
    prefix: options?.prefix ?? '/v1',
    cors_origins: options?.cors_origins ?? ['*'],
    auth_verifier: options?.auth_verifier,
  };
  const server = new RESTServer(engine, config);
  await server.start();
  return server;
}