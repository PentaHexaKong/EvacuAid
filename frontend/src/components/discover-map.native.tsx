import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker } from 'react-native-maps';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from './ui';
import { colors } from '@/theme';
import type { DiscoverMapProps } from './discover-map';

class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export function DiscoverMap(props: DiscoverMapProps) {
  const { t } = useTranslation();
  const available = Platform.OS === 'ios' || Boolean(Constants.expoConfig?.extra?.androidMapConfigured) || Constants.appOwnership === 'expo';
  const fallback = <AppText accessibilityRole="alert">{t('discoverMapUnavailable')}</AppText>;
  return available ? <MapBoundary fallback={fallback}><NativeMap {...props} /></MapBoundary> : fallback;
}
function NativeMap({ items, selected, onSelect }: DiscoverMapProps) {
  const { t } = useTranslation();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);
  const fit = () => {
    if (items.length) map.current?.fitToCoordinates(items.map(item => item.coordinate), { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: false });
  };
  useEffect(() => {
    if (ready && items.length) map.current?.fitToCoordinates(items.map(item => item.coordinate), { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: false });
  }, [items, ready]);
  return <View style={{ gap: 12 }}>
    <View style={{ height: 280, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <MapView ref={map} style={StyleSheet.absoluteFill} initialRegion={{ latitude: -6.2675, longitude: 106.8095, latitudeDelta: 0.018, longitudeDelta: 0.018 }} onMapReady={() => setReady(true)} showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} accessibilityLabel={t('discoverMapLabel')}>
        {items.map(item => {
          const Icon = item.kind === 'alert' ? IconAlertTriangle : IconMapPin;
          return <Marker key={item.id} identifier={item.id} coordinate={item.coordinate} title={item.title} accessibilityLabel={item.title} onPress={() => onSelect(item.id)}>
            <View style={{ padding: 10, backgroundColor: selected === item.id ? colors.ink : colors.surface, borderRadius: 24, borderWidth: 2, borderColor: item.kind === 'alert' ? colors.caution : colors.primary }}><Icon size={24} color={selected === item.id ? colors.surface : item.kind === 'alert' ? colors.caution : colors.primary} /></View>
          </Marker>;
        })}
      </MapView>
    </View>
    {timedOut && !ready && <AppText accessibilityRole="alert">{t('discoverMapUnavailable')}</AppText>}
    <ActionButton variant="secondary" label={t('fitMap')} disabled={!ready || !items.length} onPress={fit} />
  </View>;
}
