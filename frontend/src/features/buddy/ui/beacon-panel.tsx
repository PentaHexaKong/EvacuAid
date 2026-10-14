import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Linking, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import IconBluetooth from '@tabler/icons-react-native/IconBluetooth';
import IconArrowUp from '@tabler/icons-react-native/IconArrowUp';
import { ActionButton, AppText, Tap } from '@/components/ui';
import { colors, SystemReduceMotionContext } from '@/theme';
import type { BuddyActions } from '../use-buddy-actions';
import type { BeaconPerson } from '../use-beacons';
import { buddyStyles, Group, PersonAvatar, StatusChip } from './parts';

// The scan state as words plus a pulse that runs only while scanning, shared by the helper's Auto search and the requester's SOS.
export function useBeaconStatus(a: BuddyActions) {
  const { c, beacons } = a;
  const reduceMotion = useContext(SystemReduceMotionContext);
  const [opacity] = useState(() => new Animated.Value(1));
  const scanning = beacons.status === 'scanning';
  useEffect(() => {
    if (!scanning || reduceMotion) { opacity.setValue(1); return; }
    const pulse = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: 0.45, duration: 1000, useNativeDriver: true }), Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true })]));
    pulse.start(); return () => { pulse.stop(); opacity.setValue(1); };
  }, [opacity, scanning, reduceMotion]);
  const label = beacons.locationDenied ? c('bluetoothLocationPermission') : c(beacons.status === 'off' ? 'bluetoothOff' : beacons.status === 'unauthorized' ? 'bluetoothDenied' : beacons.status === 'unavailable' ? 'bluetoothUnavailable' : beacons.status === 'error' ? 'bluetoothError' : scanning ? 'bluetoothSearching' : beacons.status === 'starting' ? 'bluetoothStarting' : 'bluetoothPaused');
  return { label, scanning, opacity, needsSettings: beacons.status === 'off' || beacons.status === 'unauthorized' };
}

export function BeaconPanel({ a, people: preview }: { a: BuddyActions; people?: BeaconPerson[] }) {
  const { c } = a;
  const { label, scanning, opacity, needsSettings } = useBeaconStatus(a);
  return <View style={{ gap: 12 }}>
    <View style={[buddyStyles.row, { gap: 10 }]}>
      <Animated.View accessible={false} style={{ opacity }}><IconBluetooth size={22} color={scanning ? colors.primary : colors.muted} /></Animated.View>
      <AppText variant="button" accessibilityLiveRegion="polite" style={buddyStyles.grow}>{label}</AppText>
    </View>
    {needsSettings && <ActionButton compact variant="secondary" label={c('bluetoothSettings')} onPress={() => { void Linking.openSettings(); }} />}
    <AppText variant="small" style={{ color: colors.muted }}>{c('bluetoothForeground')}</AppText>
    <BeaconPeople a={a} people={preview} />
  </View>;
}

export function BeaconPeople({ a, people: preview }: { a: BuddyActions; people?: BeaconPerson[] }) {
  const { c, beacons } = a;
  const router = useRouter();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const people = __DEV__ && preview ? preview : beacons.people;
  if (people.length === 0) return null;
  return <Group>{people.map(person => {
      const name = person.name ?? c(person.role === 1 ? 'bluetoothSomeoneNeedsHelp' : 'bluetoothHelperNearby');
      const detail = person.distance === null ? c(person.signal === 'near' ? 'bluetoothSignalStrong' : person.signal === 'medium' ? 'bluetoothSignalMedium' : 'bluetoothSignalWeak') : c('bluetoothDistance', { m: String(Math.round(person.distance)), accuracy: String(Math.ceil(person.uncertainty!)) });
      const action = c(person.role === 1 ? 'bluetoothOpenRequest' : 'bluetoothAskHelper');
      return <Tap key={person.beaconId} accessibilityLabel={`${name}. ${action}`} accessibilityHint={action} disabled={a.beaconBusy} accessibilityState={{ disabled: a.beaconBusy, busy: a.beaconBusy }} onPress={() => {
        if (person.role === 1) void a.openBeaconRequest(person.beaconId).then(id => { if (id && mounted.current && focusedRef.current && AppState.currentState === 'active') router.push(`/help-request/${id}`); });
        else a.askBeaconHelper(person.beaconId);
      }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
        <PersonAvatar name={person.name} size={44} />
        <View style={[buddyStyles.grow, { gap: 6 }]}>
          <AppText variant="button">{name}</AppText>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><StatusChip tone={person.role === 1 ? 'caution' : 'info'} label={c(person.role === 1 ? 'needsHelpChip' : 'helper')} />{person.name && <StatusChip label={c('bluetoothBuddy')} />}</View>
          <AppText variant="small" style={{ color: colors.muted }}>{detail}</AppText>
          <AppText variant="small" style={{ color: colors.primary }}>{person.role === 2 && a.requestedBeaconId === person.beaconId ? c('bluetoothAwaitingHelper') : action}</AppText>
        </View>
        {person.direction !== null && <View accessible accessibilityLabel={c('bluetoothDirection', { degrees: String(Math.round(person.direction)) })} style={{ transform: [{ rotate: `${person.direction}deg` }] }}><IconArrowUp size={24} color={colors.primary} /></View>}
      </Tap>;
  })}</Group>;
}

export function BeaconWaiting({ a }: { a: BuddyActions }) {
  const { c, beacons, localSos, sosSending, cancelNearby } = a;
  const helpers = beacons.people.filter(person => person.role === 2).length;
  return <View style={{ gap: 12 }}>
    <AppText variant="section" accessibilityLiveRegion="polite">{c(beacons.advertising ? 'bluetoothBroadcasting' : 'bluetoothSosUnavailable')}</AppText>
    {localSos && <AppText style={{ color: colors.muted }}>{c(sosSending ? 'bluetoothSending' : 'bluetoothOfflineSos')}</AppText>}
    <AppText variant="small" style={{ color: colors.muted }}>{c('bluetoothHelperCount', { count: String(helpers) })}</AppText>
    <BeaconPanel a={a} />
    {localSos && <ActionButton variant="secondary" label={c('bluetoothCancel')} onPress={() => cancelNearby()} />}
  </View>;
}
