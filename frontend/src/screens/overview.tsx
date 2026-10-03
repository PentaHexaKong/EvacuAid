import { Image, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import IconArrowRight from '@tabler/icons-react-native/IconArrowRight';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import { LevelChip } from '@/components/content';
import { DiscoverDisaster } from '@/features/hazards/discover-disaster';
import { usePressScale } from '@/components/press';
import { Logo } from '@/components/logo';
import { SettingsMenu } from '@/components/settings-menu';
import { ActionButton, AppText, QuickTile, Tap } from '@/components/ui';
import mapArt from '../../assets/brand/quick/map.png';
import helpArt from '../../assets/brand/quick/help.png';
import buddyArt from '../../assets/brand/quick/buddy.png';
import alertsArt from '../../assets/brand/quick/alerts.png';
import rainArt from '../../assets/brand/alerts/rain.png';
import floodArt from '../../assets/brand/hazards/flood.png';
import { levelLabels, sampleAlerts } from '@/features/content/samples';
import { colors, corner, radius, sky } from '@/theme';

const SKY_OVERSCROLL = 600;
const ALERT_ART: Record<string, ImageSourcePropType> = { rain: rainArt, water: floodArt };

// Tinted with the alert level's own sky, so other levels follow automatically; the whole card opens the alert.
function RecentAlertCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const alert = sampleAlerts[0];
  const { stops } = sky[alert.level];
  const press = usePressScale(0.98);
  const time = alert.issued.split(' · ').pop();
  return <Pressable {...press.handlers} accessibilityRole="button" accessibilityLabel={`${t(levelLabels[alert.level])}. ${t(alert.title)}. ${t('openAlert')}`} onPress={onOpen}>
    <Animated.View style={[styles.alertCard, { backgroundColor: stops[2], borderColor: stops[1] }, press.style]}>
      <View style={styles.alertHead}>
        <View style={{ flex: 1, gap: 10 }}>
          <LevelChip level={alert.level} />
          <AppText variant="section">{t(alert.title)}</AppText>
        </View>
        <Image source={ALERT_ART[alert.id] ?? rainArt} accessible={false} style={styles.alertArt} />
      </View>
      <View style={styles.alertMeta}>
        <IconMapPin size={16} color={colors.muted} />
        <AppText variant="small" style={{ color: colors.muted, flexShrink: 1, fontVariant: ['tabular-nums'] }}>{t(alert.area)} · {time}</AppText>
      </View>
      <View style={styles.alertButton}>
        <AppText variant="button" style={{ color: colors.primary }}>{t('openAlert')}</AppText>
        <IconArrowRight size={18} strokeWidth={2.25} color={colors.primary} />
      </View>
    </Animated.View>
  </Pressable>;
}
// Faded words sit at 75% of the level's ink; contrast.test.ts holds them to 3:1 (large text) on every sky.
export const HEADLINE_FADE = 'BF';
const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase() + value.slice(1);

// Ducat-style sentence: the level and hazard in full ink, connecting words faded, the time in italics.
function Headline({ template, parts, ink }: { template: string; parts: Record<'level' | 'hazard' | 'window', string>; ink: string }) {
  const pieces = template.split(/\{\{(\w+)\}\}/);
  return <AppText variant="title" accessibilityRole="header" style={{ color: ink + HEADLINE_FADE }}>
    {pieces.map((piece, index) => {
      if (index % 2 === 0) return piece;
      const key = piece as keyof typeof parts;
      return <Text key={index} style={key === 'window' ? { fontStyle: 'italic' } : { color: ink }}>{parts[key]}</Text>;
    })}
  </AppText>;
}

export function OverviewScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const alert = sampleAlerts[0];
  const { stops, ink } = sky[alert.level];
  const activeAlerts = sampleAlerts.filter(item => item.level !== 'normal').length;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  return <View style={styles.root}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.header}>
        <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], colors.canvas]} locations={[0, 0.62, 0.78, 0.92, 1]} style={styles.sky} />
        {/* The native toolbar's buttons sit in the 44pt directly below the safe area; pull the logo up into that same band. */}
        <View style={[styles.brand, { marginTop: insets.top - headerHeight }]}><Logo height={32} /></View>
        <View style={{ gap: 10 }}>
          <View style={styles.meta}>
            <View style={styles.area}><IconMapPin size={16} color={ink} /><AppText variant="small" style={{ color: ink, flexShrink: 1 }}>{t(alert.area)}</AppText></View>
          </View>
          <Headline template={t(alert.window ? 'homeHeadline' : 'homeHeadlineNoWindow')} ink={ink} parts={{ level: t(levelLabels[alert.level]), hazard: lowerFirst(t(alert.title)), window: alert.window ? t(alert.window) : '' }} />
        </View>
      </View>
      <View style={styles.content}>
        <ActionButton variant="gradient" label={t('findRouteToShelter')} icon={<IconNavigation size={20} color={colors.surface} />} onPress={() => router.navigate({ pathname: '/discover', params: { route: String(Date.now()) } })} />
        <View style={styles.quickGrid}>
          <View style={styles.quickCell}><QuickTile title={t('quickMap')} detail={t('quickMapDetail')} image={mapArt} onPress={() => router.navigate('/discover')} /></View>
          <View style={styles.quickCell}><QuickTile title={t('quickHelp')} detail={t('quickHelpDetail')} image={helpArt} onPress={() => router.navigate('/buddy')} /></View>
          <View style={styles.quickCell}><QuickTile title={t('quickBuddy')} detail={t('quickBuddyDetail')} image={buddyArt} onPress={() => router.navigate('/buddy')} /></View>
          <View style={styles.quickCell}><QuickTile title={t('quickAlerts')} detail={t('quickAlertsDetail', { count: activeAlerts })} image={alertsArt} onPress={() => router.navigate('/alerts')} /></View>
        </View>
        <View style={{ gap: 12 }}>
          <View style={styles.sectionHeader}><AppText variant="section" accessibilityRole="header" style={{ flexShrink: 1 }}>{t('homeRecentAlert')}</AppText><Tap onPress={() => router.navigate('/alerts')} style={{ minHeight: 44, paddingHorizontal: 8 }}><AppText variant="button" style={{ color: colors.primary }}>{t('homeSeeAll')}</AppText></Tap></View>
          <RecentAlertCard onOpen={() => router.push({ pathname: '/alert/[id]', params: { id: alert.id } })} />
        </View>
        <DiscoverDisaster />
      </View>
    </ScrollView>
    <SettingsMenu notifications />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: 20, paddingBottom: 36, gap: 24 },
  brand: { height: 44, marginLeft: -4, justifyContent: 'center', alignSelf: 'flex-start' },
  sky: { position: 'absolute', left: 0, right: 0, top: -SKY_OVERSCROLL, bottom: -40 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  area: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  content: { paddingHorizontal: 20, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  alertCard: { padding: 20, gap: 12, ...corner(radius.xl), borderWidth: 1 },
  alertHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  alertArt: { width: 84, height: 84, marginTop: -10, marginRight: -8 },
  alertMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.surface },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  quickCell: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
});
