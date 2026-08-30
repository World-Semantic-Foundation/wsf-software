/**
 * WSF Semantic Engine : Phase 4 Tests
 *
 * Tests for the operationalized Semantic Specialisation (Tier 3):
 *   Track A : CapabilityService (ADR-WSF-07 ladder + realisation traces)
 *   Track B : ProcessService (activity execution via SimulationService)
 *   Track C : GoalService (attainment rollup)
 *   Track D : PolicyService (rule enforcement)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEngine } from '../src/index.js';
import type { CapabilitySpec, ProcessSpec, GoalSpec, ObjectiveSpec, MeasureSpec, RuleSpec, PolicySpec } from '../src/types/index.js';

const PROV = { actor: 'wsf:TestActor', authority: 'wsf:WSF', timestamp: new Date().toISOString() };

// ============================================================================
// Track A : Capability
// ============================================================================

function makeCapability(id: string, parent?: string, realised_by?: string[]): CapabilitySpec {
  return {
    semantic_id: `wsf:cap:${id}`,
    name: id,
    kind: 'capability',
    parent,
    realised_by,
    definition: `Capability ${id}`,
    provenance: PROV,
  };
}

describe('CapabilityService', () => {
  test('registers a decomposition tree and rejects unknown parents', async () => {
    const engine = new SemanticEngine();
    assert.equal((await engine.services.capability.register(makeCapability('OrderManagement'))).success, true);
    const orphan = makeCapability('Orphan', 'wsf:cap:Missing');
    assert.equal((await engine.services.capability.register(orphan)).error?.code, 'CAPABILITY_PARENT_UNKNOWN');
    assert.equal((await engine.services.capability.register(makeCapability('OrderCapture', 'wsf:cap:OrderManagement'))).success, true);
  });

  test('traceRealisation aggregates subtree and reports gaps', async () => {
    const engine = new SemanticEngine();
    await engine.services.capability.register(makeCapability('OrderManagement', undefined, ['wsf:proc:OrderToCash']));
    await engine.services.capability.register(makeCapability('OrderCapture', 'wsf:cap:OrderManagement', ['wsf:proc:Capture']));
    await engine.services.capability.register(makeCapability('OrderFulfilment', 'wsf:cap:OrderManagement'));

    const trace = await engine.services.capability.traceRealisation('wsf:cap:OrderManagement');
    assert.equal(trace.success, true);
    assert.deepEqual(trace.data?.children.sort(), ['wsf:cap:OrderCapture', 'wsf:cap:OrderFulfilment']);
    assert.ok(trace.data?.realised_by.includes('wsf:proc:OrderToCash'));
    assert.ok(trace.data?.realised_by.includes('wsf:proc:Capture'));
    assert.deepEqual(trace.data?.gaps, ['wsf:cap:OrderFulfilment']);
  });

  test('capability with no realisation is itself a gap', async () => {
    const engine = new SemanticEngine();
    await engine.services.capability.register(makeCapability('Unrealised'));
    const trace = await engine.services.capability.traceRealisation('wsf:cap:Unrealised');
    assert.deepEqual(trace.data?.gaps, ['wsf:cap:Unrealised']);
  });
});

// ============================================================================
// Track B : Process
// ============================================================================

const ORDER_PROCESS: ProcessSpec = {
  semantic_id: 'wsf:proc:OrderToCash',
  name: 'Order to Cash',
  activities: [
    { semantic_id: 'wsf:act:capture', name: 'Capture Order', order: 1, event_type: 'order.captured', changes: { captured: true } },
    { semantic_id: 'wsf:act:fulfil', name: 'Fulfil Order', order: 2, event_type: 'order.fulfilled', changes: { fulfilled: true } },
    { semantic_id: 'wsf:act:invoice', name: 'Invoice Order', order: 3, event_type: 'order.invoiced', changes: { invoiced: true } },
  ],
  inputs: ['order'],
  outputs: ['invoice'],
  provenance: PROV,
};

describe('ProcessService', () => {
  test('executes activities in order, tracking instance state', async () => {
    const engine = new SemanticEngine();
    await engine.services.process.register(ORDER_PROCESS);

    const step1 = await engine.services.process.executeNextActivity('wsf:proc:OrderToCash', 'ex:Order1', 'wsf:TestActor');
    assert.equal(step1.data?.activity?.semantic_id, 'wsf:act:capture');
    assert.equal(step1.data?.state.properties.status, 'running');
    assert.equal(step1.data?.state.properties.captured, true);

    const step2 = await engine.services.process.executeNextActivity('wsf:proc:OrderToCash', 'ex:Order1', 'wsf:TestActor');
    assert.equal(step2.data?.activity?.semantic_id, 'wsf:act:fulfil');

    const step3 = await engine.services.process.executeNextActivity('wsf:proc:OrderToCash', 'ex:Order1', 'wsf:TestActor');
    assert.equal(step3.data?.state.properties.status, 'completed');

    const step4 = await engine.services.process.executeNextActivity('wsf:proc:OrderToCash', 'ex:Order1', 'wsf:TestActor');
    assert.equal(step4.data?.activity, null);
  });

  test('executeAll runs the remaining sequence', async () => {
    const engine = new SemanticEngine();
    await engine.services.process.register(ORDER_PROCESS);
    const result = await engine.services.process.executeAll('wsf:proc:OrderToCash', 'ex:Order2', 'wsf:TestActor');
    assert.equal(result.data?.executed, 3);
    assert.equal(result.data?.state.properties.status, 'completed');
    assert.equal(result.data?.state.properties.invoiced, true);
  });

  test('instance history is preserved in the event log', async () => {
    const engine = new SemanticEngine();
    await engine.services.process.register(ORDER_PROCESS);
    await engine.services.process.executeAll('wsf:proc:OrderToCash', 'ex:Order3', 'wsf:TestActor');
    const history = await engine.services.simulation.getHistory('ex:Order3');
    assert.equal(history.data?.length, 3);
    assert.equal(history.data?.[0].type, 'order.captured');
    assert.equal(history.data?.[2].type, 'order.invoiced');
  });
});

// ============================================================================
// Track C : Goal / Objective / Measure
// ============================================================================

describe('GoalService', () => {
  test('full chain: goal ← objective ← measures with attainment rollup', async () => {
    const engine = new SemanticEngine();
    const goal: GoalSpec = { semantic_id: 'wsf:goal:Growth', name: 'Growth', provenance: PROV };
    await engine.services.goal.registerGoal(goal);

    const m1: MeasureSpec = { semantic_id: 'wsf:measure:Orders', name: 'Orders/day', target: 100, direction: 'max', actual: null, provenance: PROV };
    const m2: MeasureSpec = { semantic_id: 'wsf:measure:Defects', name: 'Defect rate', target: 2, direction: 'min', actual: null, provenance: PROV };
    await engine.services.goal.registerMeasure(m1);
    await engine.services.goal.registerMeasure(m2);

    const objective: ObjectiveSpec = { semantic_id: 'wsf:obj:Q3', name: 'Q3 targets', goal: 'wsf:goal:Growth', measures: ['wsf:measure:Orders', 'wsf:measure:Defects'], provenance: PROV };
    assert.equal((await engine.services.goal.registerObjective(objective)).success, true);

    await engine.services.goal.recordActual('wsf:measure:Orders', 120);
    await engine.services.goal.recordActual('wsf:measure:Defects', 1.5);

    const objResult = await engine.services.goal.evaluateObjective('wsf:obj:Q3');
    assert.equal(objResult.data?.achieved, true);
    assert.equal(objResult.data?.measures.length, 2);
    assert.ok((objResult.data?.mean_attainment ?? 0) >= 1);

    const goalResult = await engine.services.goal.evaluateGoal('wsf:goal:Growth');
    assert.equal(goalResult.data?.achieved, true);
  });

  test('unmeasured measures report null attainment and not achieved', async () => {
    const engine = new SemanticEngine();
    await engine.services.goal.registerGoal({ semantic_id: 'wsf:goal:G2', name: 'G2', provenance: PROV });
    await engine.services.goal.registerMeasure({ semantic_id: 'wsf:measure:M2', name: 'M2', target: 10, direction: 'max', actual: null, provenance: PROV });
    await engine.services.goal.registerObjective({ semantic_id: 'wsf:obj:O2', name: 'O2', goal: 'wsf:goal:G2', measures: ['wsf:measure:M2'], provenance: PROV });

    const result = await engine.services.goal.evaluateObjective('wsf:obj:O2');
    assert.equal(result.data?.mean_attainment, null);
    assert.equal(result.data?.achieved, false);
  });

  test('objective registration requires known goal and measures', async () => {
    const engine = new SemanticEngine();
    const bad = await engine.services.goal.registerObjective({ semantic_id: 'wsf:obj:X', name: 'X', goal: 'wsf:goal:Ghost', measures: [], provenance: PROV });
    assert.equal(bad.error?.code, 'GOAL_NOT_FOUND');
  });

  test('min-direction attainment computed correctly', async () => {
    const engine = new SemanticEngine();
    await engine.services.goal.registerMeasure({ semantic_id: 'wsf:measure:Cost', name: 'Cost', target: 50, direction: 'min', actual: null, provenance: PROV });
    await engine.services.goal.recordActual('wsf:measure:Cost', 100);
    const goal: GoalSpec = { semantic_id: 'wsf:goal:Eff', name: 'Eff', provenance: PROV };
    await engine.services.goal.registerGoal(goal);
    await engine.services.goal.registerObjective({ semantic_id: 'wsf:obj:Eff', name: 'Eff', goal: 'wsf:goal:Eff', measures: ['wsf:measure:Cost'], provenance: PROV });
    const result = await engine.services.goal.evaluateObjective('wsf:obj:Eff');
    assert.equal(result.data?.measures[0].attainment, 0.5);
    assert.equal(result.data?.measures[0].achieved, false);
  });
});

// ============================================================================
// Track D : Policy / Rule / Constraint
// ============================================================================

describe('PolicyService', () => {
  async function seeded() {
    const engine = new SemanticEngine();
    const r1: RuleSpec = { semantic_id: 'wsf:rule:TotalPositive', name: 'Total positive', field: 'total', operator: 'gt', value: 0, severity: 'violation', provenance: PROV };
    const r2: RuleSpec = { semantic_id: 'wsf:rule:OwnerPresent', name: 'Owner present', field: 'owner', operator: 'present', severity: 'violation', provenance: PROV };
    const r3: RuleSpec = { semantic_id: 'wsf:rule:RegionKnown', name: 'Region known', field: 'region', operator: 'in', value: ['EMEA', 'AMER', 'APAC'], severity: 'warning', provenance: PROV };
    await engine.services.policy.registerRule(r1);
    await engine.services.policy.registerRule(r2);
    await engine.services.policy.registerRule(r3);
    const policy: PolicySpec = { semantic_id: 'wsf:policy:OrderRules', name: 'Order rules', rules: ['wsf:rule:TotalPositive', 'wsf:rule:OwnerPresent', 'wsf:rule:RegionKnown'], effect: 'enforce', status: 'Normative', provenance: PROV };
    await engine.services.policy.registerPolicy(policy);
    return engine;
  }

  test('conformant state passes enforcement', async () => {
    const engine = await seeded();
    const result = await engine.services.policy.enforce({ total: 100, owner: 'ex:Alice', region: 'EMEA' });
    assert.equal(result.data?.conformant, true);
  });

  test('violations and warnings detected', async () => {
    const engine = await seeded();
    const result = await engine.services.policy.evaluatePolicy('wsf:policy:OrderRules', { total: -5, region: 'LUNAR' });
    assert.equal(result.data?.violations, 2);   // total + owner missing
    assert.equal(result.data?.warnings, 1);     // region unknown
    assert.equal(result.data?.evaluations.length, 3);
  });

  test('enforce blocks non-conformant state', async () => {
    const engine = await seeded();
    const result = await engine.services.policy.enforce({ total: 0 });
    assert.equal(result.data?.conformant, false);
  });

  test('advisory policies downgrade violations to warnings', async () => {
    const engine = new SemanticEngine();
    await engine.services.policy.registerRule({ semantic_id: 'wsf:rule:Soft', name: 'Soft', field: 'x', operator: 'present', severity: 'violation', provenance: PROV });
    await engine.services.policy.registerPolicy({ semantic_id: 'wsf:policy:Advisory', name: 'Advisory', rules: ['wsf:rule:Soft'], effect: 'advise', status: 'Normative', provenance: PROV });
    const result = await engine.services.policy.enforce({});
    assert.equal(result.data?.conformant, true);
    assert.equal(result.data?.evaluations[0].severity, 'warning');
  });

  test('non-Normative policies are not enforced', async () => {
    const engine = new SemanticEngine();
    await engine.services.policy.registerRule({ semantic_id: 'wsf:rule:Draft', name: 'Draft', field: 'x', operator: 'present', severity: 'violation', provenance: PROV });
    await engine.services.policy.registerPolicy({ semantic_id: 'wsf:policy:Draft', name: 'Draft', rules: ['wsf:rule:Draft'], effect: 'enforce', status: 'Proposed', provenance: PROV });
    const result = await engine.services.policy.enforce({});
    assert.equal(result.data?.conformant, true);
    assert.equal(result.data?.evaluations.length, 0);
  });

  test('matches operator applies regex', async () => {
    const engine = new SemanticEngine();
    await engine.services.policy.registerRule({ semantic_id: 'wsf:rule:Curie', name: 'CURIE', field: 'id', operator: 'matches', value: '^[a-z]+:[A-Z]', severity: 'violation', provenance: PROV });
    await engine.services.policy.registerPolicy({ semantic_id: 'wsf:policy:Ids', name: 'Ids', rules: ['wsf:rule:Curie'], effect: 'enforce', status: 'Normative', provenance: PROV });
    assert.equal((await engine.services.policy.enforce({ id: 'wsf:Entity' })).data?.conformant, true);
    assert.equal((await engine.services.policy.enforce({ id: 'not-a-curie' })).data?.conformant, false);
  });
});
