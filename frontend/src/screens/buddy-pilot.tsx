import { useAccess } from '@/features/access/use-access';
import { useCallback, useContext, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import { TabHeader } from '@/components/tab-shell';
import { ActivityIndicator } from 'react-native';
import Animated from 'react-native-reanimated';
import { ActionButton, AppText, Page } from '@/components/ui';
import { Segmented } from '@/components/native-controls';
import { useProfile } from '@/features/profile/context';
import { HelperContent, TAB_SHIFT, tabEnter } from '@/features/buddy-pilot/ui/helper-buddy';
import { useGuestSession } from '@/features/profile/session';
import { buddyRequest } from '@/features/buddy-pilot/api';
import { useBuddyPilot } from '@/features/buddy-pilot/use-buddy-pilot';
import { useBuddyActions } from '@/features/buddy-pilot/use-buddy-actions';
import { useBuddyCopy } from '@/features/buddy-pilot/copy';
import { useInboxNotifications } from '@/features/buddy-pilot/native';
import { BuddiesView } from '@/features/buddy-pilot/ui/buddies-view';
import { NearbyView } from '@/features/buddy-pilot/ui/nearby-view';
import { SessionMap, SessionView } from '@/features/buddy-pilot/ui/session-view';
import { Card } from '@/features/buddy-pilot/ui/parts';
import { colors, SystemReduceMotionContext } from '@/theme';

export function BuddyPilotScreen() {
  const { token, user } = useGuestSession();
  const state = useBuddyPilot(token);
  const { accessibility, ready } = useProfile();
  const refresh = state.refresh;
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const { c } = useBuddyCopy();
  if (!token || !user) return <Page><AppText accessibilityRole="alert">{c('requestFailed')}</AppText></Page>;
  if (state.loading || !ready) return <Page><ActivityIndicator accessibilityLabel={c('checking')} /></Page>;
  if (accessibility.length === 0) return <HelperContent key={user.id} token={token} userId={user.id} state={state} />;
  return <BuddyContent key={user.id} token={token} userId={user.id} state={state} />;
}

type Tab = 'buddies' | 'nearby';

function BuddyContent({ token, userId, state }: { token: string; userId: string; state: ReturnType<typeof useBuddyPilot> }) {
  const { soundFree } = useAccess();
  const a = useBuddyActions({ token, userId, state });
  const { c, session, requester, attempt, active, issue, voice, native, catchNative, setLocalError } = a;
  const [chosenTab, setTab] = useState<Tab>('buddies');
  const reduceMotion = useContext(SystemReduceMotionContext);
  // Only a switch animates: the tab's first appearance with the screen does not.
  const [switched, setSwitched] = useState(false);
  useInboxNotifications(state.inbox, a.event);
  // A pending GPS offer always surfaces on Nearby; a session the user is part of takes over the tab.
  const tab: Tab = attempt && session?.nearby ? 'nearby' : chosenTab;
  const inSession = Boolean(session && (requester || session.helperUserId === userId));
  const simulate = __DEV__ ? () => catchNative(async () => { await buddyRequest(token, '/dev/simulate-nearby', 'POST', {}); await state.refresh(); }) : undefined;

  const bar = <>
    <TabHeader><AppText variant="title" accessibilityRole="header">{c('title')}</AppText></TabHeader>
    <Stack.Toolbar placement="right"><Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={c('more')}>
      <Stack.Toolbar.MenuAction onPress={() => catchNative(native.enableNotifications)}>{c('notifications')}</Stack.Toolbar.MenuAction>
      {!soundFree && <Stack.Toolbar.MenuAction onPress={() => { if (voice.listening) voice.stopListening(); else void voice.startListening(); }}>{voice.listening ? c('listening') : c('listen')}</Stack.Toolbar.MenuAction>}
    </Stack.Toolbar.Menu></Stack.Toolbar>
  </>;
  const banner = issue && <Card tint="caution">
    <AppText accessibilityRole="alert" style={{ color: colors.critical }}>{issue}</AppText>
    <ActionButton compact variant="secondary" label={c('retry')} onPress={() => { setLocalError(null); void state.refresh(); }} />
  </Card>;
  if (inSession && active && native.location) return <>{bar}<SessionMap a={a} token={token} userId={userId} banner={banner} /></>;

  return <Page keyboard>
    {bar}
    {banner}
    {inSession ? <SessionView a={a} token={token} userId={userId} /> : <>
      <Segmented<Tab> value={tab} onChange={next => { setSwitched(true); setTab(next); }} options={[{ value: 'buddies', label: c('myBuddies') }, { value: 'nearby', label: c('nearbyTab') }]} />
      <Animated.View key={tab} entering={switched ? tabEnter(reduceMotion ? 0 : tab === 'nearby' ? TAB_SHIFT : -TAB_SHIFT) : undefined}>
        {tab === 'buddies' ? <BuddiesView a={a} userId={userId} /> : <NearbyView a={a} onSimulate={simulate} />}
      </Animated.View>
    </>}
  </Page>;
}
