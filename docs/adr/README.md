# Architecture Decision Records

Format: lightweight MADR (`0000-template.md`). One decision per file, numbered, never renumbered. A superseded ADR stays in place with a pointer to its successor.

**Review gate.** ADRs marked `Review gate: math` change FV, mark, funding, margin, ledger or contract behaviour. They (and PRs implementing changes to them) need explicit founder review before merge.

| ADR                                        | Title                                                     | Status           | Gate |
| ------------------------------------------ | --------------------------------------------------------- | ---------------- | ---- |
| [0001](0001-event-sourcing-determinism.md) | Event sourcing & determinism                              | Accepted         | math |
| [0002](0002-fixed-point.md)                | Fixed-point library                                       | Accepted         | math |
| [0003](0003-quote-impact-model.md)         | Quote / impact model                                      | Accepted         | math |
| [0004](0004-calendar-data.md)              | Calendar data                                             | Accepted         | –    |
| [0005](0005-shadcn-base-ui.md)             | shadcn on Base UI                                         | Accepted         | –    |
| [0006](0006-wagmi-2.md)                    | wagmi 2 + RainbowKit 2.2                                  | Accepted         | –    |
| [0007](0007-ui-benchmark.md)               | UI benchmark                                              | Accepted (draft) | –    |
| [0008](0008-live-min-window-a.md)          | live-min Window A index, anchor, CB2, stale escalation    | Accepted         | math |
| [0009](0009-mark-band-vs-step-cap.md)      | Mark: band clamp vs step cap; CB8                         | Accepted         | math |
| [0010](0010-valkey.md)                     | Valkey instead of Redis                                   | Accepted         | –    |
| [0011](0011-tooling.md)                    | Tooling choices & deviations                              | Accepted         | –    |
| [0012](0012-caddy-single-origin.md)        | Caddy single origin                                       | Accepted         | –    |
| [0013](0013-house-capital-solvency.md)     | House/insurance capital, CB7 (hysteresis), Invariants 7–9 | Accepted         | math |
| [0014](0014-smart-wallet-deposits.md)      | Smart-wallet deposits                                     | Accepted         | math |
| [0015](0015-fx-set.md)                     | FX set & DKK peg fallback                                 | Accepted         | math |
| [0016](0016-risk-parameter-defaults.md)    | Risk parameter defaults                                   | Accepted         | math |
| [0017](0017-override-line-markets.md)      | Override-line markets (NOVO, SHEL)                        | Accepted         | math |
