# HANDOFF — veydria-cartography audit fixes (Phase 1 wrap-up)

**Date:** 2026-04-27
**Branch:** master · **Last commit:** `23473c5` (F1) on top of `589ce13` (handoff cleanup)
**Status:** F1 shipped. F2–F6 + wiring gap + stashed WIP remain. Working tree clean. 2 commits ahead of origin/master (not pushed).

---

## TL;DR

- **F1 is done.** `coordinate-manifest.yaml` now round-trips through edit-mode saves with comments, key order, and `[x, y]` flow style intact. See [generator/core/yaml_io.py](generator/core/yaml_io.py).
- **Five audit issues remain** (F2–F6) plus a real wiring gap and a stashed WIP that doesn't compile.
- **Start here: F2** (`sync-world-data.mjs` hardcoded paths) — smallest, fully isolated, and a step toward portability before anyone else touches the repo.
- **Highest user-visible payoff: F4** (Export Patch button). F1 was the gating dependency; the round-trip now works, so the frontend feature is finally worth shipping.

---

## What shipped this session

| Status | Commit | Summary |
| --- | --- | --- |
| ✅ | `23473c5` | **F1** — round-trip YAML for `coordinate-manifest.yaml` via `ruamel.yaml`. `dump_rt`, `flow_seq` helpers in [generator/core/yaml_io.py](generator/core/yaml_io.py). All three persistence write/read sites migrated. Smoke test: `python -m generator.core.persistence` → 29 comments preserved, no-op writes are bit-identical. |
| ✅ | `589ce13` | Handoff doc cleanup (concise structure, lint warnings) — preceded F1. |

Verified no regression: `pipeline.py validate` / `export-geojson` / `info` all produce the Phase 1 baseline (3,052 features, 3.19 MB).

---

## Status of audit findings

| ID | Sev | Status | Where |
| --- | --- | --- | --- |
| F1 | 🔴 Critical | ✅ Done | [persistence.py](generator/core/persistence.py), [yaml_io.py](generator/core/yaml_io.py) |
| F2 | 🔴 Critical | ⏳ Open | [sync-world-data.mjs:14-15](scripts/sync-world-data.mjs#L14-L15) |
| F3 | 🟠 High | ⏳ Open | [schema_validator.py:22 + :190](generator/core/schema_validator.py) |
| F4 | 🟠 High | ⏳ Open (now unblocked by F1) | [App.tsx:207-227](web/src/App.tsx#L207-L227) |
| F5 | 🟡 Medium | ⏳ Open | [coordinate_loader.py:63-82](generator/core/coordinate_loader.py#L63-L82) |
| F6 | 🟢 Low | ⏳ Open | [coordinate-manifest.yaml landmarks](data/coordinate-manifest.yaml) |
| Wiring gap | 🟠 High | ⏳ Open | `output/` ↔ `web/public/` (web is 6 days stale) |
| rbush WIP | — | Stashed | `git stash@{0}` |

---

## Recommended order

1. **F2** — 5-minute fix, fully isolated, doesn't depend on anything.
2. **Wiring gap** — also small, prevents the "I exported but the map didn't change" trap on every future session.
3. **F4** — biggest UX win, F1 unblocks it. 30–60 min of frontend work + a manual round-trip test.
4. **F3** — replace the hand-rolled checks with `jsonschema.validate()`. Schema is already written, just unused.
5. **F5** — type-correctness cleanup; coupled with F3 because both improve "fail loudly on bad input".
6. **F6** — minor data-shape change. Cosmetic; defer if anyone is mid-edit on landmarks.
7. **rbush WIP** — pop the stash and either finish or discard. See decision tree below.

F2 + the wiring gap can land as a single "tooling" commit. F3+F5 share a theme. F4 stands alone.

---

## Punch list

### F2 — 🔴 portable worldbuilder path

[scripts/sync-world-data.mjs:14-15](scripts/sync-world-data.mjs#L14-L15) hardcodes:

```js
const WORLDBUILDER_PATH = 'C:/Users/perry/DevProjects/worldbuilder';
const CARTOGRAPHY_PATH  = 'C:/Users/perry/DevProjects/veydria-cartography';
```

The script breaks for anyone else and any CI runner. Replace with env vars + a sensible default:

```js
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARTOGRAPHY_PATH = resolve(__dirname, '..');
const WORLDBUILDER_PATH =
  process.env.WORLDBUILDER_PATH ?? resolve(CARTOGRAPHY_PATH, '..', 'worldbuilder');
```

Add a one-liner to README under "Sync world data": `WORLDBUILDER_PATH=/path/to/worldbuilder node scripts/sync-world-data.mjs`.

### F3 — 🟠 unused JSON Schema

[schema_validator.py:22](generator/core/schema_validator.py#L22) defines a complete draft-07 `TOPOLOGY_SCHEMA` dict, but the validator at [line 190](generator/core/schema_validator.py#L190) only consults `TOPOLOGY_SCHEMA["required"]` and then falls through to hand-rolled `expected_civs` set checks. Misspelled fields, wrong types, and unexpected keys all slip through.

Replace the body of `validate_topology_file` (or its inner `validate_topology` function) with:

```python
from jsonschema import Draft7Validator, ValidationError

validator = Draft7Validator(TOPOLOGY_SCHEMA)
errors = sorted(validator.iter_errors(data), key=lambda e: e.path)
if errors:
    for err in errors:
        path = ".".join(str(p) for p in err.path) or "<root>"
        print(f"  ✗ {path}: {err.message}")
    raise ValidationError(f"{len(errors)} schema violations")
```

`jsonschema` is already an indirect dep (most ML stacks have it); confirm with `pip show jsonschema`. If absent, add to [generator/requirements.txt](generator/requirements.txt). Keep the `expected_civs` membership check as an additional **semantic** validation (the schema can verify shape, not "must contain these specific civ names").

### F4 — 🟠 Export Patch button

[App.tsx:207-227](web/src/App.tsx#L207-L227) renders `coordinateUpdates` as a human-readable `<pre>` block but offers no way to persist it. Edit mode is observed but not actionable.

Frontend state shape (already correct, verified):

```ts
useState<Record<string, {name: string, category: string, coords: [number, number]}>>
```

Backend expects (`persistence.apply_patch` → `update_feature_coords`):

```yaml
patches:
  - id: <feature_id>
    category: <category>
    coords: [x, y]
```

Add an "Export Patch" button next to "Clear All". Handler:

```ts
const handleExportPatch = () => {
  const patches = Object.entries(coordinateUpdates).map(([id, u]) => ({
    id,
    category: u.category,
    coords: u.coords,
  }))
  const yaml = `patches:\n` + patches.map(p =>
    `  - id: ${p.id}\n    category: ${p.category}\n    coords: [${p.coords[0]}, ${p.coords[1]}]\n`
  ).join('')
  const blob = new Blob([yaml], { type: 'text/yaml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `veydria-patch-${Date.now()}.yaml`
  a.click()
  URL.revokeObjectURL(url)
}
```

Keep the YAML emission hand-rolled — pulling in `js-yaml` for one button isn't worth it, and the patch shape is small enough to format inline. Round-trip test: drag a marker, click Export Patch, save the file, run `python -m generator.core.persistence` then `python -c "from generator.core.persistence import apply_patch; apply_patch('veydria-patch-XXX.yaml')"`, verify [data/coordinate-manifest.yaml](data/coordinate-manifest.yaml) updated and re-export GeoJSON.

Also document the round-trip in the README so the next person finds it without spelunking.

### F5 — 🟡 Silent missing-key failures

[coordinate_loader.py:63-82](generator/core/coordinate_loader.py#L63-L82) — every `get_*` returns `{}` on a miss:

```python
def get_civ(self, name: str) -> dict[str, Any]:
    return self.civilizations.get(name, {})
```

A topology referencing a civ that's been removed from the manifest (or vice-versa) silently drops features from GeoJSON output with no warning. Change the signatures:

```python
def get_civ(self, name: str) -> dict[str, Any] | None:
    return self.civilizations.get(name)
```

Then in [generator/export/geojson.py](generator/export/geojson.py), at every call site, log a warning when the result is `None` and skip:

```python
civ_data = manifest.get_civ(civ_name)
if civ_data is None:
    logger.warning("Civ '%s' referenced by topology but missing from manifest — skipping", civ_name)
    continue
```

`get_landmarks_by_type` is fine — empty list on miss is the right default.

### F6 — 🟢 Landmarks shape mismatch

In [data/coordinate-manifest.yaml](data/coordinate-manifest.yaml), `landmarks` is a list of `{id, ...}` dicts while every other category is keyed by id. This forces the O(n) loop at [persistence.py:55-60](generator/core/persistence.py#L55-L60):

```python
elif category == "landmark":
    for lm in raw.get("landmarks", []):
        if lm.get("id") == feature_id:
            lm["coords"] = coords
            updated = True
            break
```

Convert the YAML to:

```yaml
landmarks:
  zang_ri:
    type: peak
    coords: [560, 80]
  ...
```

Then update:
- [coordinate_loader.py:30](generator/core/coordinate_loader.py#L30) — `self.landmarks = raw.get("landmarks", {})` (was `[]`)
- [coordinate_loader.py:84](generator/core/coordinate_loader.py#L84) — rewrite `get_landmarks_by_type` to iterate `self.landmarks.values()`
- [persistence.py:55](generator/core/persistence.py#L55) — `landmarks[feature_id]["coords"] = coords`
- Any consumers of `manifest.landmarks` in [generator/export/geojson.py](generator/export/geojson.py) — grep for `.landmarks` and confirm they iterate values, not the list directly.

Defer if anyone is actively editing `landmarks:` in the manifest — the merge will be unpleasant.

---

## Wiring gap (active footgun)

The pipeline writes to [output/veydria-spatial.geojson](output/veydria-spatial.geojson) but the web app fetches from [web/public/veydria-spatial.geojson](web/public/veydria-spatial.geojson). At time of writing, the two files are **out of sync** (output: 3,187,614 bytes, today; web/public: 3,187,559 bytes, 6 days old).

Pick one of three:

1. **Easiest:** add `shutil.copy2(OUTPUT_PATH, WEB_PUBLIC_PATH)` at the end of `export_geojson` in [generator/pipeline.py](generator/pipeline.py). One line, deterministic, no Vite config change.
2. **Cleanest:** point Vite's `publicDir` at `../output` so `/veydria-spatial.geojson` is served directly. Requires touching [web/vite.config.ts](web/vite.config.ts) and may break other public assets.
3. **Sacrilegious:** symlink. Works on Unix, painful on Windows.

Recommend (1). It's the kind of "duct-tape that should have been there from day one" decision.

---

## Stashed WIP — rbush viewport culling

`git stash@{0}` holds an in-progress attempt to viewport-cull [web/src/components/MapViewer.tsx](web/src/components/MapViewer.tsx) using rbush. Touched files:

- `web/package.json` (+`rbush@^4.0.1`)
- `web/package-lock.json`
- `web/src/components/MapViewer.tsx` (added `featuresToRender` state + `updateViewport` callback, replaced `featuresByCategory` memo)
- `web/src/utils/d3-overlay.ts` (small cleanup of route-arrow defs on unmount — that part is good)

**It does not compile.** The refactor removed the `featuresByCategory` memo at the top of `MapViewer.tsx` but left a reference to it in the layer-creation effect (around line 363 pre-stash). Decision tree:

- If the perf problem is real (3,000+ features rendering at all zoom levels): pop the stash, restore `featuresByCategory` as a memo derived from `featuresToRender`, re-test. The d3-overlay cleanup is independently valid and can be cherry-picked even if the rbush work is dropped.
- If the perf is fine on current hardware: drop the rbush half (`git stash drop`), but extract the d3-overlay cleanup as its own commit before discarding.

To inspect: `git stash show -p stash@{0}`. To pop: `git stash pop`.

---

## Verification (after any of these changes)

```bash
# Backend
python generator/pipeline.py validate          # → [OK] Topology YAML is valid.
python generator/pipeline.py export-geojson    # → 3,052 features, ~3.2MB
python generator/pipeline.py info              # → civ/chokepoint/route summary
python -m generator.core.persistence           # → comments preserved, sentinel intact

# Frontend (after F4)
cd web && npm run dev                          # → drag a marker, click Export Patch
python -c "from generator.core.persistence import apply_patch; apply_patch('downloaded-patch.yaml')"
diff <(git show HEAD:data/coordinate-manifest.yaml) data/coordinate-manifest.yaml
# Expect: only the dragged feature's coord line moved. Nothing else.

# Sync (F2)
WORLDBUILDER_PATH=../worldbuilder node scripts/sync-world-data.mjs --check
```

---

## Footguns / risks

1. **Python 3.10 vs 3.13.** `pip` on this machine binds to 3.13 but `python` resolves to 3.10. Phase 1 deps are installed in 3.10. If you `pip install <new-thing>`, run it as `"C:/Users/perry/AppData/Local/Programs/Python/Python310/python.exe" -m pip install <thing>` or you'll get `ModuleNotFoundError` at runtime. (This bit me during F1.)
2. **Wiring gap silently misleads.** Running `export-geojson` and refreshing the browser shows stale data unless you copy to `web/public/`. F4 testing **requires** fixing the wiring gap first or doing a manual `cp`.
3. **`CommentedMap` vs `dict`.** Anything new in the codebase doing `type(x) is dict` will break on the manifest now. `isinstance(x, dict)` is fine. Repo grep showed no offenders today.
4. **Two unpushed commits.** `master` is ahead of `origin/master` by `589ce13` and `23473c5`. Push when convenient.
