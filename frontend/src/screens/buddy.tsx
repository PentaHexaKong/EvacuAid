import { useAccess } from '@/features/access/use-access';
import { useCallback } from 'react';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { TabHeader } from '@/components/tab-shell';
import { ActivityIndicator } from 'react-native';
import { ActionButton, AppText, Page } from '@/components/ui';
import { useProfile } from '@/features/profile/context';
import { HelperContent } from '@/features/buddy/ui/helper-buddy';
import { useGuestSession } from '@/features/profile/session';
import { useBuddy } from '@/features/buddy/use-buddy';
import { useBuddyActions } from '@/features/buddy/use-buddy-actions';
import { useBuddyCopy } from '@/features/buddy/copy';
import { useInboxNotifications } from '@/features/buddy/native';
import { VoiceBuddyView } from '@/features/buddy/ui/voice-buddy-view';
import { BuddiesView } from '@/features/buddy/ui/buddies-view';
import { SessionMap, SessionView } from '@/features/buddy/ui/session-view';
import { Card } from '@/features/buddy/ui/parts';
import { colors } from '@/theme';

export function BuddyScreen() {
  const { token, user } = useGuestSession();
  const state = useBuddy(token, user?.id);
  const { accessibility, ready } = useProfile();
  const refresh = state.refresh;
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const { c } = useBuddyCopy();
  if (!token || !user) return <Page><AppText accessibilityRole="alert">{c('requestFailed')}</AppText></Page>;
  if (state.loading || !ready) return <Page><ActivityIndicator accessibilityLabel={c('checking')} /></Page>;
  if (accessibility.length === 0) return <HelperContent key={user.id} token={token} userId={user.id} state={state} />;
  return <BuddyContent key={user.id} token={token} userId={user.id} state={state} />;
}

function BuddyContent({ token, userId, state }: { token: string; userId: string; state: ReturnType<typeof useBuddy> }) {
  const { soundFree, voiceHome } = useAccess();
  const a = useBuddyActions({ token, userId, state });
  const router = useRouter();
  const { c, session, requester, active, issue, voice, native, catchNative, setLocalError } = a;
  useInboxNotifications(state.inbox, a.event);
  const inSession = Boolean(session && (requester || session.helperUserId === userId));

  const bar = <>
    <TabHeader><AppText variant="title" accessibilityRole="header">{c('title')}</AppText></TabHeader>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="plus" accessibilityLabel={c('addBuddy')} onPress={() => router.push('/buddy-add')} />
      {!voiceHome && <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={c('more')}>
        <Stack.Toolbar.MenuAction onPress={() => catchNative(native.enableNotifications)}>{c('notifications')}</Stack.Toolbar.MenuAction>
        {!soundFree && <Stack.Toolbar.MenuAction onPress={() => { if (voice.listening) voice.stopListening(); else void voice.startListening(); }}>{voice.listening ? c('listening') : c('listen')}</Stack.Toolbar.MenuAction>}
      </Stack.Toolbar.Menu>}
    </Stack.Toolbar>
  </>;
  const banner = issue && <Card tint="caution">
    <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{issue}</AppText>
    <ActionButton compact variant="secondary" label={c('retry')} onPress={() => { setLocalError(null); void state.refresh(); }} />
  </Card>;
  if (voiceHome) return <Page keyboard>{bar}{banner}<VoiceBuddyView a={a} /></Page>;
  if (inSession && active && native.location) return <>{bar}<SessionMap a={a} token={token} userId={userId} banner={banner} /></>;

  return <Page keyboard>
    {bar}
    {banner}
    {inSession ? <SessionView a={a} token={token} userId={userId} /> : <BuddiesView a={a} />}
  </Page>;
}
