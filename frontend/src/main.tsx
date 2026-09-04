import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from './auth/AuthGate'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)
