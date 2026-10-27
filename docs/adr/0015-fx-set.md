# ADR-0015 — FX set & DKK peg fallback

- **Status:** Accepted (founder, 2026-10-27). Items marked *proposed* still need founder review.
- **Review gate:** math

## Decision
- **FX pairs in every tier:** EURUSD, EURGBP, EURDKK. In live-min they come from Pyth Pro (coverage to be verified by the founder).

**Conversions**
| Line | To EUR |
|---|---|
| GBX | `/100` → GBP; `EUR = GBP / EURGBP` |
| DKK | `EUR = DKK / EURDKK` |
| USD (ADR signals) | via EURUSD in return form (brief §6.1) |

- Anchors convert at `t_C` using the FX rate prevailing at that time.

**DKK peg fallback**
- If the EURDKK feed is missing or stale, use the **static peg 7.46** (`config: fx.dkkPeg = "7.46"`). The ERM II central rate is 7.46038; the founder's figure is used.
- **Alert** if `|feed / peg − 1| > 0.5 %`. The feed stays in use.
- *Proposed:* treat a feed outside the ERM II band (±2.25 %) as a bad print and fall back to the peg.

## Consequences
- The simulator generates EURGBP and EURDKK (DKK within a tight band around the peg).
- Tests cover feed loss and deviation alerts.
