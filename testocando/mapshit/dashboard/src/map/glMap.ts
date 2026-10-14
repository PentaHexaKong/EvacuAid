import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import './map.css'
import type { Geometry } from '@/lib/types'

export type Feature = { type: 'Feature'; id?: string | number; geometry: Geometry | null; properties: Record<string, unknown> | null }
export type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] }
export type Polygon = { type: 'Polygon'; coordinates: number[][][] }

export type LayerId = 'region' | 'hazard' | 'shelter' | 'route' | 'report' | 'mock' | 'safe-house'
export type FeatureStyle = { color?: string; weight?: number; hoverWeight?: number; opacity?: number; dashed?: boolean; fillColor?: string; fillOpacity?: number; radius?: number; sortKey?: number }
export type MapAPI = {
  setLayer(id: LayerId, fc: FeatureCollection, style?: FeatureStyle): void
  setVisible(id: LayerId, on: boolean): void
  fit(bounds: mapboxgl.LngLatBoundsLike): void
  onClick(id: LayerId, cb: (feature: Feature, event: mapboxgl.MapMouseEvent) => void): () => void
  pick(): Promise<[lng: number, lat: number]>
  cancelPick(): void
}
const ids: LayerId[] = ['region', 'hazard', 'shelter', 'route', 'report', 'mock', 'safe-house']
const polygon: mapboxgl.FilterSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const line: mapboxgl.FilterSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], false, true]
const point: mapboxgl.FilterSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const hovered: mapboxgl.ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
const calmBasemap = { theme: 'monochrome', showPointOfInterestLabels: false, showTransitLabels: false, show3dObjects: false }
export const noTokenNote = 'Map unavailable · set MAPBOX_TOKEN'
export const noWebGLNote = "Map unavailable · this browser can't start WebGL"

export function createMap(container: HTMLElement, token: string, style: string, onReady: (api: MapAPI) => void, onConstruct?: (map: mapboxgl.Map) => void) {
  mapboxgl.accessToken = token
  const map = new mapboxgl.Map({
    container, style: 'mapbox://styles/' + style, ...(style === 'mapbox/standard' ? { config: { basemap: calmBasemap } } : {}),
    center: [118, -2], zoom: 4, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
  })
  onConstruct?.(map)
  map.touchZoomRotate.disableRotation()
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
  map.on('error', event => { console.error(event.error) })
  const groups = Object.fromEntries(ids.map(id => {
    const data: FeatureCollection = { type: 'FeatureCollection', features: [] }
    return [id, { data, visible: true }]
  })) as Record<LayerId, { data: FeatureCollection; visible: boolean }>
  const callbacks = new Map<LayerId, Set<(feature: Feature, event: mapboxgl.MapMouseEvent) => void>>()
  const meta = new Map<number, { feature: Feature; content?: string | Node }>()
  const tooltip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'map-tooltip', offset: 10, maxWidth: '320px' })
  let nextId = 1
  let ready = false
  let framed = false
  let pendingBounds: mapboxgl.LngLatBoundsLike | null = null
  let hover: { source: string; id: number } | null = null
  let tooltipId: number | undefined
  let pendingPick: { resolve: (point: [number, number]) => void; reject: (reason: DOMException) => void } | null = null
  const layerIds = (id: LayerId) => ['fill', 'line', 'dash', 'point'].map(kind => id + '-' + kind)
  function clearHover() {
    tooltip.remove()
    tooltipId = undefined
    if (hover) map.setFeatureState(hover, { hover: false })
    hover = null
  }
  function visibility(id: LayerId) {
    if (ready) for (const layer of layerIds(id)) map.setLayoutProperty(layer, 'visibility', groups[id].visible ? 'visible' : 'none')
  }
  function install(id: LayerId) {
    const slot = map.getStyle().layers.some(layer => layer.type === 'slot') ? { slot: 'middle' } : {}
    map.addSource(id, { type: 'geojson', data: groups[id].data, promoteId: 'fid' })
    const width: mapboxgl.ExpressionSpecification = ['case', hovered, ['get', 'hoverWeight'], ['get', 'weight']]
    map.addLayer({ id: id + '-fill', type: 'fill', source: id, filter: polygon, ...slot, layout: { 'fill-sort-key': ['get', 'sortKey'] }, paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] } })
    map.addLayer({ id: id + '-line', type: 'line', source: id, filter: ['all', line, ['!', ['get', 'dashed']]], ...slot, layout: { 'line-sort-key': ['get', 'sortKey'], 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-opacity': ['get', 'opacity'] } })
    map.addLayer({ id: id + '-dash', type: 'line', source: id, filter: ['all', line, ['get', 'dashed']], ...slot, layout: { 'line-sort-key': ['get', 'sortKey'] }, paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-opacity': ['get', 'opacity'], 'line-dasharray': [3, 2] } })
    map.addLayer({ id: id + '-point', type: 'circle', source: id, filter: point, ...(slot.slot ? { slot: 'top' } : {}), paint: { 'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'fillColor'], 'circle-opacity': ['get', 'fillOpacity'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['get', 'weight'] } })
    visibility(id)
  }
  function frame(bounds: mapboxgl.LngLatBoundsLike) {
    map.resize()
    map.fitBounds(bounds, { padding: 24, maxZoom: 12, animate: false })
  }
  function resize() {
    map.resize()
    if (ready && pendingBounds && container.offsetWidth) { const bounds = pendingBounds; pendingBounds = null; frame(bounds) }
  }
  const setCursor = (value: string) => { container.dataset.cursor = value; map.getCanvas().style.cursor = value }
  function cancelPick() {
    const pending = pendingPick
    pendingPick = null
    document.removeEventListener('keydown', escape)
    setCursor('')
    pending?.reject(new DOMException('Aborted', 'AbortError'))
  }
  function escape(event: KeyboardEvent) { if (event.key === 'Escape') cancelPick() }
  const api: MapAPI = {
    setLayer(id, fc, style = {}) {
      const group = groups[id]
      clearHover()
      for (const feature of group.data.features) meta.delete(feature.properties?.fid as number)
      const features = fc.features.map(feature => {
        const { tooltip: content, ...properties } = feature.properties ?? {}
        const appearance = { ...properties, ...style }
        const fid = nextId++
        const color = appearance.color || '#000'
        const weight = appearance.weight ?? 2
        meta.set(fid, { feature, content: content as string | Node | undefined })
        return { ...feature, properties: { ...properties, fid, color, weight, hoverWeight: appearance.hoverWeight ?? weight, opacity: appearance.opacity ?? 1, dashed: Boolean(appearance.dashed), fillColor: appearance.fillColor || color, fillOpacity: appearance.fillOpacity ?? .2, radius: appearance.radius ?? 6, sortKey: appearance.sortKey ?? 0 } }
      })
      group.data = { type: 'FeatureCollection', features }
      if (ready) map.getSource<mapboxgl.GeoJSONSource>(id)?.setData(group.data)
    },
    setVisible(id, on) { groups[id].visible = on; visibility(id) },
    fit(bounds) { if (!container.offsetWidth || !ready) pendingBounds = bounds; else frame(bounds) },
    onClick(id, cb) {
      if (!callbacks.has(id)) callbacks.set(id, new Set())
      callbacks.get(id)?.add(cb)
      return () => { callbacks.get(id)?.delete(cb) }
    },
    pick() {
      cancelPick()
      clearHover()
      setCursor('crosshair')
      document.addEventListener('keydown', escape)
      return new Promise((resolve, reject) => { pendingPick = { resolve, reject } })
    },
    cancelPick,
  }
  map.on('style.load', () => {
    ready = true
    for (const id of ids) install(id)
    if (!framed) { framed = true; api.fit([[106.68, -6.38], [107.02, -6.08]]) }
    resize()
    onReady(api)
  })
  function topFeature(event: mapboxgl.MapMouseEvent) {
    const layers = ids.flatMap(layerIds).filter(id => map.getLayer(id))
    return layers.length ? map.queryRenderedFeatures(event.point, { layers })[0] : undefined
  }
  map.on('mousemove', event => {
    const feature = topFeature(event)
    const properties = (feature as unknown as Feature | undefined)?.properties
    const fid = properties?.fid as number | undefined
    if (hover && hover.id !== fid) clearHover()
    const info = fid != null ? meta.get(fid) : undefined
    if (!feature?.source || !info || fid == null) { clearHover(); setCursor(container.dataset.cursor || ''); return }
    hover = { source: feature.source, id: fid }
    map.setFeatureState({ source: feature.source, id: fid }, { hover: true })
    map.getCanvas().style.cursor = container.dataset.cursor || (callbacks.get(feature.source as LayerId)?.size ? 'pointer' : '')
    if (info.content && !pendingPick) {
      if (tooltipId !== fid || !tooltip.isOpen()) tooltip.setDOMContent(typeof info.content === 'string' ? Object.assign(document.createElement('span'), { textContent: info.content }) : info.content.cloneNode(true))
      tooltipId = fid
      tooltip.setLngLat(event.lngLat)
      if (!tooltip.isOpen()) tooltip.addTo(map)
    } else tooltip.remove()
  })
  map.getCanvas().addEventListener('mouseleave', clearHover)
  map.on('click', event => {
    if (pendingPick) {
      const pending = pendingPick
      pendingPick = null
      document.removeEventListener('keydown', escape)
      setCursor('')
      const point = event.lngLat.wrap()
      pending.resolve([point.lng, point.lat])
      return
    }
    const feature = topFeature(event)
    if (feature?.source) {
      const rendered = feature as unknown as Feature
      const original = meta.get(rendered.properties?.fid as number)?.feature ?? rendered
      for (const cb of callbacks.get(feature.source as LayerId) ?? []) cb(original, event)
    }
  })
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  return { map, resize, destroy() { cancelPick(); observer.disconnect(); map.getCanvas().removeEventListener('mouseleave', clearHover); tooltip.remove(); map.remove() } }
}

export function boundsOf(geometry?: Geometry | null): mapboxgl.LngLatBounds | null {
  const bounds = new mapboxgl.LngLatBounds()
  const walk = (value: number[] | number[][] | number[][][] | number[][][][]) => {
    if (typeof value[0] === 'number') bounds.extend([value[0], value[1] as number])
    else for (const item of value) walk(item as number[] | number[][] | number[][][])
  }
  const visit = (item: Geometry) => { if (item.type === 'GeometryCollection') item.geometries?.forEach(visit); else if (item.coordinates) walk(item.coordinates) }
  if (geometry) visit(geometry)
  return bounds.isEmpty() ? null : bounds
}

export function circlePolygon(longitude: number, latitude: number, radiusM: number, steps = 64): Polygon {
  const ring: number[][] = []
  const dLat = radiusM / 111320
  const dLng = radiusM / (111320 * Math.cos(latitude * Math.PI / 180))
  for (let i = 0; i <= steps; i++) {
    const angle = i / steps * 2 * Math.PI
    ring.push([longitude + dLng * Math.cos(angle), latitude + dLat * Math.sin(angle)])
  }
  return { type: 'Polygon', coordinates: [ring] }
}
