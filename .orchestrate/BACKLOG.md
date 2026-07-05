# Kimi Delegation Backlog — veydria-cartography

**Generated:** 2026-06-23  
**Purpose:** Pre-specced work for the Claude-down window (Thu–Sun). Perry launches each task
via the orchestrate loop; diffs wait for Perry/Claude review. Nothing auto-merges.

**Operating model** (per approved plan):
```
cd veydria-cartography
git worktree add .orchestrate/wt/<id> HEAD
# Windows: junction node_modules into the worktree; DELETE the junction BEFORE git worktree remove
<combo>/scripts/kimi-exec.sh --implement --cwd .orchestrate/wt/<id> --timeout 2400 .orchestrate/specs/<id>.md
git -C .orchestrate/wt/<id> diff           # review before merging
git worktree remove .orchestrate/wt/<id>
```

**⚠️ ROADMAP IS STALE (dated 2026-05-21).** Every spec instructs Kimi to **grep by
symbol/function name** and re-verify file:line against the current code before editing.

**Verify gate (mandatory — both, in order):**
1. `cd web && npm run test` — 908 tests green (or the current count; do not regress)
2. `cd web && npm run build` — typecheck + bundle must pass

---

## HARD STOP RULE

> When the curated task list below is exhausted, **STOP. Write a HANDOFF.md and wait.**
> Do NOT improvise new work, read ahead in ai/IDEAS.md, or touch any gated surface.

---

## Task list (priority order)

| ID | Task | Status | Spec |
|---|---|---|---|
| V3 | Tier-4 polish (3 sub-items: export trim, tooltip, time-of-day) | **OPEN** | [V3.md](specs/V3.md) |
| V4 | Passage per-instance variation + new signature keys | **OPEN** | [V4.md](specs/V4.md) |

**Build order:** V3 first (smaller, well-bounded, lower risk). V4 can start after V3 is
reviewed and merged — it touches `passage.ts` which V3 does not.

---

## Already done — do NOT re-implement

| Task | Evidence |
|---|---|
| V1: CI bundle-size budget + `tsc --noEmit` | Already in `.github/workflows/ci.yml` — `npm run build` step includes tsc; `npm run check:size` step is wired |
| V2: Playwright smoke suite | Already in `.github/workflows/ci.yml` — the `e2e` job runs `npm run test:e2e` with Playwright and uploads the report |

---

## Never touch (hard prohibition)

- **Passage "Teeth slice (engine)"** — *"Architecture — stays on Opus."*
- **Journey "Travel mode" / new journey architecture** — *"largest/most-ambitious axis…genuine new feature with real architecture and UX design."*
- **First-run welcome experience** — medium-effort UX spanning many components + desktop-gated branch.
- **Death-march reachability** — campaign-canon balance; touches route/graph data design.
- **`feat/branding-chrome` merge** — *"needs Perry's explicit go (merging deploys to prod)."*
- **WebView2 toast bug** — final verification requires a running Tauri window; do supervised, not headless.
- **Any architecture/ADR, anything marked "Architecture — stays on Opus" or "needs Perry's go."**

---

## Kimi 2.7 Beta — Money-Rule checkpoint

See `claude-budget-dispatcher/.orchestrate/BACKLOG.md` for the full checkpoint procedure.
Short version: start an interactive `kimi` session, read the banner model version. If the
banner says k2.7, the rolling alias updated and headless gets it for free. If it says k2.5/k2.6,
use that — the 2.7 "6x faster" claim cannot be relied on until verified. Do NOT call
`api.moonshot.ai` — that is metered and Money-Rule-forbidden.
