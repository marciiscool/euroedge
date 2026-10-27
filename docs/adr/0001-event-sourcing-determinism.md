# ADR-0001 — Event sourcing & determinism

- **Status:** Accepted (founder, 2026-10-27)
- **Review gate:** math

## Context

Brief §7.1 requires:

- a single writer that never reads the wall clock;
- an append-only, hash-chained event log;
- snapshots;
- bit-for-bit replay from genesis (Invariant 6).

The same core must later back a partner (step 2) or our own venue (step 3).

## Options

1. **Postgres append-only table + in-process sequencer** — one datastore we already run; transactional; easy backups.
2. **Kafka / Redpanda log** — overkill at ~50 ops/s; extra ops.
3. **EventStoreDB** — purpose-built, but another datastore to operate and back up.
4. **Local file WAL** — fastest, weakest ops/backup story.

## Decision

Option 1.

**Process and transport**

- One engine process. It holds a Postgres **advisory lock** at start-up, so there are never two writers.
- The **sequencer** is the only code that reads the wall clock.
  - It consumes inputs from a Valkey Stream and stamps `ts` (UTC ms).
  - It appends the batch to the log (group commit: ≤ 5 ms or ≤ 256 events), then applies it to the core and publishes results.
  - The sequencer also emits `ClockTick` inputs on a timer.
- **Inputs only are logged.** Inputs are commands, FV/index/mark/window/CB events, clock ticks, chain events, admin and param changes. Outputs (fills, postings, rejections) are recomputed on replay and written to read models.
- If an input is lost before append (e.g. a Valkey failure), clients retry with idempotency keys.

**Core rules**

- The core is `apply(state, event) → { state, outputs }`. It is synchronous, pure and has no I/O.
- Forbidden in core packages, enforced by lint (ADR-0011):
  - `Date`, `Math.*`, `performance`, timers, `process`;
  - non-integer numeric literals;
  - floats for money (branded bigints, ADR-0002).
- Iteration uses insertion-ordered `Map`s/arrays only.

**Encoding and hashing**

- Canonical JSON (RFC 8785-style key ordering; bigints as decimal strings).
- The encoding is **stored as raw bytes** (`bytea`), never as `jsonb`, because `jsonb` reorders and normalises.
- `hash_n = sha256(hash_{n-1} ‖ bytes_n)`, with genesis `hash_0 = sha256("euroedge-genesis-v1")`.

**Versioning, snapshots and verification**

- Every event carries `v` (its schema version). Upcasters migrate old events when they are read; stored bytes are never rewritten.
- A snapshot every 10,000 events stores the state bytes plus a state hash. Restore = snapshot + tail.
- A nightly job replays from genesis and compares state hashes with the snapshots.

## Consequences

- Replay determinism is testable in CI: a model test runs live vs replay and compares state hashes.
- The FV floats in `fv-core` cannot leak into the engine: FV enters only as logged integer ticks.
- Throughput is bounded by a single core. That is fine for the testnet (target 50 orders/s, p99 ack < 50 ms); sharding by market is the step-3 path.
