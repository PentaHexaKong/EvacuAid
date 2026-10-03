import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from '@/components/ui';
import { colors } from '@/theme';
import { interpolate, type Coordinate } from './routing';
import type { SimulationMapProps } from './map';

const toLatLng = ([longitude, latitude]: Coordinate) => ({ latitude, longitude });
class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export function SimulationMap(props: SimulationMapProps) {
  const { t } = useTranslation();
  const available = Platform.OS === 'ios' || Boolean(Constants.expoConfig?.extra?.androidMapConfigured) || Constants.appOwnership === 'expo';
  const fallback = <AppText accessibilityRole="alert">{t('simulationMapUnavailable')}</AppText>;
  return <View style={{ gap: 12 }}>
    {available ? <MapBoundary fallback={fallback}><NativeMap {...props} /></MapBoundary> : fallback}
    <AppText variant="small">{t('simulationMapNetwork')}</AppText>
    <AppText variant="small" accessibilityRole="link" onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}>{t('simulationAttribution')}</AppText>
  </View>;
}
function NativeMap({ origin, destination, traveller, route, blocked, network = [], onDestinationSelect }: SimulationMapProps) {
  const { t } = useTranslation();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const points = route.reachable ? route.geometry : [origin, ...(destination ? [destination] : [])];
  const west = Math.min(...points.map(point => point[0]));
  const east = Math.max(...points.map(point => point[0]));
  const south = Math.min(...points.map(point => point[1]));
  const north = Math.max(...points.map(point => point[1]));
  const fit = useCallback(() => map.current?.fitToCoordinates([
    { longitude: east + 0.0004, latitude: north + 0.0004 },
    { longitude: west - 0.0004, latitude: south - 0.0004 },
  ], { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: false }), [east, north, west, south]);
  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);
  useEffect(() => { if (ready) fit(); }, [ready, fit]);
  return <View style={{ gap: 12 }}>
    <View style={{ height: 340, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={{ ...toLatLng(origin), latitudeDelta: 0.018, longitudeDelta: 0.018 }} onMapReady={() => setReady(true)} onLongPress={event => onDestinationSelect?.([event.nativeEvent.coordinate.longitude, event.nativeEvent.coordinate.latitude])} showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} accessibilityLabel={t('simulationMapLabel')}>
        {onDestinationSelect && network.map(edge => <Polyline key={`network-${edge.id}`} coordinates={edge.geometry.map(toLatLng)} strokeColor={colors.muted} strokeWidth={2} zIndex={0} />)}
        {route.reachable && route.geometry.length > 1 && <>
          <Polyline coordinates={route.geometry.map(toLatLng)} strokeColor={colors.surface} strokeWidth={9} zIndex={1} />
          <Polyline coordinates={route.geometry.map(toLatLng)} strokeColor={colors.primary} strokeWidth={5} zIndex={2} />
        </>}
        {blocked.map(edge => <Polyline key={edge.id} coordinates={edge.geometry.map(toLatLng)} strokeColor={colors.critical} strokeWidth={6} lineDashPattern={[12, 6]} zIndex={3} />)}
        {blocked.map((edge, index) => <Marker key={edge.id} identifier={edge.id} coordinate={toLatLng(interpolate(edge.geometry, 0.5))} title={t('simulationBlockedMarker', { number: index + 1 })} accessibilityLabel={t('simulationBlockedMarker', { number: index + 1 })} zIndex={4}><View style={{ backgroundColor: colors.surface, padding: 4, borderWidth: 1, borderColor: colors.critical }}><AppText variant="small" style={{ color: colors.critical }}>{t('simulationBlockedMarker', { number: index + 1 })}</AppText></View></Marker>)}
        <Marker identifier="origin" coordinate={toLatLng(origin)} anchor={{ x: 0.5, y: 1 }} centerOffset={{ x: 0, y: -24 }} title={t('simulationOrigin')} accessibilityLabel={t('simulationOrigin')} zIndex={5}><View style={{ backgroundColor: colors.surface, borderColor: colors.ink, borderWidth: 2, padding: 5 }}><AppText variant="small">{t('simulationOrigin')}</AppText></View></Marker>
        {destination && <Marker identifier="destination" coordinate={toLatLng(destination)} anchor={{ x: 0.5, y: 1 }} centerOffset={{ x: 0, y: -24 }} title={t('simulationDestination')} accessibilityLabel={t('simulationDestination')} zIndex={5}><View style={{ backgroundColor: colors.ink, padding: 5, borderRadius: 8 }}><AppText variant="small" style={{ color: colors.surface }}>{t('simulationDestination')}</AppText></View></Marker>}
        <Marker identifier="traveller" coordinate={toLatLng(traveller)} anchor={{ x: 0.5, y: 0 }} centerOffset={{ x: 0, y: 24 }} title={t('simulationTraveller')} accessibilityLabel={t('simulationTraveller')} zIndex={6}><View style={{ backgroundColor: colors.primary, borderColor: colors.surface, borderWidth: 2, borderRadius: 20, padding: 6 }}><AppText variant="small" style={{ color: colors.surface }}>{t('simulationTraveller')}</AppText></View></Marker>
      </MapView>
    </View>
    {timedOut && !ready && <AppText accessibilityRole="alert">{t('simulationMapFailed')}</AppText>}
    <ActionButton variant="secondary" label={t('simulationFit')} disabled={!ready} onPress={fit} />
  </View>;
}
