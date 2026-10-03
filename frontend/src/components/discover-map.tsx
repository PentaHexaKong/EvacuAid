import { AppText } from './ui';
import { useTranslation } from 'react-i18next';

export type DiscoverMarker = { id: string; title: string; kind: 'alert' | 'destination'; coordinate: { latitude: number; longitude: number } };
export type DiscoverMapProps = { items: DiscoverMarker[]; selected: string | null; onSelect: (id: string) => void };
export function DiscoverMap(_props: DiscoverMapProps) {
  const { t } = useTranslation();
  return <AppText>{t('discoverMapUnavailable')}</AppText>;
}
