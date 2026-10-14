import { useEffect, useRef } from 'react'
import { useMapHost } from './MapProvider'

export function MapView() {
  const slot = useRef<HTMLDivElement>(null)
  const host = useMapHost()
  const attach = host?.attach
  useEffect(() => { if (slot.current && attach) return attach(slot.current) }, [attach])
  return <div role="region" aria-label="Map" className="relative min-h-[480px] h-[min(72vh,760px)]"><div ref={slot} className="absolute inset-0" />{host?.note && <p className="map-note" role="note">{host.note}</p>}</div>
}
