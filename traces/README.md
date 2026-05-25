# traces/ — sim-harness regression baselines

This directory holds **committed** snapshots of `sim:batch` output, used as a
pre-change reference when the journey engine is recalibrated. Distinct from
`output/sim/` (gitignored, clobbered on every run).

## Current baseline

- `baseline.jsonl` — 144 full traces, one JSON object per line.
- `baseline.summary.csv` — pivot-ready companion: one row per run, all input
  params + headline metrics.

**Captured:** 2026-05-24, just before the supply-recalibration cycle
(commit will follow this file). The baseline is the pre-fix state:
**100% water-out across every preset**, including `caravan`. See
`SCOPING-supply-recalibration-2026-05-24.md` for the recalibration plan.

## Slice

The longest plausible journey on the map (`ngaru_bon → oravan`), which
surfaces the most supply pressure:

```
4 seasons × 4 modes × 3 supply presets × 3 party presets = 144 runs
```

## Exact CLI to reproduce

```sh
npm --prefix web run sim:batch -- --from-civs ngaru_bon --to-civs oravan --out traces
# then rename:
mv traces/traces.jsonl traces/baseline.jsonl
mv traces/summary.csv  traces/baseline.summary.csv
```

`--out traces` is resolved repo-root-relative by `scripts/sim/sim-batch.ts`,
so the files land here regardless of cwd.

## When to refresh

**Refresh once per engine-changing cycle, _before_ the change ships.** The
whole point is to diff post-change `output/sim/summary.csv` against the
committed pre-change snapshot in this dir.

Do **not** refresh mid-recalibration: that destroys the reference you're
trying to measure against. The next refresh happens before the *next* cycle
that touches the journey engine (e.g. before Phase 3 policies, or before a
world-scale realism pass).

## Conventions

- One baseline per cycle. Old baselines can stay (rename to
  `baseline-YYYYMMDD-<topic>.jsonl`) or be replaced — author's call.
- `traces/` is **tracked**. `output/sim/` is **gitignored**.
