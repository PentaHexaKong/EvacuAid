import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { IconMapPin, IconWifi, IconWifiOff } from '@tabler/icons-react-native';
import { AppText, Page, Panel, SectionHeading } from '@/components/ui';
import { colors } from '@/theme';
import { useBuddyPreview } from '@/features/buddy-map/use-buddy-preview';
import { positionStatus } from '@/features/buddy-map/location-source';

export function BuddyMapScreen() {
  const { t } = useTranslation();
  const { snapshot, now } = useBuddyPreview();
  const disconnected = snapshot?.connection === 'disconnected';
  const ConnectionIcon = disconnected ? IconWifiOff : IconWifi;
  return <Page>
    <SectionHeading number={t('preview')} title={t('mapTitle')} subtitle={t('mapDescription')} />
    <View style={{ gap: 12 }}><AppText variant="small" style={{ color: colors.muted }}>{t('demoOnly')}</AppText>
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8 }}><ConnectionIcon size={24} strokeWidth={2} color={disconnected ? colors.caution : colors.primary} /><AppText style={{ flex: 1, color: disconnected ? colors.caution : colors.primary }}>{t(!snapshot ? 'inactive' : disconnected ? 'disconnected' : 'connected')}</AppText></View>
    </View>
    <Panel><IconMapPin color={colors.primary} size={32} strokeWidth={2} /><AppText>{t('mapKeyMissing')}</AppText></Panel>
    <Panel><AppText variant="section" accessibilityRole="header">{t('participants')}</AppText>{snapshot ? snapshot.participants.map((participant) => <View key={participant.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, gap: 4 }}><AppText variant="button">{t(participant.id)}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t(positionStatus(participant.position, now))}</AppText></View>) : <AppText>{t('mapPaused')}</AppText>}</Panel>
  </Page>;
}
