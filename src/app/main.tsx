import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import App from './App.tsx'
import { LogoLab } from '../features/logo/LogoLab.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/logo' ? <LogoLab /> : <App />}
  </StrictMode>,
)
