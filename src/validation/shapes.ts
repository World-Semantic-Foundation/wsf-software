/**
 * WSF Shape Registry
 *
 * Machine-executable mirror of the canonical normative shapes in
 * wsf-spec/shacl/wsf-shapes.ttl. The Turtle source is authoritative;
 * this registry is kept in 1:1 correspondence with it so the Semantic
 * Engine can execute validation without a Turtle parser.
 *
 * Property paths are stored as plain property names (the 'wsf:' prefix
 * of the Turtle sh:path is dropped, matching the engine's JSON object
 * model).
 */

import type { NodeShape } from './SHACLValidator.js';

const CURIE_PATTERN = '^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_]*$';

// ============================================================================
// Supporting shapes
// ============================================================================

export const PROVENANCE_SHAPE: NodeShape = {
  iri: 'wsf:ProvenanceShape',
  name: 'WSF Provenance Shape',
  closed: true,
  properties: [
    { path: 'actor', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1 },
    { path: 'authority', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1 },
    { path: 'timestamp', datatype: 'dateTime', minCount: 1 },
    { path: 'method', datatype: 'string', pattern: CURIE_PATTERN, maxCount: 1 },
    { path: 'derived_from', datatype: 'string', pattern: CURIE_PATTERN },
    { path: 'version', datatype: 'string', maxCount: 1 },
    { path: 'notes', datatype: 'string', maxCount: 1 },
  ],
};

export const VALIDITY_SHAPE: NodeShape = {
  iri: 'wsf:ValidityShape',
  name: 'WSF Validity Shape',
  closed: true,
  properties: [
    { path: 'valid_from', datatype: 'dateTime', minCount: 1 },
    { path: 'valid_until', datatype: 'dateTime' },
    { path: 'status', datatype: 'string', in: ['active', 'suspended', 'expired', 'revoked'], minCount: 1 },
  ],
};

export const PROPOSITION_SHAPE: NodeShape = {
  iri: 'wsf:PropositionShape',
  name: 'WSF Proposition Shape',
  closed: true,
  properties: [
    { path: 'semantic_id', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1, maxCount: 1 },
    { path: 'subject', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1 },
    {
      path: 'predicate', datatype: 'string',
      in: ['specialises', 'generalises', 'references', 'depends_on', 'part_of', 'has_part',
           'instantiates', 'instance_of', 'relates', 'asserts', 'evidenced_by', 'governed_by'],
      minCount: 1,
    },
    { path: 'object', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1 },
    { path: 'modality', datatype: 'string', in: ['asserted', 'negated', 'conditional', 'possible', 'necessary'], minCount: 1 },
    { path: 'qualifier', datatype: 'string', maxCount: 1 },
  ],
};

export const EVIDENCE_SHAPE: NodeShape = {
  iri: 'wsf:EvidenceShape',
  name: 'WSF Evidence Shape',
  closed: true,
  properties: [
    { path: 'semantic_id', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1, maxCount: 1 },
    { path: 'type', datatype: 'string', in: ['document', 'observation', 'measurement', 'expert_judgement', 'derivation'], minCount: 1 },
    { path: 'location', datatype: 'anyURI', minCount: 1 },
    { path: 'description', datatype: 'string', minCount: 1 },
    { path: 'reliability', datatype: 'decimal', minInclusive: 0.0, maxInclusive: 1.0 },
    { path: 'provenance', node: 'wsf:ProvenanceShape', minCount: 1, maxCount: 1 },
  ],
};

// ============================================================================
// Core shapes
// ============================================================================

export const CONCEPT_SHAPE: NodeShape = {
  iri: 'wsf:ConceptShape',
  targetClass: 'wsf:Concept',
  name: 'WSF Concept Shape',
  closed: true,
  ignoredProperties: ['rdf:type'],
  properties: [
    {
      path: 'semantic_id', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1, maxCount: 1,
      message: "semantic_id MUST be a CURIE of form 'prefix:LocalName'",
    },
    {
      path: 'preferred_name', datatype: 'string', minLength: 1, maxLength: 200, minCount: 1, maxCount: 1,
      message: 'preferred_name MUST be a non-empty string (max 200 chars)',
    },
    {
      path: 'tier', datatype: 'string', in: ['Tier 1', 'Tier 2', 'Tier 3'], minCount: 1, maxCount: 1,
      message: 'tier MUST be one of: Tier 1, Tier 2, Tier 3',
    },
    {
      path: 'definition', datatype: 'string', minLength: 1, minCount: 1, maxCount: 1,
      message: 'definition MUST be a non-empty string',
    },
    {
      path: 'authority', datatype: 'string', minCount: 1, maxCount: 1,
      message: 'authority MUST be specified',
    },
    {
      path: 'status', datatype: 'string',
      in: ['Candidate', 'Investigating', 'Proposed', 'Normative', 'Deprecated', 'Retired'],
      minCount: 1, maxCount: 1,
      message: 'status MUST be one of the 6-stage semantic status values',
    },
    {
      path: 'version', datatype: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', minCount: 1, maxCount: 1,
      message: 'version MUST be a semver string (e.g. 1.0.0)',
    },
    {
      path: 'created_at', datatype: 'dateTime', minCount: 1, maxCount: 1,
      message: 'created_at MUST be an ISO 8601 datetime',
    },
    {
      path: 'modified_at', datatype: 'dateTime', minCount: 1, maxCount: 1,
      message: 'modified_at MUST be an ISO 8601 datetime',
    },
    {
      path: 'parent', datatype: 'string', pattern: CURIE_PATTERN, maxCount: 1,
      message: 'parent, if present, MUST be a CURIE',
    },
    { path: 'aliases', nodeKind: 'IRI', message: 'aliases, if present, MUST be IRIs' },
    { path: 'defined_by', nodeKind: 'IRI', message: 'defined_by, if present, MUST be ADRs (IRIs)' },
    { path: 'related_concepts', nodeKind: 'IRI', message: 'related_concepts, if present, MUST be concept IRIs' },
    { path: 'definition_markdown', datatype: 'string', maxCount: 1 },
    { path: 'differentia', datatype: 'string', maxCount: 1 },
    { path: 'scope_notes', datatype: 'string', maxCount: 1 },
    { path: 'counter_examples', datatype: 'string' },
    { path: 'canonical_examples', datatype: 'string' },
  ],
};

export const RELATIONSHIP_SHAPE: NodeShape = {
  iri: 'wsf:RelationshipShape',
  targetClass: 'wsf:Relationship',
  name: 'WSF Relationship Shape',
  closed: true,
  ignoredProperties: ['rdf:type'],
  properties: [
    { path: 'semantic_id', datatype: 'string', minCount: 1, maxCount: 1 },
    {
      path: 'type', datatype: 'string',
      in: ['specialises', 'generalises', 'references', 'depends_on', 'part_of', 'has_part',
           'instantiates', 'instance_of', 'relates', 'asserts', 'evidenced_by', 'governed_by'],
      minCount: 1, maxCount: 1,
      message: 'type MUST be one of the 12 relationship kinds',
    },
    { path: 'subject', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1, maxCount: 1 },
    { path: 'object', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1, maxCount: 1 },
    { path: 'provenance', node: 'wsf:ProvenanceShape', minCount: 1, maxCount: 1 },
    { path: 'validity', node: 'wsf:ValidityShape', maxCount: 1 },
    { path: 'context', datatype: 'string', pattern: CURIE_PATTERN, maxCount: 1 },
    { path: 'cardinality', maxCount: 1 },
    { path: 'attributes', maxCount: 1 },
  ],
};

export const ASSERTION_SHAPE: NodeShape = {
  iri: 'wsf:AssertionShape',
  targetClass: 'wsf:Assertion',
  name: 'WSF Assertion Shape',
  closed: true,
  ignoredProperties: ['rdf:type'],
  properties: [
    { path: 'semantic_id', datatype: 'string', minCount: 1, maxCount: 1 },
    { path: 'subject', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1 },
    { path: 'relationship', datatype: 'string', minCount: 1, maxCount: 1 },
    { path: 'object', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1 },
    { path: 'confidence', datatype: 'decimal', minInclusive: 0.0, maxInclusive: 1.0, maxCount: 1 },
    { path: 'proposition', node: 'wsf:PropositionShape', minCount: 1, maxCount: 1 },
    {
      path: 'lifecycle', datatype: 'string',
      in: ['submitted', 'under_review', 'accepted', 'rejected', 'retired', 'disputed'],
      minCount: 1, maxCount: 1,
    },
    { path: 'asserted_at', datatype: 'dateTime', minCount: 1, maxCount: 1 },
    { path: 'asserted_by', datatype: 'string', pattern: CURIE_PATTERN, minCount: 1, maxCount: 1 },
    { path: 'provenance', node: 'wsf:ProvenanceShape', minCount: 1, maxCount: 1 },
    { path: 'evidence', node: 'wsf:EvidenceShape' },
    { path: 'context', datatype: 'string', pattern: CURIE_PATTERN, maxCount: 1 },
    { path: 'validity', node: 'wsf:ValidityShape', maxCount: 1 },
  ],
};

// ============================================================================
// Registry
// ============================================================================

/** All WSF normative shapes, in registration order. */
export const WSF_SHAPES: NodeShape[] = [
  PROVENANCE_SHAPE,
  VALIDITY_SHAPE,
  PROPOSITION_SHAPE,
  EVIDENCE_SHAPE,
  CONCEPT_SHAPE,
  RELATIONSHIP_SHAPE,
  ASSERTION_SHAPE,
];

/** Shape IRI lookup by target class. */
export const SHAPE_BY_TARGET_CLASS: Record<string, string> = {
  'wsf:Concept': 'wsf:ConceptShape',
  'wsf:Relationship': 'wsf:RelationshipShape',
  'wsf:Assertion': 'wsf:AssertionShape',
};
