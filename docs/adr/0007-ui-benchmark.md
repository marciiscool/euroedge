# ADR-0007 — UI benchmark

- **Status:** Accepted as draft (founder, 2026-10-27). Finalised in M7-01 once screenshots exist in `docs/research/ui/`.

## Context

The brief (§11.1) asks for a best-in-class terminal with a calm, institutional-European personality.

## Decision (draft, from prior knowledge)

**Adopt from each benchmark**

| Benchmark                   | Adopt                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Hyperliquid & pro terminals | density, keyboard-first ticket, chart trading, instant optimistic feedback               |
| Lighter / Vest / trade.xyz  | equity-perp conventions: market-hours labelling, oracle/mark disclosure, funding display |
| Robinhood Legend            | layout presets, linked panels, polish                                                    |
| Linear                      | type scale, restraint, 120–180 ms motion                                                 |

**Reject**

- Casino cues: confetti, leverage hype, PnL celebrations.
- Fake order books.
- Colour-only signalling.

**Our signatures**

- Session pill + 24 h ribbon.
- Price provenance.
- FV fan chart with snap markers.
- Honest quote ladder.
- Pre-trade gap-survival card.

## Consequences

- The design tokens in `packages/ui` follow this direction from M0. Component work starts in M7.
