declare global {
  interface Window {
    EVACUAID_MAP?: { mapboxToken?: string | null; mapboxStyle: string }
  }
}

export function mapConfig(): { token?: string; style: string } {
  return { token: window.EVACUAID_MAP?.mapboxToken ?? undefined, style: window.EVACUAID_MAP?.mapboxStyle ?? 'mapbox/standard' }
}
