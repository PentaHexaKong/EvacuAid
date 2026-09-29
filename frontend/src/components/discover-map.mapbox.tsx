import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Mapbox, { Camera, MapView, MarkerView } from '@rnmapbox/maps';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from './ui';
import { MapBoundary } from './map-boundary';
import { mapboxStyleUrl, mapboxToken } from './map-engine';
import { colors } from '@/theme';
import type { DiscoverMapProps, DiscoverMarker } from './discover-map';

void Mapbox.setAccessToken(mapboxToken() ?? null);
Mapbox.setTelemetryEnabled(false);

const position = ({ coordinate }: DiscoverMarker): [number, number] => [coordinate.longitude, coordinate.latitude];

export function DiscoverMap(props: DiscoverMapProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const fallback = <AppText accessibilityRole="alert">{t('discoverMapUnavailable')}</AppText>;
  return failed ? fallback : <MapBoundary fallback={fallback}><NativeMap {...props} onFail={() => setFailed(true)} /></MapBoundary>;
}

function NativeMap({ items, selected, onSelect, onFail }: DiscoverMapProps & { onFail: () => void }) {
  const { t } = useTranslation();
  const camera = useRef<Camera>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timeout);
  }, []);
  const fit = useCallback(() => {
    if (!items.length) return;
    if (items.length === 1) {
      camera.current?.setCamera({ centerCoordinate: position(items[0]), zoomLevel: 15, animationDuration: 0 });
      return;
    }
    const longitudes = items.map(item => item.coordinate.longitude);
    const latitudes = items.map(item => item.coordinate.latitude);
    camera.current?.fitBounds([Math.max(...longitudes), Math.max(...latitudes)], [Math.min(...longitudes), Math.min(...latitudes)], 48, 0);
  }, [items]);
  useEffect(() => { if (ready) fit(); }, [ready, fit]);
  return <View style={{ gap: 12 }}>
    <View style={{ height: 280, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      <MapView style={StyleSheet.absoluteFill} styleURL={mapboxStyleUrl()} onDidFinishLoadingMap={() => setReady(true)} onMapLoadingError={onFail} scaleBarEnabled={false} pitchEnabled={false} accessibilityLabel={t('discoverMapLabel')}>
        <Camera ref={camera} defaultSettings={{ centerCoordinate: [106.8095, -6.2675], zoomLevel: 14 }} />
        {items.map(item => {
          const Icon = item.kind === 'alert' ? IconAlertTriangle : IconMapPin;
          const active = selected === item.id;
          return <MarkerView key={item.id} coordinate={position(item)} allowOverlap>
            <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={() => onSelect(item.id)} style={{ padding: 10, backgroundColor: active ? colors.ink : colors.surface, borderRadius: 24, borderWidth: 2, borderColor: item.kind === 'alert' ? colors.caution : colors.primary }}>
              <Icon size={24} color={active ? colors.surface : item.kind === 'alert' ? colors.caution : colors.primary} />
            </Pressable>
          </MarkerView>;
        })}
      </MapView>
    </View>
    {timedOut && !ready && <AppText accessibilityRole="alert">{t('discoverMapUnavailable')}</AppText>}
    <ActionButton variant="secondary" label={t('fitMap')} disabled={!ready || !items.length} onPress={fit} />
  </View>;
}
