import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox, { Camera, LineLayer, LocationPuck, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconCurrentLocation from '@tabler/icons-react-native/IconCurrentLocation';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import { useTranslation } from 'react-i18next';
import { AppText } from './ui';
import { MapBoundary, MapFallback } from './map-boundary';
import { mapboxStyleUrl, mapboxToken } from './map-engine';
import { colors, corner, radius, SystemReduceMotionContext } from '@/theme';
import type { DiscoverMapProps, DiscoverMarker, LatLng } from './discover-map';
import { visibleBounds, type Bounds } from './map-framing';

void Mapbox.setAccessToken(mapboxToken() ?? null);
Mapbox.setTelemetryEnabled(false);

const position = ({ longitude, latitude }: LatLng): [number, number] => [longitude, latitude];
const markerPosition = (item: DiscoverMarker) => position(item.coordinate);
const DRAW_MS = 600;
const FRAME_SETTLE_MS = 150;

const NO_PADDING = { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };

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

function NativeMap({ items, selected, onSelect, route, userLocation, onLocate, topInset, bottomInset, controlsStyle, onFail }: DiscoverMapProps & { onFail: () => void }) {
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
    const points: [number, number][] = route?.length ? route : userLocation ? [position(userLocation), ...nearby] : items.map(markerPosition);
    if (!points.length) return null;
    return visibleBounds(points, { top: topInset + 96, right: 56, bottom: bottomInset + 56, left: 56 }, size);
  }, [route, userLocation, items, topInset, bottomInset, size]);
  const [view, setView] = useState<Bounds | null>(null);
  useEffect(() => {
    const settle = setTimeout(() => setView(target()), FRAME_SETTLE_MS);
    return () => clearTimeout(settle);
  }, [target]);
  const recenter = () => {
    const next = target();
    if (next) camera.current?.setCamera({ bounds: next, padding: NO_PADDING, animationDuration: 400 });
  };
  const ornament = { bottom: bottomInset - safeArea.bottom + 8 };
  return <View style={StyleSheet.absoluteFill}>
    <MapView style={StyleSheet.absoluteFill} styleURL={mapboxStyleUrl()} onDidFinishLoadingStyle={() => setReady(true)} onDidFinishLoadingMap={() => setReady(true)} onMapLoadingError={onFail} scaleBarEnabled={false} pitchEnabled={false} logoPosition={{ ...ornament, left: 12 }} attributionPosition={{ ...ornament, right: 12 }} accessibilityLabel={t('discoverMapLabel')}>
      <Camera ref={camera} defaultSettings={{ centerCoordinate: [106.8095, -6.2675], zoomLevel: 12 }} bounds={view ?? undefined} padding={NO_PADDING} animationDuration={400} />
      {userLocation && <LocationPuck puckBearingEnabled={false} pulsing={{ isEnabled: false }} />}
      {route && <RouteLayers route={route} />}
      {items.map(item => {
        const Icon = item.kind === 'alert' ? IconAlertTriangle : IconMapPin;
        const active = selected === item.id;
        const tint = item.kind === 'alert' ? colors.caution : colors.primary;
        return <MarkerView key={item.id} coordinate={markerPosition(item)} allowOverlap allowOverlapWithPuck>
          <Pressable accessibilityRole="button" accessibilityLabel={item.title} accessibilityState={{ selected: active }} onPress={() => onSelect(item.id)} hitSlop={4} style={{ padding: active ? 12 : 10, backgroundColor: active ? tint : colors.surface, borderRadius: radius.pill, borderWidth: 2, borderColor: tint }}>
            <Icon size={active ? 26 : 22} color={active ? colors.surface : tint} />
          </Pressable>
        </MarkerView>;
      })}
    </MapView>
    <Animated.View style={[styles.locateWrap, { top: topInset + 8 }, controlsStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('centerOnMe')} onPress={() => (userLocation ? recenter() : onLocate())} style={({ pressed }) => [styles.locate, { backgroundColor: pressed ? colors.canvas : colors.surface }]}>
        <IconCurrentLocation size={24} color={colors.primary} />
      </Pressable>
    </Animated.View>
    {timedOut && !ready && <View style={[styles.notice, { top: topInset + 68 }]}><AppText accessibilityRole="alert" variant="small">{t('discoverMapUnavailable')}</AppText></View>}
  </View>;
}

const styles = StyleSheet.create({
  locateWrap: { position: 'absolute', right: 16 },
  locate: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(18, 40, 75, 0.14), 0 0 0 1px rgba(18, 40, 75, 0.05)' },
  notice: { position: 'absolute', left: 16, right: 16, padding: 12, ...corner(radius.md), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
