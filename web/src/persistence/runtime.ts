/**
 * runtime.ts — Which shell are we running in?
 *
 * `__TAURI_INTERNALS__` is injected on `window` by the Tauri WebView before any
 * app code runs, so this is a synchronous, dependency-free check that is valid at
 * module-eval time (before the JS plugins load). The web/GitHub-Pages build never
 * has it. This is the single switch the persistence + I/O layers branch on.
 */
export const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
