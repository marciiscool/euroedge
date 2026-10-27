# Project skills

Third-party agent skills vendored into this repo after a full read-through (see `docs/research/skills-review.md`). Each skill directory keeps its upstream `LICENSE`. The brief, `PLAN.md` and the ADRs take precedence over any skill; project overrides are listed in `CLAUDE.md`.

| Skill                         | Upstream                                             | Pinned commit                              | Licence | Local changes                                                                          |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| `accessibility`               | addyosmani/web-quality-skills `skills/accessibility` | `afa8da942115f2961fdbfa80807ea0b232ff6c00` | MIT     | none                                                                                   |
| `make-interfaces-feel-better` | jakubkrehel/make-interfaces-feel-better              | `35545ea1512ad59fa463e6b1f95ca9c052981fe6` | MIT     | removed `agents/openai.yaml` (other agent's metadata)                                  |
| `web-interface-guidelines`    | vercel-labs/web-interface-guidelines `command.md`    | `434b7f91364665f2f733b310ec54809bf8f37937` | MIT     | converted from a slash command to a skill; rules pinned instead of fetched at run time |

**Updating a skill:** re-read the upstream diff in full, bump the pinned commit here, and note any new conflicts with the ADRs. Never add a skill that runs scripts or fetches instructions at run time without an ADR.
