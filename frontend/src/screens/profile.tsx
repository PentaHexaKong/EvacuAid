import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Input } from 'heroui-native/input';
import { ActionButton, AppText, Page } from '@/components/ui';
import { ContentRow } from '@/components/content';
import { useProfile } from '@/features/profile/context';
import { usePreferences } from '@/features/preferences/context';
import { useAuth } from '@/features/auth/context';
import { colors, useTypography } from '@/theme';

export function ProfileScreen() {
  const { t } = useTranslation();
  const { name: localName, ready: localReady } = useProfile();
  const { preferences, save } = usePreferences();
  const { logout: signOut, profile, ready: authReady, session } = useAuth();
  const ready = localReady && authReady;
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { if (session) await signOut(); else await save({ ...preferences, completed: false }); }
    catch { Alert.alert(t('logoutErrorTitle'), t('logoutErrorBody')); }
    finally { pending.current = false; setBusy(false); }
  };
  const label = profile?.name || localName || t('profileFallback');
  const initials = label.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  return <Page>
    <View style={{ alignItems: 'center', gap: 12 }}><View accessible={false} style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }}><AppText variant="title" style={{ color: colors.primary }}>{initials}</AppText></View><AppText variant="title" accessibilityRole="header">{label}</AppText><AppText style={{ color: colors.muted }}>{t(session ? 'savedOnAccount' : 'savedOnDevice')}</AppText></View>
    <View style={{ gap: 12 }}>
      {ready && <ContentRow title={t('editName')} detail={t('optionalName')} onPress={() => router.push('/profile/name')} />}
      <ContentRow title={t('supportSettings')} detail={t('supportTitle')} onPress={() => router.push('/profile/settings')} />
      <ContentRow title={t('language')} detail={t('languageChoices')} onPress={() => router.push('/profile/settings')} />
      <ContentRow title={t('buddyContacts')} detail={t('trustedContacts')} onPress={() => router.dismissTo('/buddy')} />
    </View>
    <ActionButton variant="secondary" label={t('logout')} loading={busy} onPress={() => void logout()} />
  </Page>;
}
export function EditNameScreen() {
  const { ready: authReady } = useAuth();
  const { ready: localReady } = useProfile();
  const { t } = useTranslation();
  return authReady && localReady ? <NameForm /> : <Page><AppText>{t('profileLoading')}</AppText></Page>;
}
function NameForm() {
  const { profile, updateProfile, session } = useAuth();
  const { name, saveName } = useProfile();
  const { t } = useTranslation();
  const router = useRouter();
  const [draft, setDraft] = useState(profile?.name ?? name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const typography = useTypography('body');
  const { preferences } = usePreferences();
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(false);
    try { if (session) await updateProfile({ name: draft.trim() }); else await saveName(draft); router.back(); }
    catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Page keyboard><AppText variant="title" accessibilityRole="header">{t('editName')}</AppText><AppText>{t('optionalName')}</AppText>
    <Input accessibilityLabel={t('profileNameLabel')} value={draft} onChangeText={setDraft} maxLength={60} editable={!busy} autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => void save()} style={[typography, { minHeight: 52, height: 'auto', backgroundColor: colors.surface, padding: 16 }, preferences.largerText && { fontSize: 19.2, lineHeight: 28.8 }]} />
    {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{t('nameSaveError')}</AppText>}
    <ActionButton label={t('saveName')} loading={busy} onPress={() => void save()} /><ActionButton variant="secondary" label={t('cancel')} disabled={busy} onPress={() => router.back()} />
  </Page>;
}
