import { ActionButton } from '@/components/ui';
import type { BuddyActions } from '@/features/buddy/use-buddy-actions';

export function SessionRequesterActions({ a }: { a: BuddyActions }) {
  const { active, requester, session, state, c, confirm, transition } = a;
  return <>
    {active && requester && session?.status === 'ARRIVED' && !session.meetingConfirmed && <ActionButton label={c('meet')} loading={state.busy} onPress={() => confirm(c('meet'), () => { void transition('confirm-meeting'); })} />}
  </>;
}
