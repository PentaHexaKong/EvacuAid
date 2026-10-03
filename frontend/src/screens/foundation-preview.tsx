import { useState } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SetupScreen } from '@/screens/setup';
import { PageHeaderContext, PageTitleContext } from '@/components/page-scroll-view';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import IconArrowUpRight from '@tabler/icons-react-native/IconArrowUpRight';
import IconMap2 from '@tabler/icons-react-native/IconMap2';
import IconStack2 from '@tabler/icons-react-native/IconStack2';
import { ActionButton, AppText, Page, Panel, SectionHeading } from '@/components/ui';
import { colors, radius } from '@/theme';
import { selectLanguage } from '@/localization';
import type { Language } from '@/localization/language';

export function OverviewScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const changeLanguage = async (language: Language) => {
    setSaving(true); setLanguageError(false);
    try { await selectLanguage(language); } catch { setLanguageError(true); } finally { setSaving(false); }
  };
  return <><Page>
    <PageHeaderContext.Provider value={null}><PageTitleContext.Provider value={null}><Modal visible={settingsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>{settingsOpen && <SetupScreen editing onDone={() => setSettingsOpen(false)} />}</SafeAreaView>
    </Modal></PageTitleContext.Provider></PageHeaderContext.Provider>
    <SectionHeading number={t('preview')} title={t('overviewTitle')} subtitle={t('overviewDescription')} />
    <Panel><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><IconMap2 size={32} strokeWidth={2} color={colors.primary} /><AppText variant="eyebrow" style={{ color: colors.muted }}>01</AppText></View>
      <AppText variant="section" accessibilityRole="header">{t('mapCardTitle')}</AppText><AppText style={{ color: colors.muted }}>{t('mapCardBody')}</AppText>
      <ActionButton variant="gradient" label={t('exploreMap')} icon={<IconArrowUpRight size={20} strokeWidth={2} color={colors.surface} />} onPress={() => router.navigate('/buddy-map')} />
    </Panel>
    <Panel><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><IconStack2 size={32} strokeWidth={2} color={colors.primary} /><AppText variant="eyebrow" style={{ color: colors.muted }}>02</AppText></View>
      <AppText variant="section" accessibilityRole="header">{t('componentsCardTitle')}</AppText><AppText style={{ color: colors.muted }}>{t('componentsCardBody')}</AppText>
      <ActionButton variant="secondary" label={t('exploreComponents')} onPress={() => router.navigate('/components')} />
    </Panel>
    <View style={{ gap: 12 }}><AppText variant="section" accessibilityRole="header">{t('language')}</AppText><AppText variant="small" style={{ color: colors.muted }}>{t('languageNote')}</AppText>
      {Platform.OS === 'ios' ? <ActionButton variant="secondary" disabled={saving} loading={saving} label={`${t('language')}: ${i18n.language === 'id' ? 'Bahasa Indonesia' : 'English'}`} onPress={() => ActionSheetIOS.showActionSheetWithOptions({ title: t('language'), options: ['Bahasa Indonesia', 'English', t('cancel')], cancelButtonIndex: 2, tintColor: colors.primary }, (index) => { if (index === 0 || index === 1) void changeLanguage(index === 0 ? 'id' : 'en'); })} /> : <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>{(['id', 'en'] as const).map((language) => <Pressable key={language} disabled={saving} accessibilityRole="button" accessibilityState={{ selected: i18n.language === language, disabled: saving }} onPress={() => void changeLanguage(language)} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: i18n.language === language ? colors.primary : colors.border, backgroundColor: pressed ? colors.sky : i18n.language === language ? colors.sky : colors.surface })}><AppText variant="button">{language === 'id' ? 'Bahasa Indonesia' : 'English'}</AppText></Pressable>)}</View>}
      {languageError && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('languageError')}</AppText>}
    </View><ActionButton variant="secondary" label={t('supportSettings')} onPress={() => setSettingsOpen(true)} /><AppText variant="small" style={{ color: colors.muted }}>{t('demoOnly')}</AppText>
  </Page></>;
}
