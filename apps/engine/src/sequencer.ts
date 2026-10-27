import { apply } from './core/apply.ts';
import type { EngineEvent, EngineInput } from './core/events.ts';
import type { EngineOutput } from './core/outputs.ts';
import type { EngineState } from './core/state.ts';
import { EVENT_VERSIONS, inputSchema } from './log/codec.ts';

export interface AppendLog {
  append(events: readonly EngineEvent[], cursor?: string): Promise<void>;
}

export interface StreamMessage {
  readonly id: string;
  /** Canonical JSON of an EngineInput (bigints as decimal strings). */
  readonly payload: string;
}

export interface BatchResult {
  readonly events: readonly EngineEvent[];
  readonly outputs: readonly { readonly seq: bigint; readonly output: EngineOutput }[];
  readonly skipped: readonly { readonly id: string; readonly error: string }[];
}

export class FatalEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FatalEngineError';
  }
}

/**
 * The sequencer (ADR-0001): the only component that reads the wall clock. It stamps each
 * input, applies it to the core, group-commits the events (with the stream cursor) and only
 * then lets the caller publish outputs. Any apply/append failure is fatal: the in-memory
 * state may be ahead of the log, so the process must exit and rebuild from the log.
 */
export class Sequencer {
  private readonly state: EngineState;
  private readonly log: AppendLog;
  private readonly now: () => number;
  private failed: Error | undefined;

  constructor(state: EngineState, log: AppendLog, now: () => number = Date.now) {
    this.state = state;
    this.log = log;
    this.now = now;
  }

  get healthy(): boolean {
    return this.failed === undefined;
  }

  /** Parses stream messages (invalid ones are skipped, never applied) and processes them. */
  async processMessages(messages: readonly StreamMessage[]): Promise<BatchResult> {
    const inputs: EngineInput[] = [];
    const skipped: { id: string; error: string }[] = [];
    for (const m of messages) {
      try {
        inputs.push(inputSchema.parse(JSON.parse(m.payload)) as EngineInput);
      } catch (err) {
        skipped.push({
          id: m.id,
          error: err instanceof Error ? err.message.slice(0, 200) : 'invalid',
        });
      }
    }
    const result = await this.processInputs(inputs, messages.at(-1)?.id);
    return { ...result, skipped };
  }

  async processInputs(inputs: readonly EngineInput[], cursor?: string): Promise<BatchResult> {
    if (this.failed !== undefined)
      throw new FatalEngineError('engine is fail-stopped', { cause: this.failed });
    const events: EngineEvent[] = [];
    const outputs: { seq: bigint; output: EngineOutput }[] = [];
    // Timestamps never go backwards, even if the wall clock does.
    const ts = BigInt(this.now()) > this.state.ts ? BigInt(this.now()) : this.state.ts;
    try {
      for (const input of inputs) {
        const e: EngineEvent = {
          seq: this.state.seq + 1n,
          ts,
          v: EVENT_VERSIONS[input.type],
          input,
        };
        for (const output of apply(this.state, e)) outputs.push({ seq: e.seq, output });
        events.push(e);
      }
      await this.log.append(events, cursor);
    } catch (err) {
      this.failed = err instanceof Error ? err : new Error(String(err));
      throw new FatalEngineError('apply/append failed; fail-stop', { cause: err });
    }
    return { events, outputs, skipped: [] };
  }
}
