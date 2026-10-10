import { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { buddyRequest, type Contact } from './api';

export function usePrimaryBuddy(token: string | null, enabled: boolean) {
  const focused = useIsFocused();
  const [result, setResult] = useState<{ token: string; contacts: Contact[] } | null>(null);
  useEffect(() => {
    if (!focused || !enabled || !token) return;
    const controller = new AbortController();
    void buddyRequest<Contact[]>(token, '/contacts', 'GET', undefined, controller.signal).then(contacts => {
      if (!controller.signal.aborted) setResult({ token, contacts });
    }).catch(() => {});
    return () => controller.abort();
  }, [focused, enabled, token]);
  const contacts = enabled && result?.token === token ? result.contacts : [];
  return (contacts.find(contact => contact.level === 'PRIMARY') ?? contacts[0])?.name ?? null;
}
