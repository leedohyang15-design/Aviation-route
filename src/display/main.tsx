import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DisplayApp } from './DisplayApp'
import './display.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DisplayApp />
  </StrictMode>
)
