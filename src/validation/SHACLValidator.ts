/**
 * WSF SHACL Validator
 *
 * Implements ADR-WSF-13 (Semantic Constraints and Validation) and the
 * Validation Service contract of ADR-WSF-24 §6. Zero-dependency validator
 * for the SHACL subset used by wsf-spec/shacl/wsf-shapes.ttl.
 *
 * Supported constraint components:
 *   sh:datatype, sh:pattern, sh:in, sh:minCount, sh:maxCount,
 *   sh:minLength, sh:maxLength, sh:minInclusive, sh:maxInclusive,
 *   sh:nodeKind (sh:IRI), sh:node (nested shape), sh:closed,
 *   sh:ignoredProperties
 *
 * The canonical normative shapes remain the Turtle source in
 * wsf-spec/shacl/wsf-shapes.ttl ; the typed shape registry in
 * ./shapes.ts is the machine-executable mirror of that source.
 */

import type { CURIE, ValidationResult } from '../types/index.js';

// ============================================================================
// Shape Model
// ============================================================================

export type SHACLDatatype = 'string' | 'decimal' | 'integer' | 'boolean' | 'dateTime' | 'anyURI';

export interface PropertyShape {
  /** Property path (plain property name on the node object). */
  path: string;
  /** Expected datatype. */
  datatype?: SHACLDatatype;
  /** Regex pattern the value MUST match (string values). */
  pattern?: string;
  /** Enumeration of allowed values. */
  in?: unknown[];
  /** Minimum occurrence count. */
  minCount?: number;
  /** Maximum occurrence count. */
  maxCount?: number;
  /** Minimum string length. */
  minLength?: number;
  /** Maximum string length. */
  maxLength?: number;
  /** Minimum numeric value (inclusive). */
  minInclusive?: number;
  /** Maximum numeric value (inclusive). */
  maxInclusive?: number;
  /** Node kind constraint. Only 'IRI' is used in WSF shapes. */
  nodeKind?: 'IRI' | 'Literal' | 'BlankNode';
  /** Nested node shape (IRI of a registered NodeShape). */
  node?: string;
  /** Human-readable violation message. */
  message?: string;
}

export interface NodeShape {
  /** Shape IRI (e.g. 'wsf:ConceptShape'). */
  iri: string;
  /** Target class IRI (e.g. 'wsf:Concept'). */
  targetClass?: string;
  /** Human name. */
  name?: string;
  /** Closed shape: no properties beyond those declared are allowed. */
  closed?: boolean;
  /** Properties ignored by the closed check (e.g. 'rdf:type'). */
  ignoredProperties?: string[];
  /** Property shapes. */
  properties: PropertyShape[];
}

// ============================================================================
// Validator
// ============================================================================

const CURIE_RX = /^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_]*$/;
const IRI_RX = /^[a-z][a-z0-9+.-]*:\/\/\S+$|^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_]*$/i;
const ISO_DATETIME_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

export class SHACLValidator {
  private shapes = new Map<string, NodeShape>();

  /** Register a node shape. Re-registering replaces. */
  registerShape(shape: NodeShape): void {
    this.shapes.set(shape.iri, shape);
  }

  /** List registered shape IRIs. */
  listShapes(): string[] {
    return Array.from(this.shapes.keys());
  }

  /** Retrieve a registered shape. */
  getShape(iri: string): NodeShape | undefined {
    return this.shapes.get(iri);
  }

  /**
   * Validate a node object against a registered shape.
   *
   * @param node      Plain object representation of the node.
   * @param shapeIri  IRI of the registered NodeShape to apply.
   * @param subject   CURIE identifying the representation under validation
   *                  (emitted on ValidationResult.representation).
   */
  validateNode(node: Record<string, unknown>, shapeIri: string, subject: CURIE): ValidationResult[] {
    const shape = this.shapes.get(shapeIri);
    if (!shape) {
      return [{
        representation: subject,
        severity: 'warning',
        path: '',
        message: `Shape ${shapeIri} not registered; node not validated`,
      }];
    }

    const results: ValidationResult[] = [];

    // Property constraints
    for (const prop of shape.properties) {
      results.push(...this.validateProperty(node, prop, subject, shape.iri));
    }

    // Closed shape check
    if (shape.closed) {
      const declared = new Set(shape.properties.map(p => p.path));
      const ignored = new Set(shape.ignoredProperties ?? []);
      ignored.add('@type');   // JSON-LD type keyword
      ignored.add('type_keyword_marker');
      for (const key of Object.keys(node)) {
        if (!declared.has(key) && !ignored.has(key) && key !== '@type' && key !== '@context' && key !== '@id') {
          results.push({
            representation: subject,
            severity: 'violation',
            path: key,
            message: `Property '${key}' is not declared in ${shape.iri} (closed shape)`,
            shape: shape.iri,
          });
        }
      }
    }

    return results;
  }

  private validateProperty(
    node: Record<string, unknown>,
    prop: PropertyShape,
    subject: CURIE,
    shapeIri: string,
  ): ValidationResult[] {
    const results: ValidationResult[] = [];
    const raw = node[prop.path];
    const present = raw !== undefined && raw !== null;
    const values: unknown[] = present ? (Array.isArray(raw) ? raw : [raw]) : [];
    const count = values.length;

    const emit = (message: string) => {
      results.push({
        representation: subject,
        severity: 'violation',
        path: prop.path,
        message: prop.message ?? message,
        shape: shapeIri,
      });
    };

    // Cardinality
    if (prop.minCount !== undefined && count < prop.minCount) {
      emit(`${prop.path} MUST occur at least ${prop.minCount} time(s); found ${count}`);
    }
    if (prop.maxCount !== undefined && count > prop.maxCount) {
      emit(`${prop.path} MUST occur at most ${prop.maxCount} time(s); found ${count}`);
    }

    for (const value of values) {
      // Datatype
      if (prop.datatype && !this.checkDatatype(value, prop.datatype)) {
        emit(`${prop.path} value ${JSON.stringify(value)} does not conform to datatype ${prop.datatype}`);
        continue;  // further checks assume the datatype
      }

      // Pattern
      if (prop.pattern !== undefined && typeof value === 'string' && !(new RegExp(prop.pattern).test(value))) {
        emit(`${prop.path} value '${value}' does not match pattern ${prop.pattern}`);
      }

      // Enumeration
      if (prop.in !== undefined && !prop.in.includes(value)) {
        emit(`${prop.path} value ${JSON.stringify(value)} is not in the allowed set ${JSON.stringify(prop.in)}`);
      }

      // String length
      if (prop.minLength !== undefined && typeof value === 'string' && value.length < prop.minLength) {
        emit(`${prop.path} length ${value.length} is below minimum ${prop.minLength}`);
      }
      if (prop.maxLength !== undefined && typeof value === 'string' && value.length > prop.maxLength) {
        emit(`${prop.path} length ${value.length} exceeds maximum ${prop.maxLength}`);
      }

      // Numeric range
      if (prop.minInclusive !== undefined && typeof value === 'number' && value < prop.minInclusive) {
        emit(`${prop.path} value ${value} is below minimum ${prop.minInclusive}`);
      }
      if (prop.maxInclusive !== undefined && typeof value === 'number' && value > prop.maxInclusive) {
        emit(`${prop.path} value ${value} exceeds maximum ${prop.maxInclusive}`);
      }

      // Node kind
      if (prop.nodeKind === 'IRI' && typeof value === 'string' && !IRI_RX.test(value) && !CURIE_RX.test(value)) {
        emit(`${prop.path} value '${value}' is not an IRI or CURIE`);
      }

      // Nested node shape
      if (prop.node !== undefined && typeof value === 'object' && value !== null) {
        const nested = this.shapes.get(prop.node);
        if (nested) {
          const nestedResults = this.validateNode(value as Record<string, unknown>, prop.node, subject);
          for (const r of nestedResults) {
            results.push({ ...r, path: prop.path + (r.path ? '.' + r.path : '') });
          }
        }
      }
    }

    return results;
  }

  private checkDatatype(value: unknown, datatype: SHACLDatatype): boolean {
    switch (datatype) {
      case 'string': return typeof value === 'string';
      case 'integer': return typeof value === 'number' && Number.isInteger(value);
      case 'decimal': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'dateTime': return typeof value === 'string' && ISO_DATETIME_RX.test(value);
      case 'anyURI': return typeof value === 'string' && (IRI_RX.test(value) || CURIE_RX.test(value));
      default: return false;
    }
  }
}
