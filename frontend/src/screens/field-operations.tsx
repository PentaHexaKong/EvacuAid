import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Switch, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText, Field, Page, Panel } from '@/components/ui';
import { DiscoverMap } from '@/components/discover-map';
import { apiRequest } from '@/features/profile/api';
import { useGuestSession } from '@/features/profile/session';
import { ensureForeground } from '@/features/location/permissions';
import { enqueueSubmission, flushSubmissions, pendingSubmissions, discardSubmission, type PendingSubmission } from '@/features/operations/outbox';
import { discoverRegions } from '@/features/offline/package-manager';
import { toCoordinates, type Coordinate } from '@/features/navigation/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KINDS = ['BLOCKED_ROAD','INACCESSIBLE_ROUTE','FLOODING','DAMAGED_INFRASTRUCTURE','SHELTER_CROWDING','OTHER'];
const STATUSES = ['NEEDS_ASSISTANCE','EVACUATING','ARRIVED','SAFE_REPORTED','UNKNOWN'];
type Report = { id: string; kind: string; status: string; observedAt: string; review: { note?: string } };
type Route = { id: string; name: string; shelterId: string; originLatitude: number; originLongitude: number; usable: boolean; expiresAt: string; result: { route?: { geometry: unknown }; shelterName?: string } };
type Case = { requestId: string; status: string; government: { status: string; note: string } | null; assignedRoute: Route | null };

export function FieldOperationsScreen() {
  const { t } = useTranslation();
  const { user: profileUser, account, token } = useGuestSession();
  const user = profileUser ?? account;
  const router = useRouter();
  const [kind, setKind] = useState(KINDS[0]);
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState(''); const [lon, setLon] = useState('');
  const [consent, setConsent] = useState(false);
  const [regions, setRegions] = useState<{ regionId: string; regionName: string }[]>([]);
  const [regionId, setRegionId] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    if (!user || !token) return;
    setPending(await pendingSubmissions(user.id));
    const cachedRegions = await AsyncStorage.getItem('operations.regions');
    const cachedRoutes = await AsyncStorage.getItem('operations.routes');
    if (cachedRegions) setRegions(JSON.parse(cachedRegions));
    if (cachedRoutes) setRoutes(JSON.parse(cachedRoutes));
    try {
      const [available, mine, published, assistance] = await Promise.all([discoverRegions(), apiRequest<Report[]>('/v1/field-reports/mine', token), apiRequest<Route[]>('/v1/operations/routes?limit=200', token), apiRequest<Case[]>('/v1/operations/my-assistance', token)]);
      setRegions(available); setReports(mine); setRoutes(published.filter(item => item.usable)); setCases(assistance);
      await AsyncStorage.multiSet([['operations.regions', JSON.stringify(available)], ['operations.routes', JSON.stringify(published.filter(item => item.usable))]]);
      setError('');
    } catch { setError(t('opsNetwork')); }
  }, [user, token, t]);
  useEffect(() => {
    const load = () => { setNow(Date.now()); void refresh().catch(() => setError(t('opsFailed'))); };
    const initial = setTimeout(load, 0);
    const timer = setInterval(load, 15000);
    const network = NetInfo.addEventListener(state => { if (state.isConnected) load(); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') load(); });
    return () => { clearTimeout(initial); clearInterval(timer); network(); app.remove(); };
  }, [refresh, t]);
  const run = async (task: () => Promise<void>) => { setBusy(true); setError(''); try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('opsFailed')); } finally { setBusy(false); } };
  const queue = async (endpoint: PendingSubmission['endpoint'], payload: Record<string, unknown>) => {
    if (!user || !token) throw new Error(t('sessionUnavailable'));
    await enqueueSubmission({ id: Crypto.randomUUID(), userId: user.id, endpoint, payload });
    setPending(await pendingSubmissions(user.id));
    await flushSubmissions(user.id, token); await refresh();
  };
  const report = () => run(async () => {
    const latitude=Number(lat), longitude=Number(lon);
    if (!lat.trim() || !lon.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180 || description.trim().length<5 || !consent) throw new Error(t('opsValidate'));
    await queue('/v1/field-reports', { kind, description: description.trim(), latitude, longitude, observedAt: new Date().toISOString(), hazardType: kind === 'FLOODING' ? 'FLOOD' : 'EARTHQUAKE', publicLocationConsent: true });
    setDescription(''); setConsent(false);
  });
  const locate = () => run(async () => {
    if (await ensureForeground() !== 'granted') throw new Error(t('opsLocationDenied'));
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLat(String(fix.coords.latitude)); setLon(String(fix.coords.longitude));
  });
  let coordinates: Coordinate[] | undefined;
  try { if (selectedRoute?.result.route) coordinates=toCoordinates(selectedRoute.result.route.geometry); } catch {}
  return <Page keyboard>
    <AppText variant="title" accessibilityRole="header">{t('opsTitle')}</AppText>
    <AppText>{t('opsPrivacy')}</AppText>
    <ActionButton label={t('opsRefresh')} disabled={busy} onPress={() => void run(refresh)} />
    {!!error && <AppText accessibilityRole="alert">{error}</AppText>}
    <Panel><AppText variant="section">{t('opsReport')}</AppText>
      {KINDS.map(value => <ActionButton key={value} variant={kind===value ? 'primary' : 'secondary'} label={t(`ops_${value}`)} onPress={() => setKind(value)} />)}
      <Field accessibilityLabel={t('opsDescription')} placeholder={t('opsDescription')} multiline maxLength={1000} value={description} onChangeText={setDescription} />
      <Field accessibilityLabel={t('opsLatitude')} placeholder={t('opsLatitude')} value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" />
      <Field accessibilityLabel={t('opsLongitude')} placeholder={t('opsLongitude')} value={lon} onChangeText={setLon} keyboardType="numbers-and-punctuation" />
      <ActionButton variant="secondary" label={t('opsUseGps')} disabled={busy} onPress={locate} />
      <AppText>{t('opsLocationConsent')}</AppText><Switch accessibilityLabel={t('opsLocationConsent')} value={consent} onValueChange={setConsent} />
      <ActionButton label={t('opsSubmit')} disabled={busy || !consent} onPress={report} />
    </Panel>
    <Panel><AppText variant="section">{t('opsCheckIn')}</AppText><AppText>{t('opsCheckInNotice')}</AppText>
      <Field accessibilityLabel={t('opsSearchRegion')} placeholder={t('opsSearchRegion')} value={regionSearch} onChangeText={setRegionSearch} />
      {regions.filter(region=>region.regionName.toLowerCase().includes(regionSearch.toLowerCase()) || region.regionId===regionId).slice(0,20).map(region => <ActionButton key={region.regionId} variant={regionId===region.regionId ? 'primary':'secondary'} label={region.regionName} onPress={() => setRegionId(region.regionId)} />)}
      {STATUSES.map(status => <ActionButton key={status} disabled={busy || !regionId} label={t(`ops_${status}`)} onPress={() => Alert.alert(t('opsCheckIn'), t('opsCheckInConsent'), [{ text:t('cancel'), style:'cancel' }, { text:t('opsSubmit'), onPress:()=>void run(()=>queue('/v1/evacuation-check-ins', { regionId, status, observedAt:new Date().toISOString(), shareAggregateConsent:true })) }])} />)}
    </Panel>
    <Panel><AppText variant="section">{t('opsPending', { count:pending.length })}</AppText>
      <ActionButton label={t('opsRetry')} disabled={busy} onPress={() => void run(async () => { if (user && token) { await flushSubmissions(user.id,token); await refresh(); } })} />
      {pending.map(item => <View key={item.id}><AppText>{t('opsQueued')} · {String(item.payload.kind ?? item.payload.status)} · {String(item.payload.observedAt)} {item.error}</AppText><ActionButton variant="secondary" label={t('opsDiscard')} onPress={() => void run(async () => { if(user) { await discardSubmission(user.id,item.id); await refresh(); } })} /></View>)}
    </Panel>
    <Panel><AppText variant="section">{t('opsMyReports')}</AppText>{reports.map(item => <AppText key={item.id}>{t(`ops_${item.kind}`)} · {t(`ops_${item.status}`)} · {item.observedAt} {item.review.note}</AppText>)}</Panel>
    <Panel>
      <AppText variant="section">{t('opsMyAssistance')}</AppText>
      {cases.map(item => <View key={item.requestId}>
        <AppText>{item.requestId.slice(0,8)} · {item.status} · {item.government ? t(`ops_${item.government.status}`) : t('opsAwaitingReview')} {item.government?.note}</AppText>
        {item.assignedRoute?.usable && Date.parse(item.assignedRoute.expiresAt)>now && <ActionButton label={t('opsNavigate')} onPress={()=>router.push({pathname:'/evacuate',params:{shelterId:item.assignedRoute!.shelterId}})} />}
      </View>)}
    </Panel>
    <Panel><AppText variant="section">{t('opsRoutes')}</AppText><AppText>{t('opsRouteNotice')}</AppText>
      {routes.filter(item => Date.parse(item.expiresAt)>now).map(item => <View key={item.id}><AppText>{item.name} → {item.result.shelterName} · {item.expiresAt}</AppText><ActionButton label={t('opsViewRoute')} onPress={() => setSelectedRoute(item)} /><ActionButton variant="secondary" label={t('opsNavigate')} onPress={() => router.push({ pathname:'/evacuate', params:{ shelterId:item.shelterId } })} /></View>)}
      {selectedRoute && coordinates && <View style={{height:320}}><DiscoverMap items={[]} selected={null} onSelect={()=>{}} route={coordinates} onLocate={()=>{}} topInset={0} bottomInset={0} /></View>}
    </Panel>
  </Page>;
}
