/**
 * WSF Graph Query Engine
 *
 * Implements the graph query capability of ADR-WSF-24 §6 (Query Service):
 * a store-agnostic executor for a documented subset of Cypher and SPARQL,
 * runnable over any StoreLayer backend (Memory, PostgreSQL, SQLite,
 * MongoDB). When the backend is Neo4jStore, native Cypher passthrough is
 * available via the store's own executeQuery(); this engine guarantees a
 * portable baseline across all backends.
 *
 * Supported Cypher subset:
 *   MATCH (c:Concept) RETURN c
 *   MATCH (c:Tier1) RETURN c                            ; tier label shortcut
 *   MATCH (c:Concept) WHERE c.status = 'Normative' RETURN c
 *   MATCH (s)-[r:specialises]->(o) RETURN r
 *   MATCH (s)-[r]->(o) WHERE r.type = 'part_of' RETURN r
 *   ... ORDER BY c.semantic_id LIMIT n                  ; optional tail
 *
 * Supported SPARQL subset:
 *   SELECT ?s WHERE { ?s wsf:tier "Tier 1" . }
 *   SELECT ?s WHERE { ?s wsf:tier "Tier 1" . ?s wsf:status "Normative" . }
 *
 * Expressions outside these subsets raise QueryUnsupportedError with
 * guidance to use a native backend.
 */

import type { StoreLayer } from '../store/StoreLayer.js';
import type { Concept, Query, QueryResult } from '../types/index.js';

export class QueryUnsupportedError extends Error {
  constructor(expression: string, guidance: string) {
    super(`Query expression outside the portable subset: ${expression.slice(0, 80)}. ${guidance}`);
    this.name = 'QueryUnsupportedError';
  }
}

// ============================================================================
// SPARQL predicate map (wsf: properties → Concept fields)
// ============================================================================

const SPARQL_PREDICATE_MAP: Record<string, keyof Concept> = {
  'wsf:semantic_id': 'semantic_id',
  'wsf:preferred_name': 'preferred_name',
  'wsf:tier': 'tier',
  'wsf:definition': 'definition',
  'wsf:authority': 'authority',
  'wsf:status': 'status',
  'wsf:version': 'version',
  'wsf:parent': 'parent',
};

interface WhereCondition {
  variable: string;
  property: string;
  value: string;
}

interface ParsedCypher {
  nodeVar: string;
  nodeLabel?: string;
  edgeVar?: string;
  edgeType?: string;
  edgeDirection?: 'out' | 'in' | 'both';
  objectVar?: string;
  conditions: WhereCondition[];
  returnVar: string;
  orderBy?: { property: string; descending: boolean };
  limit?: number;
}

export class GraphQueryEngine {
  constructor(private store: StoreLayer) {}

  /**
   * Execute a graph query. Language is detected from the expression:
   * MATCH → Cypher subset; SELECT → SPARQL subset.
   */
  async execute<T = unknown>(query: Query): Promise<QueryResult<T>> {
    const start = Date.now();
    const expression = query.expression.trim();
    let matches: T[];

    if (/^MATCH\b/i.test(expression)) {
      matches = await this.executeCypher<T>(expression);
    } else if (/^SELECT\b/i.test(expression)) {
      matches = await this.executeSparql<T>(expression);
    } else {
      throw new QueryUnsupportedError(
        expression,
        "Portable graph queries MUST start with MATCH (Cypher) or SELECT (SPARQL).",
      );
    }

    return {
      matches,
      total_count: matches.length,
      execution_time_ms: Date.now() - start,
    };
  }

  // ==========================================================================
  // Cypher subset
  // ==========================================================================

  async executeCypher<T = unknown>(expression: string): Promise<T[]> {
    const parsed = this.parseCypher(expression);

    if (parsed.edgeVar !== undefined) {
      return this.executeCypherRelationship<T>(parsed);
    }
    return this.executeCypherNode<T>(parsed);
  }

  private parseCypher(expression: string): ParsedCypher {
    // Normalise whitespace
    const expr = expression.replace(/\s+/g, ' ').trim();

    // LIMIT
    let limit: number | undefined;
    const limitMatch = expr.match(/\bLIMIT\s+(\d+)\s*$/i);
    if (limitMatch) limit = parseInt(limitMatch[1], 10);
    const withoutLimit = expr.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();

    // ORDER BY (accepted, applied by property name if present)
    let orderBy: { property: string; descending: boolean } | undefined;
    const orderMatch = withoutLimit.match(/\bORDER\s+BY\s+([a-z]\w*\.[a-z_]+)\s*(ASC|DESC)?/i);
    if (orderMatch) orderBy = { property: orderMatch[1].split('.')[1], descending: (orderMatch[2] ?? 'ASC').toUpperCase() === 'DESC' };
    const withoutOrder = withoutLimit.replace(/\bORDER\s+BY\s+[a-z]\w*\.[a-z_]+\s*(ASC|DESC)?/i, '').trim();

    // RETURN
    const returnMatch = withoutOrder.match(/\bRETURN\s+([a-z]\w*)\s*$/i);
    if (!returnMatch) {
      throw new QueryUnsupportedError(expression, 'Cypher subset requires a simple RETURN <variable> clause.');
    }
    const returnVar = returnMatch[1];
    const matchWhere = withoutOrder.slice(0, returnMatch.index).trim();

    // WHERE conditions
    const whereMatch = matchWhere.match(/\bWHERE\s+(.+)$/i);
    const conditions: WhereCondition[] = [];
    let patternPart = matchWhere;
    if (whereMatch) {
      patternPart = matchWhere.slice(0, whereMatch.index).trim();
      const condText = whereMatch[1];
      for (const cond of condText.split(/\bAND\b/i)) {
        const cm = cond.trim().match(/^([a-z]\w*)\.([a-z_]+)\s*=\s*'([^']*)'$/i);
        if (!cm) {
          throw new QueryUnsupportedError(expression, "Cypher subset WHERE supports only <var>.<prop> = 'value' conditions joined by AND.");
        }
        conditions.push({ variable: cm[1], property: cm[2], value: cm[3] });
      }
    }

    // MATCH pattern
    const pattern = patternPart.replace(/^MATCH\s+/i, '').trim();

    // Relationship pattern: (a)-[r:TYPE]->(b) | (a)<-[r:TYPE]-(b) | (a)-[r]-(b)
    const relOut = pattern.match(/^\(([a-z]\w*)(?::([A-Za-z]\w*))?\)-\[([a-z]\w*)(?::([a-z_]+))?\]->\(([a-z]\w*)\)$/i);
    const relIn = pattern.match(/^\(([a-z]\w*)\)<-\[([a-z]\w*)(?::([a-z_]+))?\]-\(([a-z]\w*)(?::([A-Za-z]\w*))?\)$/i);
    const relAny = pattern.match(/^\(([a-z]\w*)\)-\[([a-z]\w*)(?::([a-z_]+))?\]-\(([a-z]\w*)\)$/i);

    if (relOut) {
      return {
        nodeVar: relOut[1], nodeLabel: relOut[2],
        edgeVar: relOut[3], edgeType: relOut[4], edgeDirection: 'out',
        objectVar: relOut[5], conditions, returnVar, orderBy, limit,
      };
    }
    if (relIn) {
      return {
        nodeVar: relIn[4], nodeLabel: relIn[5],
        edgeVar: relIn[2], edgeType: relIn[3], edgeDirection: 'in',
        objectVar: relIn[1], conditions, returnVar, orderBy, limit,
      };
    }
    if (relAny && !relAny[0].includes('<') && !relAny[0].includes('->')) {
      return {
        nodeVar: relAny[1],
        edgeVar: relAny[2], edgeType: relAny[3], edgeDirection: 'both',
        objectVar: relAny[4], conditions, returnVar, orderBy, limit,
      };
    }

    // Node-only pattern: (c:Label) | (c)
    const nodeMatch = pattern.match(/^\(([a-z]\w*)(?::([A-Za-z][\w]*))?\)$/i);
    if (nodeMatch) {
      return { nodeVar: nodeMatch[1], nodeLabel: nodeMatch[2], conditions, returnVar, orderBy, limit };
    }

    throw new QueryUnsupportedError(expression, 'Cypher subset supports (n:Label), (a)-[r:TYPE]->(b), (a)<-[r:TYPE]-(b), (a)-[r]-(b) patterns.');
  }

  private async executeCypherNode<T>(parsed: ParsedCypher): Promise<T[]> {
    // Label mapping: 'Concept' → all concepts; Tier1/Tier2/Tier3 → tier filter
    let tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | undefined;
    if (parsed.nodeLabel && /^Tier[123]$/.test(parsed.nodeLabel)) {
      tier = parsed.nodeLabel.replace('Tier', 'Tier ') as 'Tier 1' | 'Tier 2' | 'Tier 3';
    } else if (parsed.nodeLabel && parsed.nodeLabel !== 'Concept') {
      throw new QueryUnsupportedError(
        parsed.nodeLabel,
        "Node labels in the portable subset are 'Concept', 'Tier1', 'Tier2', 'Tier3'.",
      );
    }

    let concepts = await this.store.listConcepts(tier ? { tier } : undefined);

    for (const cond of parsed.conditions) {
      if (cond.variable !== parsed.nodeVar) continue;
      concepts = concepts.filter(c => String((c as unknown as Record<string, unknown>)[cond.property] ?? '') === cond.value);
    }

    if (parsed.orderBy) {
      const { property, descending } = parsed.orderBy;
      concepts = [...concepts].sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[property] ?? '');
        const bv = String((b as unknown as Record<string, unknown>)[property] ?? '');
        return descending ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }

    if (parsed.limit !== undefined) concepts = concepts.slice(0, parsed.limit);
    return concepts as T[];
  }

  private async executeCypherRelationship<T>(parsed: ParsedCypher): Promise<T[]> {
    let relationships = await this.store.findRelationships({
      type: parsed.edgeType,
    });

    for (const cond of parsed.conditions) {
      if (cond.variable === parsed.edgeVar) {
        relationships = relationships.filter(r => String((r as unknown as Record<string, unknown>)[cond.property] ?? '') === cond.value);
      } else if (cond.variable === parsed.nodeVar) {
        relationships = relationships.filter(r => {
          const v = (r as unknown as Record<string, unknown>)[cond.property];
          return String(r.subject ?? '') === cond.value || String(v ?? '') === cond.value;
        });
      } else if (cond.variable === parsed.objectVar) {
        relationships = relationships.filter(r => String(r.object ?? '') === cond.value);
      }
    }

    // Subject/object constraints from labels are not applied (labels refer to
    // node types; relationship endpoints carry CURIEs in the store model).
    let result: unknown[] = relationships;
    if (parsed.returnVar === parsed.nodeVar) {
      result = relationships.map(r => r.subject);
    } else if (parsed.returnVar === parsed.objectVar) {
      result = relationships.map(r => r.object);
    }

    if (parsed.limit !== undefined) result = result.slice(0, parsed.limit);
    return result as T[];
  }

  // ==========================================================================
  // SPARQL subset
  // ==========================================================================

  async executeSparql<T = unknown>(expression: string): Promise<T[]> {
    const expr = expression.replace(/\s+/g, ' ').trim();

    const selectMatch = expr.match(/^SELECT\s+(.+?)\s+WHERE\s*\{(.+)\}\s*$/i);
    if (!selectMatch) {
      throw new QueryUnsupportedError(expression, 'SPARQL subset requires SELECT <vars> WHERE { <triples> }.');
    }

    const body = selectMatch[2];
    // Triple patterns: ?s wsf:prop "value" . | ?s wsf:prop ?o .
    const tripleRx = /\?([a-z]\w*)\s+(wsf:[a-z_]+)\s+(?:"([^"]*)"|(\?[a-z]\w*))\s*\.?/gi;
    const triples: Array<{ subjectVar: string; predicate: string; objectValue?: string; objectVar?: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = tripleRx.exec(body)) !== null) {
      triples.push({ subjectVar: m[1], predicate: m[2], objectValue: m[3], objectVar: m[4] });
    }
    if (triples.length === 0) {
      throw new QueryUnsupportedError(expression, 'SPARQL subset requires at least one ?s wsf:property "value" triple pattern.');
    }

    // All equality triples on the same subject variable → concept filter
    let concepts = await this.store.listConcepts();
    for (const triple of triples) {
      const field = SPARQL_PREDICATE_MAP[triple.predicate];
      if (!field) {
        throw new QueryUnsupportedError(
          triple.predicate,
          `SPARQL subset predicates are: ${Object.keys(SPARQL_PREDICATE_MAP).join(', ')}.`,
        );
      }
      if (triple.objectValue !== undefined) {
        concepts = concepts.filter(c => String(c[field] ?? '') === triple.objectValue);
      }
      // Variable objects (?o) act as existence checks
      if (triple.objectVar !== undefined) {
        concepts = concepts.filter(c => c[field] !== undefined && c[field] !== null && String(c[field]) !== '');
      }
    }

    // Result bindings: one row per concept
    return concepts.map(c => {
      const row: Record<string, unknown> = {};
      for (const triple of triples) {
        row[triple.subjectVar] = c.semantic_id;
        const field = SPARQL_PREDICATE_MAP[triple.predicate];
        if (triple.objectVar) row[triple.objectVar.slice(1)] = c[field];
      }
      return row as T;
    });
  }
}
