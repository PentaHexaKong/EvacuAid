import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import { ContentRow } from '@/components/content';
import { Logo } from '@/components/logo';
import { SettingsMenu } from '@/components/settings-menu';
import { ActionButton, AppText, Pill, StepList, Tap } from '@/components/ui';
import { levelLabels, sampleAlerts } from '@/features/content/samples';
import { colors, sky } from '@/theme';

const SKY_OVERSCROLL = 600;

export function OverviewScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const alert = sampleAlerts[0];
  const { stops, ink } = sky[alert.level];
  return <View style={styles.root}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.header}>
        <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], colors.canvas]} locations={[0, 0.62, 0.78, 0.92, 1]} style={styles.sky} />
        <View style={styles.brand}><Logo height={26} /></View>
        <View style={{ gap: 10 }}>
          <View style={styles.meta}>
            <Pill style={{ backgroundColor: colors.surface }}><AppText variant="small" style={{ color: ink, fontWeight: '600' }}>{t('exampleTag')}</AppText></Pill>
            <View style={styles.area}><IconMapPin size={16} color={ink} /><AppText variant="small" style={{ color: ink, flexShrink: 1 }}>{t(alert.area)}</AppText></View>
          </View>
          <AppText variant="status" accessibilityRole="header" style={{ color: ink }}>{t(levelLabels[alert.level])}</AppText>
          <AppText variant="section" style={{ color: ink }}>{t(alert.title)}</AppText>
          <AppText variant="small" style={{ color: ink }}>{t(alert.source)} · {alert.issued}</AppText>
        </View>
      </View>
      <View style={styles.content}>
        <ActionButton variant="gradient" label={t('findRouteToShelter')} icon={<IconNavigation size={20} color={colors.surface} />} onPress={() => router.navigate({ pathname: '/discover', params: { route: String(Date.now()) } })} />
        {alert.steps.length > 0 && <View style={{ gap: 14 }}>
          <AppText variant="section" accessibilityRole="header">{t('homeSteps')}</AppText>
          <StepList steps={alert.steps.map(step => t(step))} />
        </View>}
        <View style={{ gap: 12 }}>
          <View style={styles.sectionHeader}><AppText variant="section" accessibilityRole="header" style={{ flexShrink: 1 }}>{t('homeRecentAlert')}</AppText><Tap onPress={() => router.navigate('/alerts')} style={{ minHeight: 44, paddingHorizontal: 8 }}><AppText variant="button" style={{ color: colors.primary }}>{t('homeSeeAll')}</AppText></Tap></View>
          <ContentRow title={t(alert.title)} detail={`${t(alert.severity)}\n${t(alert.source)} · ${alert.issued}`} onPress={() => router.push({ pathname: '/alert/[id]', params: { id: alert.id } })} />
        </View>
        <AppText variant="small" style={{ color: colors.muted }}>{t('sampleExplanation')}</AppText>
        {__DEV__ && <Tap onPress={() => router.push('/route-simulation')} style={{ minHeight: 48, paddingVertical: 12 }}><AppText variant="button" style={{ color: colors.primary }}>{t('routeSimulation')}</AppText></Tap>}
      </View>
    </ScrollView>
    <SettingsMenu notifications />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: 20, paddingBottom: 36, gap: 24 },
  brand: { height: 44, marginTop: -44, justifyContent: 'center', alignSelf: 'flex-start' },
  sky: { position: 'absolute', left: 0, right: 0, top: -SKY_OVERSCROLL, bottom: -40 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  area: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  content: { paddingHorizontal: 20, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
});
