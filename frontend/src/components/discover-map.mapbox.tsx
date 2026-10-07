import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox, { Camera, CircleLayer, FillLayer, LineLayer, LocationPuck, MapView, MarkerView, RasterDemSource, ShapeSource, StyleImport, Terrain } from '@rnmapbox/maps';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconCube from '@tabler/icons-react-native/IconCube';
import IconCurrentLocation from '@tabler/icons-react-native/IconCurrentLocation';
import IconMap from '@tabler/icons-react-native/IconMap';
import IconUsersGroup from '@tabler/icons-react-native/IconUsersGroup';
import { useTranslation } from 'react-i18next';
import { AppText } from './ui';
import { MapBoundary, MapFallback } from './map-boundary';
import { DEFAULT_MAPBOX_STYLE_URL, mapboxStyleUrl, mapboxToken } from './map-engine';
import { MapControls } from './native-controls';
import { colors, corner, hazard, radius, SystemReduceMotionContext } from '@/theme';
import type { ZoneCollection } from '@/features/hazards/zones';
import type { DiscoverMapProps, DiscoverMarker, LatLng } from './discover-map';
import { boundsCenter, focusCorners, MAP_CONTROLS_BOX, visibleBounds, type Bounds } from './map-framing';

void Mapbox.setAccessToken(mapboxToken() ?? null);
Mapbox.setTelemetryEnabled(false);

const position = ({ longitude, latitude }: LatLng): [number, number] => [longitude, latitude];
const markerPosition = (item: DiscoverMarker) => position(item.coordinate);
const DRAW_MS = 600;
const FRAME_SETTLE_MS = 150;

const NO_PADDING = { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
const PITCH_3D = 45;
const HAZARD_COLOR = ['match', ['get', 'hazard'], ...Object.entries(hazard).flat(), colors.caution] as NonNullable<ComponentProps<typeof FillLayer>['style']>['fillColor'];

export function DiscoverMap(props: DiscoverMapProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fallback = <MapFallback topInset={props.topInset} onRetry={() => { setFailed(false); setAttempt(count => count + 1); }} />;
  return failed ? fallback : <MapBoundary key={attempt} fallback={fallback}><NativeMap {...props} onFail={() => setFailed(true)} /></MapBoundary>;
}

function useDrawProgress(route: DiscoverMapProps['route']) {
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [draw, setDraw] = useState<{ route?: DiscoverMapProps['route']; value: number }>({ value: 1 });
  useEffect(() => {
    if (!route || reduceMotion) return;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / DRAW_MS);
      setDraw({ route, value: 1 - (1 - t) ** 5 });
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [route, reduceMotion]);
  if (!route || reduceMotion) return 1;
  return draw.route === route ? draw.value : 0;
}

function RouteLayers({ route }: { route: NonNullable<DiscoverMapProps['route']> }) {
  const progress = useDrawProgress(route);
  const shape = useMemo(() => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route } }), [route]);
  return <ShapeSource id="evacuation-route" lineMetrics shape={shape}>
    <LineLayer id="evacuation-route-casing" style={{ lineColor: colors.surface, lineWidth: 10, lineCap: 'round', lineJoin: 'round', lineTrimOffset: [progress, 1] }} />
    <LineLayer id="evacuation-route-line" aboveLayerID="evacuation-route-casing" style={{ lineWidth: 6, lineCap: 'round', lineJoin: 'round', lineGradient: ['interpolate', ['linear'], ['line-progress'], 0, colors.sky, 1, colors.primary], lineTrimOffset: [progress, 1] }} />
  </ShapeSource>;
}

// Estimated impact areas drape on the terrain below labels; the core ring is stronger than the outer one.
function ZoneLayers({ zones }: { zones: ZoneCollection }) {
  return <ShapeSource id="hazard-zones" shape={zones}>
    <FillLayer id="hazard-zone-fill" slot="middle" style={{ fillColor: HAZARD_COLOR, fillOpacity: ['match', ['get', 'ring'], 'core', 0.22, 0.1] }} />
    <LineLayer id="hazard-zone-line" slot="middle" style={{ lineColor: HAZARD_COLOR, lineWidth: ['match', ['get', 'ring'], 'core', 2, 1.25], lineOpacity: ['match', ['get', 'ring'], 'core', 1, 0.7] }} />
  </ShapeSource>;
}

// Shelter pins stand upright; in 3D each one floats over a soft shadow that lies flat on the ground.
const PIN_LIFT = 3;

function PinShadows({ items }: { items: DiscoverMarker[] }) {
  const shape = useMemo(() => ({ type: 'FeatureCollection' as const, features: items.filter(item => item.kind === 'destination').map(item => ({ type: 'Feature' as const, id: item.id, properties: {}, geometry: { type: 'Point' as const, coordinates: markerPosition(item) } })) }), [items]);
  return <ShapeSource id="shelter-shadows" shape={shape}>
    <CircleLayer id="shelter-shadow" style={{ circleColor: colors.ink, circleOpacity: 0.36, circleRadius: 15, circleBlur: 1, circlePitchAlignment: 'map' }} />
  </ShapeSource>;
}

function ShelterPin({ item, active, lifted, onSelect }: { item: DiscoverMarker; active: boolean; lifted: boolean; onSelect: (id: string) => void }) {
  const size = active ? 40 : 32;
  return <View style={[styles.pin, lifted && { paddingBottom: 8 + PIN_LIFT }]}>
    <View style={[styles.pinShadow, { width: size + 8, height: size + 8 }]} />
    <View style={[styles.pinTail, lifted && { bottom: 3.3 + PIN_LIFT }]} />
    <Pressable accessibilityRole="button" accessibilityLabel={item.title} accessibilityState={{ selected: active }} onPress={() => onSelect(item.id)} hitSlop={4} style={styles.pinRing}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: active ? colors.ink : colors.primary }}>
        <IconUsersGroup size={active ? 24 : 20} strokeWidth={2.25} color={colors.surface} />
      </View>
    </Pressable>
  </View>;
}

function NativeMap({ items, selected, onSelect, route, zones, mode = '2d', onToggleMode, userLocation, focus, onLocate, topInset, bottomInset, creditsInset, controlsStyle, onFail }: DiscoverMapProps & { onFail: () => void }) {
  const { t } = useTranslation();
  const camera = useRef<Camera>(null);
  const safeArea = useSafeAreaInsets();
  const size = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);
  const target = useCallback((): Bounds | null => {
    const nearby = items.filter(item => item.kind === 'destination').slice(0, 3).map(markerPosition);
    // A focus (an epicentre opened from its detail page) wins over the user's surroundings until they ask for their own location again.
    const points: [number, number][] = focus ? focusCorners(focus) : route?.length ? route : userLocation ? [position(userLocation), ...nearby] : items.map(markerPosition);
    if (!points.length) return null;
    return visibleBounds(points, { top: topInset + 40, right: 56, bottom: bottomInset + 56, left: 56 }, size);
  }, [focus, route, userLocation, items, topInset, bottomInset, size]);
  const [view, setView] = useState<Bounds | null>(null);
  useEffect(() => {
    const settle = setTimeout(() => setView(target()), FRAME_SETTLE_MS);
    return () => clearTimeout(settle);
  }, [target]);
  const recenter = () => {
    const next = target();
    if (next) camera.current?.setCamera(tilted ? { ...boundsCenter(next, size.width), pitch: PITCH_3D, animationDuration: 400 } : { bounds: next, padding: NO_PADDING, animationDuration: 400 });
  };
  // ponytail: native ornaments hop per snap, not per drag frame; if needed, disable logoEnabled and animate our wordmark and attribution button from sheetTop.
  const ornament = { bottom: (creditsInset ?? bottomInset) - safeArea.bottom + 8 };
  const tilted = mode === '3d';
  const styleUrl = mapboxStyleUrl();
  return <View style={StyleSheet.absoluteFill}>
    <MapView style={StyleSheet.absoluteFill} styleURL={styleUrl} onDidFinishLoadingStyle={() => setReady(true)} onDidFinishLoadingMap={() => setReady(true)} onMapLoadingError={onFail} scaleBarEnabled={false} pitchEnabled={tilted} logoPosition={{ ...ornament, left: 12 }} attributionPosition={{ ...ornament, left: 100 }} accessibilityLabel={t('discoverMapLabel')}>
      {styleUrl === DEFAULT_MAPBOX_STYLE_URL && <StyleImport id="basemap" existing config={{ lightPreset: 'day', theme: 'faded', show3dObjects: tilted, showPointOfInterestLabels: false, showTransitLabels: false }} />}
      {tilted && <RasterDemSource id="mapbox-dem" url="mapbox://mapbox.mapbox-terrain-dem-v1" tileSize={514}><Terrain style={{ exaggeration: 1.3 }} /></RasterDemSource>}
      <Camera ref={camera} defaultSettings={{ centerCoordinate: [106.8095, -6.2675], zoomLevel: 12 }} {...(tilted && view ? boundsCenter(view, size.width) : { bounds: view ?? undefined })} pitch={tilted ? PITCH_3D : 0} padding={NO_PADDING} animationDuration={400} />
      {userLocation && <LocationPuck puckBearingEnabled={false} pulsing={{ isEnabled: false }} />}
      {zones && zones.features.length > 0 && <ZoneLayers zones={zones} />}
      {route && <RouteLayers route={route} />}
      {tilted && <PinShadows items={items} />}
      {items.map(item => {
        const active = selected === item.id;
        if (item.kind === 'destination') return <MarkerView key={item.id} coordinate={markerPosition(item)} anchor={{ x: 0.5, y: 1 }} allowOverlap allowOverlapWithPuck>
          <ShelterPin item={item} active={active} lifted={tilted} onSelect={onSelect} />
        </MarkerView>;
        return <MarkerView key={item.id} coordinate={markerPosition(item)} allowOverlap allowOverlapWithPuck>
          <Pressable accessibilityRole="button" accessibilityLabel={item.title} accessibilityState={{ selected: active }} onPress={() => onSelect(item.id)} hitSlop={4} style={{ padding: active ? 12 : 10, backgroundColor: active ? colors.caution : colors.surface, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.caution }}>
            <IconAlertTriangle size={active ? 26 : 22} color={active ? colors.surface : colors.caution} />
          </Pressable>
        </MarkerView>;
      })}
    </MapView>
    <Animated.View pointerEvents="box-none" style={[styles.controls, controlsStyle]}>
      <MapControls controls={[
        ...(onToggleMode ? [tilted ? { label: t('showFlatMap'), symbol: 'map' as const, icon: IconMap, onPress: onToggleMode } : { label: t('show3dMap'), symbol: 'view.3d' as const, icon: IconCube, onPress: onToggleMode }] : []),
        { label: t('centerOnMe'), symbol: 'location' as const, icon: IconCurrentLocation, onPress: () => (userLocation && !focus ? recenter() : onLocate()) },
      ]} />
    </Animated.View>
    {timedOut && !ready && <View style={[styles.notice, { top: topInset + 68 }]}><AppText accessibilityRole="alert" variant="small">{t('discoverMapUnavailable')}</AppText></View>}
  </View>;
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', paddingBottom: 8 },
  pinTail: { position: 'absolute', bottom: 3.3, width: 16, height: 16, borderBottomRightRadius: 4, backgroundColor: colors.surface, boxShadow: `0 2px 6px ${colors.ink}40`, transform: [{ rotate: '45deg' }] },
  pinShadow: { position: 'absolute', top: 0, borderRadius: radius.pill, backgroundColor: colors.surface, boxShadow: `0 2px 6px ${colors.ink}40` },
  pinRing: { padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface },
  controls: { position: 'absolute', top: 0, right: 16, height: MAP_CONTROLS_BOX },
  notice: { position: 'absolute', left: 16, right: 16, padding: 12, ...corner(radius.md), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
