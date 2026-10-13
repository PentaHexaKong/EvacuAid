const $ = id => document.getElementById(id)
const storageKey = 'evacuaid-command-mocks-v1'

export function setupMapTools({ map, api, refresh }) {
  const idleStatus = $('map-action-status').textContent
  const tokens = getComputedStyle(document.documentElement)
  const mockStroke = tokens.getPropertyValue('--mock-stroke').trim()
  const safeHouseStroke = tokens.getPropertyValue('--safe-house-stroke').trim()
  const surface = tokens.getPropertyValue('--surface').trim()
  const mockLayer = L.layerGroup().addTo(map)
  const realHouses = L.layerGroup().addTo(map)
  let items = []
  let disasters = []
  let placement = null
  let draft = null
  let saving = false
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
    if (Array.isArray(stored)) items = stored.filter(item => item.kind === 'safeHouse' && typeof item.name === 'string' && typeof item.id === 'string' && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90 && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180).slice(0, 200)
  } catch { $('map-action-status').textContent = 'Saved mock items could not be loaded. You can start a new mock scenario.' }
  persist()
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(items)) }
    catch { $('map-action-status').textContent = 'Browser storage unavailable. Mock items remain available for this tab only.' }
  }
  function label(text) {
    const span = document.createElement('span')
    span.textContent = text
    return span
  }
  // The server hides counts below 5 (null) so a small count can't reveal whether someone is at a point.
  const reach = count => count === undefined ? '' : count === null ? 'under 5 users in area' : count.toLocaleString('en-US') + ' users in area'
  function renderMocks() {
    mockLayer.clearLayers()
    $('mock-items').replaceChildren()
    for (const item of [...disasters, ...items]) {
      if (item.kind === 'safeHouse' && !$('mock-mode').checked) continue
      const point = [item.latitude, item.longitude]
      const word = value => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
      const text = (item.kind === 'hazard' ? 'Simulation · ' : 'Mock · ') + item.name + (item.kind === 'hazard' ? ' · ' + word(item.hazardType) + ' · ' + word(item.severity) + (reach(item.usersInArea) && ' · ' + reach(item.usersInArea)) : ' · Safe house')
      const layer = item.kind === 'hazard'
        ? L.circle(point, { radius: item.radiusM, color: mockStroke, dashArray: '6 4', fillOpacity: .18 })
        : L.circleMarker(point, { radius: 9, color: mockStroke, fillColor: surface, fillOpacity: 1, weight: 3 })
      layer.bindTooltip(label(text)).addTo(mockLayer)
      const row = document.createElement('div')
      row.className = 'mock-item'
      const focus = document.createElement('button')
      focus.textContent = text
      focus.onclick = () => map.setView(point, Math.max(map.getZoom(), 13))
      const remove = document.createElement('button')
      remove.textContent = 'Remove'
      remove.setAttribute('aria-label', 'Remove ' + item.name)
      remove.onclick = async () => {
        remove.disabled = true
        try {
          if (item.kind === 'hazard') await api('mock-disasters/' + item.id, { method: 'DELETE' })
          else { items = items.filter(value => value.id !== item.id); persist() }
          await loadMocks()
          await refresh({ fitView: false })
        } catch (error) { $('map-action-status').textContent = error.message; remove.disabled = false }
      }
      row.append(focus, remove)
      $('mock-items').append(row)
    }
    if (!items.length && !disasters.length) $('mock-items').append(label('No mock items. Choose Add mock disaster or Add safe house, then click the map.'))
    // Active test warnings stay listed outside mock mode; the empty hint only matters while placing mocks.
    $('mock-items').hidden = !$('mock-mode').checked && !disasters.length
  }
  function cancelPlacement() {
    placement = null
    map.getContainer().style.cursor = ''
    $('cancel-map-placement').hidden = true
    $('map-action-status').textContent = $('mock-mode').checked ? 'MOCK MODE · Choose a tool, then click the map. Live region statistics remain unchanged.' : idleStatus
  }
  function begin(kind) {
    placement = kind
    map.getContainer().style.cursor = 'crosshair'
    $('cancel-map-placement').hidden = false
    $('map-action-status').textContent = 'Click the map to place ' + (kind === 'hazard' ? 'a mock disaster.' : 'a safe house.')
  }
  $('mock-mode').onchange = () => {
    cancelPlacement()
    const mock = $('mock-mode').checked
    $('mock-banner').hidden = !mock
    $('reset-mocks').hidden = !mock
    $('add-disaster').disabled = !mock
    $('add-safe-house').textContent = mock ? 'Add mock safe house' : 'Add safe house'
    renderMocks()
  }
  $('add-disaster').onclick = () => { if ($('mock-mode').checked) begin('hazard') }
  $('add-safe-house').onclick = () => begin('safeHouse')
  $('cancel-map-placement').onclick = cancelPlacement
  $('reset-mocks').onclick = async () => {
    try {
      await api('mock-disasters', { method: 'DELETE' })
      items = []; persist(); cancelPlacement()
      await loadMocks()
      await refresh({ fitView: false })
    } catch (error) { $('map-action-status').textContent = error.message }
  }
  map.on('click', event => {
    if (!placement || saving) return
    const point = event.latlng.wrap()
    draft = { id: crypto.randomUUID(), kind: placement, mock: $('mock-mode').checked, latitude: point.lat, longitude: point.lng }
    cancelPlacement()
    $('placement-form').reset()
    $('placement-error').textContent = ''
    const disaster = draft.kind === 'hazard'
    $('disaster-fields').hidden = !disaster
    $('safe-house-fields').hidden = disaster
    $('mock-radius').disabled = !disaster
    $('placement-title').textContent = disaster ? 'Add mock disaster' : draft.mock ? 'Add mock safe house' : 'Add safe house'
    $('placement-environment').textContent = disaster ? 'Simulation · sends a test alert to phones in the area' : draft.mock ? 'Mock · this browser only' : 'Operational · saves to backend'
    $('placement-environment').className = 'badge' + (disaster || draft.mock ? ' is-simulation' : '')
    $('placement-coordinates').textContent = 'Location: ' + draft.latitude.toFixed(6) + ', ' + draft.longitude.toFixed(6)
    $('placement-dialog').showModal()
    $('placement-name').focus()
  })
  $('cancel-placement').onclick = () => { if (!saving) $('placement-dialog').close() }
  $('placement-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault() })
  $('placement-form').onsubmit = async event => {
    event.preventDefault()
    if (!draft || saving) return
    saving = true
    $('save-placement').disabled = true
    $('save-placement').textContent = 'Saving…'
    $('cancel-placement').disabled = true
    $('placement-error').textContent = ''
    try {
      const name = $('placement-name').value.trim()
      if (!name) throw new Error('Enter a name.')
      const item = { id: draft.id, kind: draft.kind, name, latitude: draft.latitude, longitude: draft.longitude }
      if (draft.kind === 'hazard') Object.assign(item, { radiusM: Number($('mock-radius').value), hazardType: $('mock-hazard').value, severity: $('mock-severity').value })
      else {
        const optionalNumber = id => $(id).value === '' ? null : Number($(id).value)
        Object.assign(item, { address: $('safe-address').value.trim() || null, status: $('safe-status').value, capacity: optionalNumber('safe-capacity'), wheelchairAccessible: $('safe-access').value === '' ? null : $('safe-access').value === 'true', verifiedNow: $('safe-verified').checked })
      }
      if (draft.kind === 'hazard') {
        const { kind, ...payload } = item
        const { usersInArea } = await api('mock-disasters', { method: 'POST', body: JSON.stringify(payload) })
        await loadMocks()
        await refresh({ fitView: false })
        $('map-action-status').textContent = name + ' placed. ' + (usersInArea === undefined ? 'Phones inside the area get a test alert within a minute.'
          : usersInArea === null ? 'Fewer than 5 EvacuAid users are in the area, so the exact count is hidden. They get a test alert within a minute.'
          : usersInArea.toLocaleString('en-US') + ' EvacuAid users in the area get a test alert within a minute.')
      } else if (draft.mock) {
        if (items.length >= 200) throw new Error('Remove an existing mock item before adding more (limit 200).')
        items.push(item); persist(); await loadMocks()
        map.setView([item.latitude, item.longitude], Math.max(map.getZoom(), 13))
        $('map-action-status').textContent = name + ' saved in this browser only. Live data unchanged.'
      } else {
        const { kind, ...payload } = item
        await api('safe-houses', { method: 'POST', body: JSON.stringify(payload) })
        $('map-action-status').textContent = name + ' saved to the backend. Regional shelter projections refreshed.'
        await refresh({ fitView: false })
      }
      $('placement-dialog').close()
      draft = null
    } catch (error) { $('placement-error').textContent = error.message }
    finally { saving = false; $('save-placement').disabled = false; $('save-placement').textContent = 'Save'; $('cancel-placement').disabled = false }
  }
  async function loadMocks() {
    disasters = (await api('mock-disasters')).map(item => ({ ...item, kind: 'hazard' }))
    renderMocks()
  }
  loadMocks().catch(error => { $('map-action-status').textContent = error.message })
  async function loadReal() {
    await loadMocks()
    const houses = []
    for (let offset = 0; ; offset += 200) {
      const batch = await api('safe-houses?limit=200&offset=' + offset)
      houses.push(...batch)
      if (batch.length < 200) break
    }
    realHouses.clearLayers()
    for (const house of houses) L.circleMarker([house.latitude, house.longitude], {radius:8,color:safeHouseStroke,fillColor:surface,fillOpacity:1,weight:3}).bindTooltip(label(house.name + ' · Safe house · ' + house.status)).addTo(realHouses)
  }
  return { isPlacing: () => !!placement || saving, loadReal }
}
