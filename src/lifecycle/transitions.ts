/**
 * WSF Lifecycle State Machines
 *
 * Implements the lifecycle semantics of the Semantic Status Model
 * (per ADR-WSF-16, Semantic Evolution and Versioning) and the assertion
 * lifecycle of ADR-WSF-22 (Assertion and Provenance Model).
 *
 * Both state machines are executable: services call assertTransition()
 * before mutating status/lifecycle fields, guaranteeing that only legal
 * transitions occur and that every transition is auditable.
 */

import type { SemanticStatus, AssertionLifecycle } from '../types/index.js';

// ============================================================================
// Concept Semantic Status State Machine (6 stages)
// ============================================================================

/**
 * Legal concept status transitions.
 *
 * Forward path:  Candidate → Investigating → Proposed → Normative
 * Rework paths:  Investigating → Candidate ; Proposed → Investigating
 * Sunset path:   Normative → Deprecated → Retired
 * Reinstatement: Deprecated → Normative
 * Terminal:      Retired (no outbound transitions)
 * Withdrawal:    any pre-Normative stage → Retired
 */
export const SEMANTIC_STATUS_TRANSITIONS: Record<SemanticStatus, SemanticStatus[]> = {
  Candidate: ['Investigating', 'Retired'],
  Investigating: ['Proposed', 'Candidate', 'Retired'],
  Proposed: ['Normative', 'Investigating', 'Retired'],
  Normative: ['Deprecated'],
  Deprecated: ['Retired', 'Normative'],
  Retired: [],
};

// ============================================================================
// Assertion Lifecycle State Machine (6 states)
// ============================================================================

/**
 * Legal assertion lifecycle transitions.
 *
 * Review path:   submitted → under_review → accepted | rejected
 * Dispute path:  accepted → disputed → accepted | rejected | retired
 * Sunset:        accepted | rejected | disputed → retired
 * Terminal:      retired (no outbound transitions)
 */
export const ASSERTION_LIFECYCLE_TRANSITIONS: Record<AssertionLifecycle, AssertionLifecycle[]> = {
  submitted: ['under_review', 'retired'],
  under_review: ['accepted', 'rejected'],
  accepted: ['disputed', 'retired'],
  rejected: ['retired'],
  disputed: ['accepted', 'rejected', 'retired'],
  retired: [],
};

// ============================================================================
// Guard
// ============================================================================

export class IllegalTransitionError extends Error {
  constructor(
    public readonly kind: string,
    public readonly from: string,
    public readonly to: string,
    public readonly legal: string[],
  ) {
    super(
      `Illegal ${kind} transition: '${from}' → '${to}'. ` +
      (legal.length > 0 ? `Legal targets from '${from}': ${legal.join(', ')}.` : `'${from}' is terminal.`),
    );
    this.name = 'IllegalTransitionError';
  }
}

/**
 * Assert that a transition is legal within a state machine.
 * Throws IllegalTransitionError otherwise.
 */
export function assertTransition<S extends string>(
  kind: string,
  machine: Record<S, S[]>,
  from: S,
  to: S,
): void {
  const legal = machine[from] ?? [];
  if (!legal.includes(to)) {
    throw new IllegalTransitionError(kind, from, to, legal);
  }
}

/** List the legal targets from a state. */
export function legalTransitions<S extends string>(machine: Record<S, S[]>, from: S): S[] {
  return machine[from] ?? [];
}
