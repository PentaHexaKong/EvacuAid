import type { MapAPI } from '@/map/glMap'
import { updateRouteFields } from './formState'
let cancelOwned: (() => void) | null = null
export async function pickAssembly(map: MapAPI, navigate: (path: string) => void) {
    updateRouteFields({ feedback: 'Click a public evacuation assembly point on the map.' })
    navigate('/overview')
    const state = { pending: true }
    const cancel = () => { if (state.pending) { state.pending = false; map.cancelPick() } }
    cancelOwned = cancel
    const leaving = () => { if (location.hash !== '#/overview') cancel() }
    window.addEventListener('hashchange', leaving)
    try {
      const [longitude, latitude] = await map.pick()
      if (!state.pending) return
      state.pending = false
      updateRouteFields({ latitude: String(latitude), longitude: String(longitude), feedback: 'Origin selected. Choose a recorded shelter and calculate.' })
      navigate('/operations/routes')
    } catch { state.pending = false }
    finally { window.removeEventListener('hashchange', leaving); if (cancelOwned === cancel) cancelOwned = null }
}
export function cancelAssemblyPick() { cancelOwned?.() }
