/**
 * WSF Semantic Engine : Core Type Definitions
 *
 * Implements ADR-WSF-24 (Software Architecture) : the canonical type system
 * for the WSF Semantic Engine. These types are the in-memory representation
 * of the 38 WSF concepts (12 Tier 1 + 9 Tier 2 + 16 Tier 3 + 1 example)
 * plus the supporting structures defined by ADR-WSF-17 through ADR-WSF-27.
 *
 * The types SHALL be the single source of truth for engine-internal
 * representations, API contracts, and persistence schemas.
 *
 * @see ADR-WSF-17 : Foundational Semantic Architecture
 * @see ADR-WSF-18 : Concept Identity
 * @see ADR-WSF-19 : Semantic Relationship Model
 * @see ADR-WSF-20 : Concept Definition Model
 * @see ADR-WSF-21 : Namespace and Reference Model
 * @see ADR-WSF-22 : Assertion and Provenance Model
 * @see ADR-WSF-23 : Semantic Representation Architecture
 * @see ADR-WSF-24 : WSF Software Architecture
 */

// ============================================================================
// Section 1 : Identifiers and Namespaces (ADR-WSF-21)
// ============================================================================

/**
 * A CURIE-form compact URI (per ADR-WSF-21) of the form `prefix:local`.
 * Examples: `wsf:Entity`, `schema:Organization`, `skos:Concept`.
 */
export type CURIE = string;

/**
 * An IRI (Internationalised Resource Identifier).
 */
export type IRI = string;

/**
 * A namespace registration (per ADR-WSF-21).
 */
export interface Namespace {
  /** Namespace prefix, registered with the Identity Service. */
  prefix: string;
  /** IRI of the namespace. */
  iri: IRI;
  /** Authority responsible for the namespace. */
  authority: string;
  /** Namespace status per SEMANTIC-STATUS-MODEL. */
  status: SemanticStatus;
  /** Registration date (ISO 8601). */
  registered_at: string;
}

// ============================================================================
// Section 2 : Semantic Status (per SEMANTIC-STATUS-MODEL)
// ============================================================================

/**
 * The 6-stage semantic status (per SEMANTIC-STATUS-MODEL):
 * Candidate ; Investigating ; Proposed ; Normative ; Deprecated ; Retired.
 */
export type SemanticStatus =
  | 'Candidate'
  | 'Investigating'
  | 'Proposed'
  | 'Normative'
  | 'Deprecated'
  | 'Retired';

// ============================================================================
// Section 3 : Concept (Tier 1 foundational, per ADR-WSF-18)
// ============================================================================

/**
 * Tier classification of a concept.
 */
export type ConceptTier = 'Tier 1' | 'Tier 2' | 'Tier 3';

/**
 * A concept definition (per ADR-WSF-18 and ADR-WSF-20).
 *
 * Concepts are the foundational primitives of WSF. Every entity in WSF
 * is either a Concept or an instance of a Concept.
 */
export interface Concept {
  /** Stable identifier (CURIE). */
  semantic_id: CURIE;
  /** Preferred human-readable name. */
  preferred_name: string;
  /** Alternative names. */
  aliases?: string[];
  /** Tier classification. */
  tier: ConceptTier;
  /** Parent concept semantic_id (for specialisation chains). */
  parent?: CURIE;
  /** Formal definition text. */
  definition: string;
  /** Markdown rendering of the concept. */
  definition_markdown?: string;
  /** Differentia (what distinguishes this concept from its parent). */
  differentia?: string;
  /** Scope notes clarifying application boundaries. */
  scope_notes?: string;
  /** Counter-examples (what this concept is NOT). */
  counter_examples?: string[];
  /** Canonical examples (worked instances). */
  canonical_examples?: string[];
  /** Authority responsible for the concept definition. */
  authority: string;
  /** Semantic status per SEMANTIC-STATUS-MODEL. */
  status: SemanticStatus;
  /** Version string (semver). */
  version: string;
  /** ADR(s) that established this concept. */
  defined_by?: string[];
  /** Related concept semantic_ids. */
  related_concepts?: CURIE[];
  /** Created timestamp (ISO 8601). */
  created_at: string;
  /** Last modified timestamp (ISO 8601). */
  modified_at: string;
}

// ============================================================================
// Section 4 : Relationship (Tier 1, per ADR-WSF-19)
// ============================================================================

/**
 * Relationship type kinds (per ADR-WSF-19).
 */
export type RelationshipKind =
  | 'specialises'      // Tier specialisation (subClassOf)
  | 'generalises'      // Inverse of specialises
  | 'references'       // Identifier/Reference link
  | 'depends_on'       // Dependency
  | 'part_of'          // Mereological composition
  | 'has_part'         // Inverse of part_of
  | 'instantiates'     // Entity instantiates Concept
  | 'instance_of'      // Inverse of instantiates
  | 'relates'          // Generic typed relationship
  | 'asserts'          // Subject makes an Assertion
  | 'evidenced_by'     // Assertion has Evidence
  | 'governed_by';     // Entity governed by Authority/Policy

/**
 * A relationship (per ADR-WSF-19).
 */
export interface Relationship {
  /** Stable identifier (CURIE) of the relationship instance. */
  semantic_id: CURIE;
  /** Relationship type. */
  type: RelationshipKind;
  /** Source concept or entity semantic_id. */
  subject: CURIE;
  /** Target concept or entity semantic_id. */
  object: CURIE;
  /** Optional context qualifier (e.g., temporal, role). */
  context?: CURIE;
  /** Optional cardinality constraint. */
  cardinality?: {
    min?: number;
    max?: number;
  };
  /** Optional relationship attributes. */
  attributes?: Record<string, unknown>;
  /** Provenance (per ADR-WSF-22). */
  provenance: Provenance;
  /** Validity (per wsf:Validity concept). */
  validity?: ValidityPeriod;
}

// ============================================================================
// Section 5 : Assertion (Tier 1, per ADR-WSF-22)
// ============================================================================

/**
 * Assertion lifecycle status (per ADR-WSF-22).
 */
export type AssertionLifecycle =
  | 'submitted'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'retired'
  | 'disputed';

/**
 * An assertion (per ADR-WSF-22).
 *
 * An Assertion is a claim about a relationship between concepts or entities,
 * with full provenance, evidence, and lifecycle tracking.
 */
export interface Assertion {
  /** Stable identifier (CURIE). */
  semantic_id: CURIE;
  /** Subject of the assertion (CURIE). */
  subject: CURIE;
  /** Relationship type. */
  relationship: RelationshipKind;
  /** Object of the assertion (CURIE). */
  object: CURIE;
  /** Confidence level (0.0 : 1.0). */
  confidence?: number;
  /** Context qualifier. */
  context?: CURIE;
  /** Assertion content/proposition (per wsf:Proposition). */
  proposition: Proposition;
  /** Evidence references. */
  evidence?: EvidenceReference[];
  /** Provenance metadata. */
  provenance: Provenance;
  /** Validity period. */
  validity?: ValidityPeriod;
  /** Lifecycle status. */
  lifecycle: AssertionLifecycle;
  /** Asserted at timestamp (ISO 8601). */
  asserted_at: string;
  /** Asserted by (CURIE of Actor). */
  asserted_by: CURIE;
}

// ============================================================================
// Section 6 : Proposition (Tier 1, per wsf:Proposition concept)
// ============================================================================

/**
 * A proposition (per wsf:Proposition concept).
 *
 * A Proposition is a statement about concepts or entities, independent of
 * any particular assertion. An Assertion materialises a Proposition.
 */
export interface Proposition {
  /** Stable identifier (CURIE). */
  semantic_id: CURIE;
  /** Subject of the proposition. */
  subject: CURIE;
  /** Predicate (relationship type). */
  predicate: RelationshipKind;
  /** Object of the proposition. */
  object: CURIE;
  /** Modality: asserted (true), negated (false), conditional, possible. */
  modality: 'asserted' | 'negated' | 'conditional' | 'possible' | 'necessary';
  /** Optional qualifier. */
  qualifier?: string;
}

// ============================================================================
// Section 7 : Provenance (Tier 2, per ADR-WSF-22)
// ============================================================================

/**
 * Provenance metadata (per ADR-WSF-22).
 *
 * Provenance captures WHO made a change, WHEN, under WHAT authority,
 * with WHAT evidence, and through WHAT derivation chain.
 */
export interface Provenance {
  /** Actor who created/modified (CURIE). */
  actor: CURIE;
  /** Authority under which the change was made (CURIE). */
  authority: CURIE;
  /** Timestamp (ISO 8601). */
  timestamp: string;
  /** Method or process used (CURIE). */
  method?: CURIE;
  /** Source derivation (CURIE of upstream entity). */
  derived_from?: CURIE[];
  /** Version identifier. */
  version?: string;
  /** Free-form notes. */
  notes?: string;
}

// ============================================================================
// Section 8 : Validity (Tier 2, per wsf:Validity concept)
// ============================================================================

/**
 * Time-bounded validity period (per wsf:Validity concept).
 */
export interface ValidityPeriod {
  /** Effective start time (ISO 8601). */
  valid_from: string;
  /** Effective end time (ISO 8601), or null if indefinite. */
  valid_until: string | null;
  /** Validity status. */
  status: 'active' | 'suspended' | 'expired' | 'revoked';
}

// ============================================================================
// Section 9 : Evidence (Tier 2, per wsf:Evidence concept)
// ============================================================================

/**
 * Evidence reference (per wsf:Evidence concept).
 */
export interface EvidenceReference {
  /** Stable identifier (CURIE). */
  semantic_id: CURIE;
  /** Evidence type: document, observation, measurement, expert_judgement. */
  type: 'document' | 'observation' | 'measurement' | 'expert_judgement' | 'derivation';
  /** URI/IRI of the evidence artefact. */
  location: IRI;
  /** Description of the evidence. */
  description: string;
  /** Reliability score (0.0 : 1.0). */
  reliability?: number;
  /** Provenance of the evidence itself. */
  provenance: Provenance;
}

// ============================================================================
// Section 10 : Identifier Resolution (Tier 2, per ADR-WSF-21)
// ============================================================================

/**
 * Identifier resolution request (per ADR-WSF-21).
 */
export interface IdentifierResolution {
  /** CURIE to resolve. */
  curie: CURIE;
  /** Resolution strategy. */
  strategy: 'exact' | 'prefix_wildcard' | 'cross_namespace' | 'canonical';
  /** Resolution context. */
  context?: CURIE;
}

/**
 * Identifier resolution result.
 */
export interface IdentifierResolutionResult {
  /** Input CURIE. */
  curie: CURIE;
  /** Resolved concept semantic_id (if found). */
  resolved_to?: CURIE;
  /** Resolution confidence (0.0 : 1.0). */
  confidence: number;
  /** Resolution strategy used. */
  strategy: string;
  /** Alternative candidates (if multiple matches). */
  alternatives?: CURIE[];
}

// ============================================================================
// Section 11 : Query (per ADR-WSF-24 Query Service)
// ============================================================================

/**
 * Query type.
 */
export type QueryType = 'graph' | 'semantic' | 'fulltext' | 'pattern';

/**
 * A query (per Query Service).
 */
export interface Query {
  /** Query type. */
  type: QueryType;
  /** Query expression (Cypher, SPARQL, or pattern). */
  expression: string;
  /** Query parameters. */
  parameters?: Record<string, unknown>;
  /** Pagination. */
  pagination?: {
    offset: number;
    limit: number;
  };
}

/**
 * Query result.
 */
export interface QueryResult<T = unknown> {
  /** Matched entities. */
  matches: T[];
  /** Total count (before pagination). */
  total_count: number;
  /** Query execution time (ms). */
  execution_time_ms: number;
  /** Query explanation trace (for inference queries). */
  explanation?: string[];
}

// ============================================================================
// Section 12 : Validation (per ADR-WSF-24 Validation Service)
// ============================================================================

/**
 * Validation request.
 */
export interface ValidationRequest {
  /** Representations to validate. */
  representations: Representation[];
  /** Validation language: 'shacl' or 'shex'. */
  language: 'shacl' | 'shex';
  /** Shapes to apply (CURIE list). */
  shapes?: CURIE[];
}

/**
 * Validation result entry.
 */
export interface ValidationResult {
  /** Representation semantic_id. */
  representation: CURIE;
  /** Severity. */
  severity: 'violation' | 'warning' | 'info';
  /** Result path. */
  path: string;
  /** Message. */
  message: string;
  /** Shape that emitted the result. */
  shape?: CURIE;
}

/**
 * Validation report.
 */
export interface ValidationReport {
  /** Total results. */
  results: ValidationResult[];
  /** Conformance status. */
  conforms: boolean;
  /** Validation time. */
  validation_time_ms: number;
}

// ============================================================================
// Section 13 : Representation (per ADR-WSF-23)
// ============================================================================

/**
 * Representation format (per ADR-WSF-23 5-layer stack).
 */
export type RepresentationFormat =
  | 'json-ld'        // Semantic Identity Layer
  | 'turtle'         // Canonical Encoding Layer
  | 'yaml'
  | 'json'
  | 'protobuf'       // Distribution Format Layer
  | 'messagepack'
  | 'cbor'
  | 'markdown'       // Presentation Layer
  | 'mermaid'
  | 'html'
  | 'svg';

/**
 * A representation of a concept or assertion (per ADR-WSF-23).
 */
export interface Representation {
  /** Stable identifier (CURIE). */
  semantic_id: CURIE;
  /** Subject concept/assertion. */
  subject: CURIE;
  /** Format. */
  format: RepresentationFormat;
  /** The representation content. */
  content: string | Uint8Array;
  /** Content media type. */
  media_type: string;
  /** Encoding timestamp. */
  encoded_at: string;
  /** Encoder (Actor). */
  encoded_by: CURIE;
}

// ============================================================================
// Section 14 : Audit Trail (Tier 2, per ADR-WSF-22)
// ============================================================================

/**
 * Audit entry (per Audit Service).
 */
export interface AuditEntry {
  /** Stable identifier (CURIE). */
  semantic_id: CURIE;
  /** Action type. */
  action: 'create' | 'update' | 'delete' | 'validate' | 'submit' | 'accept' | 'reject' | 'retire';
  /** Affected entity semantic_id. */
  affected: CURIE;
  /** Actor who performed the action. */
  actor: CURIE;
  /** Timestamp (ISO 8601). */
  timestamp: string;
  /** Before state (if update). */
  before?: unknown;
  /** After state (if create/update). */
  after?: unknown;
  /** Rationale. */
  rationale?: string;
}

// ============================================================================
// Section 15 : Tier 1, Tier 2, Tier 3 Concept Catalog (the 38 WSF concepts)
// ============================================================================

/**
 * The complete catalog of WSF concept semantic_ids.
 *
 * Tier 1 (Foundational, 12): Entity, Concept, Relationship, Event, State,
 *   Disposition, Proposition, Assertion, Identity, Context, Time, Space.
 *
 * Tier 2 (Supporting, 9): Identifier, Reference, Namespace, Term,
 *   Definition, Validity, Evidence, Provenance, Authority.
 *
 * Tier 3 (Specialisation, 16 + 1 example): Role, Process, Function,
 *   Activity, Outcome, Resource, System, Organisation, Service, Goal,
 *   Policy, Rule, Constraint, Objective, Measure, Actor, Capability.
 */
export const WSF_CONCEPT_CATALOG = {
  // Tier 1
  ENTITY: 'wsf:Entity',
  CONCEPT: 'wsf:Concept',
  RELATIONSHIP: 'wsf:Relationship',
  EVENT: 'wsf:Event',
  STATE: 'wsf:State',
  DISPOSITION: 'wsf:Disposition',
  PROPOSITION: 'wsf:Proposition',
  ASSERTION: 'wsf:Assertion',
  IDENTITY: 'wsf:Identity',
  CONTEXT: 'wsf:Context',
  TIME: 'wsf:Time',
  SPACE: 'wsf:Space',

  // Tier 2
  IDENTIFIER: 'wsf:Identifier',
  REFERENCE: 'wsf:Reference',
  NAMESPACE: 'wsf:Namespace',
  TERM: 'wsf:Term',
  DEFINITION: 'wsf:Definition',
  VALIDITY: 'wsf:Validity',
  EVIDENCE: 'wsf:Evidence',
  PROVENANCE: 'wsf:Provenance',
  AUTHORITY: 'wsf:Authority',

  // Tier 3
  ROLE: 'wsf:Role',
  PROCESS: 'wsf:Process',
  FUNCTION: 'wsf:Function',
  ACTIVITY: 'wsf:Activity',
  OUTCOME: 'wsf:Outcome',
  RESOURCE: 'wsf:Resource',
  SYSTEM: 'wsf:System',
  ORGANISATION: 'wsf:Organisation',
  SERVICE: 'wsf:Service',
  GOAL: 'wsf:Goal',
  POLICY: 'wsf:Policy',
  RULE: 'wsf:Rule',
  CONSTRAINT: 'wsf:Constraint',
  OBJECTIVE: 'wsf:Objective',
  MEASURE: 'wsf:Measure',
  ACTOR: 'wsf:Actor',
  CAPABILITY: 'wsf:Capability',
} as const;

/**
 * Type-safe enumeration of WSF concept semantic_ids.
 */
export type WSFConceptID = (typeof WSF_CONCEPT_CATALOG)[keyof typeof WSF_CONCEPT_CATALOG];

// ============================================================================
// Section 16 : Engine Result Types
// ============================================================================

/**
 * Generic engine operation result envelope.
 */
export interface EngineResult<T = unknown> {
  /** Operation success. */
  success: boolean;
  /** Result data. */
  data?: T;
  /** Error details if not successful. */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Execution metadata. */
  meta?: {
    timestamp: string;
    execution_time_ms: number;
    actor?: CURIE;
  };
}

// ============================================================================
// Section 17 : Service Configuration
// ============================================================================

/**
 * Engine configuration.
 */
export interface EngineConfig {
  /** Default namespace prefix. */
  default_namespace: string;
  /** Storage backend type. */
  store_backend: 'memory' | 'postgresql' | 'neo4j' | 'mongodb' | 'sqlite';
  /** Validation languages enabled. */
  validation_languages: Array<'shacl' | 'shex'>;
  /** Inference engine enabled. */
  inference_enabled: boolean;
  /** Audit trail retention (days). */
  audit_retention_days: number;
  /** API surface enabled. */
  api_surface: Array<'rest' | 'grpc' | 'graphql' | 'cli' | 'websocket'>;
}

// ============================================================================
// End of Core Type Definitions
// ============================================================================

/**
 * The default engine configuration (in-memory backend for development).
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  default_namespace: 'wsf',
  store_backend: 'memory',
  validation_languages: ['shacl'],
  inference_enabled: true,
  audit_retention_days: 2555,  // 7 years
  api_surface: ['rest', 'cli'],
};