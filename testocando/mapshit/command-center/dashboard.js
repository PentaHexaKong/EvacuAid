import { setupMapTools } from './mapTools.js'
const $ = (id) => document.getElementById(id)
const colors = { NORMAL: '#39a987', WATCH: '#d2b747', ELEVATED: '#e68b35', CRITICAL: '#dc4c53', UNKNOWN: '#82929e' }
const number = (value) => value == null ? 'UNKNOWN' : new Intl.NumberFormat('en-US').format(value)
const time = (value) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'UNKNOWN'
const state = { regions: [], selected: null, generation: 0, selectionGeneration: 0 }
const map = L.map('map', { scrollWheelZoom: false }).setView([-2, 118], 5)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map)
const layers = Object.fromEntries(['regions', 'active', 'baseline', 'community', 'satellite', 'shelters', 'routes'].map((name) => [name, L.layerGroup()]))
for (const name of ['regions', 'active', 'shelters']) layers[name].addTo(map)

function element(tag, className, text) {
  const result = document.createElement(tag)
  if (className) result.className = className
  if (text != null) result.textContent = text
  return result
}
function badge(text, signal) {
  const result = element('span', 'tag', text)
  if (signal && colors[signal]) { result.style.color = colors[signal]; result.style.borderColor = colors[signal] + '66' }
  return result
}
function notice(text, kind = '') { $('notice').textContent = text; $('notice').className = 'notice ' + kind }
function metric(target, label, value, note) {
  const item = element('div', 'metric')
  item.append(element('label', '', label), element('strong', value == null ? 'unknown' : '', number(value)))
  if (note) item.append(element('small', '', note))
  target.append(item)
}
function evidenceRow(target, title, description, tag) {
  const row = element('div', 'evidence-row')
  const info = element('div')
  info.append(element('strong', '', title), element('small', '', description))
  row.append(info, badge(tag))
  target.append(row)
}
async function api(path, options = {}) {
  const response = await fetch('/api/command/' + path, { ...options, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
  if (!response.ok) {
    if (response.status === 503) throw new Error('EvacuAid backend is unavailable. Start the backend to load regional data.')
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Unable to save or load command data (HTTP ' + response.status + ').')
  }
  return response.json()
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
  const values = [
    ['Regions with Hazard Signals', rows.some((r) => r.signalLevel !== 'UNKNOWN') ? known : null, 'Includes baseline WATCH · ' + rows.filter((r) => r.signalLevel === 'UNKNOWN').length + ' regions UNKNOWN'],
    ['Critical Regions', rows.some((r) => r.signalLevel !== 'UNKNOWN') ? rows.filter((r) => r.signalLevel === 'CRITICAL').length : null, 'Known official critical signals · ' + rows.filter((r) => r.signalLevel === 'UNKNOWN').length + ' regions UNKNOWN'],
    ['Estimated Population Exposed', sum('estimatedExposedPopulation'), 'Approximate · missing regions → UNKNOWN'],
    ['Active Assistance Requests', sum('activeAssistanceCount'), 'Recently located requester profiles'],
    ['Available Shelters', sum('availableShelterCount'), 'Verified records only · inventory coverage UNKNOWN'],
  ]
  $('kpis').replaceChildren()
  for (const [label, value, note] of values) {
    const card = element('div', 'kpi')
    card.append(element('label', '', label), element('strong', value == null ? 'unknown' : '', number(value)), element('small', '', note))
    $('kpis').append(card)
  }
}
function renderRegions() {
  layers.regions.clearLayers()
  $('priorities').replaceChildren()
  $('region-count').textContent = state.regions.length + ' REGIONS'
  for (const region of state.regions) {
    const layer = L.geoJSON(region.geometry, { style: { color: colors[region.signalLevel], weight: 1.5, fillColor: colors[region.signalLevel], fillOpacity: .3 } })
    layer.bindTooltip(element('span', '', region.name + ' · ' + region.signalLevel))
    layer.on('click', () => { if (!mapTools.isPlacing()) selectRegion(region.id) })
    layer.addTo(layers.regions)
    const row = element('button', 'priority-row' + (state.selected === region.id ? ' selected' : ''))
    const top = element('div', 'row-top')
    top.append(element('strong', '', region.name), badge(region.signalLevel, region.signalLevel))
    row.append(top, element('p', '', 'Est. exposed ' + number(region.estimatedExposedPopulation) + ' · Assistance ' + number(region.activeAssistanceCount)), element('small', '', (region.dataMode === 'SIMULATION' ? 'SIMULATION · ' : '') + (region.snapshotStale ? 'Projection unavailable / stale' : 'Updated ' + time(region.updatedAt))))
    row.addEventListener('click', () => selectRegion(region.id))
    $('priorities').append(row)
  }
  if (!state.regions.length) $('priorities').append(element('p', 'empty', 'No imported regions match these filters. Import administrative GeoJSON to begin.'))
}
function clearSelection() {
  state.selectionGeneration++
  state.selected = null
  for (const [name, layer] of Object.entries(layers)) if (name !== 'regions') layer.clearLayers()
  $('selected-name').textContent = 'Choose a region'
  $('selected-signal').textContent = 'UNKNOWN'
  $('hierarchy').textContent = 'Select a polygon or a priority region.'
  for (const id of ['region-metrics', 'population-note', 'hazard-list', 'shelter-summary', 'shelter-list', 'needs', 'sources']) $(id).replaceChildren()
  $('routing').textContent = 'Responder inventory and regional routing status: UNKNOWN.'
}
async function selectRegion(id) {
  const generation = ++state.selectionGeneration
  try {
    const detail = await api('regions/' + id)
    if (generation !== state.selectionGeneration) return
    state.selected = id
    renderRegions()
    $('selected-name').textContent = detail.name
    $('hierarchy').textContent = detail.hierarchy.map((r) => r.name).join(' / ') || detail.administrativeLevel
    $('selected-signal').replaceWith(Object.assign(badge(detail.signalLevel, detail.signalLevel), { id: 'selected-signal' }))
    $('region-metrics').replaceChildren()
    for (const [label, value] of [['Reference population', detail.population], ['Estimated exposed', detail.estimatedExposedPopulation], ['Active assistance', detail.assistance.activeAssistanceCount], ['Evacuating requests', detail.assistance.evacuatingCount], ['Safe request statuses', detail.assistance.safeCheckInCount], ['Unknown safety', detail.assistance.unknownSafetyCount]]) metric($('region-metrics'), label, value)
    $('population-note').textContent = (detail.dataMode === 'SIMULATION' ? 'SIMULATION / DEMO DATA. ' : '') + 'Population: ' + (detail.populationSource || 'UNKNOWN source') + ' / ' + (detail.populationReferenceYear || 'UNKNOWN year') + '. Exposure method: ' + detail.exposureEstimationMethod + '. Area-weighted estimates assume uniformly distributed population. No exact affected-person count. Projection: ' + time(detail.updatedAt) + (detail.snapshotStale ? ' · STALE' : '') + '. ' + detail.assistance.scope
    $('needs').replaceChildren()
    for (const [label, key] of [['Mobility', 'mobilityNeedCount'], ['Visual', 'visualNeedCount'], ['Hearing', 'hearingNeedCount'], ['Elderly', 'elderlyNeedCount'], ['Other', 'otherNeedCount']]) {
      const item = element('div', 'need')
      item.append(element('strong', detail.assistance[key] == null ? 'unknown' : '', number(detail.assistance[key])), element('span', '', label))
      $('needs').append(item)
    }
    $('shelter-summary').replaceChildren()
    for (const [label, value] of [['Available', detail.availableShelterCount], ['Reference capacity', detail.totalShelterCapacity], ['Known occupancy subtotal', detail.knownShelterOccupancy], ['Unknown occupancy records', detail.unknownShelterOccupancyCount]]) metric($('shelter-summary'), label, value)
    $('shelter-list').replaceChildren()
    $('hazard-list').replaceChildren()
    $('sources').replaceChildren()
    for (const [name, layer] of Object.entries(layers)) if (name !== 'regions') layer.clearLayers()
    for (const shelter of detail.shelters) {
      evidenceRow($('shelter-list'), shelter.name, 'Occupancy ' + number(shelter.currentOccupancy) + ' / ' + number(shelter.capacity) + ' · ' + shelter.source + ' · verified ' + time(shelter.verifiedAt), shelter.status === 'OPEN' ? shelter.capacityStatus : shelter.status)
      L.geoJSON(shelter.geometry, { pointToLayer: (_, point) => L.circleMarker(point, { radius: 6, color: '#176d60', fillColor: '#fff', fillOpacity: 1, weight: 2 }) }).bindPopup(element('span', '', shelter.name + ' · ' + shelter.capacityStatus)).addTo(layers.shelters)
    }
    if (!detail.shelters.length) $('shelter-list').append(element('p', 'empty', 'No relevant shelter records. Occupancy coverage remains unknown.'))
    evidenceRow($('sources'), 'Administrative boundary', detail.boundarySource, detail.dataMode)
    evidenceRow($('sources'), 'Reference population', (detail.populationSource || 'UNKNOWN') + ' / ' + (detail.populationReferenceYear || 'UNKNOWN'), detail.dataMode)
    for (const hazard of detail.hazards) {
      evidenceRow($('hazard-list'), hazard.hazardType, hazard.source + ' · ' + hazard.evidenceType, hazard.freshness)
      evidenceRow($('sources'), hazard.source + ' · ' + hazard.hazardType, 'Observed ' + time(hazard.observedAt) + ' · expires ' + time(hazard.expiresAt) + ' · ' + hazard.freshness, hazard.provenanceClass)
      if (!hazard.active || !['FRESH', 'REFERENCE'].includes(hazard.freshness) || detail.snapshotStale) continue
      const baseline = hazard.provenanceClass === 'OFFICIAL_BASELINE'
      const target = baseline ? 'baseline' : hazard.provenanceClass === 'COMMUNITY_OBSERVATION' ? 'community' : hazard.provenanceClass === 'SATELLITE_OBSERVATION' ? 'satellite' : 'active'
      L.geoJSON(hazard.geometry, { style: { color: baseline ? '#8663af' : '#c63f4e', weight: 2, dashArray: baseline ? '5 5' : null, fillOpacity: baseline ? .06 : .17 }, pointToLayer: (_, point) => L.circleMarker(point, { radius: 6, color: target === 'community' ? '#277ac0' : '#dc8132', fillOpacity: .6 }) }).bindTooltip(element('span', '', hazard.source + ' · ' + hazard.provenanceClass)).addTo(layers[target])
    }
    if (!detail.hazards.length) $('hazard-list').append(element('p', 'empty', 'Hazard evidence: UNKNOWN. No intersecting normalized evidence in this projection.'))
    evidenceRow($('sources'), 'Reported profiles / assistance', detail.metricProvenance.assistance || 'UNKNOWN', detail.dataMode)
    $('routing').textContent = 'Responders available: ' + number(detail.availableResponderCount) + ' · assigned: ' + number(detail.assignedResponderCount) + '. Routes feasible: ' + number(detail.feasibleRouteCount) + ' · blocked: ' + number(detail.blockedRouteCount) + ' · no feasible route: ' + number(detail.noFeasibleRouteCount) + '. ' + detail.limitations.join(' ')
  } catch (error) { if (generation === state.selectionGeneration) notice(error.message, 'error') }
}
async function refresh({ fitView = true } = {}) {
  const generation = ++state.generation
  const previousSelection = state.selected
  clearSelection()
  state.regions = []
  renderRegions(); renderKpis()
  $('connection').textContent = 'Loading projections…'
  const params = { administrativeLevel: $('level').value, dataMode: $('dataMode').value }
  for (const [id, key] of [['parent', 'parentRegionId'], ['hazard', 'hazardType'], ['signal', 'signalLevel']]) if ($(id).value) params[key] = $(id).value
  try {
    const rows = await allRegions(params)
    if (generation !== state.generation) return
    state.regions = rows
    renderRegions(); renderKpis()
    await mapTools.loadReal()
    if (generation !== state.generation) return
    const featureGroup = L.featureGroup(layers.regions.getLayers())
    if (fitView && featureGroup.getBounds().isValid()) map.fitBounds(featureGroup.getBounds(), { padding: [24, 24], maxZoom: 13 })
    const demo = $('dataMode').value === 'SIMULATION'
    const stale = rows.filter((r) => r.snapshotStale).length
    notice((demo ? 'SIMULATION / DEMO DATA. Synthetic administrative boundaries and population; not real operational statistics. ' : 'REFERENCE / OPERATIONAL DATA. ') + rows.length + ' regions in the current filter scope. ' + stale + ' unavailable/stale projections. Signal counts show known evidence only; numeric totals become UNKNOWN when a contributing metric is missing. ' + (!rows.length ? 'Import administrative GeoJSON using the command importer.' : 'Hazard and shelter overlays load when a region is selected.'), demo ? 'simulation' : '')
    $('connection').textContent = !rows.length ? 'Connected · no regions in this scope' : stale === rows.length ? 'Connected · regional snapshots unavailable' : 'Connected · ' + rows.length + ' regions · ' + stale + ' stale'
    if (rows.length) await selectRegion(rows.some((r) => r.id === previousSelection) ? previousSelection : rows[0].id)
  } catch (error) {
    if (generation !== state.generation) return
    state.regions = []; clearSelection(); renderRegions(); renderKpis()
    $('connection').textContent = 'Connection unavailable'
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
    for (const parent of parents) $('parent').append(new Option(parent.name, parent.id))
  } catch (error) { notice(error.message, 'error') }
}
const mapTools = setupMapTools({ map, api, refresh })
$('refresh').onclick = refresh
for (const id of ['dataMode', 'level']) $(id).onchange = async () => { await updateParents(); await refresh() }
for (const id of ['parent', 'hazard', 'signal']) $(id).onchange = refresh
$('layers').onchange = (event) => { const layer = layers[event.target.dataset.layer]; if (layer) event.target.checked ? layer.addTo(map) : map.removeLayer(layer) }
renderKpis()
updateParents().then(refresh)
setInterval(() => { if (!document.hidden && !mapTools.isPlacing() && !$('placement-dialog').open) refresh({ fitView: false }) }, 60000)
