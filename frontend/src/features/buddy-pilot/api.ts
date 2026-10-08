import { apiRequest } from '@/features/profile/api';

export type Position = { latitude: number; longitude: number; accuracyM: number; observedAt: string };
export type Relation = 'KELUARGA' | 'TEMAN' | 'TETANGGA' | 'PENDAMPING' | 'LAINNYA';
export type Invitation = { id: string; code?: string; expiresAt: string; status: string; redeemerUserId: string | null; redeemerName: string | null; direction?: 'SEEK_HELP' | 'OFFER_HELP'; relation?: Relation | null; ownerName?: string | null; ownerUserId?: string; ownerNeeds?: string[] };
export type Contact = { id: string; userId: string; buddyUserId: string; name: string | null; level: string; status: string; available: boolean; observedAt: string | null; needs?: string[]; relation?: Relation | null };
export type Attempt = { id: string; helperUserId: string; status: string; expiresAt: string };
export type Session = { id: string; requesterUserId: string; helperUserId: string | null; requesterName: string | null; helperName: string | null; status: string; message: string; supportNeeds: string[]; sharingConsent: boolean; phoneShared: boolean; nearby: boolean; meetingConfirmed: boolean; selectedShelterId: string | null; attempts: Attempt[]; createdAt: string; updatedAt: string };
export type InboxItem = { id: string; requestId: string | null; kind: string; payload: { requestId?: string; attemptId?: string; status?: string }; read: boolean; createdAt: string };
export type Availability = { enrolled: boolean; optedIn: boolean; observedAt: string | null };
export type Message = { id: string; userId: string; text: string; createdAt: string };
export type SharedPosition = Position & { userId: string; stale: boolean };
export type Maneuver = { instruction: string; beginShapeIndex: number; endShapeIndex: number; distanceM: number; durationSec: number; type: number; streetNames?: string[] };
export type BuddyRoute = { routeStatus: string; leg: 'TO_REQUESTER' | 'TO_SHELTER'; destination: { name: string; latitude: number; longitude: number; shelterId?: string } | null; route: { geometry: { type: 'LineString'; coordinates: [number, number][] }; distanceM: number; durationSec: number; profile: string; maneuvers: Maneuver[] } | null; evaluation: { safetyStatus: string; accessibilityStatus: string; reasonCodes: string[] } | null; selectionReasonCodes: string[] };

export const terminalStatuses = new Set(['COMPLETED', 'INTERRUPTED', 'UNANSWERED']);
export const sharingStatuses = new Set(['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING', 'COMPLETION_PENDING']);

export async function buddyRequest<T>(token: string, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try {
    return await apiRequest<T>(`/v1/buddy-pilot${path}`, token, { method, signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (cause) {
    if (timedOut) throw new Error('Buddy connection timed out. Please retry.');
    throw cause;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
