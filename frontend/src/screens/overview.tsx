import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import IconArrowRight from '@tabler/icons-react-native/IconArrowRight';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconChevronDown from '@tabler/icons-react-native/IconChevronDown';
import IconChevronUp from '@tabler/icons-react-native/IconChevronUp';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconMap from '@tabler/icons-react-native/IconMap';
import IconUsers from '@tabler/icons-react-native/IconUsers';
import { AlertRow } from '@/components/content';
import { DiscoverDisaster } from '@/features/hazards/discover-disaster';
import { Logo } from '@/components/logo';
import { SettingsMenu } from '@/components/settings-menu';
import { TabHeader, TabScrollView } from '@/components/tab-shell';
import { AppText, Tap } from '@/components/ui';
import { Group, Row } from '@/components/grouped-list';
import { formatDistance } from '@/features/navigation/distance';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { useAccess } from '@/features/access/use-access';
import { speak } from '@/features/feedback/speech';
import { useHaptics } from '@/features/feedback/haptics';
import { levelLabels, sampleAlerts, topAlert } from '@/features/content/samples';
import { colors, corner, gutter, radius, sky, type AlertLevel } from '@/theme';

const vibratedAlerts = new Set<string>();
const spokenAlerts = new Set<string>();
const SKY_OVERSCROLL = 600;
// One plain next step per warning level; Normal has nothing to act on.
const GUIDANCE = { waspada: 'guidanceWaspada', siaga: 'guidanceSiaga', awas: 'guidanceAwas' } as const;

// Faded words sit at 75% of the level's ink; contrast.test.ts holds them to 3:1 (large text) on every sky.
export const HEADLINE_FADE = 'BF';
const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase() + value.slice(1);
const upperFirst = (value: string) => value.charAt(0).toLocaleUpperCase() + value.slice(1);

// Ducat-style sentence: the level and hazard in full ink, connecting words faded. The time sits on its own line below.
function Headline({ template, parts, ink }: { template: string; parts: Record<'level' | 'hazard', string>; ink: string }) {
  const pieces = template.split(/\{\{(\w+)\}\}/);
  return <AppText variant="title" accessibilityRole="header" style={{ color: ink + HEADLINE_FADE }}>
    {pieces.map((piece, index) => {
      if (index % 2 === 0) return piece;
      const key = piece as keyof typeof parts;
      return <Text key={index} style={{ color: ink }}>{parts[key]}</Text>;
    })}
  </AppText>;
}

// The route lives in the sky as the nearest gathering point itself. Its shape never changes between levels;
// at Awas the chevron becomes a "Mulai rute" pill, and the headline does the urging. Normal has nothing to evacuate from.
function RouteAction({ level, ink, tint, onRoute }: { level: AlertLevel; ink: string; tint: string; onRoute: () => void }) {
  const { t, i18n } = useTranslation();
  const { shelters } = useEvacuationRoute();
  if (level === 'normal') return null;
  const nearest = shelters?.[0];
  const detail = nearest ? `${t('nearestShort')} · ${formatDistance(nearest.distanceM, i18n.language)}` : t('homeRouteOnMap');
  const title = nearest?.name ?? t('findRouteToShelter');
  return <Group><Row
    leading={<View style={[styles.tile, { backgroundColor: tint }]}><IconMapPin size={20} strokeWidth={2.25} color={ink} /></View>}
    title={title} detail={detail} accessibilityLabel={level === 'awas' ? `${title}. ${detail}. ${t('homeStartRoute')}` : `${title}. ${detail}`} onPress={onRoute}
    trailing={level === 'awas'
      ? <View style={styles.startPill}><AppText variant="button" style={{ color: colors.surface }}>{t('homeStartRoute')}</AppText></View>
      : <IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />} /></Group>;
}

export function OverviewScreen() {
  const access = useAccess();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  // The hero follows the most severe alert, so a newer Normal notice never hides an active warning.
  const alert = topAlert;
  const level = alert.level;
  const summary = level === 'normal' ? '' : [t(levelLabels[level]), t(alert.title), alert.window ? t(alert.window) : '', t(GUIDANCE[level])].filter(Boolean).join(', ');
  useEffect(() => {
    if (!access.autoRead || level === 'normal' || spokenAlerts.has(alert.id)) return;
    spokenAlerts.add(alert.id);
    void speak(summary, i18n.language).catch(() => {});
  }, [access.autoRead, alert.id, level, summary, i18n.language]);
  const { stops, ink } = sky[level];
  // The header already shows the top alert, so the list below only repeats it at Normal, where the header shows none.
  const listed = level === 'normal' ? sampleAlerts : sampleAlerts.filter(item => item.id !== alert.id);
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (level === 'normal' || vibratedAlerts.has(alert.id)) return;
    vibratedAlerts.add(alert.id);
    haptics.alert(level);
  }, [alert.id, level, haptics.alert]);
  const openAlert = (id: string) => router.push({ pathname: '/alert/[id]', params: { id } });
  const chevron = <IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />;
  return <TabScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <TabHeader><Logo height={32} color={ink} /></TabHeader>
      <SettingsMenu notifications />
      <View style={styles.header}>
        <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], colors.canvas]} locations={[0, 0.62, 0.78, 0.92, 1]} style={styles.sky} />
        <View style={{ gap: 10 }}>
          <View style={styles.meta}>
            <View style={styles.area}><IconMapPin size={16} color={ink} /><AppText variant="small" style={{ color: ink, flexShrink: 1 }}>{t(alert.area)}</AppText></View>
          </View>
          {level === 'normal'
            ? <Headline template={t('homeHeadlineClear')} ink={ink} parts={{ level: lowerFirst(t(levelLabels.normal)), hazard: '' }} />
            : <>
              <Headline template={t('homeHeadlineNoWindow')} ink={ink} parts={{ level: t(levelLabels[level]), hazard: lowerFirst(t(alert.title)) }} />
              {alert.window && <AppText variant="button" style={{ color: ink }}>{upperFirst(t(alert.window))}</AppText>}
              <AppText style={{ color: ink }}>{t(GUIDANCE[level])}</AppText>
              <Tap onPress={() => openAlert(alert.id)} style={styles.readLink}><AppText variant="button" style={{ color: ink }}>{t('homeReadAlert')}</AppText><IconArrowRight size={18} strokeWidth={2.25} color={ink} /></Tap>
            </>}
        </View>
        <RouteAction level={level} ink={ink} tint={stops[2]} onRoute={() => router.navigate({ pathname: '/discover', params: { route: String(Date.now()) } })} />
      </View>
      <View style={styles.content}>
        <Group inset={0}>
          <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconUsers size={20} strokeWidth={2.25} color={colors.primary} /></View>} title={t('quickHelp')} detail={t('quickHelpDetail')} trailing={chevron} onPress={() => { haptics.tap(); router.navigate('/buddy'); }} />
          <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconMap size={20} strokeWidth={2.25} color={colors.primary} /></View>} title={t('quickMap')} detail={t('quickMapDetail')} trailing={chevron} onPress={() => { haptics.tap(); router.navigate('/discover'); }} />
        </Group>
        {access.simpleHome && <Group><Row title={t('homeMore')} detail={t('homeMoreDetail')} accessibilityState={{ expanded }} trailing={expanded ? <IconChevronUp size={18} strokeWidth={2.25} color={colors.muted} /> : <IconChevronDown size={18} strokeWidth={2.25} color={colors.muted} />} onPress={() => setExpanded(value => !value)} /></Group>}
        {(!access.simpleHome || expanded) && <>
        <View style={{ gap: 12 }}>
          <View style={styles.sectionHeader}><AppText variant="section" accessibilityRole="header" style={{ flexShrink: 1 }}>{t(level === 'normal' ? 'homeRecentAlert' : 'homeOtherAlerts')}</AppText><Tap onPress={() => router.navigate('/alerts')} style={{ minHeight: 44, paddingHorizontal: 8 }}><AppText variant="button" style={{ color: colors.primary }}>{t('homeSeeAll')}</AppText></Tap></View>
          {listed.length
            ? <Group>{listed.map(item => <AlertRow key={item.id} alert={item} onPress={() => openAlert(item.id)} />)}</Group>
            : <AppText style={{ color: colors.muted }}>{t('homeNoOtherAlerts')}</AppText>}
        </View>
        <DiscoverDisaster />
        </>}
      </View>
  </TabScrollView>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: gutter, paddingTop: 12, paddingBottom: 36, gap: 24 },
  sky: { position: 'absolute', left: 0, right: 0, top: -SKY_OVERSCROLL, bottom: -40 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  area: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  content: { paddingHorizontal: gutter, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  startPill: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primary },
  tile: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', ...corner(radius.sm) },
  readLink: { alignSelf: 'flex-start', justifyContent: 'flex-start', gap: 6, minHeight: 44 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
});
