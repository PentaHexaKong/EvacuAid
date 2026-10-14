import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { routes } from './app/router'
import { normalizeLegacyHash } from './app/normalize-legacy-hash'
import './app/styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: true } } })

normalizeLegacyHash()

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')

createRoot(root).render(
  <StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={createHashRouter(routes)} /></QueryClientProvider></StrictMode>,
)
