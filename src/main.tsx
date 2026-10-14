import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { mappingStore } from './sound/mappingStore'
import { loadSession } from './state/persist'
import './styles.css'

// The last visit's session, read once here rather than in App (StrictMode renders it twice).
const restored = loadSession()
if (restored.session) mappingStore.restore(restored.session.mappings)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App restored={restored} />
  </StrictMode>,
)
