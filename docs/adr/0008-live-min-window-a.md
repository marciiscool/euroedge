# ADR-0008 — live-min: Window A index, anchor and CB2

- **Status:** Accepted (founder, 2026-10-27). The rows marked _proposed_ in the source table still need founder review.
- **Review gate:** math

## Context

`live-min` has no real-time primary (Xetra/Euronext) feed; the testnet will not license one (revisit in step 2). The brief's Window A rule `median{primary, Tradegate, FV}` therefore cannot be applied as written.

## Decision

### Index and mark in Window A (live-min only)

Definitions:

- **TG fresh:** Tradegate quote age < 60 s and spread < 30 bp.
- **US live:** the ADR venue's regular or extended session is open per its calendar, the ADR quote is fresh, and `adr.verified = true`.
- **ADR-implied** = `C · exp(s_A)` (brief §6.1), quantized to ticks.

| TG fresh | US live | Index (= mark target)                                                                               | Status                                      |
| -------- | ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| yes      | yes     | `median{TG mid, ADR-implied, FV}` (three values)                                                    | normal                                      |
| yes      | no      | **TG mid** — FV acts as a sanity check via CB1 (ADR-vs-TG divergence) and the band clamp (ADR-0009) | normal                                      |
| no       | yes     | _proposed:_ **FV** (ADR-driven)                                                                     | degraded (CB3: no new opens, wider spreads) |
| no       | no      | _proposed:_ **FV_last** with σ widening (brief §6.1)                                                | degraded (CB3)                              |

- **A median is never taken over two values.**
- `sim` and `replay` keep the brief's rule, `median{primary, TG, FV}`, because the sim provides a real-time primary.

### Anchor C

- `C` is the **official closing auction from the 15-min delayed feed**, arriving about 17:51 for Xetra.
- Until it arrives, the previous anchor stays in force and Tradegate drives the index (brief §6.1).

### CB2 (primary halt / volatility interruption) in live-min

CB2 fires if either:

- a Tradegate halt or volatility flag is set, or
- Tradegate is silent for more than 60 s while the primary venue is scheduled open.

The delayed primary feed confirms or clears CB2 when its prints arrive.

**Limitation (public docs):** real halts on the primary venue are detected up to 15 minutes late.

### Snap

Per brief §6.4: the Tradegate first-minute VWAP after the primary open, reconciled with the official open from the delayed feed (~09:15).

## Consequences

- The status page and docs explain the reduced Window A source set for live-min.
- Tests cover every row of the table, plus the transitions between rows.
