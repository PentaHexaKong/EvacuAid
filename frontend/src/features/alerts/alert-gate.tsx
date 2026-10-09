import { useEffect } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { compareAlerts, LEVEL_ORDER } from '@/features/alerts/alerts';
import { useAlerts } from '@/features/alerts/use-alerts';

const presented = new Set<string>();
export const markAlertPresented = (id: string) => { presented.add(id); };
export function AlertGate() {
  const alerts = useAlerts();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (pathname.startsWith('/emergency/')) return;
    // Someone who already answered a warning is acting on it: only a more severe one may interrupt them again.
    const answered = Math.max(0, ...alerts.items.filter(item => item.myResponse !== null).map(item => LEVEL_ORDER[item.level]));
    const item = [...alerts.items].filter(item => item.level !== 'waspada' && item.myResponse === null && LEVEL_ORDER[item.level] > answered && !presented.has(item.id)).sort(compareAlerts)[0];
    if (!item) return;
    markAlertPresented(item.id);
    router.push({ pathname: '/emergency/[id]', params: { id: item.id } });
  }, [alerts.items, pathname, router]);
  return null;
}
