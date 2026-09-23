/**
 * Shared Buddy API client.
 *
 * Keep this file outside `frontend` and `backend`: it is the small contract
 * between both teams. It has no React Native or server dependency.
 *
 * Frontend usage:
 *   const buddies = createBuddyApi("http://YOUR_COMPUTER_IP:8000");
 *   const list = await buddies.listBuddies(currentUserId);
 *
 * `localhost` only works in a web browser on the same computer. Android
 * emulator normally needs `http://10.0.2.2:8000`; physical devices need the
 * computer's LAN IP. Replace base URL at app configuration time.
 */

export type Uuid = string;
export type BuddyLevel = 'PRIMARY' | 'SECONDARY' | 'COMMUNITY';
export type BuddyStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED';
export type SafetyStatus = 'UNKNOWN' | 'SAFE' | 'POTENTIALLY_EXPOSED';

// Names stay camelCase because FastAPI sends and expects these exact fields.
export type BuddyRelationship = {
  id: Uuid;
  userId: Uuid;
  buddyUserId: Uuid;
  level: BuddyLevel;
  status: BuddyStatus;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
};

export type BuddyCandidate = {
  buddyUserId: Uuid;
  relationshipId: Uuid;
  level: BuddyLevel;
  distanceM: number | null;
  locationAvailable: boolean;
  available: boolean;
  activeAssignments: number;
  safetyStatus: SafetyStatus;
  rank: number;
  selectionReasons: string[];
};

export type BuddyCandidatesResponse = { candidates: BuddyCandidate[] };
export type CreateBuddyInvitation = { buddyUserId: Uuid; level: BuddyLevel };

export class BuddyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
  ) {
    super(`Buddy API request failed (${status})`);
    this.name = 'BuddyApiError';
  }
}

type RequestOptions = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown };

function normaliseBaseUrl(baseUrl: string) {
  const value = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(value)) throw new Error('Buddy API base URL must start with http:// or https://');
  return value;
}

/**
 * One place for every current Buddy endpoint. Add future endpoints as methods
 * here; screens should never hard-code `/v1/...` strings.
 */
export class BuddyApi {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normaliseBaseUrl(baseUrl);
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) throw new BuddyApiError(response.status, payload);
    return payload as T;
  }

  createInvitation(userId: Uuid, invitation: CreateBuddyInvitation) {
    return this.request<BuddyRelationship>(`/v1/users/${userId}/buddies/invitations`, { method: 'POST', body: invitation });
  }

  listBuddies(userId: Uuid) {
    return this.request<BuddyRelationship[]>(`/v1/users/${userId}/buddies`);
  }

  getBuddy(userId: Uuid, relationshipId: Uuid) {
    return this.request<BuddyRelationship>(`/v1/users/${userId}/buddies/${relationshipId}`);
  }

  revokeBuddy(userId: Uuid, relationshipId: Uuid) {
    return this.request<BuddyRelationship>(`/v1/users/${userId}/buddies/${relationshipId}`, { method: 'DELETE' });
  }

  listIncomingInvitations(buddyUserId: Uuid) {
    return this.request<BuddyRelationship[]>(`/v1/users/${buddyUserId}/buddy-invitations`);
  }

  acceptInvitation(relationshipId: Uuid, actorUserId: Uuid) {
    return this.request<BuddyRelationship>(`/v1/buddy-invitations/${relationshipId}/accept`, { method: 'POST', body: { actorUserId } });
  }

  rejectInvitation(relationshipId: Uuid, actorUserId: Uuid) {
    return this.request<BuddyRelationship>(`/v1/buddy-invitations/${relationshipId}/reject`, { method: 'POST', body: { actorUserId } });
  }

  listCandidates(userId: Uuid) {
    return this.request<BuddyCandidatesResponse>(`/v1/users/${userId}/buddy-candidates`);
  }
}

export function createBuddyApi(baseUrl: string) {
  return new BuddyApi(baseUrl);
}
