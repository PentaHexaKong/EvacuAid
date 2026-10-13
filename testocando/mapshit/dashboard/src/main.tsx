import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { routes } from './app/router'
import './app/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')

createRoot(root).render(
  <StrictMode><RouterProvider router={createHashRouter(routes)} /></StrictMode>,
)
