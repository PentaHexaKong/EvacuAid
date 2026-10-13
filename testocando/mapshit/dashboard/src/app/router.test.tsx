import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from './router'

afterEach(() => { cleanup(); localStorage.clear() })

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
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
  expect(screen.getByRole('link', { name: 'E EvacuAid Command center' })).toBeInTheDocument()
  expect(screen.getByText('DKI Jakarta')).toBeInTheDocument()
  expect(screen.getByText('Loading dashboard')).toBeInTheDocument()
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
