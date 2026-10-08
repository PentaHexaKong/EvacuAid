import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Constants from 'expo-constants';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconCurrentLocation from '@tabler/icons-react-native/IconCurrentLocation';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import { useTranslation } from 'react-i18next';
import { AppText } from './ui';
import { MapBoundary, MapFallback } from './map-boundary';
import { MAP_CONTROLS_BOX, focusCorners } from './map-framing';
import { MapControls } from './native-controls';
import { colors, corner, hazard, radius } from '@/theme';
import type { DiscoverMapProps } from './discover-map';

export function DiscoverMap(props: DiscoverMapProps) {
  const available = Platform.OS === 'ios' || Boolean(Constants.expoConfig?.extra?.androidMapConfigured) || Constants.appOwnership === 'expo';
  const [attempt, setAttempt] = useState(0);
  if (!available) return <MapFallback topInset={props.topInset} />;
  return <MapBoundary key={attempt} fallback={<MapFallback topInset={props.topInset} onRetry={() => setAttempt(count => count + 1)} />}><NativeMap {...props} /></MapBoundary>;
}
function NativeMap({ items, selected, onSelect, route, zones, userLocation, focus, onLocate, topInset, bottomInset, controlsStyle }: DiscoverMapProps) {
  const { t } = useTranslation();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);
  const frame = useCallback(() => {
    const edgePadding = { top: topInset + 40, right: 56, bottom: bottomInset + 56, left: 56 };
    const points = route?.length ? route.map(([longitude, latitude]) => ({ latitude, longitude })) : focus ? focusCorners(focus).map(([longitude, latitude]) => ({ latitude, longitude })) : userLocation ? [userLocation] : items.map(item => item.coordinate);
    if (points.length === 1) map.current?.animateCamera({ center: points[0], zoom: 14 });
    else if (points.length) map.current?.fitToCoordinates(points, { edgePadding, animated: true });
  }, [focus, route, userLocation, items, topInset, bottomInset]);
  useEffect(() => {
    if (!ready) return;
    const settle = setTimeout(frame, 150);
    return () => clearTimeout(settle);
  }, [ready, frame]);
  return <View style={StyleSheet.absoluteFill}>
    <MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={{ latitude: -6.2675, longitude: 106.8095, latitudeDelta: 0.08, longitudeDelta: 0.08 }} onMapReady={() => setReady(true)} showsUserLocation={Boolean(userLocation)} showsMyLocationButton={false} toolbarEnabled={false} mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }} accessibilityLabel={t('discoverMapLabel')}>
      {zones?.features.map(zone => {
        const tint = hazard[zone.properties.hazard];
        const core = zone.properties.ring === 'core';
        return <Polygon key={zone.id} coordinates={zone.geometry.coordinates[0].map(([longitude, latitude]) => ({ latitude, longitude }))} fillColor={`${tint}${core ? '38' : '1A'}`} strokeColor={tint} strokeWidth={core ? 2 : 1.25} />;
      })}
      {route && <Polyline coordinates={route.map(([longitude, latitude]) => ({ latitude, longitude }))} strokeColor={colors.primary} strokeWidth={6} lineCap="round" lineJoin="round" />}
      {items.map(item => {
        if (item.kind === 'person') return <Marker key={item.id} identifier={item.id} coordinate={item.coordinate} anchor={{ x: 0.5, y: 0.5 }} title={item.title} accessibilityLabel={item.title} onPress={() => onSelect(item.id)}>
          <View style={styles.person}>
            <View style={styles.personHalo} />
            <View style={styles.personRing}><AppText variant="button" style={{ color: colors.surface, fontSize: 17 }}>{item.initials}</AppText></View>
          </View>
        </Marker>;
        const Icon = item.kind === 'alert' ? IconAlertTriangle : IconMapPin;
        const active = selected === item.id;
        const tint = item.kind === 'alert' ? colors.caution : colors.primary;
        return <Marker key={item.id} identifier={item.id} coordinate={item.coordinate} title={item.title} accessibilityLabel={item.title} onPress={() => onSelect(item.id)}>
          <View style={{ padding: active ? 12 : 10, backgroundColor: active ? tint : colors.surface, borderRadius: radius.pill, borderWidth: 2, borderColor: tint }}><Icon size={active ? 26 : 22} color={active ? colors.surface : tint} /></View>
        </Marker>;
      })}
    </MapView>
    <Animated.View pointerEvents="box-none" style={[styles.controls, controlsStyle]}>
      <MapControls controls={[{ label: t('centerOnMe'), symbol: 'location', icon: IconCurrentLocation, onPress: () => (userLocation && !focus ? frame() : onLocate()) }]} />
    </Animated.View>
    {timedOut && !ready && <View style={[styles.notice, { top: topInset + 68 }]}><AppText accessibilityRole="alert" variant="small">{t('discoverMapUnavailable')}</AppText></View>}
  </View>;
}

const styles = StyleSheet.create({
  person: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  personHalo: { position: 'absolute', width: 64, height: 64, borderRadius: radius.pill, backgroundColor: `${colors.primary}29` },
  personRing: { width: 48, height: 48, borderRadius: radius.pill, borderWidth: 3, borderColor: colors.surface, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', top: 0, right: 16, height: MAP_CONTROLS_BOX },
  notice: { position: 'absolute', left: 16, right: 16, padding: 12, ...corner(radius.md), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
