import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import { SystemReduceMotionContext } from '@/theme';
import { useBuddyCopy } from '../copy';
import type { BuddyActions } from '../use-buddy-actions';
import type { BeaconPerson } from '../use-beacons';
import { BeaconPanel, BeaconWaiting } from './beacon-panel';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
const mockPush = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useRouter: () => ({ push: mockPush }) }));
const cancelNearby = jest.fn();
const openBeaconRequest = jest.fn();
const askBeaconHelper = jest.fn();
beforeEach(() => { jest.clearAllMocks(); mockFocused = true; Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true }); openBeaconRequest.mockResolvedValue('nearby-request'); });
const person = { role: 1, beaconId: 20, latitude: -6.2, longitude: 106.8, accuracy: 5, lastHeard: 0, rssi: -55, name: 'Synthetic Buddy', distance: 34, uncertainty: 10, direction: 45, signal: 'near' } as BeaconPerson;
function Harness({ status = 'scanning', people = [], waiting = false }: { status?: string; people?: BeaconPerson[]; waiting?: boolean }) {
  const { c } = useBuddyCopy();
  const a = { c, beacons: { status, advertising: status === 'scanning', people: [], offline: true }, localSos: true, sosSending: false, cancelNearby, openBeaconRequest, askBeaconHelper, beaconBusy: false, requestedBeaconId: null } as unknown as BuddyActions;
  return <SystemReduceMotionContext.Provider value={true}>{waiting ? <BeaconWaiting a={a} /> : <BeaconPanel a={a} people={people} />}</SystemReduceMotionContext.Provider>;
}

test('missing Bluetooth shows an honest unavailable state', () => {
  const view = render(<Harness status="unavailable" />);
  expect(view.getByText('Bluetooth unavailable')).toBeTruthy();
  expect(view.getByText('Active only while this screen is open. Range depends on devices and surroundings.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Open Settings' })).toBeNull();
});

test('Bluetooth off provides settings recovery', () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  const view = render(<Harness status="off" />); fireEvent.press(view.getByRole('button', { name: 'Open Settings' }));
  expect(settings).toHaveBeenCalled(); settings.mockRestore();
});

test('populated preview lists Buddy names, roles, uncertainty and direction', () => {
  const view = render(<Harness people={[person, { ...person, beaconId: 21, name: null, distance: null, uncertainty: null, direction: null }]} />);
  expect(view.getByText('Synthetic Buddy')).toBeTruthy(); expect(view.getByText('Your Buddy')).toBeTruthy(); expect(view.getByText('Someone needs help')).toBeTruthy();
  expect(view.getByText('About 34 m · uncertainty ±10 m')).toBeTruthy(); expect(view.getByText('Strong signal · distance unknown')).toBeTruthy();
  expect(view.getByLabelText('Direction 45 degrees from the front of your phone')).toBeTruthy();
});

test('offline SOS shows detection as unconfirmed assistance and remains cancellable', () => {
  const view = render(<Harness waiting />);
  expect(view.getByText('Broadcasting nearby by Bluetooth')).toBeTruthy(); expect(view.getByText('Helpers detected: 0. This does not confirm assistance.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Cancel help search' })); expect(cancelNearby).toHaveBeenCalled();
});

test('tapping a requester card opens the actionable help request', async () => {
  const view = render(<Harness people={[{ ...person, name: null }]} />);
  fireEvent.press(view.getByRole('button', { name: 'Someone needs help. Open request and help' }));
  expect(openBeaconRequest).toHaveBeenCalledWith(20);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/help-request/nearby-request'));
  expect(askBeaconHelper).not.toHaveBeenCalled();
});

test('tapping a helper card asks that detected helper for help', () => {
  const view = render(<Harness people={[{ ...person, role: 2, name: null }]} />);
  fireEvent.press(view.getByRole('button', { name: 'Helper nearby. Ask this helper for help' }));
  expect(askBeaconHelper).toHaveBeenCalledWith(20);
  expect(openBeaconRequest).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('an unavailable request does not open a help screen', async () => {
  openBeaconRequest.mockResolvedValue(null);
  const view = render(<Harness people={[person]} />);
  fireEvent.press(view.getByRole('button', { name: 'Synthetic Buddy. Open request and help' }));
  await waitFor(() => expect(openBeaconRequest).toHaveBeenCalled());
  expect(mockPush).not.toHaveBeenCalled();
});

test('a late response cannot open the same request after the screen loses focus', async () => {
  let finish!: (id: string) => void;
  openBeaconRequest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<Harness people={[person]} />);
  fireEvent.press(view.getByRole('button', { name: 'Synthetic Buddy. Open request and help' }));
  mockFocused = false;
  view.rerender(<Harness people={[person]} />);
  await act(async () => { finish('nearby-request'); });
  expect(mockPush).not.toHaveBeenCalled();
});
