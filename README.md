# wsf-software : WSF Semantic Engine

> **The deployable software implementation of the World Semantic Foundation.**
>
> Implements ADR-WSF-24 (Software Architecture) : the 3-layer architecture (Store, Services, API) that operationalises the 38 WSF concepts.

## Overview

The WSF Semantic Engine is the executable instantiation of the WSF architectural foundation. It provides:

- **Type-safe concept, relationship, and assertion management** for the full 38-concept vocabulary
- **8 service modules** (Concept, Relationship, Assertion, Identity, Validation, Inference, Query, Audit) per ADR-WSF-24 §6
- **Pluggable storage backends** (in-memory, PostgreSQL, Neo4j, MongoDB, SQLite) per ADR-WSF-24 §5
- **Multiple API surfaces** (REST, gRPC, GraphQL, CLI, WebSocket) per ADR-WSF-24 §7
- **SHACL validation** and **OWL 2 RL inference** per ADR-WSF-23 and ADR-WSF-24
- **Full provenance and audit trail** per ADR-WSF-22

## Architecture (ADR-WSF-24)

```
+---------------------------------------------------+
|                  API Layer                        |
|   REST  ;  gRPC  ;  GraphQL  ;  CLI  ;  WebSocket |
+---------------------------------------------------+
|               Services Layer                      |
|   Concept ; Relationship ; Assertion ; Identity    |
|   Validation ; Inference ; Query ; Audit          |
+---------------------------------------------------+
|                 Store Layer                       |
|   PostgreSQL ; Neo4j ; MongoDB ; SQLite ; Memory  |
+---------------------------------------------------+
```

## Quick Start

### Installation

```bash
npm install @wsf/semantic-engine
```

### Basic Usage

```typescript
import { SemanticEngine } from '@wsf/semantic-engine';

const engine = new SemanticEngine({
  store_backend: 'memory',
  validation_languages: ['shacl'],
  inference_enabled: true,
  api_surface: ['rest', 'cli'],
});

await engine.initialise();

const result = await engine.services.concept.get('wsf:Entity');
console.log(result.data);
```

### CLI Usage

```bash
wsf concept get wsf:Entity
wsf concept list --tier=Tier1
wsf assertion submit my_assertion.json
wsf validate my_representation.json
wsf resolve wsf:Entity
```

### REST API

```bash
# Get a concept
curl -X GET https://api.wsf.example/concepts/wsf:Entity

# List concepts by tier
curl -X GET "https://api.wsf.example/concepts?tier=Tier%201"

# Submit an assertion
curl -X POST https://api.wsf.example/assertions \
  -H "Content-Type: application/json" \
  -d @assertion.json
```

## Repository Structure

```
wsf-software/
  src/
    index.ts                 : Main entry point ; SemanticEngine class
    types/                   : Type definitions (Concept, Assertion, etc.)
    store/                   : Store Layer interface + MemoryStore implementation
    store/postgresql/        : PostgreSQL backend (7-table DDL, transactions)
    store/sqlite/            : SQLite backend (7-table DDL, WAL mode)
    store/neo4j/             : Neo4j backend (graph model, constraints, fulltext index)
    store/mongodb/           : MongoDB backend (7 collections, JSON Schema validators)
    validation/              : SHACL validator + WSF shape registry
    query/                   : GraphQueryEngine (Cypher/SPARQL portable subsets)
    services/                : 8 service modules
    api/
      rest/                  : REST API handlers
      grpc/                  : gRPC scaffolding (planned)
    server/                  : RESTServer + production entrypoint (main.ts)
    cli/                     : Command-line interface
  schemas/
    json/                    : JSON Schema definitions (Concept, Relationship, Assertion, etc.)
    protobuf/                : Protobuf schemas (planned)
  deploy/                    : Production deployment templates (Dockerfile, compose, env)
  tests/                     : Test suite (54 tests)
  docs/
    ARCHITECTURE.md          : Detailed architecture documentation
  package.json               : npm package configuration
  tsconfig.json              : TypeScript compiler configuration
```

## Production Deployment

See [deploy/README.md](deploy/README.md) : Dockerfile (multi-stage, non-root,
healthcheck), docker-compose reference topology with one profile per store
backend, and the environment template (`.env.example`). The service-mode
entrypoint is `src/server/main.ts`, configured entirely via environment
variables.

## Phase 1 Capabilities (v0.2.0)

- **5 store backends** : Memory, PostgreSQL, SQLite (v0.1.0) + Neo4j, MongoDB (v0.2.0)
- **Full SHACL validation** : zero-dependency SHACL subset validator executing the 7 normative WSF shapes (canonical source: wsf-spec/shacl/wsf-shapes.ttl) against JSON and JSON-LD representations
- **Graph query layer** : portable Cypher and SPARQL subsets over any backend; native Cypher passthrough on Neo4jStore
- **Production deployment templates** : service-mode container with selectable backends

## Concept Vocabulary Coverage

The engine implements the complete 38-concept WSF vocabulary:

| Tier | Count | Concepts |
|---|---|---|
| **Tier 1 (Foundational)** | 12 | Entity, Concept, Relationship, Event, State, Disposition, Proposition, Assertion, Identity, Context, Time, Space |
| **Tier 2 (Supporting)** | 9 | Identifier, Reference, Namespace, Term, Definition, Validity, Evidence, Provenance, Authority |
| **Tier 3 (Specialisation)** | 16 | Role, Process, Function, Activity, Outcome, Resource, System, Organisation, Service, Goal, Policy, Rule, Constraint, Objective, Measure, Actor |
| **Tier 3 Worked Example** | 1 | Capability |

The TypeScript type system encodes all 38 concept semantic_ids in the `WSF_CONCEPT_CATALOG` constant.

## Service Modules

Per ADR-WSF-24 §6, the engine exposes 8 service modules:

1. **Concept Service** : Create, retrieve, update, delete, list, specialise, retire concepts
2. **Relationship Service** : Declare, find, traverse relationship graphs
3. **Assertion Service** : Submit, retrieve, accept, reject assertions
4. **Identity Service** : Register namespaces, resolve CURIEs
5. **Validation Service** : SHACL/ShEx validation of representations
6. **Inference Service** : OWL 2 RL entailment, explanation traces
7. **Query Service** : Pattern, graph, semantic, fulltext queries
8. **Audit Service** : Record and query audit trail

## Related Repositories

- [wsf/](https://github.com/World-Semantic-Foundation/wsf) : Concept catalog (38 concept files)
- [wsf-spec/](https://github.com/World-Semantic-Foundation/wsf-spec) : Normative schemas
- [wsf-governance/](https://github.com/World-Semantic-Foundation/wsf-governance) : ADRs (especially ADR-WSF-24)
- [wsf-examples/](https://github.com/World-Semantic-Foundation/wsf-examples) : Reference applications

## Architectural References

- **ADR-WSF-24** : WSF Software Architecture (this implementation)
- **ADR-WSF-23** : Semantic Representation Architecture
- **ADR-WSF-22** : Assertion and Provenance Model
- **ADR-WSF-25** : Integration Architecture
- **ADR-WSF-27** : Digital Twin and Simulation Architecture

## License

Apache-2.0

---

*The WSF Semantic Engine. Implementation per ADR-WSF-24. Status: Baseline.*