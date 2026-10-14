import type { Region } from './types'

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/command/' + path, { ...init, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
  if (!response.ok) {
    if (response.status === 503) throw new Error('EvacuAid backend is unavailable. Start the backend to load regional data.')
    const error: { detail?: string | { message?: string } } = await response.json().catch(() => ({})) as { detail?: string | { message?: string } }
    throw new Error(typeof error.detail === 'string' ? error.detail : error.detail?.message || 'Unable to save or load command data (HTTP ' + String(response.status) + ').')
  }
  return (response.status === 204 ? null : await response.json()) as T
}

export async function allRegions(params: Record<string, string>): Promise<Region[]> {
  const rows: Region[] = []
  for (let offset = 0; ; offset += 200) {
    const query = new URLSearchParams(params)
    query.set('limit', '200')
    query.set('offset', String(offset))
    const batch = await api<Region[]>('regions?' + query.toString())
    rows.push(...batch)
    if (batch.length < 200) return rows
  }
}
