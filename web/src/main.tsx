import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { loadExternalEncounters } from './utils/external-encounters'
import './App.css'

// Arm worldbuilder's encounter canon (ADR-0022). Fire-and-forget: by the time a
// user computes a route the fetch has resolved; a missing file degrades silently
// to the default pools. The Node sim never calls this, so its baseline is intact.
void loadExternalEncounters(import.meta.env.BASE_URL)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
