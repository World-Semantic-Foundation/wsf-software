# WSF Semantic Engine : Architecture

> **Detailed architecture documentation for the WSF Semantic Engine implementation.**

## 1. Implementation Status

The current implementation (`v0.1.0`) provides:

| Component | Status | Notes |
|---|---|---|
| Type system (38 concepts) | Baseline | All Tier 1/2/3 concepts typed |
| Store Layer interface | Baseline | Abstract interface defined |
| MemoryStore implementation | Baseline | Full CRUD operations |
| PostgreSQL backend | Planned | Phase 1 |
| Neo4j backend | Planned | Phase 2 |
| MongoDB backend | Planned | Phase 3 |
| SQLite backend | Planned | Phase 1 |
| Concept Service | Baseline | Full CRUD + specialise + retire |
| Relationship Service | Baseline | Declare, find, traverse |
| Assertion Service | Baseline | Submit, accept, reject |
| Identity Service | Baseline | Namespace registration, CURIE resolution |
| Validation Service | Baseline | SHACL scaffold (full implementation in Phase 1) |
| Inference Service | Baseline | OWL 2 RL scaffold (full implementation in Phase 2) |
| Query Service | Baseline | Pattern matching (Cypher/SPARQL in Phase 2) |
| Audit Service | Baseline | Record and query |
| REST API | Baseline | JSON-LD, OAuth 2.0 + OIDC |
| gRPC API | Planned | Phase 3 |
| GraphQL API | Planned | Phase 3 |
| CLI | Baseline | 6 commands implemented |
| WebSocket/SSE | Planned | Phase 2 |

## 2. Type System (src/types/index.ts)

The TypeScript type system encodes:

- **Identifiers** : CURIE, IRI, Namespace
- **Semantic Status** : 6-stage enum (Candidate, Investigating, Proposed, Normative, Deprecated, Retired)
- **Concept** : full definition with tier, parent, definition, differentia, scope, counter-examples, canonical examples
- **Relationship** : typed associations with cardinality, attributes, provenance, validity
- **Assertion** : claim with confidence, proposition, evidence, provenance, lifecycle
- **Proposition** : modality-aware statements
- **Provenance** : actor, authority, timestamp, method, derivation chain
- **Validity** : time-bounded periods with status
- **Evidence** : document/observation/measurement/derivation references
- **Query** : 4 query types (graph, semantic, fulltext, pattern)
- **Validation** : SHACL/ShEx request and report structures
- **Representation** : 11 format types per ADR-WSF-23
- **Audit** : create/update/delete/validate/submit/accept/reject/retire actions
- **WSF_CONCEPT_CATALOG** : 38 concept semantic_ids as a const object

## 3. Store Layer (src/store/StoreLayer.ts)

The Store Layer interface defines 8 functional groups:

### 3.1 Concepts
- `createConcept(concept)` ; `getConcept(semantic_id)` ; `updateConcept(semantic_id, updates, provenance)` ; `deleteConcept(semantic_id, provenance)` ; `listConcepts(filter)` ; `countConcepts(filter)`

### 3.2 Relationships
- `createRelationship(relationship)` ; `getRelationship(semantic_id)` ; `deleteRelationship(semantic_id, provenance)` ; `findRelationships(filter)`

### 3.3 Assertions
- `createAssertion(assertion)` ; `getAssertion(semantic_id)` ; `updateAssertion(semantic_id, updates, provenance)` ; `findAssertions(filter)`

### 3.4 Identifiers and Namespaces
- `registerNamespace(namespace)` ; `getNamespace(prefix)` ; `resolveIdentifier(resolution)` ; `listNamespaces()`

### 3.5 Evidence
- `recordEvidence(evidence)` ; `getEvidenceForAssertion(assertion_id)`

### 3.6 Audit Trail
- `recordAudit(entry)` ; `queryAudit(filter)`

### 3.7 Query
- `executeQuery(query)`

### 3.8 Transactions
- `beginTransaction()` returns Transaction with `commit()`, `rollback()`, and access to the store

## 4. Services Layer (src/services/index.ts)

8 service modules per ADR-WSF-24 §6. Each service wraps the Store Layer with domain-specific operations and returns `EngineResult<T>` envelopes.

### 4.1 Service Composition Root

```typescript
import { createServices, SemanticEngine } from '@wsf/semantic-engine';

const engine = new SemanticEngine();
const { concept, relationship, assertion, identity, validation, inference, query, audit } =
  engine.services;
```

### 4.2 EngineResult Envelope

All service methods return `EngineResult<T>`:

```typescript
interface EngineResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { timestamp: string; execution_time_ms: number; actor?: CURIE };
}
```

## 5. API Layer (src/api/rest/index.ts)

### 5.1 REST Endpoints

| Method | Path | Handler | Purpose |
|---|---|---|---|
| GET | /concepts/{semantic_id} | `getConcept` | Retrieve a concept |
| POST | /concepts | `createConcept` | Create a new concept |
| GET | /concepts?tier=X | `listConcepts` | List concepts (optionally filtered) |
| POST | /relationships | `createRelationship` | Declare a relationship |
| GET | /relationships?subject=X&object=Y | `findRelationships` | Query relationships |
| POST | /assertions | `submitAssertion` | Submit an assertion |
| GET | /assertions/{semantic_id} | `getAssertion` | Retrieve an assertion |
| POST | /validate | `validate` | Run SHACL validation |
| POST | /namespaces | `registerNamespace` | Register a namespace |
| GET | /namespaces | `listNamespaces` | List registered namespaces |
| POST | /resolve | `resolveIdentifier` | Resolve a CURIE |
| GET | /audit?affected=X&actor=Y | `queryAudit` | Query audit trail |

### 5.2 Response Format

All responses are JSON-LD with `@context` and `@type`:

```json
{
  "@context": "https://www.w3.org/ns/json-ld",
  "@type": "wsf:APIResponse",
  "success": true,
  "data": { /* entity */ },
  "meta": {
    "timestamp": "2026-08-29T...",
    "execution_time_ms": 12
  }
}
```

Errors return `wsf:APIError` with error code, message, and details.

### 5.3 Status Codes

| Status | When |
|---|---|
| 200 | Success |
| 404 | Resource not found (CONCEPT_NOT_FOUND, ASSERTION_NOT_FOUND, etc.) |
| 422 | Validation failure |
| 401 | Unauthorized |
| 403 | Forbidden |
| 500 | Internal error |

## 6. CLI (src/cli/index.ts)

6 commands:

```
wsf concept get <semantic_id>
wsf concept list [--tier=Tier1]
wsf assertion submit <file.json>
wsf validate <file.json>
wsf query <expression>
wsf resolve <curie>
```

All commands accept file paths and return JSON output. Exit codes: 0 (success), 1 (error).

## 7. JSON Schemas (schemas/json/)

6 normative schemas:

- `concept.schema.json` : Concept per ADR-WSF-18/20
- `relationship.schema.json` : Relationship per ADR-WSF-19
- `assertion.schema.json` : Assertion per ADR-WSF-22
- `proposition.schema.json` : Proposition per wsf:Proposition
- `provenance.schema.json` : Provenance per ADR-WSF-22
- `validity.schema.json` : Validity per wsf:Validity
- `evidence.schema.json` : Evidence per wsf:Evidence

All schemas use JSON Schema Draft 2020-12, with CURIE patterns for identifiers, ISO 8601 for timestamps, and URI format for evidence locations.

## 8. Implementation Phases

Per CR-WSF-17 Rev.1, the implementation proceeds in 5 phases:

- **Phase 0 (current)** : Architecture + Foundation complete
- **Phase 1** : PostgreSQL + SQLite backends, full SHACL validation, REST API server
- **Phase 2** : Neo4j backend, OWL 2 RL inference, Cypher/SPARQL query, WebSocket
- **Phase 3** : MongoDB backend, gRPC, GraphQL, federation
- **Phase 4** : Production hardening, observability, deployment templates

## 9. Architectural Constraints

Per ADR-WSF-24, the implementation MUST:

- Maintain concept identity across all representations (ADR-WSF-18)
- Track all assertions with provenance and evidence (ADR-WSF-22)
- Support semantic status lifecycle (SEMANTIC-STATUS-MODEL)
- Provide query explanation traces for inference (ADR-WSF-22)
- Maintain audit trail immutability (ADR-WSF-24 §6.8)
- Support multi-backend pluggability without API changes (ADR-WSF-24 §5)

---

*This document follows ADR-WSF-24 and the WSF GitHub Language Rule. Status: Baseline.*