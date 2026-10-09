import { useEffect, useRef, useState, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import IconArrowRight from '@tabler/icons-react-native/IconArrowRight';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconChevronDown from '@tabler/icons-react-native/IconChevronDown';
import IconChevronUp from '@tabler/icons-react-native/IconChevronUp';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconMap from '@tabler/icons-react-native/IconMap';
import IconUsers from '@tabler/icons-react-native/IconUsers';
import IconVolume from '@tabler/icons-react-native/IconVolume';
import IconLifebuoy from '@tabler/icons-react-native/IconLifebuoy';
import { AlertRow } from '@/components/content';
import { DiscoverDisaster } from '@/features/hazards/discover-disaster';
import { Logo } from '@/components/logo';
import { SettingsMenu } from '@/components/settings-menu';
import { TabHeader, TabScrollView } from '@/components/tab-shell';
import { ActionButton, AppText, Tap } from '@/components/ui';
import { Group, Row } from '@/components/grouped-list';
import { SpeakButton } from '@/components/speak-button';
import { incomingNamesSummary } from '@/features/buddy-pilot/incoming-contacts';
import { useIncomingContacts } from '@/features/buddy-pilot/use-incoming-contacts';
import { useProfile } from '@/features/profile/context';
import { useGuestSession } from '@/features/profile/session';
import { useBuddySpeech } from '@/features/buddy-pilot/native';
import { homeCommand, type HomeCommand } from '@/features/voice/home-command';
import { formatDistance } from '@/features/navigation/distance';
import { useEvacuationRoute } from '@/features/navigation/use-evacuation-route';
import { useAccess } from '@/features/access/use-access';
import { speak } from '@/features/feedback/speech';
import { useHaptics } from '@/features/feedback/haptics';
import { formatAlertTime, levelLabels, mapAlert, topAlert } from '@/features/alerts/alerts';
import { useAlerts } from '@/features/alerts/use-alerts';
import { AlertLocationButton } from '@/features/alerts/location-button';
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

// Voice-first Home (visual need): spoken commands and the three rows below Speak run the same actions.
function useVoiceHome(readText: string, nearest: RefObject<string | null>, listen: boolean) {
  const focused = useIsFocused();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const haptics = useHaptics();
  const say = (text: string) => { if (!listen || !focused) return; void speak(text, i18n.language).catch(() => {}); };
  const run = (command: HomeCommand) => {
    if (command === 'readAlert') say(readText);
    // ponytail: interim until spoken evacuation guidance lands.
    else if (command === 'nearest') { if (nearest.current) say(nearest.current); }
    else router.navigate({ pathname: '/buddy', params: { help: String(Date.now()) } });
  };
  const voice = useBuddySpeech({ language: i18n.language === 'id' ? 'id' : 'en', onCommand: transcript => {
    if (!listen || !focused) return;
    const command = homeCommand(transcript);
    if (command) run(command); else say(t('voiceUnknown'));
  } });
  useEffect(() => { if (!focused && voice.listening) voice.cancelListening(); }, [focused, voice.listening, voice.cancelListening]);
  useEffect(() => { if (voice.error) say(t('voiceUnavailable')); }, [voice.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { if (!listen || !focused) return; haptics.tap(); if (voice.listening) voice.stopListening(); else void voice.startListening(); };
  return { listening: voice.listening, failed: Boolean(voice.error), toggle, run };
}

// Owns the shelter lookup on the voice Home, where the sky's route row is not shown, and keeps a spoken line for the "nearest" command.
function NearestRow({ nearest, onPress }: { nearest: RefObject<string | null>; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const { shelters } = useEvacuationRoute();
  const shelter = shelters?.[0];
  const detail = shelter ? `${shelter.name} · ${formatDistance(shelter.distanceM, i18n.language)}` : t('homeNearestDetail');
  useEffect(() => { nearest.current = shelter ? `${t('homeNearest')}: ${shelter.name}, ${formatDistance(shelter.distanceM, i18n.language)}` : null; }, [shelter, nearest, t, i18n.language]);
  return <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconMapPin size={22} strokeWidth={2} color={colors.primary} /></View>} title={t('homeNearest')} detail={detail} trailing={<IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />} onPress={onPress} />;
}

export function OverviewScreen() {
  const access = useAccess();
  const { accessibility } = useProfile();
  const { token } = useGuestSession();
  const hasNeeds = accessibility.length > 0;
  const incomingContacts = useIncomingContacts(token, !hasNeeds);
  const { t, i18n } = useTranslation();
  const peopleDetail = incomingNamesSummary(incomingContacts) || t('homePeopleRelyingDetail');
  const router = useRouter();
  // The hero follows the most severe alert, so a newer Normal notice never hides an active warning.
  const alerts = useAlerts();
  const item = topAlert(alerts.items);
  const alert = item ? mapAlert(item, t) : undefined;
  const level = alert?.level ?? 'normal';
  const calmText = alerts.status === 'no-location' ? t('alertNoLocationBody') : alerts.status === 'error' ? t('alertUnavailable') : alerts.status === 'ready' ? t('homeNoWarning') : '';
  const summary = !alert ? '' : [t(levelLabels[level]), t(alert.title), alert.window ? alert.window : '', t(GUIDANCE[alert.level])].filter(Boolean).join(', ');
  useEffect(() => {
    if (!access.autoRead || !alert || spokenAlerts.has(alert.id)) return;
    spokenAlerts.add(alert.id);
    void speak(summary, i18n.language).catch(() => {});
  }, [access.autoRead, alert?.id, level, summary, i18n.language]);
  const { stops, ink } = sky[level];
  // The header already shows the top alert, so the list below only repeats it at Normal, where the header shows none.
  const listed = alerts.items.filter(item => item.id !== alert?.id).map(item => mapAlert(item, t));
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(false);
  const nearest = useRef<string | null>(null);
  const voice = useVoiceHome(!alert ? calmText : summary, nearest, access.listen);
  const voiceHome = access.voiceHome;
  const collapsible = access.simpleHome || voiceHome;
  useEffect(() => {
    if (!alert || vibratedAlerts.has(alert.id)) return;
    vibratedAlerts.add(alert.id);
    haptics.alert(level);
  }, [alert?.id, level, haptics.alert]);
  const openAlert = (id: string) => router.push({ pathname: '/alert/[id]', params: { id } });
  const chevron = <IconChevronRight size={18} strokeWidth={2.25} color={colors.muted} />;
  return <TabScrollView contentContainerStyle={{ paddingBottom: 32 }}>
    {/* Magic Tap (two-finger double-tap) reaches the element VoiceOver is on and then its ancestors, so it wraps the whole page. */}
    <View onMagicTap={voiceHome && access.listen ? voice.toggle : undefined}>
      <TabHeader><Logo height={32} color={ink} /></TabHeader>
      <SettingsMenu />
      <View style={styles.header}>
        <LinearGradient pointerEvents="none" colors={[stops[0], stops[0], stops[1], stops[2], colors.canvas]} locations={[0, 0.62, 0.78, 0.92, 1]} style={styles.sky} />
        <View style={{ gap: 10 }}>
          <View style={styles.meta}>
            <View style={styles.area}><IconMapPin size={16} color={ink} /><AppText variant="small" style={{ color: ink, flexShrink: 1 }}>{alert?.area ?? t('alertAreaYours')}</AppText></View>
          </View>
          {!alert
            ? alerts.status === 'ready' ? <Headline template={t('homeHeadlineClear')} ink={ink} parts={{ level: lowerFirst(t(levelLabels.normal)), hazard: '' }} /> : <AppText variant="title" accessibilityRole="header" style={{ color: ink }}>{alerts.status === 'no-location' ? t('alertNoLocationTitle') : alerts.status === 'error' ? t('alertUnavailable') : t('loading')}</AppText>
            : <>
              <Headline template={t('homeHeadlineNoWindow')} ink={ink} parts={{ level: t(levelLabels[level]), hazard: lowerFirst(t(alert.title)) }} />
              {alert.window && <AppText variant="button" style={{ color: ink }}>{upperFirst(alert.window)}</AppText>}
              <AppText style={{ color: ink }}>{t(GUIDANCE[alert.level])}</AppText>
              <Tap onPress={() => openAlert(alert.id)} style={styles.readLink}><AppText variant="button" style={{ color: ink }}>{t('homeReadAlert')}</AppText><IconArrowRight size={18} strokeWidth={2.25} color={ink} /></Tap>
            </>}
          {!alert && calmText && alerts.status !== 'error' && <AppText style={{ color: ink }}>{calmText}</AppText>}
          {alerts.status === 'no-location' && <AlertLocationButton reload={alerts.reload} />}
          {alerts.status === 'error' && <ActionButton variant="secondary" label={t('tryAgain')} onPress={() => void alerts.reload()} />}
          {alerts.stale && <AppText variant="small" style={{ color: ink }}>{t('alertStale', { time: formatAlertTime(new Date(alerts.updatedAt!).toISOString()) })}</AppText>}
        </View>
        {voiceHome
          ? access.listen && <View style={{ gap: 12 }}>
            <SpeakButton listening={voice.listening} label={t(voice.listening ? 'voiceListening' : 'voiceSpeak')} detail={t(voice.listening ? 'voiceListeningDetail' : 'voiceSpeakDetail')} hint={`${t('voiceHint')} ${t('voiceExamples')}`} onPress={voice.toggle} />
            {/* Visible examples for low vision; VoiceOver already hears them through the button's hint. A failure is shown here as well as spoken, for people who see the screen but did not hear it. */}
            {voice.failed
              ? <AppText accessibilityRole="alert" style={{ color: ink }}>{t('voiceUnavailable')}</AppText>
              : <AppText accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ color: ink }}>{t('voiceExamples')}</AppText>}
          </View>
          : <RouteAction level={level} ink={ink} tint={stops[2]} onRoute={() => router.navigate({ pathname: '/discover', params: { route: String(Date.now()) } })} />}
      </View>
      <View style={styles.content}>
        {voiceHome ? <Group inset={0}>
          {access.listen && <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconVolume size={22} strokeWidth={2} color={colors.primary} /></View>} title={t('homeReadAloud')} detail={!alert ? calmText : t(alert.title)} trailing={chevron} onPress={() => voice.run('readAlert')} />}
          <NearestRow nearest={nearest} onPress={() => voice.run('nearest')} />
          <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconLifebuoy size={22} strokeWidth={2} color={colors.primary} /></View>} title={t('homeAskHelp')} detail={t('homeAskHelpDetail')} trailing={chevron} onPress={() => voice.run('help')} />
        </Group> : <Group inset={0}>
          {hasNeeds && <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconUsers size={20} strokeWidth={2.25} color={colors.primary} /></View>} title={t('quickHelp')} detail={t('quickHelpDetail')} trailing={chevron} onPress={() => { haptics.tap(); router.navigate('/buddy'); }} />}
          {!hasNeeds && incomingContacts.length > 0 && <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconUsers size={20} strokeWidth={2.25} color={colors.primary} /></View>} title={t('homePeopleRelying')} detail={peopleDetail} accessibilityLabel={`${t('homePeopleRelying')}. ${peopleDetail}`} trailing={chevron} onPress={() => { haptics.tap(); router.navigate('/buddy'); }} />}
          <Row leading={<View style={[styles.tile, { backgroundColor: colors.accentSoft }]}><IconMap size={20} strokeWidth={2.25} color={colors.primary} /></View>} title={t('quickMap')} detail={t('quickMapDetail')} trailing={chevron} onPress={() => { haptics.tap(); router.navigate('/discover'); }} />
        </Group>}
        {collapsible && <Group><Row title={t('homeMore')} detail={t('homeMoreDetail')} accessibilityState={{ expanded }} trailing={expanded ? <IconChevronUp size={18} strokeWidth={2.25} color={colors.muted} /> : <IconChevronDown size={18} strokeWidth={2.25} color={colors.muted} />} onPress={() => setExpanded(value => !value)} /></Group>}
        {(!collapsible || expanded) && <>
        {(listed.length > 0 || level !== 'normal') && <View style={{ gap: 12 }}>
          <View style={styles.sectionHeader}><AppText variant="section" accessibilityRole="header" style={{ flexShrink: 1 }}>{t(level === 'normal' ? 'homeRecentAlert' : 'homeOtherAlerts')}</AppText><Tap onPress={() => router.navigate('/alerts-tab')} style={{ minHeight: 44, paddingHorizontal: 8 }}><AppText variant="button" style={{ color: colors.primary }}>{t('homeSeeAll')}</AppText></Tap></View>
          {listed.length
            ? <Group>{listed.map(item => <AlertRow key={item.id} alert={item} onPress={() => openAlert(item.id)} />)}</Group>
            : <AppText style={{ color: colors.muted }}>{t('homeNoOtherAlerts')}</AppText>}
        </View>}
        <DiscoverDisaster />
        </>}
      </View>
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
