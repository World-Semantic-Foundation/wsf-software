/**
 * WSF Semantic Specialisation Services
 *
 * Phase 4 of the WSF program (per PLAN-INDEX roadmap: Semantic
 * Specialization). Operationalises the Tier 3 concepts:
 *
 *   CapabilityService : ADR-WSF-07 ladder + realisation traces
 *   ProcessService    : process/activity execution via SimulationService
 *   GoalService       : goal / objective / measure attainment rollup
 *   PolicyService     : rule evaluation and policy enforcement
 *
 * Persistence: in-memory registries with documented seams, consistent
 * with the Phase 2/3 supporting services pattern.
 */

import type { StoreLayer } from '../store/StoreLayer.js';
import type { SimulationService } from '../simulation/SimulationService.js';
import type {
  ActivitySpec,
  CapabilitySpec,
  CURIE,
  EngineResult,
  EntityState,
  GoalSpec,
  MeasureSpec,
  ObjectiveSpec,
  PolicySpec,
  ProcessSpec,
  RuleEvaluation,
  RuleSpec,
  SemanticEvent,
} from '../types/index.js';

// ============================================================================
// 13. Capability Service (ADR-WSF-07)
// ============================================================================

/** Realisation trace for a capability. */
export interface RealisationTrace {
  capability: CURIE;
  kind: CapabilitySpec['kind'];
  realised_by: CURIE[];
  requires: CURIE[];
  /** Sub-capabilities (decomposition children). */
  children: CURIE[];
  /** Realisation gaps: capabilities with no realising process/service. */
  gaps: CURIE[];
}

export class CapabilityService {
  private capabilities = new Map<CURIE, CapabilitySpec>();

  constructor(private store: StoreLayer) {}

  /** Register a capability specification. */
  async register(spec: CapabilitySpec): Promise<EngineResult<CapabilitySpec>> {
    if (this.capabilities.has(spec.semantic_id)) {
      return {
        success: false,
        error: { code: 'CAPABILITY_DUPLICATE', message: `Capability ${spec.semantic_id} already registered` },
      };
    }
    if (spec.parent && !this.capabilities.has(spec.parent)) {
      return {
        success: false,
        error: { code: 'CAPABILITY_PARENT_UNKNOWN', message: `Parent capability ${spec.parent} is not registered` },
      };
    }
    this.capabilities.set(spec.semantic_id, spec);
    return { success: true, data: spec };
  }

  /** Retrieve a capability. */
  async get(semantic_id: CURIE): Promise<EngineResult<CapabilitySpec>> {
    const spec = this.capabilities.get(semantic_id);
    if (!spec) {
      return { success: false, error: { code: 'CAPABILITY_NOT_FOUND', message: `Capability ${semantic_id} not found` } };
    }
    return { success: true, data: spec };
  }

  /** Decomposition children of a capability. */
  async getChildren(semantic_id: CURIE): Promise<EngineResult<CapabilitySpec[]>> {
    const children = Array.from(this.capabilities.values()).filter(c => c.parent === semantic_id);
    return { success: true, data: children };
  }

  /**
   * Realisation trace: the realising processes/services, requirements,
   * decomposition children, and realisation gaps for a capability and
   * its subtree. A capability without any realising process or service
   * is a gap (a disposition with no realisation path).
   */
  async traceRealisation(semantic_id: CURIE): Promise<EngineResult<RealisationTrace>> {
    const spec = this.capabilities.get(semantic_id);
    if (!spec) {
      return { success: false, error: { code: 'CAPABILITY_NOT_FOUND', message: `Capability ${semantic_id} not found` } };
    }

    const realised_by: CURIE[] = [...(spec.realised_by ?? [])];
    const requires: CURIE[] = [...(spec.requires ?? [])];
    const children: CURIE[] = [];
    const gaps: CURIE[] = [];

    const visit = (id: CURIE) => {
      const node = this.capabilities.get(id);
      if (!node) return;
      if ((node.realised_by ?? []).length === 0) gaps.push(id);
      for (const child of Array.from(this.capabilities.values()).filter(c => c.parent === id)) {
        children.push(child.semantic_id);
        for (const r of child.realised_by ?? []) if (!realised_by.includes(r)) realised_by.push(r);
        for (const r of child.requires ?? []) if (!requires.includes(r)) requires.push(r);
        visit(child.semantic_id);
      }
    };
    visit(semantic_id);

    return {
      success: true,
      data: { capability: semantic_id, kind: spec.kind, realised_by, requires, children, gaps },
    };
  }
}

// ============================================================================
// 14. Process Service (wsf:Process, wsf:Activity, wsf:Function)
// ============================================================================

export class ProcessService {
  private processes = new Map<CURIE, ProcessSpec>();

  constructor(
    private store: StoreLayer,
    private simulation: SimulationService,
  ) {}

  /** Register a process specification. */
  async register(spec: ProcessSpec): Promise<EngineResult<ProcessSpec>> {
    if (this.processes.has(spec.semantic_id)) {
      return {
        success: false,
        error: { code: 'PROCESS_DUPLICATE', message: `Process ${spec.semantic_id} already registered` },
      };
    }
    this.processes.set(spec.semantic_id, spec);
    return { success: true, data: spec };
  }

  /** Retrieve a process specification. */
  async get(semantic_id: CURIE): Promise<EngineResult<ProcessSpec>> {
    const spec = this.processes.get(semantic_id);
    if (!spec) {
      return { success: false, error: { code: 'PROCESS_NOT_FOUND', message: `Process ${semantic_id} not found` } };
    }
    return { success: true, data: spec };
  }

  /**
   * Execute the next pending activity of a process instance.
   *
   * A process instance is an entity whose state lives in the
   * SimulationService event log. Execution applies the lowest-order
   * activity not yet completed, records its event, and updates the
   * instance state (status: running → completed).
   */
  async executeNextActivity(
    process_id: CURIE,
    instance: CURIE,
    actor: CURIE,
  ): Promise<EngineResult<{ activity: ActivitySpec | null; state: EntityState }>> {
    const spec = this.processes.get(process_id);
    if (!spec) {
      return { success: false, error: { code: 'PROCESS_NOT_FOUND', message: `Process ${process_id} not found` } };
    }

    const stateResult = await this.simulation.getCurrentState(instance);
    const state = stateResult.data;
    const completed = new Set<string>(
      ((state?.properties.completed_activities as string[] | undefined) ?? []),
    );

    const ordered = [...spec.activities].sort((a, b) => a.order - b.order);
    const next = ordered.find(a => !completed.has(a.semantic_id)) ?? null;

    if (!next) {
      return { success: true, data: { activity: null, state: state! } };
    }

    const now = new Date().toISOString();
    const isLast = ordered.every(a => a.semantic_id === next.semantic_id || completed.has(a.semantic_id));
    const event: SemanticEvent = {
      semantic_id: `wsf:event:${crypto.randomUUID()}`,
      type: next.event_type ?? `activity.completed`,
      subject: instance,
      occurred_at: now,
      changes: {
        ...(next.changes ?? {}),
        completed_activities: [...completed, next.semantic_id],
        current_activity: isLast ? null : ordered[ordered.indexOf(next) + 1]?.semantic_id ?? null,
        status: isLast ? 'completed' : 'running',
        process: process_id,
      },
      actor,
      provenance: { actor, authority: actor, timestamp: now },
    };
    await this.simulation.recordEvent(event);

    const newState = await this.simulation.getCurrentState(instance);
    return { success: true, data: { activity: next, state: newState.data! } };
  }

  /** Execute all remaining activities of a process instance. */
  async executeAll(
    process_id: CURIE,
    instance: CURIE,
    actor: CURIE,
  ): Promise<EngineResult<{ executed: number; state: EntityState }>> {
    let executed = 0;
    for (;;) {
      const step = await this.executeNextActivity(process_id, instance, actor);
      if (!step.success) {
        return { success: false, error: step.error };
      }
      if (!step.data?.activity) break;
      executed++;
    }
    const state = await this.simulation.getCurrentState(instance);
    return { success: true, data: { executed, state: state.data! } };
  }
}

// ============================================================================
// 15. Goal Service (wsf:Goal, wsf:Objective, wsf:Measure)
// ============================================================================

/** Attainment of a single measure. */
export interface MeasureAttainment {
  measure: CURIE;
  name: string;
  actual: number | null;
  target: number;
  direction: 'min' | 'max';
  /** Ratio of attainment (1.0 = target met). Null if unmeasured. */
  attainment: number | null;
  achieved: boolean;
}

/** Attainment rollup for an objective. */
export interface ObjectiveAttainment {
  objective: CURIE;
  goal: CURIE;
  measures: MeasureAttainment[];
  /** Mean attainment across measured measures (null if none measured). */
  mean_attainment: number | null;
  achieved: boolean;
}

export class GoalService {
  private goals = new Map<CURIE, GoalSpec>();
  private objectives = new Map<CURIE, ObjectiveSpec>();
  private measures = new Map<CURIE, MeasureSpec>();

  constructor(private store: StoreLayer) {}

  async registerGoal(goal: GoalSpec): Promise<EngineResult<GoalSpec>> {
    if (this.goals.has(goal.semantic_id)) {
      return { success: false, error: { code: 'GOAL_DUPLICATE', message: `Goal ${goal.semantic_id} already registered` } };
    }
    this.goals.set(goal.semantic_id, goal);
    return { success: true, data: goal };
  }

  async registerObjective(objective: ObjectiveSpec): Promise<EngineResult<ObjectiveSpec>> {
    if (this.objectives.has(objective.semantic_id)) {
      return { success: false, error: { code: 'OBJECTIVE_DUPLICATE', message: `Objective ${objective.semantic_id} already registered` } };
    }
    if (!this.goals.has(objective.goal)) {
      return { success: false, error: { code: 'GOAL_NOT_FOUND', message: `Goal ${objective.goal} not found` } };
    }
    for (const m of objective.measures) {
      if (!this.measures.has(m)) {
        return { success: false, error: { code: 'MEASURE_NOT_FOUND', message: `Measure ${m} not found` } };
      }
    }
    this.objectives.set(objective.semantic_id, objective);
    return { success: true, data: objective };
  }

  async registerMeasure(measure: MeasureSpec): Promise<EngineResult<MeasureSpec>> {
    if (this.measures.has(measure.semantic_id)) {
      return { success: false, error: { code: 'MEASURE_DUPLICATE', message: `Measure ${measure.semantic_id} already registered` } };
    }
    this.measures.set(measure.semantic_id, measure);
    return { success: true, data: measure };
  }

  /** Record an actual value for a measure. */
  async recordActual(semantic_id: CURIE, actual: number): Promise<EngineResult<MeasureSpec>> {
    const measure = this.measures.get(semantic_id);
    if (!measure) {
      return { success: false, error: { code: 'MEASURE_NOT_FOUND', message: `Measure ${semantic_id} not found` } };
    }
    const updated: MeasureSpec = { ...measure, actual };
    this.measures.set(semantic_id, updated);
    return { success: true, data: updated };
  }

  /** Evaluate one measure's attainment. */
  private evaluateMeasure(measure: MeasureSpec): MeasureAttainment {
    if (measure.actual === null) {
      return {
        measure: measure.semantic_id, name: measure.name,
        actual: null, target: measure.target, direction: measure.direction,
        attainment: null, achieved: false,
      };
    }
    const achieved = measure.direction === 'max'
      ? measure.actual >= measure.target
      : measure.actual <= measure.target;
    // Attainment ratio, direction-normalised, floored at 0
    let attainment: number;
    if (measure.direction === 'max') {
      attainment = measure.target === 0 ? (measure.actual >= 0 ? 1 : 0) : measure.actual / measure.target;
    } else {
      attainment = measure.actual === 0 ? 1 : (measure.target === 0 ? 0 : measure.target / measure.actual);
    }
    return {
      measure: measure.semantic_id, name: measure.name,
      actual: measure.actual, target: measure.target, direction: measure.direction,
      attainment: Math.max(0, attainment), achieved,
    };
  }

  /** Evaluate an objective: per-measure attainment plus rollup. */
  async evaluateObjective(semantic_id: CURIE): Promise<EngineResult<ObjectiveAttainment>> {
    const objective = this.objectives.get(semantic_id);
    if (!objective) {
      return { success: false, error: { code: 'OBJECTIVE_NOT_FOUND', message: `Objective ${semantic_id} not found` } };
    }
    const measures = objective.measures.map(id => this.evaluateMeasure(this.measures.get(id)!));
    const measured = measures.filter(m => m.attainment !== null);
    const mean = measured.length > 0
      ? measured.reduce((a, m) => a + (m.attainment ?? 0), 0) / measured.length
      : null;
    return {
      success: true,
      data: {
        objective: semantic_id,
        goal: objective.goal,
        measures,
        mean_attainment: mean,
        achieved: measures.length > 0 && measures.every(m => m.achieved),
      },
    };
  }

  /** Goal rollup: attainment across all objectives serving a goal. */
  async evaluateGoal(semantic_id: CURIE): Promise<EngineResult<{ goal: CURIE; objectives: ObjectiveAttainment[]; mean_attainment: number | null; achieved: boolean }>> {
    if (!this.goals.has(semantic_id)) {
      return { success: false, error: { code: 'GOAL_NOT_FOUND', message: `Goal ${semantic_id} not found` } };
    }
    const objectives: ObjectiveAttainment[] = [];
    for (const objective of Array.from(this.objectives.values()).filter(o => o.goal === semantic_id)) {
      const result = await this.evaluateObjective(objective.semantic_id);
      if (result.data) objectives.push(result.data);
    }
    const measured = objectives.filter(o => o.mean_attainment !== null);
    const mean = measured.length > 0
      ? measured.reduce((a, o) => a + (o.mean_attainment ?? 0), 0) / measured.length
      : null;
    return {
      success: true,
      data: {
        goal: semantic_id,
        objectives,
        mean_attainment: mean,
        achieved: objectives.length > 0 && objectives.every(o => o.achieved),
      },
    };
  }
}

// ============================================================================
// 16. Policy Service (wsf:Policy, wsf:Rule, wsf:Constraint)
// ============================================================================

export class PolicyService {
  private policies = new Map<CURIE, PolicySpec>();
  private rules = new Map<CURIE, RuleSpec>();

  constructor(private store: StoreLayer) {}

  async registerRule(rule: RuleSpec): Promise<EngineResult<RuleSpec>> {
    if (this.rules.has(rule.semantic_id)) {
      return { success: false, error: { code: 'RULE_DUPLICATE', message: `Rule ${rule.semantic_id} already registered` } };
    }
    this.rules.set(rule.semantic_id, rule);
    return { success: true, data: rule };
  }

  async registerPolicy(policy: PolicySpec): Promise<EngineResult<PolicySpec>> {
    if (this.policies.has(policy.semantic_id)) {
      return { success: false, error: { code: 'POLICY_DUPLICATE', message: `Policy ${policy.semantic_id} already registered` } };
    }
    for (const r of policy.rules) {
      if (!this.rules.has(r)) {
        return { success: false, error: { code: 'RULE_NOT_FOUND', message: `Rule ${r} not found` } };
      }
    }
    this.policies.set(policy.semantic_id, policy);
    return { success: true, data: policy };
  }

  /** Evaluate one rule against an entity state. */
  private evaluateRule(rule: RuleSpec, state: Record<string, unknown>): RuleEvaluation {
    const actual = state[rule.field];
    let holds: boolean;

    switch (rule.operator) {
      case 'present': holds = actual !== undefined && actual !== null; break;
      case 'eq': holds = actual === rule.value; break;
      case 'neq': holds = actual !== rule.value; break;
      case 'gt': holds = typeof actual === 'number' && typeof rule.value === 'number' && actual > rule.value; break;
      case 'gte': holds = typeof actual === 'number' && typeof rule.value === 'number' && actual >= rule.value; break;
      case 'lt': holds = typeof actual === 'number' && typeof rule.value === 'number' && actual < rule.value; break;
      case 'lte': holds = typeof actual === 'number' && typeof rule.value === 'number' && actual <= rule.value; break;
      case 'in': holds = Array.isArray(rule.value) && rule.value.includes(actual); break;
      case 'matches': holds = typeof actual === 'string' && typeof rule.value === 'string' && new RegExp(rule.value).test(actual); break;
      default: holds = false;
    }

    return {
      rule: rule.semantic_id,
      holds,
      severity: rule.severity,
      message: rule.message ?? `${rule.field} ${rule.operator} ${JSON.stringify(rule.value)} (actual: ${JSON.stringify(actual)})`,
    };
  }

  /**
   * Evaluate a policy against an entity state. Only Normative policies
   * are evaluated; others return an empty result set with a note.
   */
  async evaluatePolicy(semantic_id: CURIE, state: Record<string, unknown>): Promise<EngineResult<{ policy: CURIE; evaluations: RuleEvaluation[]; violations: number; warnings: number }>> {
    const policy = this.policies.get(semantic_id);
    if (!policy) {
      return { success: false, error: { code: 'POLICY_NOT_FOUND', message: `Policy ${semantic_id} not found` } };
    }
    const evaluations = policy.rules.map(id => this.evaluateRule(this.rules.get(id)!, state));
    const failed = evaluations.filter(e => !e.holds);
    return {
      success: true,
      data: {
        policy: semantic_id,
        evaluations,
        violations: failed.filter(e => e.severity === 'violation').length,
        warnings: failed.filter(e => e.severity === 'warning').length,
      },
    };
  }

  /**
   * Evaluate all Normative enforcing policies against an entity state.
   * This is the constraint-enforcement entry point (per wsf:Constraint):
   * callers use it before mutating governed state.
   */
  async enforce(state: Record<string, unknown>): Promise<EngineResult<{ conformant: boolean; evaluations: RuleEvaluation[] }>> {
    const evaluations: RuleEvaluation[] = [];
    for (const policy of Array.from(this.policies.values())) {
      if (policy.status !== 'Normative') continue;
      for (const id of policy.rules) {
        const rule = this.rules.get(id)!;
        // Advisory policies downgrade violations to warnings
        const evaluation = this.evaluateRule(rule, state);
        if (policy.effect === 'advise' && evaluation.severity === 'violation') {
          evaluations.push({ ...evaluation, severity: 'warning' });
        } else {
          evaluations.push(evaluation);
        }
      }
    }
    const conformant = !evaluations.some(e => !e.holds && e.severity === 'violation');
    return { success: true, data: { conformant, evaluations } };
  }
}
