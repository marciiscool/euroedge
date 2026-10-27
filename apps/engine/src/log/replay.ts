import { apply } from '../core/apply.ts';
import type { EngineEvent } from '../core/events.ts';
import { createState, type EngineState } from '../core/state.ts';

/** Rebuilds state from genesis by re-applying logged inputs (outputs are discarded). */
export function replay(
  events: Iterable<EngineEvent>,
  state: EngineState = createState(),
): EngineState {
  for (const e of events) apply(state, e);
  return state;
}
