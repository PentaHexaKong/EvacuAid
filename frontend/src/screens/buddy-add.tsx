import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import IconX from '@tabler/icons-react-native/IconX';
import { ActionButton, AppText, Field } from '@/components/ui';
import { ValueMenu } from '@/components/native-controls';
import { colors, corner, radius } from '@/theme';
import { useGuestSession } from '@/features/profile/session';
import { buddyRequest, type Relation } from '@/features/buddy-pilot/api';
import { readableIssue, useBuddyCopy } from '@/features/buddy-pilot/copy';
import { useBuddyCode } from '@/features/buddy-pilot/use-buddy-pilot';
import type { ApiError } from '@/features/profile/api';

const formatCode = (value: string) => {
  const raw = value.trim();
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Anything longer than a Buddy code is a one-time invitation code from a shared link; it is case-sensitive, so it stays as typed.
  if (clean.length > 8) return raw;
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
};
const BUDDY_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const relations: Relation[] = ['KELUARGA', 'TEMAN', 'TETANGGA', 'PENDAMPING', 'LAINNYA'];

export function BuddyAddScreen() {
  const { token } = useGuestSession();
  const { c } = useBuddyCopy();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();
  const own = useBuddyCode(token);
  const [code, setCode] = useState(() => formatCode(params.code ?? ''));
  const [relation, setRelation] = useState<Relation>('KELUARGA');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const share = () => { if (own) void Share.share({ message: c('shareMessage', { code: own }) }).catch(cause => setError(readableIssue(cause instanceof Error ? cause.message : c('requestFailed'), c))); };
  const direct = BUDDY_CODE.test(code);
  const ready = direct || code.length >= 12;
  const submit = async () => {
    if (!token || !ready || pending.current) return;
    if (code === own) { setError(c('ownCode')); return; }
    pending.current = true; setBusy(true); setError(null);
    try {
      await (direct ? buddyRequest(token, '/invitations/direct', 'POST', { code, relation, direction: 'OFFER_HELP' }) : buddyRequest(token, '/invitations/redeem', 'POST', { code }));
      if (Platform.OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (cause) {
      const status = (cause as ApiError).status;
      setError(status === 404 || (status === 409 && !direct) ? c('codeNotFound') : status === 409 ? c('alreadyConnected') : status === 422 ? c('codeInvalid') : readableIssue(cause instanceof Error ? cause.message : c('requestFailed'), c));
    } finally { pending.current = false; setBusy(false); }
  };
  return <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
    <View style={styles.header}><AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>{c('addBuddy')}</AppText><Pressable accessibilityRole="button" accessibilityLabel={c('sheetClose')} style={styles.close} onPress={() => router.back()}><IconX size={22} color={colors.ink} /></Pressable></View>
    <AppText style={{ color: colors.muted }}>{c('addBuddyBody')}</AppText>
    <View style={styles.codeBlock}>
      <AppText variant="eyebrow" style={{ color: colors.muted }}>{c('yourCode')}</AppText>
      <View style={styles.figure}>{own ? <AppText variant="figure" selectable numberOfLines={1} adjustsFontSizeToFit style={styles.code}>{own}</AppText> : <ActivityIndicator accessibilityLabel={c('checking')} color={colors.primary} />}</View>
      <AppText variant="small" style={{ color: colors.muted }}>{c('yourCodeHint')}</AppText>
      <ActionButton compact variant="secondary" label={c('shareCode')} disabled={!own} onPress={share} />
    </View>
    <View style={styles.field}>
      <AppText variant="button">{c('code')}</AppText>
      <Field accessibilityLabel={c('code')} placeholder="K7Q2-M9XD" value={code} onChangeText={value => { setCode(formatCode(value)); setError(null); }} autoCapitalize="characters" autoCorrect={false} maxLength={64} textContentType="none" returnKeyType="send" onSubmitEditing={() => { void submit(); }} invalid={!!error} editable={!busy} />
      {error && <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{error}</AppText>}
    </View>
    <View style={styles.field}>
      <AppText variant="button">{c('relation')}</AppText>
      <ValueMenu label={c('relation')} value={relation} options={relations.map(value => ({ value, label: c(value) }))} onChange={setRelation} />
    </View>
    <ActionButton label={c('sendInvite')} disabled={!ready || !token} loading={busy} onPress={() => { void submit(); }} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.surface },
  content: { paddingHorizontal: 24, paddingTop: 28, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  codeBlock: { backgroundColor: colors.canvas, ...corner(radius.md), padding: 16, gap: 8 },
  figure: { minHeight: 38, justifyContent: 'center' },
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 0, fontVariant: ['tabular-nums'] },
  field: { gap: 8 },
});
