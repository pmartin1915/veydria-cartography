# Session Handoff — 2026-05-12 · AI Lore Panel per Feature

## Branch
`master`  
Head: `3924958`  
Status: clean working tree

## Verification
- `npm test -- --run` (web): **436/436 pass** across 24 test files
- `npm run build` (web): ✅ green (index.js ~453 kB, CSS ~103 kB)
- `python pipeline.py validate` (generator): ✅ green

## Commit

```
feat: AI Lore panel per feature — mock generator, caching, settings modal, OpenAI-compatible API client
```

## What was done

Implemented the first half of the "Generative content per feature" backlog item: a fully functional AI Lore panel that generates **Rumours**, **NPCs**, and **Local Tensions** for every feature on the map. Works immediately without any API key (mock mode), and can be upgraded to live AI generation by adding an OpenAI-compatible API key in Settings.

### Architecture

```
InfoPanel
└── AiLorePanel (new)
    ├── Tab bar: Rumours / NPCs / Tensions
    ├── Content area: skeleton → content / error / placeholder
    └── Mock-badge when running without API key

App
├── Header → Settings button (gear icon)
└── SettingsModal (new)
    ├── API Key input (password toggle)
    ├── Endpoint URL input
    ├── Model name input
    └── Clear cache + Save buttons
```

### `web/src/utils/ai-lore.ts` (new)

- **Prompt builder** — constructs rich context from feature properties (name, category, description, commodities, strategic value, etc.) plus world context (Veydria as C-shaped continent around Aethelian Basin)
- **Three content types** — `rumors`, `npcs`, `tensions`, each with category-specific template pools (port, chokepoint, oasis, civilization, trade_route, water, landmark, river, contested_site, default)
- **Mock generator** — deterministic seeded content using `djb2Hash` + `mulberry32`, same pattern as `feature-hooks.ts`. Every feature × type combination always produces the same mock content, so GMs get consistency.
- **Live API client** — `fetchAiLore()` calls any OpenAI-compatible chat completions endpoint. Supports:
  - Custom endpoint URL (default: `https://api.openai.com/v1/chat/completions`)
  - Custom model (default: `gpt-4o-mini`)
  - Caching layer so repeated views don't re-call the API
  - Graceful error handling with meaningful messages
- **Settings persistence** — `veydria.aiLoreSettings.v1`
- **Cache persistence** — `veydria.aiLoreCache.v1`, keyed by `featureId#type`

### `web/src/components/AiLorePanel.tsx` (new)

- Tab bar with icons (💬 👤 ⚡) for the three content types
- Auto-generates mock content on first view when no API key is configured
- Loading skeleton with shimmer animation
- Regenerate button per tab
- Error state with link to Settings
- Mock-mode badge reminding users they can upgrade to AI

### `web/src/components/SettingsModal.tsx` (new)

- Overlay modal matching the SearchBar / KeyboardHelp aesthetic
- API key input with show/hide toggle (👁 / 🙈)
- Endpoint and model inputs with sensible defaults
- Save button with brief "Saved ✓" flash
- Clear AI cache button
- Escape key closes, click outside closes

### Integration

- **InfoPanel.tsx** — AiLorePanel inserted between Adventure Hooks and GM Notes
- **App.tsx** — Settings button added to header (between Help and Search), SettingsModal rendered alongside other modals
- **App.css** — ~260 lines of new styles for tabs, skeleton, paragraphs, error states, settings modal, inputs, buttons

### Tests

`web/src/utils/ai-lore.test.ts` — 45 tests covering:
- Settings round-trip and default merging
- Cache store/retrieve/clear
- Mock generator determinism across features, types, and categories
- Category sweep: all 9 categories × 3 types produce non-empty content
- Live API call mocking (success, error, empty response)
- Cached content short-circuits API call

## Files touched

```
web/src/utils/ai-lore.ts              NEW — prompt builder, mock generator, API client, caching
web/src/utils/ai-lore.test.ts         NEW — 45 tests
web/src/components/AiLorePanel.tsx    NEW — tabbed UI with loading/error/content states
web/src/components/SettingsModal.tsx  NEW — API key / endpoint / model configuration
web/src/components/InfoPanel.tsx      + AiLorePanel import & render
web/src/App.tsx                       + SettingsModal state, header button, modal render
web/src/App.css                       + ai-lore & settings styles
```

## Notes for the next instance

- **Mock mode is the default.** The feature is fully usable without an API key. Every feature gets 3 deterministic rumours/NPCs/tensions immediately.
- **API integration is ready but untested against a real endpoint.** The fetch client follows the OpenAI chat completions schema. CORS may be an issue depending on the provider — users might need a proxy.
- **No schema or localStorage breakage** — additive changes only, versioned keys.
- **Bundle impact:** JS +31 kB, CSS +5 kB. Well within thresholds.
- **Mobile audit** remains the top open item from MASTER.md — still cannot be done from this environment.
- **Future enhancement ideas:**
  - Add a "Copy prompt" button so GMs can paste into their own ChatGPT/Claude interface if CORS is a problem
  - Batch-pre-generate content for all 3,052 features via a script (expensive but would make everything instant)
  - Add a "temperature" slider in settings
  - Let users choose which content types to auto-generate vs. generate on demand
