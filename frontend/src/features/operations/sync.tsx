import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useGuestSession } from '@/features/profile/session';
import { flushSubmissions } from './outbox';

export function OperationsSync() {
  const { token, user, account } = useGuestSession();
  const userId = user?.id ?? account?.id;
  useEffect(() => {
    if (!token || !userId) return;
    const flush = () => { void flushSubmissions(userId, token).catch(() => {}); };
    const initial = setTimeout(flush, 0);
    const network = NetInfo.addEventListener(state => { if (state.isConnected) flush(); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') flush(); });
    const timer = setInterval(flush, 30000);
    return () => { clearTimeout(initial); clearInterval(timer); network(); app.remove(); };
  }, [token, userId]);
  return null;
}
