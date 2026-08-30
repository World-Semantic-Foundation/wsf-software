/**
 * WSF Simulation Service
 *
 * Implements the simulation pattern of ADR-WSF-27 (Digital Twin and
 * Simulation Architecture) and Capability 6 (Realization) of CR-WSF-17
 * Rev.1 §15-§17:
 *
 *   Initial State → Event/Action → Transition → Resulting State → Next Event
 *
 * States are derived by event sourcing: the state of an entity at instant
 * T is the fold of every recorded event for that entity with
 * occurred_at <= T, applied in occurrence order.
 *
 * Persistence: the default event log is in-memory. The persistence seam
 * is the protected `persistEvent()` hook; production deployments attach
 * a StoreLayer-backed event collection (a dedicated 'events' collection
 * is the natural extension of the 7-collection model of ADR-WSF-24 §5.2).
 */

import type {
  CURIE,
  EngineResult,
  EntityState,
  SemanticEvent,
} from '../types/index.js';

export class SimulationService {
  /** In-memory event log, ordered by occurrence. */
  private events: SemanticEvent[] = [];

  /**
   * Record an event. Events are the atomic units of state change and
   * are immutable once recorded.
   */
  async recordEvent(event: SemanticEvent): Promise<EngineResult<SemanticEvent>> {
    if (this.events.some(e => e.semantic_id === event.semantic_id)) {
      return {
        success: false,
        error: { code: 'EVENT_DUPLICATE', message: `Event ${event.semantic_id} already recorded` },
      };
    }
    this.events.push(event);
    this.events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    await this.persistEvent(event);
    return { success: true, data: event };
  }

  /** Persistence seam: override or extend for durable storage. */
  protected async persistEvent(_event: SemanticEvent): Promise<void> {
    // In production: persist to the store backend's event collection.
  }

  /**
   * Derive the current state of an entity from its full event history.
   */
  async getCurrentState(entity: CURIE): Promise<EngineResult<EntityState>> {
    return this.getStateAt(entity, new Date().toISOString());
  }

  /**
   * Derive the state of an entity at a given instant (bitemporal as-of
   * state derivation): fold every event with occurred_at <= as_of.
   */
  async getStateAt(entity: CURIE, as_of: string): Promise<EngineResult<EntityState>> {
    const applicable = this.events
      .filter(e => e.subject === entity && e.occurred_at <= as_of)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

    const properties: Record<string, unknown> = {};
    const derived_from: CURIE[] = [];
    for (const event of applicable) {
      Object.assign(properties, event.changes);
      derived_from.push(event.semantic_id);
    }

    return {
      success: true,
      data: {
        entity,
        properties,
        captured_at: as_of,
        derived_from,
      },
    };
  }

  /**
   * The ordered event history of an entity.
   */
  async getHistory(entity: CURIE): Promise<EngineResult<SemanticEvent[]>> {
    const history = this.events
      .filter(e => e.subject === entity)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    return { success: true, data: history };
  }

  /**
   * Simulate prospective events against an entity's current state
   * without recording them: returns the hypothetical resulting state.
   *
   * This is the Transition step of the simulation pattern: Initial State
   * (derived) → Event/Action (prospective) → Resulting State (hypothetical).
   */
  async simulate(entity: CURIE, prospective: SemanticEvent[]): Promise<EngineResult<EntityState>> {
    const current = await this.getCurrentState(entity);
    if (!current.success || !current.data) return current;

    const ordered = [...prospective].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const properties = { ...current.data.properties };
    const derived_from = [...current.data.derived_from];
    for (const event of ordered) {
      Object.assign(properties, event.changes);
      derived_from.push(event.semantic_id);
    }

    return {
      success: true,
      data: {
        entity,
        properties,
        captured_at: ordered.length > 0
          ? ordered[ordered.length - 1].occurred_at
          : current.data.captured_at,
        derived_from,
      },
    };
  }
}
