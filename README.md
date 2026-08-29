# WSF Semantic Engine — Software Foundation

> **The deployable software implementation of WSF semantics.**

This repository (`wsf-software/`) contains the initial WSF Semantic Engine architecture. Per CR-WSF-17 Rev.1 §7, this is the **deployable software foundation** that brings WSF semantics to life.

---

## Repository Structure

```
wsf-software/
├── README.md (this file)
├── engine/         ← WSF Semantic Engine core
├── api/            ← REST/Graph/Events/SDK APIs
├── store/          ← Semantic Store (Concepts/Entities/Relations/Assertions/Context/Provenance)
├── services/       ← Validation/Resolution/Query/Reasoning/Mapping
└── deploy/         ← Deployment configurations
```

---

## WSF Semantic Engine Architecture (per CR-WSF-17 Rev.1 §7)

```
                  WSF SEMANTIC ENGINE
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
   Semantic Store     Semantic Services    API Layer
       │                   │                   │
       ├── Concepts        ├── Validation     ├── REST
       ├── Entities        ├── Resolution     ├── Graph
       ├── Relations       ├── Query          ├── Events
       ├── Assertions      ├── Reasoning      └── SDK
       ├── Context        └── Mapping
       └── Provenance
```

---

## 11 Engine Capabilities (per CR-WSF-17 Rev.1 §8)

```
Create          → Create semantic instances and assertions
Identify        → Assign and resolve semantic identities
Reference       → Resolve references across namespaces
Describe        → Represent entities, concepts, states, events
Relate          → Create and query semantic relationships
Contextualize   → Qualify semantics through context
Validate        → Validate semantic structures and assertions
Query           → Retrieve semantic information via machine interfaces
Reason          → Support controlled semantic inference
Transform       → Map between compatible semantic representations
Import          → Consume compatible external semantic/data representations
Export          → Produce interoperable representations
Observe         → Provide semantic state/event information
```

---

## Platform Neutrality (per CR-WSF-17 Rev.1 §9)

WSF SHALL remain technology-neutral at the semantic level. The implementation may use:

- RDF, OWL, JSON-LD (semantic web technologies)
- Graph databases (Neo4j, JanusGraph, etc.)
- Relational databases (PostgreSQL, etc.)
- REST APIs, GraphQL, Event interfaces

**However**: Technology choices SHALL implement the semantic architecture; they SHALL NOT define the semantic architecture.

Technology selection SHALL be handled through subsequent implementation ADRs.

---

## Architecture Layers

### 1. Semantic Store

Stores and retrieves semantic artifacts:
- Concepts (12 Tier 1 + 9 Tier 2 + derived)
- Entities (e.g., OTCHERE Inc, Kwesi, OTCHERE DC-01)
- Relations (4 Forms + 10 Families)
- Assertions (with qualifiers)
- Context (qualification metadata)
- Provenance (source, agent, time, method, derivation)

### 2. Semantic Services

The 11 engine capabilities implemented as services:
- **Validation**: Check assertions against semantic constraints
- **Resolution**: Resolve Identifier/Reference to Entity/Concept
- **Query**: Retrieve semantic information
- **Reasoning**: Controlled semantic inference (where explicitly supported)
- **Mapping**: Transform between compatible representations

### 3. API Layer

Multiple API styles:
- **REST**: Standard HTTP-based API
- **Graph**: GraphQL or similar query interface
- **Events**: Event-driven interfaces for change notifications
- **SDK**: Client libraries for embedding

---

## Deployment Considerations

The engine is designed to be:
- **Stateless where possible** — for horizontal scaling
- **Stateful where necessary** — for transactions and reasoning
- **Cloud-native** — container-ready, orchestration-friendly
- **On-premise compatible** — for sensitive deployments

Specific deployment strategies (Kubernetes, Docker Swarm, etc.) will be selected through subsequent ADRs.

---

## Status

This repository is being established per CR-WSF-17 Rev.1. **No code has been written yet.** The architecture is documented; the implementation awaits subsequent ADRs (ADR-WSF-24 — WSF Software Architecture).

---

## Related Repositories

- [wsf/](../wsf/) — Canonical semantic assets
- [wsf-spec/](../wsf-spec/) — Normative specifications
- [wsf-governance/](../wsf-governance/) — ADRs, CRs
- [wsf-connectors/](../wsf-connectors/) — Integration adapters

---

*This is the software foundation of WSF. Implementation requires explicit ADR authorization.*
