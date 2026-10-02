import { AppText } from './ui';
import { useTranslation } from 'react-i18next';
import type { useAnimatedStyle } from 'react-native-reanimated';
import type { Coordinate } from '@/features/navigation/api';

export type LatLng = { latitude: number; longitude: number };
export type DiscoverMarker = { id: string; title: string; kind: 'alert' | 'destination'; coordinate: LatLng };
export type DiscoverMapProps = { items: DiscoverMarker[]; selected: string | null; onSelect: (id: string) => void; route?: Coordinate[]; userLocation?: LatLng | null; onLocate: () => void; topInset: number; bottomInset: number; controlsStyle?: ReturnType<typeof useAnimatedStyle> };
export function DiscoverMap(_props: DiscoverMapProps) {
  const { t } = useTranslation();
  return <AppText>{t('discoverMapUnavailable')}</AppText>;
}
