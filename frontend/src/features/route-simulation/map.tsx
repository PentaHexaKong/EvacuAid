import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { AppText } from '@/components/ui';
import type { Coordinate, Edge, Route } from './routing';

export type SimulationMapProps = { origin: Coordinate; destination?: Coordinate; traveller: Coordinate; route: Route; blocked: Pick<Edge, 'id' | 'geometry'>[]; network?: Pick<Edge, 'id' | 'geometry'>[]; onDestinationSelect?: (coordinate: Coordinate) => void };
export function SimulationMap(_props: SimulationMapProps) {
  const { t } = useTranslation();
  return <View style={{ gap: 12 }}>
    <AppText accessibilityRole="alert">{t('simulationMapUnavailable')}</AppText>
    <AppText variant="small">{t('simulationMapNetwork')}</AppText>
    <AppText variant="small" accessibilityRole="link" onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}>{t('simulationAttribution')}</AppText>
  </View>;
}
