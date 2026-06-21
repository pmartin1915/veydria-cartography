# IDEAS — veydria-cartography

Append-only deferred-idea log (NOT `@`-imported). Sweep at session start / into handoffs.
Format: idea — why-deferred — where-it-applies.

## 2026-06-20 (deferred while fixing the WebView2 success-toast bug)

These were the three unpicked options from the "what next?" choice; Perry picked the toast fix.

- **Branding / first-run experience** — the "doesn't-feel-finished" axis (app name/icon, window
  title, first-run welcome). Deferred: partly an Opus design call before any implementation, larger
  than this session. Where: experience-polish track; Tauri shell (`web/src-tauri/`) + first-run gate.
- **Journey-as-game** — the north-star vision (Oregon Trail × A Dark Room × GoT): richer travel
  vignettes, journey beats, the game-feel layer. Deferred: largest/most creative scope, needs its own
  design pass. Where: see memory `journey-experience-vision`; `web/src/components/journey-planner/`,
  `TravelVignette.tsx`, `encounters.ts`.
- **Verify desktop export round-trip** — *pending verification, not a feature idea*: the un-run
  desktop GUI dialog round-trip (snapshot PNG / campaign log / render config / session-prep /
  coord-patch) + the forced-failure badge check, at `cd web && npm run tauri dev`. Deferred: needs a
  real Tauri window (Perry, interactive). Where: `HANDOFF-2026-06-20-desktop-file-exports.md` has the
  step-by-step checklist.
