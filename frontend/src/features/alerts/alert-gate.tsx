import { useEffect } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { compareAlerts } from '@/features/alerts/alerts';
import { useAlerts } from '@/features/alerts/use-alerts';

const presented = new Set<string>();
export const markAlertPresented = (id: string) => { presented.add(id); };
export function AlertGate() {
  const alerts = useAlerts();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (pathname.startsWith('/emergency/')) return;
    const item = [...alerts.items].filter(item => item.level !== 'waspada' && item.myResponse === null && !presented.has(item.id)).sort(compareAlerts)[0];
    if (!item) return;
    markAlertPresented(item.id);
    router.push({ pathname: '/emergency/[id]', params: { id: item.id } });
  }, [alerts.items, pathname, router]);
  return null;
}
