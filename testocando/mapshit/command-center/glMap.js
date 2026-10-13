// Mapbox GL map plus overlay groups. Each group is one GeoJSON source; every feature carries its own
// style in its properties, so a group can mix polygons, lines and points like a Leaflet layer group did.
const polygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const line = ['match', ['geometry-type'], ['Point', 'MultiPoint'], false, true]
const point = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const hovered = ['boolean', ['feature-state', 'hover'], false]

// Stands in for the map when there is no token or no WebGL (Mapbox GL draws nothing without either):
// every call is a harmless no-op, so the lists, KPIs and operations keep working without a map.
function withoutMap(element, note) {
  element.dataset.mapNote = note
  const inert = new Proxy(function () {}, { get: (_, key) => key === 'getContainer' ? () => element : inert, apply: () => inert })
  return { map: inert, group: () => inert, setCursor() {} }
}

// Standard tuned for a dashboard: severity fills must carry the colour, so the basemap stays quiet,
// shops, transit icons and 3D buildings are hidden, and place and road names stay for orientation.
const calmBasemap = { theme: 'monochrome', showPointOfInterestLabels: false, showTransitLabels: false, show3dObjects: false }

export function createMap({ container, token, style }) {
  const element = document.getElementById(container)
  if (!token) return withoutMap(element, 'Map unavailable · set MAPBOX_TOKEN')
  mapboxgl.accessToken = token
  let map
  try {
    map = new mapboxgl.Map({
      container, style: 'mapbox://styles/' + style, ...(style === 'mapbox/standard' ? { config: { basemap: calmBasemap } } : {}),
      center: [118, -2], zoom: 4, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
    })
  } catch (error) {
    console.error(error)
    return withoutMap(element, "Map unavailable · this browser can't start WebGL")
  }
  map.touchZoomRotate.disableRotation()
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
  map.on('error', event => console.error(event.error))

  const groups = []
  const meta = new Map()
  let nextId = 1
  let ready = false
  const tooltip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'map-tooltip', offset: 10, maxWidth: '320px' })
  let hover = null
  const layerIds = () => groups.flatMap(group => group.layerIds)

  function install(group) {
    // Standard has slots; overlays sit under its labels so place names stay readable over severity fills.
    const slot = map.getStyle().layers.some(layer => layer.type === 'slot') ? { slot: 'middle' } : {}
    map.addSource(group.name, { type: 'geojson', data: { type: 'FeatureCollection', features: group.features }, promoteId: 'fid' })
    const width = ['case', hovered, ['get', 'hoverWeight'], ['get', 'weight']]
    map.addLayer({ id: group.name + '-fill', type: 'fill', source: group.name, filter: polygon, ...slot, layout: { 'fill-sort-key': ['get', 'sortKey'] }, paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] } })
    map.addLayer({ id: group.name + '-line', type: 'line', source: group.name, filter: ['all', line, ['!', ['get', 'dashed']]], ...slot, layout: { 'line-sort-key': ['get', 'sortKey'], 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-opacity': ['get', 'opacity'] } })
    map.addLayer({ id: group.name + '-dash', type: 'line', source: group.name, filter: ['all', line, ['get', 'dashed']], ...slot, layout: { 'line-sort-key': ['get', 'sortKey'] }, paint: { 'line-color': ['get', 'color'], 'line-width': width, 'line-opacity': ['get', 'opacity'], 'line-dasharray': [3, 2] } })
    map.addLayer({ id: group.name + '-point', type: 'circle', source: group.name, filter: point, ...(slot.slot ? { slot: 'top' } : {}), paint: { 'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'fillColor'], 'circle-opacity': ['get', 'fillOpacity'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['get', 'weight'] } })
    group.apply()
  }
  map.on('style.load', () => { ready = true; for (const group of groups) install(group) })

  function group(name, { visible = true } = {}) {
    const result = {
      name, features: [], visible,
      layerIds: ['fill', 'line', 'dash', 'point'].map(kind => name + '-' + kind),
      add(geometry, style = {}, { tooltip: content, onClick } = {}) {
        if (!geometry) return
        const fid = nextId++
        const color = style.color || '#000'
        const weight = style.weight ?? 2
        this.features.push({ type: 'Feature', geometry, properties: {
          fid, color, weight, hoverWeight: style.hoverWeight ?? weight, opacity: style.opacity ?? 1, dashed: Boolean(style.dashed),
          fillColor: style.fillColor || color, fillOpacity: style.fillOpacity ?? .2, radius: style.radius ?? 6, sortKey: style.sortKey ?? 0,
        } })
        meta.set(fid, { content, onClick })
        this.sync()
      },
      clear() {
        for (const feature of this.features) meta.delete(feature.properties.fid)
        this.features = []
        this.sync()
      },
      sync() { if (ready) map.getSource(name)?.setData({ type: 'FeatureCollection', features: this.features }) },
      setVisible(value) { this.visible = value; this.apply() },
      apply() { if (ready) for (const id of this.layerIds) map.setLayoutProperty(id, 'visibility', this.visible ? 'visible' : 'none') },
    }
    groups.push(result)
    if (ready) install(result)
    return result
  }

  function topFeature(event) {
    const ids = layerIds().filter(id => map.getLayer(id))
    return ids.length ? map.queryRenderedFeatures(event.point, { layers: ids })[0] : undefined
  }
  map.on('mousemove', event => {
    const feature = topFeature(event)
    const fid = feature?.properties.fid
    if (hover && hover.fid !== fid) { map.setFeatureState({ source: hover.source, id: hover.fid }, { hover: false }); hover = null }
    const info = fid != null ? meta.get(fid) : undefined
    if (!info) { tooltip.remove(); map.getCanvas().style.cursor = map.getContainer().dataset.cursor || ''; return }
    hover = { source: feature.source, fid }
    map.setFeatureState({ source: feature.source, id: fid }, { hover: true })
    map.getCanvas().style.cursor = map.getContainer().dataset.cursor || (info.onClick ? 'pointer' : '')
    if (info.content) {
      // Tooltip text goes in as textContent: report and region names are untrusted input.
      if (tooltip.fid !== fid || !tooltip.isOpen()) tooltip.setDOMContent(typeof info.content === 'string' ? Object.assign(document.createElement('span'), { textContent: info.content }) : info.content.cloneNode(true))
      tooltip.fid = fid
      tooltip.setLngLat(event.lngLat)
      if (!tooltip.isOpen()) tooltip.addTo(map)
    } else tooltip.remove()
  })
  map.getCanvas().addEventListener('mouseleave', () => {
    tooltip.remove()
    if (hover) map.setFeatureState({ source: hover.source, id: hover.fid }, { hover: false })
    hover = null
  })
  map.on('click', event => {
    const fid = topFeature(event)?.properties.fid
    meta.get(fid)?.onClick?.(event)
  })

  // A crosshair while placing wins over the pointer shown above clickable overlays.
  const setCursor = value => { map.getContainer().dataset.cursor = value; map.getCanvas().style.cursor = value }
  return { map, group, setCursor }
}

export function boundsOf(geometry) {
  const bounds = new mapboxgl.LngLatBounds()
  const walk = value => { if (typeof value[0] === 'number') bounds.extend([value[0], value[1]]); else for (const item of value) walk(item) }
  if (geometry?.type === 'GeometryCollection') for (const item of geometry.geometries) walk(item.coordinates)
  else if (geometry?.coordinates) walk(geometry.coordinates)
  return bounds.isEmpty() ? null : bounds
}

// A ground-distance circle (a mock disaster radius) as a polygon, since GL circles are sized in pixels.
export function circlePolygon(longitude, latitude, radiusM, steps = 64) {
  const ring = []
  const dLat = radiusM / 111320
  const dLng = radiusM / (111320 * Math.cos(latitude * Math.PI / 180))
  for (let i = 0; i <= steps; i++) {
    const angle = i / steps * 2 * Math.PI
    ring.push([longitude + dLng * Math.cos(angle), latitude + dLat * Math.sin(angle)])
  }
  return { type: 'Polygon', coordinates: [ring] }
}
