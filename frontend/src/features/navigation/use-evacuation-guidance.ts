import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { useAccess } from '@/features/access/use-access';
import type { BuddyRoute, Position } from '@/features/buddy-pilot/api';
import { useBuddyCopy } from '@/features/buddy-pilot/copy';
import { CUE_M, useRouteGuidance } from '@/features/buddy-pilot/use-route-guidance';
import { speak, stopSpeaking } from '@/features/feedback/speech';
import { toCoordinates, type NavigationResponse } from './api';

export function useEvacuationGuidance(response: NavigationResponse | null, reroute: () => void) {
  const access = useAccess();
  const { c } = useBuddyCopy();
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith('id') ? 'id' : 'en';
  const [position, setPosition] = useState<Position | null>(null);
  const [caption, setCaption] = useState<{ route: BuddyRoute | null; text: string } | null>(null);
  const route = useMemo<BuddyRoute | null>(() => response?.routeStatus === 'READY' && response.route ? { ...response, leg: 'TO_SHELTER', route: { ...response.route, geometry: { type: 'LineString', coordinates: toCoordinates(response.route.geometry) }, maneuvers: response.route.maneuvers ?? [] } } : null, [response]);
  const active = Boolean(route);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let watch: Location.LocationSubscription | undefined;
    void Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, fix => {
      if (mounted) setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracyM: fix.coords.accuracy ?? Infinity, observedAt: new Date(Math.min(fix.timestamp, Date.now())).toISOString() });
    }).then(subscription => { if (mounted) watch = subscription; else subscription.remove(); }).catch(() => {});
    return () => { mounted = false; watch?.remove(); stopSpeaking(); };
  }, [active]);
  const guidance = useRouteGuidance({ route, position, target: null, language, reroute, speak: text => speak(text, language).catch(() => {}), voiceEnabled: access.listen && !access.soundFree, haptics: true, cue: text => c('inMeters', { m: String(CUE_M), text: text.charAt(0).toLocaleLowerCase() + text.slice(1) }), onInstruction: () => {}, entranceNote: response?.destination?.entranceNote, destinationName: response?.destination?.name, caption: text => setCaption({ route, text }) });
  return { ...guidance, caption: caption?.route === route ? caption.text : null, position };
}
