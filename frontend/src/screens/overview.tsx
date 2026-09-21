import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from 'heroui-native/button';
import { Card } from 'heroui-native/card';
import { Chip } from 'heroui-native/chip';
import { Input } from 'heroui-native/input';
import IconAlertTriangle from '@tabler/icons-react-native/IconAlertTriangle';
import IconMapPin from '@tabler/icons-react-native/IconMapPin';
import IconNavigation from '@tabler/icons-react-native/IconNavigation';
import IconMap2 from '@tabler/icons-react-native/IconMap2';
import IconSearch from '@tabler/icons-react-native/IconSearch';
import IconBell from '@tabler/icons-react-native/IconBell';
import { SettingsMenu } from '@/components/settings-menu';
import { AppText } from '@/components/ui';
import { sampleAlerts, sampleDestinations } from '@/features/content/samples';
import { useProfile } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import { colors, useTypography } from '@/theme';

export function OverviewScreen() {
  const { t } = useTranslation();
  const { name } = useProfile();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const { preferences } = usePreferences();
  const inputStyle = useTypography('body');
  const [query, setQuery] = useState('');
  const alert = sampleAlerts[0];
  const search = query.trim().toLocaleLowerCase();
  const results = sampleDestinations.filter(item => `${t(item.name)} ${t(item.address)}`.toLocaleLowerCase().includes(search));
  const expandedText = preferences.largerText || fontScale > 1.2 || width < 360;
  const actions = [
    { label: 'homeRiskMap', Icon: IconMap2, href: '/discover' },
    { label: 'homeSafeRoutes', Icon: IconNavigation, href: '/destinations' },
    { label: 'homeReport', Icon: IconAlertTriangle, href: null },
    { label: 'homePreparedness', Icon: IconBell, href: '/alerts' },
  ] as const;
  return <View style={styles.root}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ backgroundColor: colors.canvas, paddingBottom: 24 }}>
      <View style={styles.header}>
        <View style={styles.greetingRow}>
          <View style={{ flex: 1, gap: 8 }}><AppText variant="title" accessibilityRole="header">{name ? t('homeNamedGreeting', { name }) : t('homeGreeting')}</AppText><View style={styles.location}><IconMapPin size={18} color={colors.muted} /><AppText variant="small" style={{ color: colors.muted, flexShrink: 1 }}>{t('exampleArea')}</AppText></View></View>
        </View>
        <View style={styles.search}>
          <IconSearch size={20} color={colors.muted} />
          <Input value={query} onChangeText={setQuery} accessibilityLabel={t('homeSearch')} placeholder={t('homeSearch')} placeholderTextColor={preferences.strongerContrast ? colors.ink : colors.muted} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} style={[inputStyle, styles.searchInput, preferences.largerText && { fontSize: 19.2, lineHeight: 28.8 }]} />
        </View>
        {search.length > 0 && <View style={{ gap: 8 }}>
          <AppText variant="small" accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{t(results.length ? 'homeSearchResults' : 'homeNoResults')}</AppText>
          {results.map(item => <Button key={item.id} variant="ghost" onPress={() => { setQuery(''); router.push({ pathname: '/destinations/[id]', params: { id: item.id } }); }} style={styles.searchResult}><AppText style={{ color: colors.primary, flex: 1 }}>{t(item.name)}</AppText><IconNavigation size={18} color={colors.primary} /></Button>)}
        </View>}
      </View>
      <View style={styles.content}>
        <Card style={styles.statusCard}>
          <LinearGradient colors={[colors.primary, colors.gradientTop]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" accessible={false} style={styles.statusRing} />
          <Card.Body style={{ gap: 16 }}>
            <View style={styles.statusTop}><Chip size="sm" style={styles.statusChip}><AppText variant="small" style={{ color: colors.surface }}>{t('homeAreaStatus')}</AppText></Chip><AppText variant="small" style={{ color: colors.surface }}>{t('homeExample')}</AppText></View>
            <View style={{ gap: 8 }}><AppText variant="section" accessibilityRole="header" style={{ color: colors.surface }}>{t('homeStatusTitle')}</AppText><AppText style={{ color: colors.surface }}>{t('homeStatusBody')}</AppText></View>
          </Card.Body>
        </Card>
        <View style={{ gap: 18 }}>
          <AppText variant="section" accessibilityRole="header">{t('homeQuickActions')}</AppText>
          <View style={styles.quickGrid}>{actions.map(({ label, Icon, href }) => <View key={label} style={{ width: expandedText ? '47%' : '22%', alignItems: 'center', gap: 10 }}>
            <Button isIconOnly variant="outline" accessibilityLabel={t(label)} onPress={() => href ? router.navigate(href) : Alert.alert(t('homeReport'), t('homeReportUnavailable'))} style={styles.quickButton}><Icon size={26} strokeWidth={1.7} color={colors.primary} /></Button>
            <AppText variant="button" accessible={false} style={{ textAlign: 'center', fontSize: 14, lineHeight: 20 }}>{t(label)}</AppText>
          </View>)}</View>
        </View>
        <View style={{ gap: 12 }}>
          <View style={styles.sectionHeader}><AppText variant="section" accessibilityRole="header" style={{ flexShrink: 1 }}>{t('homeRecentAlert')}</AppText><Button variant="ghost" size="sm" onPress={() => router.navigate('/alerts')} style={{ minHeight: 44, paddingHorizontal: 8 }}><AppText variant="button" style={{ color: colors.primary }}>{t('homeSeeAll')}</AppText></Button></View>
          <Card style={styles.alertCard}><Card.Body style={{ gap: 14 }}>
            <View style={styles.statusTop}><Chip variant="soft" color="warning" style={{ height: 'auto', minHeight: 32, paddingVertical: 6 }}><IconAlertTriangle size={16} color={colors.caution} /><AppText variant="small" style={{ color: colors.caution }}>{t('cautionLabel')}</AppText></Chip><AppText variant="small" style={{ color: colors.muted, fontVariant: ['tabular-nums'] }}>08:30 WIB</AppText></View>
            <AppText variant="section" accessibilityRole="header">{t(alert.title)}</AppText>
            <AppText style={{ color: colors.muted }}>{t(alert.area)}. {t(alert.source)}</AppText>
            <Button variant="secondary" onPress={() => router.push({ pathname: '/alert/[id]', params: { id: alert.id } })} style={styles.readButton}><AppText variant="button" style={{ color: colors.primary }}>{t('viewAlert')}</AppText><IconNavigation size={18} color={colors.primary} /></Button>
          </Card.Body></Card>
        </View>
        <AppText variant="small" style={{ color: colors.muted }}>{t('sampleExplanation')}</AppText>
      </View>
    </ScrollView>
    <SettingsMenu notifications />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: { backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 22 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.canvas },
  searchInput: { flex: 1, backgroundColor: 'transparent', borderWidth: 0, minHeight: 54, height: 'auto', paddingHorizontal: 0, paddingVertical: 14, boxShadow: 'none' },
  searchResult: { justifyContent: 'flex-start', minHeight: 48, height: 'auto', paddingVertical: 12 },
  content: { padding: 20, gap: 28, maxWidth: 680, width: '100%', alignSelf: 'center' },
  statusCard: { borderRadius: 24, padding: 20, overflow: 'hidden', backgroundColor: colors.primary, borderWidth: 0, boxShadow: '0 8px 20px rgba(0, 85, 160, 0.12)' },
  statusRing: { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 22, borderColor: 'rgba(18,40,75,0.1)', right: -60, top: -60 },
  statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  statusChip: { backgroundColor: 'rgba(18,40,75,0.2)', minHeight: 32, height: 'auto', paddingVertical: 6 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 20 },
  quickButton: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.surface, borderColor: colors.border, boxShadow: '0 3px 8px rgba(18,40,75,0.04)' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  alertCard: { padding: 18, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, boxShadow: 'none' },
  readButton: { alignSelf: 'flex-start', height: 'auto', minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: colors.canvas },
});
