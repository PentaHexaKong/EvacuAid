import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Mapbox, { Camera, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from '@/components/ui';
import { MapBoundary } from '@/components/map-boundary';
import { mapboxStyleUrl, mapboxToken } from '@/components/map-engine';
import { colors } from '@/theme';
import { interpolate, type Coordinate } from './routing';
import type { SimulationMapProps } from './map';

void Mapbox.setAccessToken(mapboxToken() ?? null);
Mapbox.setTelemetryEnabled(false);

const line = (id: string, coordinates: Coordinate[]) => ({ type: 'Feature' as const, id, properties: {}, geometry: { type: 'LineString' as const, coordinates } });
const lines = (edges: SimulationMapProps['blocked']) => ({ type: 'FeatureCollection' as const, features: edges.filter(edge => edge.geometry.length > 1).map(edge => line(edge.id, edge.geometry)) });

export function SimulationMap(props: SimulationMapProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const fallback = <AppText accessibilityRole="alert">{t('simulationMapUnavailable')}</AppText>;
  return <View style={{ gap: 12 }}>
    {failed ? fallback : <MapBoundary fallback={fallback}><NativeMap {...props} onFail={() => setFailed(true)} /></MapBoundary>}
    <AppText variant="small">{t('simulationMapNetwork')}</AppText>
    <AppText variant="small" accessibilityRole="link" onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}>{t('simulationAttribution')}</AppText>
  </View>;
}

function NativeMap({ origin, destination, traveller, route, blocked, network = [], onDestinationSelect, onFail }: SimulationMapProps & { onFail: () => void }) {
  const { t } = useTranslation();
  const camera = useRef<Camera>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const points = route.reachable ? route.geometry : [origin, ...(destination ? [destination] : [])];
  const west = Math.min(...points.map(point => point[0]));
  const east = Math.max(...points.map(point => point[0]));
  const south = Math.min(...points.map(point => point[1]));
  const north = Math.max(...points.map(point => point[1]));
  const fit = useCallback(() => camera.current?.fitBounds([east + 0.0004, north + 0.0004], [west - 0.0004, south - 0.0004], 48, 0), [east, north, west, south]);
  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);
  useEffect(() => { if (ready) fit(); }, [ready, fit]);
  return <View style={{ gap: 12 }}>
    <View style={{ height: 340, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <MapView style={StyleSheet.absoluteFill} styleURL={mapboxStyleUrl()} onDidFinishLoadingMap={() => setReady(true)} onMapLoadingError={onFail} onLongPress={feature => {
        const [longitude, latitude] = (feature.geometry as { coordinates: number[] }).coordinates;
        onDestinationSelect?.([longitude, latitude]);
      }} scaleBarEnabled={false} pitchEnabled={false} accessibilityLabel={t('simulationMapLabel')}>
        <Camera ref={camera} defaultSettings={{ centerCoordinate: origin, zoomLevel: 14 }} />
        {onDestinationSelect && network.length > 0 && <ShapeSource id="network" shape={lines(network)}>
          <LineLayer id="network-line" style={{ lineColor: colors.muted, lineWidth: 2 }} />
        </ShapeSource>}
        {route.reachable && route.geometry.length > 1 && <ShapeSource id="route" shape={line('route', route.geometry)}>
          <LineLayer id="route-casing" style={{ lineColor: colors.surface, lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="route-line" aboveLayerID="route-casing" style={{ lineColor: colors.primary, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>}
        {blocked.length > 0 && <ShapeSource id="blocked" shape={lines(blocked)}>
          <LineLayer id="blocked-line" style={{ lineColor: colors.critical, lineWidth: 6, lineDasharray: [2, 1] }} />
        </ShapeSource>}
        {blocked.map((edge, index) => <MarkerView key={edge.id} coordinate={interpolate(edge.geometry, 0.5)} allowOverlap>
          <View accessible accessibilityLabel={t('simulationBlockedMarker', { number: index + 1 })} style={{ backgroundColor: colors.surface, padding: 4, borderWidth: 1, borderColor: colors.critical }}><AppText variant="small" style={{ color: colors.critical }}>{t('simulationBlockedMarker', { number: index + 1 })}</AppText></View>
        </MarkerView>)}
        <MarkerView coordinate={origin} anchor={{ x: 0.5, y: 1 }} allowOverlap>
          <View testID="origin" accessible accessibilityLabel={t('simulationOrigin')} style={{ backgroundColor: colors.surface, borderColor: colors.ink, borderWidth: 2, padding: 5 }}><AppText variant="small">{t('simulationOrigin')}</AppText></View>
        </MarkerView>
        {destination && <MarkerView coordinate={destination} anchor={{ x: 0.5, y: 1 }} allowOverlap>
          <View testID="destination" accessible accessibilityLabel={t('simulationDestination')} style={{ backgroundColor: colors.ink, padding: 5, borderRadius: 8 }}><AppText variant="small" style={{ color: colors.surface }}>{t('simulationDestination')}</AppText></View>
        </MarkerView>}
        <MarkerView coordinate={traveller} anchor={{ x: 0.5, y: 0 }} allowOverlap>
          <View testID="traveller" accessible accessibilityLabel={t('simulationTraveller')} style={{ backgroundColor: colors.primary, borderColor: colors.surface, borderWidth: 2, borderRadius: 20, padding: 6 }}><AppText variant="small" style={{ color: colors.surface }}>{t('simulationTraveller')}</AppText></View>
        </MarkerView>
      </MapView>
    </View>
    {timedOut && !ready && <AppText accessibilityRole="alert">{t('simulationMapFailed')}</AppText>}
    <ActionButton variant="secondary" label={t('simulationFit')} disabled={!ready} onPress={fit} />
  </View>;
}
