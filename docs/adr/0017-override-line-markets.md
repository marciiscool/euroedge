# ADR-0017 — Override-line markets (NOVO, SHEL): windows & anchor

- **Status:** Accepted (founder, 2026-10-27). Items marked _proposed_ still need founder review.
- **Review gate:** math

## Context

For NOVO and SHEL, the primary listing is not in EUR (XCSE in DKK, XLON in GBp). The live-min price source is therefore the Tradegate EUR line.

## Decision

**Windows**

- **Window A** follows the **primary venue** calendar:
  - XCSE continuous 09:00–17:00 CET;
  - XLON 08:00–16:30 UK time (UK and EU change DST on the same dates).
- **Window B** follows the **Tradegate** calendar outside Window A.
- **Window C** is the remainder of a trading day. **Window D** covers weekends and holidays where both venues are closed.
- _Proposed:_ on a primary-only holiday where Tradegate is open, the whole Tradegate session is Window B.

**Anchor and price source**

- **Anchor C** = the primary closing auction, converted to EUR at `t_C`:
  - XCSE: DKK / EURDKK;
  - XLON: GBX / 100 / EURGBP.
- **Price source (live-min):** the Tradegate EUR line, used for the `s_T` signal and the Window A index.

**Snap and ADRs**

- **Snap:** at the primary open, using the Tradegate first-minute VWAP after the primary open, reconciled with the delayed official open.
- **ADRs:** NVO 1:1, SHEL 1 ADS = 2 shares.

**SHEL's Amsterdam line**

- SHEL gets an optional `priceSourceOverride: { mic: XAMS, ccy: EUR }`, disabled by default. It is not needed for live-min.

## Consequences

- The calendar resolver composes windows from two venues for these markets.
- Tests cover the primary-only holiday case and the DST weeks.
