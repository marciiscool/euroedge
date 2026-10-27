# UI design notes (input to ADR-0007, finalised in M7-01)

Status: **interim**. The benchmark trading sites (Hyperliquid, Lighter, trade.xyz, Vest, Robinhood Legend, Linear) are not reachable from the build environment, so there are no screenshots yet. These notes come from the reviewed skills (`docs/research/skills-review.md`), our ADRs, and a self-critique of the M0 skeleton.

## Principles we adopt

1. **One memorable element.** Spend boldness in one place: the **FV fan chart with snap markers** and the **session ribbon**. Everything around them stays quiet.
2. **Structure, not decoration.**
   - Borders exist only where they encode structure (panel separators, table cells, inputs).
   - Elevated surfaces (popovers, dialogs) use layered transparent shadows; in dark mode, a 1 px white ring at about 8 %.
   - Nested radii are concentric (`outer = inner + padding`).
3. **Numbers first.**
   - Tabular figures everywhere, mono for prices and the ladder.
   - Dynamic values get a fixed width, so nothing shifts as they change.
   - Every price shows its data age, and every time shows its zone.
   - Formatting goes through `Intl.NumberFormat` / `Intl.DateTimeFormat`, never hand-written formats.
4. **Motion budget.**
   - High-frequency interactions get instant feedback, or a ≤ 150 ms colour/opacity change.
   - No bounce, no scale-on-press in trading controls, no entrance animations in the terminal.
   - Motion is never the only signal: ▲▼ and +/− always accompany colour.
5. **Copy.**
   - Sentence case, active voice, second person.
   - An action keeps the same name through its whole flow ("Close position" → toast "Position closed").
   - Errors say what happened and how to fix it, without apologising.
   - Loading text ends in "…".
   - German uses formal "Sie".
6. **State in the URL.** Selected market, timeframe, bottom tab and layout preset are deep-linkable.

## Accessibility requirements surfaced (WCAG 2.2 AA)

| Criterion                         | Consequence for EuroEdge                                                                          | Task         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ |
| 2.1.4 Character key shortcuts (A) | Single-key hotkeys (B/S) must be **possible to turn off** as well as remap.                       | M7-18        |
| 2.4.11 Focus not obscured         | The sticky testnet banner and top bar must not cover focused elements: `scroll-padding-top`.      | M1-16        |
| 2.5.7 Dragging movements          | Draggable limit/TP/SL chart lines need a click/keyboard alternative (ticket fields, nudge keys).  | M7-12        |
| 2.5.8 Target size                 | ≥ 24×24 px targets even in the dense terminal; 44×44 on mobile.                                   | M7, M8-16    |
| 4.1.3 Status messages             | Fills, liquidations and window changes are announced politely; price announcements are throttled. | M7-23, M7-27 |
| 2.4.1 Bypass blocks               | Skip link to the order ticket / main content.                                                     | M1-16        |
| 3.3.8 Accessible authentication   | Wallet + SIWE is fine. A future email login must allow paste/passkeys.                            | M8           |

## Self-critique of the M0 skeleton (to fix in M1-16/17)

- The decorative mono, tracked "EUROEDGE" wordmark and the all-caps "TESTNET" chip read as template chrome. Use a sentence-case "Testnet" badge and a proper wordmark later (M8).
- Missing: skip link, `<meta name="theme-color">` per theme, `translate="no"` on brand/tickers/ISINs, `text-pretty` on body copy.
- The theme toggle icon must not shift on swap; a cross-fade is acceptable outside the terminal.

## Still needed from the founder

Benchmark screenshots in `docs/research/ui/` (see README there), or allow these hosts in the environment's network settings: `app.hyperliquid.xyz`, `app.lighter.xyz`, `trade.xyz`, `vestmarkets.com`, `robinhood.com`, `linear.app`.
