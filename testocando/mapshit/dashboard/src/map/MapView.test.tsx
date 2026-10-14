import { StrictMode, useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayerSpecification } from 'mapbox-gl'
import type { FeatureCollection } from './glMap'
import { MapProvider, useMap, useMapHost } from './MapProvider'
import { MapView } from './MapView'
import { circlePolygon } from './glMap'
import { readFileSync } from 'node:fs'

const mapCSS = readFileSync('src/map/map.css', 'utf8')

const mock = vi.hoisted(() => ({ supported: vi.fn(), width: 800, constructorThrows: false, setupThrows: false, maps: [] as InstanceType<typeof FakeMap>[], popup: { remove: vi.fn(), setDOMContent: vi.fn<(node: Node) => unknown>(), setLngLat: vi.fn(), addTo: vi.fn(), isOpen: vi.fn() } }))
const FakeMap = vi.hoisted(() => class FakeMap {
  container: HTMLElement
  canvas = document.createElement('canvas')
  events = new Map<string, Set<(event: unknown) => void>>()
  sources = new Map<string, { setData: ReturnType<typeof vi.fn<(data: FeatureCollection) => void>> }>()
  layers = new Map<string, LayerSpecification>()
  touchZoomRotate = { disableRotation: vi.fn() }
  addControl = vi.fn(() => { if (mock.setupThrows) throw new Error('Control setup failed') })
  resize = vi.fn()
  remove = vi.fn()
  fitBounds = vi.fn()
  setFeatureState = vi.fn()
  queryRenderedFeatures = vi.fn(() => [] as { source: string; properties: { fid: number } }[])
  setLayoutProperty = vi.fn()
  constructor(public options: { container: HTMLElement }) { if (mock.constructorThrows) throw new Error('WebGL construction failed'); this.container = options.container; Object.defineProperty(this.container, 'offsetWidth', { get: () => mock.width }); this.container.append(this.canvas); mock.maps.push(this) }
  on(name: string, cb: (event: unknown) => void) { if (!this.events.has(name)) this.events.set(name, new Set()); required(this.events.get(name)).add(cb); return this }
  off(name: string, cb: (event: unknown) => void) { this.events.get(name)?.delete(cb); return this }
  emit(name: string, event = {}) { for (const cb of [...(this.events.get(name) ?? [])]) cb(event) }
  getContainer() { return this.container }
  getCanvas() { return this.canvas }
  getStyle() { return { layers: [{ type: 'slot' }] } }
  addSource(id: string, options: { data: FeatureCollection }) { this.sources.set(id, { setData: vi.fn<(data: FeatureCollection) => void>() }); required(this.sources.get(id)).setData(options.data) }
  getSource(id: string) { return this.sources.get(id) }
  addLayer(layer: LayerSpecification) { this.layers.set(layer.id, layer) }
  getLayer(id: string) { return this.layers.get(id) }
})
vi.mock('mapbox-gl', () => ({ default: { Map: FakeMap, supported: mock.supported, NavigationControl: vi.fn(), Popup: vi.fn(function () { return mock.popup }) } }))
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Expected value'); return value }
let api: ReturnType<typeof useMap>
function Consumer() { const value = useMap(); useEffect(() => { api = value }, [value]); return null }
function Host({ show = true }: { show?: boolean }) { return <div id="map-host-boundary"><MapProvider><Consumer />{show && <MapView />}</MapProvider></div> }
const fc: FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'r1', geometry: { type: 'Point', coordinates: [106.8, -6.2] }, properties: { tooltip: '<b>Region</b>', color: '#123456', radius: 9 } }] }
function ready() { act(() => { required(mock.maps[0]).emit('style.load'); }); return required(mock.maps[0]) }
let styleElement: HTMLStyleElement
beforeEach(() => { styleElement = document.createElement('style'); styleElement.textContent = mapCSS; document.head.append(styleElement); mock.width = 800; mock.constructorThrows = false; mock.setupThrows = false; vi.clearAllMocks(); mock.maps.length = 0; mock.supported.mockReturnValue(true); window.EVACUAID_MAP = { mapboxToken: 'test-token', mapboxStyle: 'mapbox/standard' }; api = null; for (const name of ['remove', 'setDOMContent', 'setLngLat', 'addTo'] as const) mock.popup[name].mockReturnValue(mock.popup) })
afterEach(() => { cleanup(); styleElement.remove(); delete window.EVACUAID_MAP; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('shared map', () => {
  it('defers Jakarta framing until the parked map is visible and fits only once', () => {
    mock.width = 0
    const view = render(<Host show={false} />)
    const map = ready()
    expect(map.fitBounds).not.toHaveBeenCalled()
    mock.width = 800
    view.rerender(<Host />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.fitBounds).toHaveBeenCalledWith([[106.68, -6.38], [107.02, -6.08]], { padding: 24, maxZoom: 12, animate: false })
    view.rerender(<Host show={false} />)
    view.rerender(<Host />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
  })
  it('keeps a DOM tooltip out of GeoJSON while rendering a cloned tooltip', () => {
    render(<Host />); const map = ready()
    const tooltip = document.createElement('span')
    tooltip.textContent = 'Safe house'
    required(api).setLayer('safe-house', { type: 'FeatureCollection', features: [{ ...required(fc.features[0]), properties: { name: 'House', tooltip } }] })
    const feature = required(required(required(map.getSource('safe-house')).setData.mock.calls.at(-1)?.[0]).features[0])
    expect(feature.properties).not.toHaveProperty('tooltip')
    expect(feature.properties).toHaveProperty('name', 'House')
    const fid = required(feature.properties).fid as number
    map.queryRenderedFeatures.mockReturnValue([{ source: 'safe-house', properties: { fid } }])
    map.emit('mousemove', { point: {}, lngLat: {} })
    const rendered = required(mock.popup.setDOMContent.mock.calls[0])[0]
    expect(rendered.textContent).toBe('Safe house')
    expect(rendered).not.toBe(tooltip)
  })
  it('applies explicit style after API properties for every style key', () => {
    render(<Host />); const map = ready()
    const properties = { name: 'Region', color: '#ff0000', weight: 1, radius: 1, opacity: 0, dashed: false, hoverWeight: 1, fillColor: '#ff0000', fillOpacity: 0, sortKey: 0 }
    const style = { color: '#123456', weight: 3, radius: 9, opacity: 0.7, dashed: true, hoverWeight: 5, fillColor: '#654321', fillOpacity: 0.4, sortKey: 2 }
    required(api).setLayer('region', { type: 'FeatureCollection', features: [{ ...required(fc.features[0]), properties }] }, style)
    const feature = required(required(required(map.getSource('region')).setData.mock.calls.at(-1)?.[0]).features[0])
    expect(feature.properties).toMatchObject({ name: 'Region', ...style })
    expect(properties.color).toBe('#ff0000')
  })
  it('renders fallback notes as a bottom pill and tooltips without pointer interception', () => {
    window.EVACUAID_MAP = {} as Window['EVACUAID_MAP']
    render(<Host />)
    const noteStyle = getComputedStyle(screen.getByRole('note'))
    expect(noteStyle.position).toBe('absolute')
    expect(noteStyle.bottom).toBe('16px')
    expect(noteStyle.left).toBe('50%')
    expect(noteStyle.pointerEvents).toBe('none')
    const popup = document.createElement('div')
    popup.className = 'map-tooltip'
    popup.innerHTML = '<div class="mapboxgl-popup-content"></div><div class="mapboxgl-popup-tip"></div>'
    document.body.append(popup)
    expect(getComputedStyle(popup).pointerEvents).toBe('none')
    expect(getComputedStyle(required(popup.firstElementChild)).pointerEvents).toBe('none')
    expect(getComputedStyle(required(popup.lastElementChild)).display).toBe('none')
    popup.remove()
  })
  it('removes the constructed map if later setup throws and shows the WebGL note', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.setupThrows = true
    render(<Host />)
    expect(await screen.findByText("Map unavailable · this browser can't start WebGL")).toBeInTheDocument()
    expect(mock.maps).toHaveLength(1)
    expect(required(mock.maps[0]).remove).toHaveBeenCalledTimes(1)
    expect(required(mock.maps[0]).container.isConnected).toBe(false)
    expect(api).toBeNull()
  })
  it('shows the WebGL note when the Map constructor throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.constructorThrows = true
    render(<Host />)
    expect(await screen.findByText("Map unavailable · this browser can't start WebGL")).toBeInTheDocument()
    expect(mock.maps).toHaveLength(0)
    expect(api).toBeNull()
  })
  it('keeps the context value stable across unrelated provider renders', () => {
    const changes = vi.fn()
    function Probe() { const value = useMapHost(); useEffect(() => { changes(value) }, [value]); return null }
    const child = <Probe />
    const view = render(<MapProvider>{child}</MapProvider>)
    ready()
    changes.mockClear()
    view.rerender(<MapProvider>{child}</MapProvider>)
    expect(changes).not.toHaveBeenCalled()
  })
  it('renders the no-token note without constructing a map', () => {
    window.EVACUAID_MAP = {} as Window['EVACUAID_MAP']
    render(<Host />)
    expect(screen.getByText('Map unavailable · set MAPBOX_TOKEN')).toBeInTheDocument()
    expect(mock.maps).toHaveLength(0)
    expect(api).toBeNull()
  })
  it('renders the WebGL note without constructing a map', () => {
    mock.supported.mockReturnValue(false)
    render(<Host />)
    expect(screen.getByText("Map unavailable · this browser can't start WebGL")).toBeInTheDocument()
    expect(mock.maps).toHaveLength(0)
    expect(api).toBeNull()
  })
  it('stays null until style readiness and frames Jakarta', () => {
    render(<Host />)
    expect(api).toBeNull()
    const map = ready()
    expect(api).not.toBeNull()
    expect(map.fitBounds).toHaveBeenCalledWith([[106.68, -6.38], [107.02, -6.08]], { padding: 24, maxZoom: 12, animate: false })
  })
  it('replaces a source with per-feature styles and changes only the requested visibility', () => {
    render(<Host />); const map = ready()
    act(() => { required(api).setLayer('region', fc, { weight: 3, fillOpacity: 0.4 }); })
    expect(map.sources.size).toBe(7)
    const data = required(required(map.getSource('region')).setData.mock.calls.at(-1)?.[0])
    expect(data.features).toHaveLength(1)
    expect(required(data.features[0]).properties).toMatchObject({ color: '#123456', fillColor: '#123456', weight: 3, radius: 9, fillOpacity: 0.4 })
    act(() => { required(api).setLayer('region', { type: 'FeatureCollection', features: [] }); })
    expect(required(map.getSource('region')).setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] })
    map.setLayoutProperty.mockClear()
    required(api).setVisible('hazard', false)
    expect(map.setLayoutProperty.mock.calls).toEqual(['fill', 'line', 'dash', 'point'].map(kind => [`hazard-${kind}`, 'visibility', 'none']))
    expect(required(map.getLayer('region-fill')).slot).toBe('middle')
    expect(required(map.getLayer('region-point')).slot).toBe('top')
  })
  it('resolves a pick on the next click, restores the cursor and suppresses overlay clicks', async () => {
    render(<Host />); const map = ready(); const cb = vi.fn()
    required(api).onClick('region', cb)
    map.queryRenderedFeatures.mockReturnValue([{ source: 'region', properties: { fid: 1 } }])
    const pick = required(api).pick()
    expect(map.canvas.style.cursor).toBe('crosshair')
    act(() => { map.emit('click', { lngLat: { wrap: () => ({ lng: 106.8, lat: -6.2 }) } }); })
    await expect(pick).resolves.toEqual([106.8, -6.2])
    expect(map.canvas.style.cursor).toBe('')
    expect(cb).not.toHaveBeenCalled()
  })
  it('rejects a pick on Escape and removes the key listener', async () => {
    render(<Host />); const map = ready(); const pick = required(api).pick(); const rejection = expect(pick).rejects.toMatchObject({ name: 'AbortError' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await rejection
    expect(map.canvas.style.cursor).toBe('')
    const next = required(api).pick()
    act(() => { map.emit('click', { lngLat: { wrap: () => ({ lng: 107, lat: -6 }) } }); })
    await expect(next).resolves.toEqual([107, -6])
  })
  it('unsubscribes layer click callbacks', () => {
    render(<Host />); const map = ready(); const cb = vi.fn(); const off = required(api).onClick('region', cb)
    map.queryRenderedFeatures.mockReturnValue([{ source: 'region', properties: { fid: 1 } }])
    map.emit('click', { point: {}, lngLat: {} }); expect(cb).toHaveBeenCalledTimes(1)
    off(); map.emit('click', { point: {}, lngLat: {} }); expect(cb).toHaveBeenCalledTimes(1)
  })
  it('uses safe tooltip text and hover state', () => {
    render(<Host />); const map = ready(); required(api).setLayer('region', fc)
    const data = required(required(map.getSource('region')).setData.mock.calls.at(-1)?.[0])
    expect(required(data.features[0]).properties).not.toHaveProperty('tooltip')
    const fid = required(required(data.features[0]).properties).fid as number
    map.queryRenderedFeatures.mockReturnValue([{ source: 'region', properties: { fid } }])
    map.emit('mousemove', { point: {}, lngLat: {} })
    expect(required(mock.popup.setDOMContent.mock.calls[0])[0].textContent).toBe('<b>Region</b>')
    expect((required(mock.popup.setDOMContent.mock.calls[0])[0] as HTMLElement).children).toHaveLength(0)
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'region', id: fid }, { hover: true })
    fireEvent.mouseLeave(map.canvas)
    expect(map.setFeatureState).toHaveBeenLastCalledWith({ source: 'region', id: fid }, { hover: false })
  })
  it('parks and reparents the same map node across MapView mounts', () => {
    const view = render(<Host />); const map = ready(); required(api).setLayer('region', fc)
    const slot = screen.getByRole('region', { name: 'Map' })
    expect(slot).toContainElement(map.container)
    view.rerender(<Host show={false} />)
    expect(document.getElementById('map-host-boundary')).toContainElement(map.container)
    expect(map.remove).not.toHaveBeenCalled()
    view.rerender(<Host />)
    expect(screen.getByRole('region', { name: 'Map' })).toContainElement(map.container)
    expect(mock.maps).toHaveLength(1)
    expect(map.resize.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
  it('keeps one map through StrictMode effect replay', async () => {
    render(<StrictMode><Host /></StrictMode>); ready()
    await act(async () => {})
    expect(mock.maps).toHaveLength(1)
    expect(required(mock.maps[0]).remove).not.toHaveBeenCalled()
  })
  it('resizes with its observer and cleans up on provider unmount', async () => {
    let resize: ResizeObserverCallback = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { resize = cb } observe() {} disconnect = disconnect })
    const view = render(<Host />); const map = ready(); map.resize.mockClear()
    resize([], {} as ResizeObserver); expect(map.resize).toHaveBeenCalledTimes(1)
    view.unmount(); await act(async () => {})
    expect(disconnect).toHaveBeenCalled(); expect(map.remove).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
  it('creates a closed ground-distance radius polygon', () => {
    const circle = circlePolygon(0, 0, 111320, 4)
    expect(circle.coordinates[0]).toHaveLength(5)
    expect(required(circle.coordinates[0])[0]).toEqual([1, 0])
    expect(required(required(circle.coordinates[0])[1])[1]).toBeCloseTo(1)
    expect(required(required(circle.coordinates[0])[4])[0]).toBeCloseTo(1)
  })
})
