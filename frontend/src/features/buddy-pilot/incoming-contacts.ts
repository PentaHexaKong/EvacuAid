import type { Contact } from './api';

export function incomingNamesSummary(contacts: readonly Pick<Contact, 'name'>[]): string {
  const names = contacts.map(contact => contact.name?.trim()).filter((name): name is string => Boolean(name));
  return [...names.slice(0, 2), ...(names.length > 2 ? [`+${names.length - 2}`] : [])].join(', ');
}
