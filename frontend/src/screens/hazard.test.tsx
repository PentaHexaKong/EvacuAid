import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { HazardScreen } from './hazard';
import { findHazard } from '@/features/hazards/use-recent-hazards';

const mockNavigate = jest.fn();
let mockId = 'bmkg:1';
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }), useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/features/hazards/use-recent-hazards', () => ({ findHazard: jest.fn() }));
jest.mock('@/components/page-scroll-view', () => {
  const { ScrollView } = jest.requireActual('react-native');
  return { ...jest.requireActual('@/components/page-scroll-view'), PageScrollView: ScrollView };
});
jest.mock('react-i18next', () => {
  const en = jest.requireActual('../localization/en.json') as Record<string, string>;
  const t = (key: string, values: Record<string, unknown> = {}) => {
    const plural = typeof values.count === 'number' ? en[`${key}_${values.count === 1 ? 'one' : 'other'}`] : undefined;
    return (plural ?? en[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const find = findHazard as jest.Mock;
const recent = new Date().toISOString();
const quake = { id: 'bmkg:1', type: 'earthquake', occurredAt: recent, source: 'BMKG', latitude: -8, longitude: 120.5, magnitude: 4.3, depthKm: 17, region: 'Pusat gempa berada di laut 82 km Timur Laut RUTENG-MANGGARAI-NTT', felt: 'II-III Kab. Manggarai, II Ruteng', reportCount: null };
const flood = { id: 'pb:flood', type: 'flood', occurredAt: recent, source: 'PetaBencana', latitude: null, longitude: null, magnitude: null, depthKm: null, region: null, felt: null, reportCount: 12 };

beforeEach(() => { mockNavigate.mockReset(); mockId = 'bmkg:1'; });

test('an earthquake shows its facts, what to do, and opens the map on the epicentre', () => {
  find.mockReturnValue(quake);
  const view = render(<HazardScreen />);
  expect(view.getByRole('header', { name: '82 km northeast of Ruteng' })).toBeTruthy();
  expect(view.getByLabelText('Magnitude: 4.3')).toBeTruthy();
  expect(view.getByLabelText('Depth: 17 km')).toBeTruthy();
  expect(view.getByLabelText('Epicentre: 82 km northeast of Ruteng, Manggarai, NTT')).toBeTruthy();
  expect(view.getByLabelText('Location: At sea')).toBeTruthy();
  expect(view.getByLabelText('Coordinates: 8.00° S, 120.50° E')).toBeTruthy();
  expect(view.getByLabelText('Shaking felt in: Kab. Manggarai · intensity II-III (MMI)')).toBeTruthy();
  expect(view.getByText('During shaking, drop, take cover under a sturdy table, and hold on.')).toBeTruthy();
  expect(view.getByText('Source: BMKG felt-earthquake reports.')).toBeTruthy();
  expect(view.getByText('The photo is illustrative, not of this event. Photo: U.S. Geological Survey, public domain.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Show on the map' }));
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/discover', params: { focus: '-8,120.5' } });
});

test('citizen reports show the count, the unverified caveat, and open the map without a focus', () => {
  find.mockReturnValue(flood);
  const view = render(<HazardScreen />);
  expect(view.getByRole('header', { name: 'Flood reports' })).toBeTruthy();
  expect(view.getByLabelText('Citizen reports this week: 12')).toBeTruthy();
  expect(view.queryByLabelText(/^Magnitude/)).toBeNull();
  expect(view.getByText('Move to higher ground and keep away from rivers and drains.')).toBeTruthy();
  expect(view.getByText('Source: PetaBencana citizen reports. They are not verified, and a count is not a measure of severity.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Open the map' }));
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/discover', params: {} });
});

test('an id that is not in the loaded feed shows the empty state', () => {
  find.mockReturnValue(undefined);
  const view = render(<HazardScreen />);
  expect(view.getByText('This information is unavailable. Go back to choose another item.')).toBeTruthy();
  expect(view.queryByText('What to do')).toBeNull();
});

let mockAccess = { listen: false, autoRead: false, stepFree: false };
jest.mock('@/features/access/use-access', () => ({ useAccess: () => mockAccess }));
jest.mock('expo-speech', () => ({ stop: jest.fn(() => Promise.resolve()), speak: jest.fn() }));
beforeEach(() => { mockAccess = { listen: false, autoRead: false, stepFree: false }; jest.clearAllMocks(); jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); });

test.each([false, true])('detail offers Listen only with the capability (%s)', listen => {
  find.mockReturnValue(quake);
  mockAccess = { listen, autoRead: false, stepFree: false };
  const view = render(<HazardScreen />);
  expect(Boolean(view.queryByRole('button', { name: 'Listen' }))).toBe(listen);
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('detail auto reads the title and numbered first step on open', async () => {
  find.mockReturnValue(quake);
  mockAccess = { listen: true, autoRead: true, stepFree: false };
  const view = render(<HazardScreen />);
  await waitFor(() => expect(Speech.speak).toHaveBeenCalledTimes(1));
  const text = jest.mocked(Speech.speak).mock.calls[0][0];
  expect(text).toContain('82 km northeast of Ruteng');
  expect(text).toContain(`1. ${'During shaking, drop, take cover under a sturdy table, and hold on.'}`);
  expect(view.getByRole('button', { name: 'Stop' })).toBeTruthy();
});


test.each(['earthquake', 'haze'])('stepFree adapts only known mobility steps for %s', type => {
  mockAccess.stepFree = true;
  find.mockReturnValue({ ...quake, type });
  const view = render(<HazardScreen />);
  const en = jest.requireActual('../localization/en.json') as Record<string, string>;
  for (const step of [1, 2, 3, 4]) {
    const key = `hazardStep_${type}_${step}`;
    const mobility = type === 'earthquake' && (step === 1 || step === 3);
    expect(view.getByText(en[mobility ? `${key}_mobility` : key])).toBeTruthy();
    if (mobility) expect(view.queryByText(en[key])).toBeNull();
  }
});
