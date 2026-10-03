import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText, Page, Panel } from '@/components/ui';
import { ContentRow, EmptyContent, SampleNotice, SectionTitle } from '@/components/content';
import { sampleDestinations } from '@/features/content/samples';
import { colors } from '@/theme';

export function DestinationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return <Page><SampleNotice /><View style={{ gap: 8 }}><SectionTitle>{t('destinationsIntro')}</SectionTitle><AppText style={{ color: colors.muted }}>{t('destinationsBody')}</AppText></View>
    <View style={{ gap: 12 }}>{sampleDestinations.length ? sampleDestinations.map(destination => <ContentRow key={destination.id} title={t(destination.name)} detail={t(destination.address)} onPress={() => router.push({ pathname: '/destinations/[id]', params: { id: destination.id } })} />) : <EmptyContent message="noDestinations" />}</View>
  </Page>;
}
export function DestinationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const destination = sampleDestinations.find(item => item.id === id);
  const { t } = useTranslation();
  if (!destination) return <Page><EmptyContent /></Page>;
  return <Page><SampleNotice /><View style={{ gap: 8 }}><AppText variant="title" accessibilityRole="header">{t(destination.name)}</AppText><AppText selectable style={{ color: colors.muted }}>{t(destination.address)}</AppText></View>
    <Panel><SectionTitle>{t('accessInformation')}</SectionTitle><AppText>{t(destination.access)}</AppText><AppText style={{ color: colors.muted }}>{t('accessUnknown')}</AppText></Panel>
    <View style={{ gap: 8 }}><SectionTitle>{t('informationSource')}</SectionTitle><AppText>{t('destinationSource')}</AppText><AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>17 Sep 2026 · 08:00 WIB</AppText></View>
    <AppText style={{ color: colors.caution }}>{t('destinationLimit')}</AppText>
  </Page>;
}
