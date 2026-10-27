# ADR-0004 — Calendar data

- **Status:** Accepted (founder, 2026-10-27; horizon extended to 2028)

## Context

Windows A–D, auctions and DST handling are resolved per market from venue calendars (brief §6.2). There is no reliable TypeScript exchange-calendar library.

## Options

1. **Curated YAML per MIC** — full control; covers TGAT, XEUR and US overnight venues; needs yearly upkeep.
2. **Paid calendar API** — cost and licence; a runtime dependency.
3. **Python `exchange_calendars` at runtime** — wrong runtime; misses TGAT/XEUR.

## Decision

Option 1, covering **2026–2028**. One file per MIC lives in `config/calendars/`. Each file holds:

- the timezone and regular sessions;
- auction windows with random-end ranges (e.g. Xetra opening auction 08:50–09:00 + random end);
- half-days (e.g. XETR 24/31 Dec, closing at 14:00);
- holidays;
- a source URL and retrieval date per year.

MICs: XETR, XAMS, XPAR, XCSE, XLON, TGAT (+ L&S hours), XNYS, XNAS (+ US overnight venue), XEUR, and FX 24/5.

**Cross-checks and safeguards**

- A one-off export from `exchange_calendars` cross-checks XETR, XAMS, XPAR, XCSE, XLON and XNYS in CI. It is a committed fixture, not a runtime dependency.
- **CI fails 120 days before any calendar runs out of data.**
- Unscheduled closures are handled by admin events (engine-logged) plus feed-silence halt detection.

## Consequences

- A yearly maintenance runbook is needed (M9-10).
- Mandatory tests: the EU/US DST-mismatch weeks 26–30 Oct 2026 and 14–28 Mar 2027, holidays, half-days, and halts.

## Implementation notes (M2, 2026-10-27)

- **Format.** The schema lives in `packages/calendar/src/schema.ts`. Each YAML file names its phases (`preOpen`, `openingAuction`, `continuous`, `closingAuction`, `postTrading`) and lists holidays and `specialSessions`. Holidays and special sessions are keyed by **trade date**. `tradeDateOffsetDays: 1` attaches the US overnight session (`USON`) to the next day.
- **Generated module.** `pnpm --filter @euroedge/calendar gen` compiles the YAML into `src/generated/calendars.ts`, so lookups stay synchronous and work in the browser. A test fails if the generated file drifts from the YAML.
- **Internal codes.** `FX`, `LSX` (Lang & Schwarz hours, informational only) and `USON` are internal venue codes, not MICs.
- **Sources are not yet verified.** None of the official exchange sites was reachable from the build environment, so every source carries `verified: false, retrieved: null`.
  - The holiday and early-close lists for XETR, XAMS, XPAR, XCSE, XLON and XNYS/XNAS equal the committed `exchange_calendars` 4.13.2 export, which CI checks.
  - TGAT, LSX, XEUR and USON have no independent check.
  - **The founder must verify them against the venue publications**, or allow those hosts, before a live tier relies on them.
- **Beyond coverage.** Dates after `coverage.to` fall back to the regular week without holidays. The coverage test fails CI 120 days before that happens.
- **Not modelled.**
  - The Xetra 13:00 intraday auction counts as continuous trading.
  - The US opening and closing crosses are instantaneous.
