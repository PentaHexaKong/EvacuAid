import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from './router'
import { normalizeLegacyHash } from './normalize-legacy-hash'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

test.each([
  ['/nope', 'Regional overview'],
  ['/operations', 'Field reports'],
  ['/overview', 'Regional overview'],
  ['/operations/reports', 'Field reports'],
  ['/operations/assistance', 'Assistance'],
  ['/operations/check-ins', 'Check-ins'],
  ['/operations/routes', 'Route setter'],
  ['/about', 'About this data'],
])('%s renders %s and sets its document title', async (path, title) => {
  mount(path)
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
  await waitFor(() => { expect(document.title).toBe(`${title} · EvacuAid Command Center`) })
  expect(document.getElementById('map-host-boundary')).toContainElement(screen.getByRole('heading', { name: title }))
})

test('rebrands the shell and keeps the data environment across routes', async () => {
  const user = userEvent.setup()
  mount('/overview')
  expect(screen.getByRole('link', { name: 'EvacuAid command center' })).toHaveAttribute('href', '#/overview')
  expect(screen.getByText('DKI Jakarta')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading dashboard')
  await user.click(screen.getByRole('button', { name: /Data environment/ }))
  await user.click(screen.getByRole('option', { name: 'Simulation data' }))
  await user.click(screen.getByRole('link', { name: 'About this data' }))
  expect(await screen.findByRole('heading', { name: 'About this data' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Data environment/ })).toHaveTextContent('Simulation data')
  expect(localStorage.length).toBe(0)
  cleanup()
  mount('/overview')
  expect(screen.getByRole('button', { name: /Data environment/ })).toHaveTextContent('Operational data')
})

test.each(['#overview', '#operations/reports', '#operations/assistance', '#/operations', '#/nope', ''])('normalizes %s before router mounting without adding a history entry', (hash) => {
  const originalUrl = window.location.href
  const state = { existing: 'state' }
  window.history.replaceState(state, '', `/command-center/?existing=1${hash}`)
  const length = window.history.length
  normalizeLegacyHash()
  expect(window.location.hash).toBe(hash && !hash.startsWith('#/') ? `#/${hash.slice(1)}` : hash)
  expect(window.location.pathname).toBe('/command-center/')
  expect(window.location.search).toBe('?existing=1')
  expect(window.history.state).toEqual(state)
  expect(window.history.length).toBe(length)
  window.history.replaceState(null, '', originalUrl)
})
