import { ActionSheetIOS, Alert, Platform, View } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from '@/components/ui';
import { SetupScreen } from './setup';
import { selectLanguage } from '@/localization';
import type { Language } from '@/localization/language';
import { colors } from '@/theme';

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const change = async (language: Language) => {
    setSaving(true);
    try { await selectLanguage(language); } catch { Alert.alert(t('languageError')); } finally { setSaving(false); }
  };
  const languageControl = <View style={{ gap: 12 }}><AppText variant="section" accessibilityRole="header">{t('language')}</AppText><ActionButton variant="secondary" disabled={saving} label={i18n.language === 'id' ? 'Bahasa Indonesia' : 'English'} onPress={() => {
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: t('language'), options: ['Bahasa Indonesia', 'English', t('cancel')], cancelButtonIndex: 2, tintColor: colors.primary }, index => { if (index < 2) void change(index === 0 ? 'id' : 'en'); });
    else void change(i18n.language === 'id' ? 'en' : 'id');
  }} /></View>;
  return <SetupScreen editing onDone={() => router.back()} beforePreferences={languageControl} footer={__DEV__ ? <ActionButton variant="secondary" label={t('developerPreviews')} onPress={() => router.replace('/preview')} /> : undefined} />;
}
