import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import { ActionButton, AppText, Page, Panel, StepList } from '@/components/ui';
import { ContentRow, EmptyContent, ExampleChip, LevelChip, SampleNotice, SectionTitle } from '@/components/content';
import { levelLabels, sampleAlerts } from '@/features/content/samples';
import { colors } from '@/theme';

export function AlertsScreen({ sheet = false }: { sheet?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return <Page><SampleNotice /><SectionTitle>{t('alertsIntro')}</SectionTitle><View style={{ gap: 12 }}>
    {sampleAlerts.length ? sampleAlerts.map(alert => <ContentRow key={alert.id} title={t(alert.title)} detail={`${t(levelLabels[alert.level])} · ${t(alert.area)}\n${alert.issued}\n${t(alert.source)}`} onPress={() => router.push({ pathname: sheet ? '/alerts/[id]' : '/alert/[id]', params: { id: alert.id } })} />) : <EmptyContent message="noAlerts" />}
  </View></Page>;
}

export function AlertScreen({ sheet = false }: { sheet?: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const alert = sampleAlerts.find(item => item.id === id);
  const { t } = useTranslation();
  const router = useRouter();
  if (!alert) return <Page><EmptyContent /></Page>;
  const go = (pathname: '/buddy' | '/discover', params?: Record<string, string>) => sheet ? router.dismissTo({ pathname, params }) : router.navigate({ pathname, params });
  return <Page><SampleNotice />
    <View style={{ gap: 10 }}>
      <View style={styles.chips}><LevelChip level={alert.level} /><ExampleChip /></View>
      <AppText variant="title" accessibilityRole="header">{t(alert.title)}</AppText>
      <AppText>{t(alert.area)}</AppText>
      <AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>{alert.issued}{'\n'}{t(alert.validity)}</AppText>
      <AppText variant="small" style={{ color: colors.muted }}>{t(alert.source)}</AppText>
    </View>
    <Panel><SectionTitle>{t('warningContent')}</SectionTitle><AppText selectable>{t(alert.body)}</AppText></Panel>
    <View style={{ gap: 14 }}>
      <SectionTitle>{t('nextSteps')}</SectionTitle>
      {alert.steps.length ? <StepList steps={alert.steps.map(step => t(step))} /> : <AppText style={{ color: colors.muted }}>{t('nextStepsBody')}</AppText>}
    </View>
    <View style={{ gap: 12 }}>
      <ActionButton variant="gradient" label={t('findRouteToShelter')} icon={<IconNavigation size={20} color={colors.surface} />} onPress={() => go('/discover', { route: String(Date.now()) })} />
      <ActionButton variant="secondary" label={t('requestHelp')} onPress={() => go('/buddy')} />
    </View>
    <AppText variant="small" style={{ color: colors.muted }}>{t('alertLimit')}</AppText>
  </Page>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
