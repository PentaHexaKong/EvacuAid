import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, type ApiError } from '@/features/profile/api';

export type PendingSubmission = { id: string; userId: string; endpoint: '/v1/field-reports' | '/v1/evacuation-check-ins'; payload: Record<string, unknown>; error?: string };
const KEY = 'evacuaid.operations.outbox.v1';
let tail: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.then(operation, operation); tail = next.catch(() => {}); return next;
}
async function read(): Promise<PendingSubmission[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('OUTBOX_CORRUPT');
  return value;
}
export function pendingSubmissions(userId: string) { return serialized(async () => (await read()).filter(item => item.userId === userId)); }
export function enqueueSubmission(item: PendingSubmission) {
  return serialized(async () => {
    const items = await read();
    if (items.some(value => value.id === item.id)) throw new Error('DUPLICATE_SUBMISSION');
    if (items.length >= 100) throw new Error('OUTBOX_FULL');
    await AsyncStorage.setItem(KEY, JSON.stringify([...items, item]));
  });
}
export function discardSubmission(userId: string, id: string) {
  return serialized(async () => { await AsyncStorage.setItem(KEY, JSON.stringify((await read()).filter(item => item.userId !== userId || item.id !== id))); });
}
export function flushSubmissions(userId: string, token: string) {
  return serialized(async () => {
    let items = await read();
    for (const item of [...items]) {
      if (item.userId !== userId) continue;
      try {
        await apiRequest(item.endpoint, token, { method: 'POST', body: JSON.stringify({ ...item.payload, id: item.id }) });
        items = items.filter(value => value.id !== item.id);
        // Persist each acknowledgment, so process termination cannot lose unsent entries.
        await AsyncStorage.setItem(KEY, JSON.stringify(items));
      } catch (cause) {
        const error = cause as ApiError;
        if (error.kind === 'network' || error.status === 401 || error.status === 429 || (error.status ?? 0) >= 500) break;
        items = items.map(value => value.id === item.id ? { ...value, error: error.message } : value);
        await AsyncStorage.setItem(KEY, JSON.stringify(items));
        // Invalid submissions remain editable by deletion/replacement; never drop silently.
      }
    }
    return items.filter(item => item.userId === userId);
  });
}
