import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Page, Panel } from '@/components/ui';
import { ContentRow, EmptyContent, SampleNotice, SectionTitle } from '@/components/content';
import { sampleAlerts } from '@/features/content/samples';
import { colors } from '@/theme';

export function AlertsScreen({ sheet = false }: { sheet?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return <><Page><SampleNotice /><SectionTitle>{t('alertsIntro')}</SectionTitle><View style={{ gap: 12 }}>
    {sampleAlerts.length ? sampleAlerts.map(alert => <ContentRow key={alert.id} title={t(alert.title)} detail={`${t(alert.severity)} · ${t(alert.area)}\n${alert.issued}\n${t(alert.source)}`} onPress={() => router.push({ pathname: sheet ? '/alerts/[id]' : '/alert/[id]', params: { id: alert.id } })} />) : <EmptyContent message="noAlerts" />}
  </View></Page></>;
}
export function AlertScreen({ sheet = false }: { sheet?: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alert = sampleAlerts.find(item => item.id === id);
  const { t } = useTranslation();
  const router = useRouter();
  if (!alert) return <Page><EmptyContent /></Page>;
  return <Page><SampleNotice />
    <View style={{ gap: 8 }}><AppText variant="eyebrow" style={{ color: alert.severity === 'cautionLabel' ? colors.caution : colors.primary }}>{t(alert.severity)}</AppText><AppText variant="title" accessibilityRole="header">{t(alert.title)}</AppText><AppText>{t(alert.area)}</AppText><AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{alert.issued}{'\n'}{t(alert.validity)}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t(alert.source)}</AppText></View>
    <Panel><SectionTitle>{t('warningContent')}</SectionTitle><AppText selectable>{t(alert.body)}</AppText></Panel>
    <View style={{ gap: 12 }}><SectionTitle>{t('nextSteps')}</SectionTitle><AppText style={{ color: colors.muted }}>{t('nextStepsBody')}</AppText><ActionButton label={t('requestHelp')} onPress={() => sheet ? router.dismissTo('/buddy') : router.navigate('/buddy')} /><ActionButton variant="secondary" label={t('viewDestinations')} onPress={() => sheet ? router.dismissTo('/destinations') : router.push('/destinations')} /></View>
    <AppText variant="small" style={{ color: colors.muted }}>{t('alertLimit')}</AppText>
  </Page>;
}
