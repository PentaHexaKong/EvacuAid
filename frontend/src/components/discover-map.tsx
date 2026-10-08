import { AppText } from './ui';
import { useTranslation } from 'react-i18next';
import type { useAnimatedStyle } from 'react-native-reanimated';
import type { Coordinate } from '@/features/navigation/api';
import type { ZoneCollection } from '@/features/hazards/zones';

export type LatLng = { latitude: number; longitude: number };
// A place the map should frame instead of the user's surroundings, e.g. an earthquake's epicentre and the area around it.
export type MapFocus = LatLng & { spanKm: number };
export type DiscoverMarker = { id: string; title: string; kind: 'alert' | 'destination' | 'person'; initials?: string; coordinate: LatLng };
export type MapMode = '2d' | '3d';
// controlsStyle positions the map buttons, which are laid out from the top of the screen.
// follow is for turn-by-turn: true keeps the camera on the user, false leaves it where they dragged it, undefined frames the content as usual.
// walked (0..1) hides the part of the route already behind the user.
export type DiscoverMapProps = { items: DiscoverMarker[]; selected: string | null; onSelect: (id: string) => void; route?: Coordinate[]; zones?: ZoneCollection; mode?: MapMode; onToggleMode?: () => void; userLocation?: LatLng | null; focus?: MapFocus | null; onLocate: () => void; topInset: number; bottomInset: number; creditsInset?: number; controlsStyle?: ReturnType<typeof useAnimatedStyle>; follow?: boolean; onFollowChange?: (following: boolean) => void; walked?: number };
export function DiscoverMap(_props: DiscoverMapProps) {
  const { t } = useTranslation();
  return <AppText>{t('discoverMapUnavailable')}</AppText>;
}
