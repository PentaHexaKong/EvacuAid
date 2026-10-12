import { setupMapTools } from './mapTools.js'
import { setupOperations } from './operations.js'
const $ = (id) => document.getElementById(id)
const tokens = getComputedStyle(document.documentElement)
const levels = ['CRITICAL', 'ELEVATED', 'WATCH', 'NORMAL', 'UNKNOWN']
const fill = Object.fromEntries(levels.map(level => [level, tokens.getPropertyValue('--' + level.toLowerCase() + '-fill').trim()]))
const stroke = Object.fromEntries(levels.map(level => [level, tokens.getPropertyValue('--' + level.toLowerCase() + '-stroke').trim()]))
const accent = tokens.getPropertyValue('--accent-600').trim()
const titleCase = value => String(value).replace(/\p{L}+/gu, word => word.length > 3 && word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word)
const readable = value => value == null || value === 'UNKNOWN' ? 'Unknown' : String(value).toLowerCase().replaceAll('_', ' ').replace(/^./u, letter => letter.toUpperCase())
const hazardName = value => ({ FLOOD: 'Flood', EARTHQUAKE: 'Earthquake', TSUNAMI: 'Tsunami', WILDFIRE: 'Wildfire', LANDSLIDE: 'Landslide', EXTREME_WEATHER: 'Extreme weather' }[value] || readable(value))
const sourceName = value => ({ INARISK: 'InaRISK (BNPB)', BMKG_CAP: 'BMKG', BMKG_EARTHQUAKE: 'BMKG', PETABENCANA: 'PetaBencana', FIRMS: 'NASA FIRMS', DEMO_SIMULATION: 'EvacuAid simulation' }[value] || (value == null || value === 'UNKNOWN' ? 'Unknown' : value))
const provenanceName = value => ({ OFFICIAL_BASELINE: 'reference layer, not an active warning', OFFICIAL_ACTIVE: 'official active', COMMUNITY_OBSERVATION: 'community report', SATELLITE_OBSERVATION: 'satellite', SIMULATION: 'simulation' }[value] || readable(value))
const number = (value) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value)
const time = (value) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Unknown'
const state = { regions: [], selected: null, generation: 0, selectionGeneration: 0 }
const map = L.map('map', { zoomSnap: 0.25, scrollWheelZoom: false }).setView([-2, 118], 5)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxNativeZoom: 16, maxZoom: 19 }).addTo(map)
map.createPane('labels')
map.getPane('labels').style.zIndex = 450
map.getPane('labels').style.pointerEvents = 'none'
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { pane: 'labels', maxNativeZoom: 16, maxZoom: 19 }).addTo(map)
const layers = Object.fromEntries(['regions', 'active', 'baseline', 'community', 'satellite', 'shelters', 'routes'].map((name) => [name, L.layerGroup()]))
for (const name of ['regions', 'active', 'shelters']) layers[name].addTo(map)

function element(tag, className, text) {
  const result = document.createElement(tag)
  if (className) result.className = className
  if (text != null) result.textContent = text
  return result
}
function badge(text = '', signal) {
  const simulation = text.startsWith('Simulation · ')
  const level = signal || (levels.includes(text) ? text : null)
  return element('span', 'badge' + (simulation ? ' is-simulation' : level ? ' is-' + level.toLowerCase() : ''), simulation ? text : readable(level || text))
}
function notice(text, kind = 'info') {
  $('notice').textContent = text
  $('notice').className = 'notice ' + kind
  $('notice').hidden = !text
}
function connection(text, kind) {
  $('connection').textContent = text
  $('connection-dot').className = 'live-dot ' + kind
  $('connection-dot').setAttribute('aria-label', text)
}
function numeric(value) {
  const result = element('strong', value == null ? 'unknown' : '', number(value))
  if (value == null) { result.title = 'No data'; result.setAttribute('aria-label', 'Unknown') }
  return result
}
function mapControl(id, position) {
  const control = L.control({ position })
  control.onAdd = () => {
    const node = $(id)
    L.DomEvent.disableClickPropagation(node)
    L.DomEvent.disableScrollPropagation(node)
    return node
  }
  control.addTo(map)
}
mapControl('map-legend', 'bottomleft')
mapControl('map-layers', 'topright')
$('toggle-layers').onclick = () => {
  const open = $('layers').hidden
  $('layers').hidden = !open
  $('toggle-layers').setAttribute('aria-expanded', String(open))
}
function metric(target, label, value, note) {
  const item = element('div', 'metric')
  item.append(element('label', '', label), numeric(value))
  if (note) item.append(element('small', '', note))
  target.append(item)
}
function evidenceRow(target, title, description, tag) {
  const row = element('div', 'evidence-row')
  const info = element('div')
  info.append(element('strong', '', title == null || title === 'UNKNOWN' ? 'Unknown' : title), element('small', '', description == null || description === 'UNKNOWN' ? 'Unknown' : description))
  row.append(info, element('span', 'badge', readable(tag)))
  if (description?.includes('—')) info.setAttribute('aria-label', (title + '. ' + description).replaceAll('—', 'Unknown'))
  target.append(row)
}
async function api(path, options = {}) {
  const response = await fetch('/api/command/' + path, { ...options, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
  if (!response.ok) {
    if (response.status === 503) throw new Error('EvacuAid backend is unavailable. Start the backend to load regional data.')
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : error.detail?.message || 'Unable to save or load command data (HTTP ' + response.status + ').')
  }
  return response.status === 204 ? null : response.json()
}
async function allRegions(params) {
  const rows = []
  for (let offset = 0; ; offset += 200) {
    const query = new URLSearchParams(params)
    query.set('limit', 200); query.set('offset', offset)
    const batch = await api('regions?' + query)
    rows.push(...batch)
    if (batch.length < 200) return rows
  }
}
function renderKpis() {
  const rows = state.regions
  const sum = (key) => rows.length && rows.every((r) => r[key] != null) ? rows.reduce((total, r) => total + r[key], 0) : null
  const known = rows.filter((r) => r.signalLevel !== 'UNKNOWN' && r.signalLevel !== 'NORMAL').length
  const unknown = rows.filter((r) => r.signalLevel === 'UNKNOWN').length
  const unknownNote = unknown ? ' · ' + unknown + ' unknown' : ''
  const values = [
    ['Regions with hazard signals', rows.some((r) => r.signalLevel !== 'UNKNOWN') ? known : null, 'Watch or higher' + unknownNote, 'Includes baseline WATCH · ' + unknown + ' regions UNKNOWN'],
    ['Critical regions', rows.some((r) => r.signalLevel !== 'UNKNOWN') ? rows.filter((r) => r.signalLevel === 'CRITICAL').length : null, 'Official critical signals' + unknownNote, 'Known official critical signals · ' + unknown + ' regions UNKNOWN'],
    ['Population exposed (est.)', sum('estimatedExposedPopulation'), sum('estimatedExposedPopulation') == null ? 'No data' : 'Area-weighted estimate', 'Approximate · missing regions → UNKNOWN'],
    ['Active assistance requests', sum('activeAssistanceCount'), 'From recently located people', 'Recently located requester profiles'],
    ['Recorded shelters', sum('recordedShelterCount'), 'Reference inventory', 'Reference inventory · no live occupancy tracking'],
  ]
  $('kpis').replaceChildren()
  for (const [label, value, note, title] of values) {
    const card = element('div', 'kpi')
    card.title = title
    card.append(element('label', '', label), numeric(value), element('small', '', note))
    $('kpis').append(card)
  }
}
function renderRegions() {
  layers.regions.clearLayers()
  $('priorities').replaceChildren()
  $('region-count').textContent = state.regions.length + ' regions'
  let selectedLayer = null
  for (const region of state.regions) {
    const level = region.simulation ? region.simulation.signalLevel : region.signalLevel
    const selected = state.selected === region.id
    const style = { color: selected || region.simulation ? accent : stroke[level], weight: selected ? 2.5 : region.simulation ? 2 : 1, opacity: .9, fillColor: fill[level], fillOpacity: .55, dashArray: region.simulation ? '4 4' : null }
    const layer = L.geoJSON(region.geometry, { style })
    layer.on('mouseover', () => layer.setStyle({ weight: selected ? 2.5 : 2 }))
    layer.on('mouseout', () => layer.setStyle(style))
    layer.bindTooltip(element('span', '', (region.simulation ? 'Simulation · ' : '') + titleCase(region.name) + ' · ' + readable(level)))
    layer.on('click', () => { if (!mapTools.isPlacing()) selectRegion(region.id) })
    layer.addTo(layers.regions)
    if (selected) selectedLayer = layer
    const row = element('button', 'priority-row' + (state.selected === region.id ? ' selected' : ''))
    const top = element('div', 'row-top')
    top.append(element('strong', '', titleCase(region.name)))
    const badges = element('span', 'row-badges')
    if (region.simulation) badges.append(badge('Simulation · ' + readable(region.simulation.signalLevel), region.simulation.signalLevel))
    badges.append(badge(region.signalLevel, region.signalLevel))
    top.append(badges)
    const updated = region.updatedAt ? new Date(region.updatedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB' : '—'
    const description = element('p', '', (region.activeAssistanceCount > 0 ? 'Assistance ' + number(region.activeAssistanceCount) + ' · ' : '') + 'Updated ' + updated + (region.estimatedExposedPopulation == null ? '' : ' · Est. exposed ' + number(region.estimatedExposedPopulation)))
    if (region.activeAssistanceCount == null || !region.updatedAt) description.setAttribute('aria-label', description.textContent.replaceAll('—', 'Unknown'))
    row.title = region.snapshotStale ? 'Projection unavailable / stale' : description.textContent.replaceAll('—', 'Unknown')
    row.append(top, description)
    row.addEventListener('click', () => selectRegion(region.id))
    $('priorities').append(row)
  }
  if (selectedLayer) selectedLayer.bringToFront()
  if (!state.regions.length) $('priorities').append(element('p', 'empty', 'No imported regions match these filters. Import administrative GeoJSON to begin.'))
}
function clearSelection() {
  state.selectionGeneration++
  state.selected = null
  for (const [name, layer] of Object.entries(layers)) if (name !== 'regions') layer.clearLayers()
  $('selected-name').textContent = 'Choose a region'
  $('selected-signal').textContent = 'Unknown'
  $('selected-signal').className = 'badge is-unknown'
  $('hierarchy').textContent = 'Select a polygon or a priority region.'
  $('population-note').removeAttribute('title')
  for (const id of ['simulation-note', 'region-metrics', 'population-note', 'hazard-list', 'shelter-summary', 'shelter-list', 'needs', 'sources']) $(id).replaceChildren()
  $('routing').removeAttribute('aria-label')
  $('routing').textContent = 'Responder inventory and regional routing status: Unknown.'
}
async function selectRegion(id) {
  const generation = ++state.selectionGeneration
  try {
    const detail = await api('regions/' + id)
    if (generation !== state.selectionGeneration) return
    state.selected = id
    renderRegions()
    $('selected-name').textContent = titleCase(detail.name)
    $('hierarchy').textContent = detail.hierarchy.map((r) => titleCase(r.name)).join(' / ') || readable(detail.administrativeLevel)
    $('selected-signal').replaceWith(Object.assign(badge(detail.signalLevel, detail.signalLevel), { id: 'selected-signal' }))
    $('simulation-note').textContent = detail.simulation ? 'Simulation: ' + readable(detail.simulation.signalLevel) + ' ' + detail.simulation.hazardTypes.map(type => hazardName(type).toLowerCase()).join(', ') + ', ' + detail.simulation.names.join(', ') + '. Official signal unchanged.' : ''
    $('region-metrics').replaceChildren()
    for (const [label, value] of [['Reference population', detail.population], ['Estimated exposed', detail.estimatedExposedPopulation], ['Active assistance', detail.assistance.activeAssistanceCount], ['Evacuating requests', detail.assistance.evacuatingCount], ['Safe request statuses', detail.assistance.safeCheckInCount], ['Unknown safety', detail.assistance.unknownSafetyCount]]) metric($('region-metrics'), label, value)
    $('population-note').title = (detail.dataMode === 'SIMULATION' ? 'SIMULATION / DEMO DATA. ' : '') + 'Population: ' + (detail.populationSource || 'UNKNOWN source') + ' / ' + (detail.populationReferenceYear || 'UNKNOWN year') + '. Exposure method: ' + detail.exposureEstimationMethod + '. Area-weighted estimates assume uniformly distributed population. No exact affected-person count. Projection: ' + time(detail.updatedAt) + (detail.snapshotStale ? ' · STALE' : '') + '. ' + detail.assistance.scope
    const population = !detail.populationSource && !detail.populationReferenceYear ? 'Population source and year unknown' : 'Population: ' + sourceName(detail.populationSource) + ' / ' + (detail.populationReferenceYear || 'Unknown')
    const exposure = detail.exposureEstimationMethod && detail.exposureEstimationMethod !== 'UNKNOWN' ? '; exposure method: ' + readable(detail.exposureEstimationMethod).toLowerCase() : ''
    const updated = detail.updatedAt ? new Date(detail.updatedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Unknown'
    $('population-note').textContent = (detail.dataMode === 'SIMULATION' ? 'Simulation data. ' : '') + population + exposure + '. Projection updated ' + updated + '.' + (detail.snapshotStale ? ' Stale.' : '')
    $('needs').replaceChildren()
    for (const [label, key] of [['Mobility', 'mobilityNeedCount'], ['Visual', 'visualNeedCount'], ['Hearing', 'hearingNeedCount'], ['Elderly', 'elderlyNeedCount'], ['Other', 'otherNeedCount']]) {
      const item = element('div', 'need')
      item.append(numeric(detail.assistance[key]), element('span', '', label))
      $('needs').append(item)
    }
    $('shelter-summary').replaceChildren()
    for (const [label, value] of [['Recorded shelters', detail.recordedShelterCount], ['Reference capacity', detail.totalShelterCapacity]]) metric($('shelter-summary'), label, value)
    $('shelter-list').replaceChildren()
    $('hazard-list').replaceChildren()
    $('sources').replaceChildren()
    for (const [name, layer] of Object.entries(layers)) if (name !== 'regions') layer.clearLayers()
    for (const shelter of detail.shelters) {
      const access = shelter.wheelchairAccessible === true ? 'step-free access reported' : shelter.wheelchairAccessible === false ? 'not reported step-free' : 'step-free access unknown'
      evidenceRow($('shelter-list'), shelter.name, 'Capacity ' + number(shelter.capacity) + ' · ' + access + ' · ' + sourceName(shelter.source) + ' · recorded ' + time(shelter.verifiedAt), shelter.status)
      L.geoJSON(shelter.geometry, { pointToLayer: (_, point) => L.circleMarker(point, { radius: 6, color: accent, fillColor: '#fff', fillOpacity: 1, weight: 2 }) }).bindPopup(element('span', '', shelter.name + ' · capacity ' + number(shelter.capacity))).addTo(layers.shelters)
    }
    if (!detail.shelters.length) $('shelter-list').append(element('p', 'empty', 'No shelter records for this region.'))
    operations.setRegion(detail)
    evidenceRow($('sources'), 'Administrative boundary', sourceName(detail.boundarySource), detail.dataMode)
    evidenceRow($('sources'), 'Reference population', sourceName(detail.populationSource) + ' / ' + (detail.populationReferenceYear || 'Unknown'), detail.dataMode)
    const hazardGroups = new Map()
    const freshnessOrder = ['REFERENCE', 'FRESH', 'STALE', 'EXPIRED', 'UNKNOWN']
    for (const hazard of detail.hazards) {
      const key = JSON.stringify([hazard.hazardType, hazard.source, hazard.evidenceType, hazard.provenanceClass])
      const group = hazardGroups.get(key)
      if (group) {
        group.count++
        if (freshnessOrder.indexOf(hazard.freshness || 'UNKNOWN') > freshnessOrder.indexOf(group.freshness || 'UNKNOWN')) group.freshness = hazard.freshness
      } else hazardGroups.set(key, { ...hazard, count: 1 })
    }
    for (const hazard of hazardGroups.values()) {
      const kind = { BASELINE_HAZARD: 'susceptibility', ACTIVE_WARNING: 'warning', CRITICAL_HAZARD: 'critical hazard', OBSERVATION: 'observation', CONFIRMED_CLOSURE: 'closure' }[hazard.evidenceType] || readable(hazard.evidenceType).toLowerCase()
      evidenceRow($('hazard-list'), hazardName(hazard.hazardType) + ' ' + kind + (hazard.count > 1 ? ' · ' + hazard.count + ' areas' : ''), sourceName(hazard.source) + ' · ' + provenanceName(hazard.provenanceClass), hazard.freshness)
      // One sources row per grouped layer, not one per polygon.
      evidenceRow($('sources'), sourceName(hazard.source) + ' · ' + hazardName(hazard.hazardType), [hazard.observedAt ? 'Observed ' + time(hazard.observedAt) : 'No observation time', hazard.expiresAt ? 'expires ' + time(hazard.expiresAt) : null, hazard.count > 1 ? hazard.count + ' areas' : null].filter(Boolean).join(' · '), provenanceName(hazard.provenanceClass))
    }
    for (const hazard of detail.hazards) {
      if (!hazard.active || !['FRESH', 'REFERENCE'].includes(hazard.freshness) || detail.snapshotStale) continue
      const baseline = hazard.provenanceClass === 'OFFICIAL_BASELINE'
      const target = baseline ? 'baseline' : hazard.provenanceClass === 'COMMUNITY_OBSERVATION' ? 'community' : hazard.provenanceClass === 'SATELLITE_OBSERVATION' ? 'satellite' : 'active'
      L.geoJSON(hazard.geometry, { style: { color: baseline ? '#8663af' : '#c63f4e', weight: 2, dashArray: baseline ? '5 5' : null, fillOpacity: baseline ? .06 : .17 }, pointToLayer: (_, point) => L.circleMarker(point, { radius: 6, color: target === 'community' ? '#277ac0' : '#dc8132', fillOpacity: .6 }) }).bindTooltip(element('span', '', sourceName(hazard.source) + ' · ' + provenanceName(hazard.provenanceClass))).addTo(layers[target])
    }
    if (!detail.hazards.length) $('hazard-list').append(element('p', 'empty', 'Hazard evidence: Unknown. No intersecting normalized evidence in this projection.'))
    evidenceRow($('sources'), 'Reported profiles / assistance', readable(detail.metricProvenance.assistance), detail.dataMode)
    $('routing').textContent = 'Responders available: ' + number(detail.availableResponderCount) + ' · assigned: ' + number(detail.assignedResponderCount) + '. Routes feasible: ' + number(detail.feasibleRouteCount) + ' · blocked: ' + number(detail.blockedRouteCount) + ' · no feasible route: ' + number(detail.noFeasibleRouteCount) + '. ' + detail.limitations.join(' ')
    $('routing').setAttribute('aria-label', $('routing').textContent.replaceAll('—', 'Unknown'))
  } catch (error) { if (generation === state.selectionGeneration) notice(error.message, 'error') }
}
async function refresh({ fitView = true } = {}) {
  const generation = ++state.generation
  const previousSelection = state.selected
  clearSelection()
  state.regions = []
  renderRegions(); renderKpis()
  connection('Loading projections…', 'loading')
  const params = { administrativeLevel: $('level').value, dataMode: $('dataMode').value }
  for (const [id, key] of [['parent', 'parentRegionId'], ['hazard', 'hazardType'], ['signal', 'signalLevel']]) if ($(id).value) params[key] = $(id).value
  try {
    const rows = await allRegions(params)
    if (generation !== state.generation) return
    state.regions = rows
    renderRegions(); renderKpis()
    await mapTools.loadReal()
    if (generation !== state.generation) return
    const centroids = rows.filter(region => region.centroid?.type === 'Point' && region.centroid.coordinates?.length >= 2).map(region => [region.centroid.coordinates[1], region.centroid.coordinates[0]])
    if (fitView && centroids.length) {
      const median = (values) => {
        const sorted = values.slice().sort((a, b) => a - b)
        const middle = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
      }
      const latitude = median(centroids.map(([lat]) => lat))
      const longitude = median(centroids.map(([, lng]) => lng))
      // ponytail: Outlying islands are left out of the initial frame on purpose.
      const mainland = centroids.filter(([lat, lng]) => Math.abs(lat - latitude) <= 0.25 && Math.abs(lng - longitude) <= 0.25)
      map.invalidateSize() // the container reaches its CSS height after Leaflet first measured it
      map.fitBounds(L.latLngBounds(mainland.length >= 3 ? mainland : centroids), { padding: [24, 24], maxZoom: 13 })
    }
    else if (fitView && !rows.length) map.setView([-2, 118], 5)
    const demo = $('dataMode').value === 'SIMULATION'
    const stale = rows.filter((r) => r.snapshotStale).length
    const explanation = (demo ? 'Simulation data. Synthetic administrative boundaries and population; not real operational statistics. ' : 'Operational data. ') + rows.length + ' regions in the current filter scope. ' + stale + ' unavailable/stale projections. Signal counts show known evidence only; numeric totals become Unknown when a contributing metric is missing. ' + (!rows.length ? 'Import administrative GeoJSON using the command importer.' : 'Hazard and shelter overlays load when a region is selected.')
    if (!demo) $('about-data-text').textContent = explanation
    notice(demo || !rows.length ? explanation : '', demo ? 'simulation' : 'info')
    connection(!rows.length ? 'Connected · no regions in this scope' : stale === rows.length ? 'Connected · regional snapshots unavailable' : 'Connected · ' + rows.length + ' regions · ' + stale + ' stale', 'connected')
    if (rows.length) await selectRegion(rows.some((r) => r.id === previousSelection) ? previousSelection : rows[0].id)
  } catch (error) {
    if (generation !== state.generation) return
    state.regions = []; clearSelection(); renderRegions(); renderKpis()
    connection('Connection unavailable', 'error')
    notice(error.message, 'error')
  }
}
async function updateParents() {
  $('parent').replaceChildren(new Option('All parents', ''))
  const level = { VILLAGE: 'DISTRICT', DISTRICT: 'CITY_REGENCY', CITY_REGENCY: 'PROVINCE' }[$('level').value]
  if (!level) return
  const mode = $('dataMode').value
  try {
    const parents = await allRegions({ administrativeLevel: level, dataMode: mode })
    if ($('dataMode').value !== mode || { VILLAGE: 'DISTRICT', DISTRICT: 'CITY_REGENCY', CITY_REGENCY: 'PROVINCE' }[$('level').value] !== level) return
    for (const parent of parents) $('parent').append(new Option(titleCase(parent.name), parent.id))
  } catch (error) { notice(error.message, 'error') }
}
const mapTools = setupMapTools({ map, api, refresh })
const operations = setupOperations({ map, api, routeLayer: layers.routes, isPlacing: () => mapTools.isPlacing() })
$('refresh').onclick = refresh
for (const id of ['dataMode', 'level']) $(id).onchange = async () => { await updateParents(); await refresh() }
for (const id of ['parent', 'hazard', 'signal']) $(id).onchange = refresh
$('layers').onchange = (event) => { const layer = layers[event.target.dataset.layer]; if (layer) event.target.checked ? layer.addTo(map) : map.removeLayer(layer) }
renderKpis()
updateParents().then(refresh)
setInterval(() => { if (!document.hidden && !mapTools.isPlacing() && !$('placement-dialog').open) refresh({ fitView: false }) }, 60000)
