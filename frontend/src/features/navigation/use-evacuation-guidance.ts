import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { usePreferences } from '@/features/preferences/context';
import { useAccess } from '@/features/access/use-access';
import type { BuddyRoute, Position } from '@/features/buddy/api';
import { useBuddyCopy } from '@/features/buddy/copy';
import { distanceM } from '@/features/buddy/navigation';
import { CUE_M, useRouteGuidance } from '@/features/buddy/use-route-guidance';
import { speak, stopSpeaking } from '@/features/feedback/speech';
import { toCoordinates, type NavigationResponse } from './api';

const STILL_MS = 10_000;

export function useEvacuationGuidance(response: NavigationResponse | null, reroute: (position: Position) => void, focused = true) {
  const access = useAccess();
  const { preferences } = usePreferences();
  const { c } = useBuddyCopy();
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith('id') ? 'id' : 'en';
  const [position, setPosition] = useState<Position | null>(null);
  const [caption, setCaption] = useState<{ route: BuddyRoute | null; text: string } | null>(null);
  const route = useMemo<BuddyRoute | null>(() => response?.routeStatus === 'READY' && response.route ? { ...response, leg: 'TO_SHELTER', route: { ...response.route, geometry: { type: 'LineString', coordinates: toCoordinates(response.route.geometry) }, maneuvers: response.route.maneuvers ?? [] } } : null, [response]);
  const active = focused && Boolean(route);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let watch: Location.LocationSubscription | undefined;
    let last = 0;
    const accept = (fix: Location.LocationObject) => {
      if (!mounted) return;
      last = Date.now();
      setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracyM: fix.coords.accuracy ?? Infinity, observedAt: new Date(Math.min(fix.timestamp, Date.now())).toISOString() });
    };
    // The watch only reports movement. Someone standing still would look lost after 30 s, so ask for a fresh fix while it is quiet.
    const still = setInterval(() => { if (Date.now() - last >= STILL_MS) void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(accept).catch(() => {}); }, STILL_MS);
    void Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, accept).then(subscription => { if (mounted) watch = subscription; else subscription.remove(); }).catch(() => {});
    return () => { mounted = false; clearInterval(still); watch?.remove(); stopSpeaking(); };
  }, [active]);
  // Within sight of the destination a new route adds nothing, and the router cannot plan a few metres.
  const destination = response?.destination;
  const endpoint = destination && destination.entranceLatitude != null && destination.entranceLongitude != null ? { latitude: destination.entranceLatitude, longitude: destination.entranceLongitude } : destination;
  const close = Boolean(position && endpoint && distanceM(position, endpoint) <= 30);
  const guidance = useRouteGuidance({ route: active ? route : null, position: active ? position : null, target: null, language, reroute: () => { if (active && position && !close) reroute(position); }, speak: text => speak(text, language).catch(() => {}), voiceEnabled: active && access.listen && !access.soundFree, haptics: active && preferences.vibrationEnabled, cue: text => c('inMeters', { m: String(CUE_M), text: text.charAt(0).toLocaleLowerCase() + text.slice(1) }), onInstruction: () => {}, entranceNote: response?.destination?.entranceNote, destinationName: response?.destination?.name, caption: text => setCaption({ route, text }) });
  return { ...guidance, caption: caption?.route === route ? caption.text : null, position };
}
