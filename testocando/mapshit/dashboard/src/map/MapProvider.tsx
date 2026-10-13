import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import mapboxgl from 'mapbox-gl'
import { mapConfig } from '@/lib/config'
import { createMap, noTokenNote, noWebGLNote, type MapAPI } from './glMap'

const MapContext = createContext<{ api: MapAPI | null; note: string | null; attach: (slot: HTMLElement) => () => void } | null>(null)

export function MapProvider({ children }: { children: ReactNode }) {
  const parking = useRef<HTMLDivElement>(null)
  const runtime = useRef<ReturnType<typeof createMap> | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const mounted = useRef(false)
  const initialized = useRef(false)
  const slot = useRef<HTMLElement | null>(null)
  const [config] = useState(() => {
    const value = mapConfig()
    return { ...value, note: !value.token ? noTokenNote : !mapboxgl.supported() ? noWebGLNote : null }
  })
  const [api, setAPI] = useState<MapAPI | null>(null)
  const [note, setNote] = useState<string | null>(config.note)
  const [attach] = useState(() => (target: HTMLElement) => {
    slot.current = target
    if (container.current) target.append(container.current)
    runtime.current?.resize()
    return () => {
      if (slot.current !== target) return
      slot.current = null
      if (container.current) parking.current?.append(container.current)
    }
  })
  useEffect(() => {
    mounted.current = true
    if (!initialized.current) {
      initialized.current = true
      const { token, style } = config
      if (token && !config.note) {
        const node = document.createElement('div')
        node.style.width = '100%'
        node.style.height = '100%'
        container.current = node
        ;(slot.current ?? parking.current)?.append(node)
        try { runtime.current = createMap(node, token, style, value => { if (mounted.current) setAPI(value) }) }
        catch (error) { console.error(error); node.remove(); container.current = null; queueMicrotask(() => { if (mounted.current) setNote(noWebGLNote) }) }
      }
    }
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current) return
        runtime.current?.destroy()
        container.current?.remove()
      })
    }
  }, [config])
  return <MapContext.Provider value={{ api, note, attach }}><div ref={parking} hidden />{children}</MapContext.Provider>
}

export function useMap(): MapAPI | null { return useContext(MapContext)?.api ?? null }
export function useMapHost() { return useContext(MapContext) }
