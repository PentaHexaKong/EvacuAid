export type DataMode = 'REFERENCE' | 'SIMULATION'
export type AdministrativeLevel = 'PROVINCE' | 'CITY_REGENCY' | 'DISTRICT' | 'VILLAGE'
export type SignalLevel = 'NORMAL' | 'WATCH' | 'ELEVATED' | 'CRITICAL' | 'UNKNOWN'
export type HazardType = 'FLOOD' | 'EARTHQUAKE' | 'TSUNAMI' | 'WILDFIRE' | 'LANDSLIDE' | 'EXTREME_WEATHER'
export type Geometry = { type: string; coordinates?: number[] | number[][] | number[][][] | number[][][][]; geometries?: Geometry[] }
interface SimulationOverlay { signalLevel: SignalLevel; hazardTypes: string[]; names: string[] }
export interface Region {
  id: string
  code: string
  name: string
  administrativeLevel: AdministrativeLevel
  parentRegionId: string | null
  geometry: Geometry
  centroid: Geometry
  population: number | null
  populationReferenceYear: number | null
  populationSource: string | null
  boundarySource: string
  dataMode: DataMode
  signalLevel: SignalLevel
  simulation: SimulationOverlay | null
  hazardTypes: string[]
  authoritativeCriticalHazard: boolean
  estimatedExposedPopulation: number | null
  exposureFraction: number | null
  exposureEstimationMethod: 'AREA_WEIGHTED_ESTIMATE' | 'EXACT_GRID_OVERLAY' | 'UNKNOWN'
  activeAssistanceCount: number | null
  recordedShelterCount: number | null
  evidenceFreshness: string
  updatedAt: string | null
  snapshotExpiresAt: string | null
  snapshotStale: boolean
}
interface AssistanceAggregate {
  assistanceRequestedCount: number | null
  activeAssistanceCount: number | null
  evacuatingCount: number | null
  safeCheckInCount: number | null
  unknownSafetyCount: number | null
  mobilityNeedCount: number | null
  visualNeedCount: number | null
  hearingNeedCount: number | null
  elderlyNeedCount: number | null
  otherNeedCount: number | null
  categoriesOverlap: boolean
  scope: string
}
interface ShelterSummary {
  id: string
  name: string
  geometry: Geometry
  status: string
  capacity: number | null
  wheelchairAccessible: boolean | null
  source: string
  verifiedAt: string | null
  dataMode: string
}
export interface HazardSummary {
  hazardType: string
  source: string
  sourceId: string | null
  authority: string
  evidenceType: string
  provenanceClass: string
  geometry: Geometry | null
  severity: number | null
  confidence: number | null
  observedAt: string | null
  validFrom: string | null
  expiresAt: string | null
  freshness: string
  active: boolean
}
export interface RegionDetail extends Region {
  hierarchy: { id: string; name: string; administrativeLevel: AdministrativeLevel }[]
  registeredUserCount: number | null
  assistance: AssistanceAggregate
  totalShelterCapacity: number | null
  availableResponderCount: number | null
  assignedResponderCount: number | null
  feasibleRouteCount: number | null
  blockedRouteCount: number | null
  noFeasibleRouteCount: number | null
  hazards: HazardSummary[]
  shelters: ShelterSummary[]
  routes: Record<string, unknown>[]
  metricProvenance: Record<string, string>
  limitations: string[]
}
export type ShelterStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN'
export interface SafeHouse {
  id: string
  name: string
  latitude: number
  longitude: number
  entranceLatitude: number | null
  entranceLongitude: number | null
  entranceNote: string | null
  status: ShelterStatus
  wheelchairAccessible: boolean | null
  capacity: number | null
  source: string
}
export interface SafeHouseCreate {
  id: string
  name: string
  latitude: number
  longitude: number
  entranceLatitude?: number | null
  entranceLongitude?: number | null
  entranceNote?: string | null
  address?: string | null
  status?: ShelterStatus
  capacity?: number | null
  wheelchairAccessible?: boolean | null
  verifiedNow?: boolean
}
export interface MockDisasterCreate {
  id: string
  name: string
  hazardType: HazardType
  latitude: number
  longitude: number
  radiusM: number
  severity: 'WATCH' | 'ELEVATED' | 'CRITICAL'
}
export interface MockDisaster extends MockDisasterCreate { expiresAt: string; usersInArea: number | null }
export type ReportReviewStatus = 'CONFIRMED' | 'REJECTED' | 'RESOLVED'
export interface Review {
  status: ReportReviewStatus
  note: string
  expectedUpdatedAt: string
  barrier: boolean
  radiusM: number
  validUntil: string | null
}
export interface FieldReport {
  id: string
  kind: 'BLOCKED_ROAD' | 'INACCESSIBLE_ROUTE' | 'FLOODING' | 'DAMAGED_INFRASTRUCTURE' | 'SHELTER_CROWDING' | 'OTHER'
  latitude: number
  longitude: number
  description: string
  hazardType: HazardType
  observedAt: string
  publicLocationConsent: true
  status: 'UNVERIFIED' | ReportReviewStatus
  review: Partial<Omit<Review, 'expectedUpdatedAt'>>
  createdAt: string
  updatedAt: string
}
export interface CaseUpdate {
  status: 'ACKNOWLEDGED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED'
  note: string
  expectedUpdatedAt: string | null
  assignedRouteId: string | null
}
export interface AssistanceCase {
  requestId: string
  status: string
  supportNeeds: string[]
  requestedAt: string
  observedAt: string
  stale: boolean
  government: Omit<CaseUpdate, 'expectedUpdatedAt'> | null
  caseUpdatedAt: string | null
}
export type CaseUpdateResponse = Omit<CaseUpdate, 'expectedUpdatedAt'> & { requestId: string; updatedAt: string }
type CheckInStatus = 'NEEDS_ASSISTANCE' | 'EVACUATING' | 'ARRIVED' | 'SAFE_REPORTED' | 'UNKNOWN'
export interface CheckIns { scope: string; regions: { regionId: string; status: CheckInStatus; count: number; lastObservedAt: string }[] }
export interface RouteSet {
  id: string
  name: string
  regionId: string
  shelterId: string
  originLatitude: number
  originLongitude: number
  mobilityRequired: boolean
}
interface HazardMetrics {
  state: string
  exposure: number | null
  intersectionRatio: number
  proximity: number | null
  communityContribution: number
  severityExposure: number | null
  firstExitDistanceM: number | null
  firstExitTimeSec: number | null
  reentered: boolean | null
  elevationGainM: number | null
  elevationPenalty: number | null
  unknownElevationPenalty: number
  slopeMeanDegrees: number | null
  sources: string[]
  reasonCodes: string[]
}
interface RouteCandidateEvaluation {
  routeId: string
  distanceM: number
  durationSec: number
  feasible: boolean
  hazardExposure: number
  hazardProximity: number
  accessibilityPenalty: number
  uncertainty: number
  normalized: { hazardExposure: number; hazardProximity: number; accessibility: number; uncertainty: number; travelTime: number } | null
  weightedScore: number | null
  riskClass: string
  flags: string[]
  reasons: string[]
  reasonCodes: string[]
  hazards: Record<string, HazardMetrics>
}
interface RouteResult {
  routeStatus: 'NOT_REQUIRED' | 'PENDING' | 'READY' | 'UNAVAILABLE'
  route: { distanceM: number; durationSec: number; geometry: Geometry; routeScore: number; profile: string; maneuvers: Record<string, unknown>[] } | null
  selectionReasonCodes: string[]
  safetyVerified: false
  evaluatedCandidates?: RouteCandidateEvaluation[]
  evaluation?: {
    safetyStatus: 'NO_KNOWN_HAZARD' | 'POTENTIALLY_EXPOSED' | 'EXPOSED' | 'UNKNOWN'
    accessibilityStatus: 'COMPATIBLE' | 'POTENTIALLY_INCOMPATIBLE' | 'UNKNOWN'
    reasonCodes: string[]
    closestHazardDistanceM: number | null
    hazards: Record<string, HazardMetrics>
  } | null
  destinationVerificationStatus?: string
  shelterName?: string
  shelterAccessibility?: boolean | null
  evaluatedAt?: string
}
export interface OperationalRoute extends RouteSet {
  status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN'
  result: RouteResult
  updatedAt: string
  expiresAt: string
  stale: boolean
  usable: boolean
}
export interface RegionParams {
  administrativeLevel?: AdministrativeLevel
  parentRegionId?: string
  hazardType?: HazardType
  signalLevel?: SignalLevel
}
export interface PagingParams { limit?: number; offset?: number }
