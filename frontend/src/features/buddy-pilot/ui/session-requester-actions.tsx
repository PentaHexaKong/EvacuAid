import { ActionButton } from '@/components/ui';
import type { BuddyActions } from '@/features/buddy-pilot/use-buddy-actions';

export function SessionRequesterActions({ a }: { a: BuddyActions }) {
  const { active, requester, session, state, c, confirm, transition } = a;
  return <>
    {active && requester && session?.status === 'ARRIVED' && !session.meetingConfirmed && <ActionButton label={c('meet')} loading={state.busy} onPress={() => confirm(c('meet'), () => { void transition('confirm-meeting'); })} />}
    {active && requester && session?.status === 'COMPLETION_PENDING' && <ActionButton label={c('confirmComplete')} loading={state.busy} onPress={() => confirm(c('confirmComplete'), () => { void transition('confirm-complete'); })} />}
  </>;
}
