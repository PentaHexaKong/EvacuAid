import { useEffect, useRef } from 'react'
import { useMapHost } from './MapProvider'

export function MapView() {
  const slot = useRef<HTMLDivElement>(null)
  const host = useMapHost()
  const attach = host?.attach
  useEffect(() => { if (slot.current && attach) return attach(slot.current) }, [attach])
  return <div role="region" aria-label="Map" className="relative min-h-[420px] h-[min(62vh,640px)]"><div ref={slot} className="absolute inset-0" />{host?.note && <p className="absolute inset-0 flex items-center justify-center" role="note">{host.note}</p>}</div>
}
