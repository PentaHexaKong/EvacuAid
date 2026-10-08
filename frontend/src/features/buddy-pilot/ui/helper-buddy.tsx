import { useAccess } from '@/features/access/use-access';
import { useContext, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import Animated, { withTiming } from 'react-native-reanimated';
import { TabHeader } from '@/components/tab-shell';
import { ActionButton, AppText, Page } from '@/components/ui';
import { Segmented } from '@/components/native-controls';
import { colors, SystemReduceMotionContext } from '@/theme';
import { duration, ease } from '@/theme/motion';
import { buddyRequest } from '../api';
import { useBuddyActions } from '../use-buddy-actions';
import { useBuddyCode, type useBuddyPilot } from '../use-buddy-pilot';
import { useInboxNotifications } from '../native';
import { FriendsView } from './friends-view';
import { NearbyView } from './nearby-view';
import { SessionMap, SessionView } from './session-view';
import { Card } from './parts';

type Tab = 'friends' | 'auto';
// The incoming tab fades in from the side its segment sits on: a short nudge, not a page slide.
export const TAB_SHIFT = 12;
export const tabEnter = (from: number) => () => {
  'worklet';
  const timing = { duration: duration.state, easing: ease.out };
  return { initialValues: { opacity: 0, transform: [{ translateX: from }] }, animations: { opacity: withTiming(1, timing), transform: [{ translateX: withTiming(0, timing) }] } };
};

export function HelperContent({ token, userId, state }: { token: string; userId: string; state: ReturnType<typeof useBuddyPilot> }) {
  const { soundFree } = useAccess();
  const a = useBuddyActions({ token, userId, state });
  const { c, session, requester, attempt, active, issue, voice, native, catchNative, setLocalError } = a;
  const router = useRouter();
  const code = useBuddyCode(token);
  const [chosenTab, setTab] = useState<Tab>('friends');
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [switched, setSwitched] = useState(false);
  useInboxNotifications(state.inbox, a.event);
  const tab: Tab = attempt && session ? session.nearby ? 'auto' : 'friends' : chosenTab;
  const inSession = Boolean(session && (requester || session.helperUserId === userId));
  const simulate = __DEV__ ? () => catchNative(async () => { await buddyRequest(token, '/dev/simulate-nearby', 'POST', {}); await state.refresh(); }) : undefined;
  const bar = <>
    <TabHeader><AppText variant="eyebrow" style={{ color: colors.muted }}>{c('helpOthers')}</AppText><AppText variant="title" accessibilityRole="header">{c('title')}</AppText></TabHeader>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="plus" accessibilityLabel={c('addBuddy')} onPress={() => router.push('/buddy-add')} />
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={c('more')}>
        <Stack.Toolbar.MenuAction onPress={() => catchNative(native.enableNotifications)}>{c('notifications')}</Stack.Toolbar.MenuAction>
        {!soundFree && <Stack.Toolbar.MenuAction onPress={() => { if (voice.listening) voice.stopListening(); else void voice.startListening(); }}>{voice.listening ? c('listening') : c('listen')}</Stack.Toolbar.MenuAction>}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
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
      <Segmented<Tab> value={tab} onChange={next => { setSwitched(true); setTab(next); }} options={[{ value: 'friends', label: c('friends') }, { value: 'auto', label: c('auto') }]} />
      <Animated.View key={tab} entering={switched ? tabEnter(reduceMotion ? 0 : tab === 'auto' ? TAB_SHIFT : -TAB_SHIFT) : undefined}>
        {tab === 'friends' ? <FriendsView a={a} code={code} /> : <NearbyView a={a} helper onSimulate={simulate} />}
      </Animated.View>
    </>}
  </Page>;
}
