export type EmergencyAction = { id: 'buddy' | 'evacuate' | 'safe' | 'checkPeople' | 'needHelp'; variant: 'gradient' | 'secondary' | 'link' };
export function emergencyActions({ hasNeeds, relyingCount }: { hasNeeds: boolean; voiceHome: boolean; buddyName: string | null; relyingCount: number }): EmergencyAction[] {
  if (hasNeeds) return [{ id: 'buddy', variant: 'gradient' }, { id: 'evacuate', variant: 'secondary' }, { id: 'safe', variant: 'link' }];
  return [{ id: 'evacuate', variant: 'gradient' }, { id: 'safe', variant: 'secondary' }, ...(relyingCount > 0 ? [{ id: 'checkPeople', variant: 'secondary' } as const] : []), { id: 'needHelp', variant: 'link' }];
}
