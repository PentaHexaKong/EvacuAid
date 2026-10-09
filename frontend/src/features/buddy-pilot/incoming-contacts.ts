import type { Contact } from './api';

export function incomingNamesSummary(contacts: readonly Pick<Contact, 'name'>[]): string {
  const names = contacts.map(contact => contact.name?.trim()).filter((name): name is string => Boolean(name));
  return [...names.slice(0, 2), ...(names.length > 2 ? [`+${names.length - 2}`] : [])].join(', ');
}


type RelyingContact = Pick<Contact, 'name' | 'latestAlertResponse'>;

export function relyingSummary(contacts: readonly RelyingContact[]): { key: string | null; params: Record<string, string>; tone: 'critical' | 'neutral' } {
  const needsHelp = contacts.find(contact => contact.latestAlertResponse?.response === 'NEEDS_HELP');
  if (needsHelp) return { key: 'relyingDetailNeedsHelp', params: { name: needsHelp.name?.trim() || '' }, tone: 'critical' };
  const answered = contacts.filter(contact => contact.latestAlertResponse);
  if (answered.length && answered.every(contact => contact.latestAlertResponse?.response === 'SAFE')) return { key: 'relyingDetailAllSafe', params: { names: incomingNamesSummary(answered) }, tone: 'neutral' };
  return { key: null, params: { names: incomingNamesSummary(contacts) }, tone: 'neutral' };
}

export function orderRelyingContacts<T extends RelyingContact>(contacts: readonly T[]): T[] {
  const rank = (contact: RelyingContact) => contact.latestAlertResponse?.response === 'NEEDS_HELP' ? 0 : contact.latestAlertResponse?.response === 'EVACUATING' ? 1 : contact.latestAlertResponse?.response === 'SAFE' ? 3 : 2;
  return [...contacts].sort((left, right) => rank(left) - rank(right));
}
