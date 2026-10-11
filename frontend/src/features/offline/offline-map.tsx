import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { ActionButton, AppText } from '@/components/ui';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme';
import type { OfflineManifest } from './manifest';

type Geometry = { type: string; coordinates?: any; geometries?: Geometry[] };
type Feature = { geometry: Geometry };
type Shelter = { id: string; name: string; latitude: number; longitude: number; status: string };
export type MapData = {
  streets: { features: Feature[] }; boundary: Feature; coverage: Feature;
  hazards: { geometry: Geometry; hazardType: string; source?: string; observedAt?: string | null; validUntil: string | null }[];
  shelters: (Shelter & { wheelchairAccessible?: boolean | null })[]; cachedRoutes: { geometry: Geometry }[];
};

// Explicit offline vector adapter: only local GeoJSON and SVG. No tile URLs,
// remote map style, network image or online map SDK is used in this component.
export function OfflineMap({ manifest, data, position, onShelter }: {
  manifest: OfflineManifest; data: MapData;
  position: { latitude: number; longitude: number } | null; onShelter: (shelter: Shelter) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1, startX: 0, startY: 0 });
  const [west, south, east, north] = manifest.bbox;
  const project = ([longitude, latitude]: number[]) => [
    10 + (longitude - west) / (east - west) * 380,
    310 - (latitude - south) / (north - south) * 300,
  ];
  const path = (geometry: Geometry): string => {
    if (geometry.type === 'GeometryCollection') return (geometry.geometries || []).map(path).join(' ');
    const line = (points: number[][], closed = false) => points.map((p, index) => (index ? 'L' : 'M') + project(p).join(',')).join(' ') + (closed ? ' Z' : '');
    if (geometry.type === 'LineString') return line(geometry.coordinates);
    if (geometry.type === 'MultiLineString') return geometry.coordinates.map((p: number[][]) => line(p)).join(' ');
    if (geometry.type === 'Polygon') return geometry.coordinates.map((p: number[][]) => line(p, true)).join(' ');
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon: number[][][]) => polygon.map(p => line(p, true)).join(' ')).join(' ');
    return '';
  };
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => setView(current => ({ ...current, startX: current.x, startY: current.y })),
    onPanResponderMove: (_event, gesture) => setView(current => ({ ...current, x: current.startX + gesture.dx, y: current.startY + gesture.dy })),
  });
  return <View style={{ gap: 8 }}>
    <View {...pan.panHandlers} style={{ height: 320, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <Svg width="100%" height="320" viewBox="0 0 400 320" accessibilityLabel={t('offlineMapLabel')}>
        <G transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {data.streets.features.map((feature, index) => <Path key={index} d={path(feature.geometry)} stroke={colors.borderStrong} fill="none" strokeWidth={1 / view.zoom} />)}
          <Path d={path(data.boundary.geometry)} fill="none" stroke={colors.primary} strokeWidth={2 / view.zoom} />
          <Path d={path(data.coverage.geometry)} fill="none" stroke={colors.ink} strokeDasharray="5 4" strokeWidth={1 / view.zoom} />
          {data.hazards.map((hazard, index) => hazard.geometry.type === 'Point'
            ? <Circle key={index} cx={project(hazard.geometry.coordinates)[0]} cy={project(hazard.geometry.coordinates)[1]} r={4 / view.zoom} fill={colors.caution} />
            : <Path key={index} d={path(hazard.geometry)} fill={colors.caution + '30'} fillRule="evenodd" stroke={colors.caution} strokeWidth={1 / view.zoom} />)}
          {data.cachedRoutes.map((route, index) => <Path key={index} d={path(route.geometry)} fill="none" stroke={colors.primary} strokeDasharray="4 3" strokeWidth={3 / view.zoom} />)}
          {data.shelters.map(shelter => <Circle key={shelter.id} cx={project([shelter.longitude, shelter.latitude])[0]} cy={project([shelter.longitude, shelter.latitude])[1]} r={5 / view.zoom} fill={colors.primary} onPress={() => onShelter(shelter)} accessibilityLabel={shelter.name} />)}
          {position && <Circle cx={project([position.longitude, position.latitude])[0]} cy={project([position.longitude, position.latitude])[1]} r={5 / view.zoom} fill={colors.ink} />}
        </G>
      </Svg>
    </View>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <ActionButton compact variant="secondary" label={t('offlineZoomIn')} onPress={() => setView(v => ({ ...v, zoom: Math.min(v.zoom * 1.5, 8) }))} />
      <ActionButton compact variant="secondary" label={t('offlineZoomOut')} onPress={() => setView(v => ({ ...v, zoom: Math.max(v.zoom / 1.5, 1) }))} />
      <ActionButton compact variant="secondary" label={t('offlineResetMap')} onPress={() => setView({ x: 0, y: 0, zoom: 1, startX: 0, startY: 0 })} />
    </View>
    <AppText variant="small">{manifest.sourceProvenance.mapAttribution}</AppText>
    <AppText variant="small">{t('offlineMapLegend')}</AppText>
  </View>;
}
