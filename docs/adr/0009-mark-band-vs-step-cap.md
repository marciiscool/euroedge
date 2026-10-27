# ADR-0009 — Mark: band clamp dominates step cap; CB8

- **Status:** Accepted (founder, 2026-10-27)
- **Review gate:** math

## Context
The brief caps mark moves at 50 bp/s (except during SNAP), and Invariant 5 says the mark always lies within `fvBand` (except during SNAP). When FV moves legitimately faster than 50 bp/s, the two rules conflict.

## Decision
- `stepped = mark_{t−1} + clamp(target_t − mark_{t−1}, ±50 bp · Δt_s)`
- `mark_t = clamp(stepped, bandLo_t, bandHi_t)`. **The band dominates.** The step cap is suspended during SNAP.
- **Every clamp** — any step where `mark_t ≠ stepped` because of the band — emits an engine event: `MarkClamped { market, target, stepped, mark, bandLo, bandHi }`.
- **CB8 (mark pinned):** if the mark equals `bandLo` or `bandHi` for more than 60 s of event time:
  - the market becomes **degraded** (no new opens);
  - an alert is raised;
  - CB8 clears once the mark has been strictly inside the band for 60 s.
- Invariant 5 then holds by construction. A property test asserts it.

## Consequences
- A visible audit trail of every forced mark move.
- Prolonged pinning signals a model or feed problem and stops new risk.
