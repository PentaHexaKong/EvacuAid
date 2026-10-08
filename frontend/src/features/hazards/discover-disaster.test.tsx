import { act, fireEvent, render } from '@testing-library/react-native';
import { DiscoverDisaster } from './discover-disaster';
import { useRecentHazards } from './use-recent-hazards';

jest.mock('./use-recent-hazards', () => ({ useRecentHazards: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-i18next', () => {
  const en = jest.requireActual('../../localization/en.json') as Record<string, string>;
  const t = (key: string, values: Record<string, unknown> = {}) => {
    const plural = typeof values.count === 'number' ? en[`${key}_${values.count === 1 ? 'one' : 'other'}`] : undefined;
    return (plural ?? en[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const hook = useRecentHazards as jest.Mock;
const recent = new Date().toISOString();
const quake = { id: 'bmkg:1', type: 'earthquake', occurredAt: recent, source: 'BMKG', latitude: -8, longitude: 120, magnitude: 4.3, depthKm: 17, region: 'Pusat gempa berada di laut 82 km Timur Laut RUTENG', felt: 'II-III Kab. Manggarai', reportCount: null };
const volcano = { id: 'pb:volcano', type: 'volcano', occurredAt: recent, source: 'PetaBencana', latitude: null, longitude: null, magnitude: null, depthKm: null, region: null, felt: null, reportCount: 3 };

test('chips list only the types present and filter the cards', () => {
  hook.mockReturnValue({ status: 'ready', items: [quake, volcano], retry: jest.fn() });
  const view = render(<DiscoverDisaster />);
  expect(view.getByRole('radio', { name: 'All' })).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  expect(view.queryByRole('radio', { name: 'Flood' })).toBeNull();
  expect(view.getByText('4.3')).toBeTruthy();
  expect(view.getByText('82 km northeast of Ruteng')).toBeTruthy();
  expect(view.getByText('Depth 17 km · At sea')).toBeTruthy();
  expect(view.getByText('Shaking felt in Kab. Manggarai')).toBeTruthy();
  expect(view.getByText('citizen reports this week')).toBeTruthy();
  expect(view.getByText('Volcano reports')).toBeTruthy();
  expect(view.getByText('PetaBencana · unverified')).toBeTruthy();
  fireEvent.press(view.getByRole('radio', { name: 'Volcano' }));
  expect(view.queryByText('4.3')).toBeNull();
  expect(view.getByText('3')).toBeTruthy();
});

test('a selected chip whose type disappears falls back to All', () => {
  hook.mockReturnValue({ status: 'ready', items: [quake, volcano], retry: jest.fn() });
  const view = render(<DiscoverDisaster />);
  fireEvent.press(view.getByRole('radio', { name: 'Volcano' }));
  hook.mockReturnValue({ status: 'ready', items: [quake], retry: jest.fn() });
  view.rerender(<DiscoverDisaster />);
  expect(view.getByText('4.3')).toBeTruthy();
});

test('the felt place survives a spaced intensity range and unparsed regions fall back to clamped raw text', () => {
  const odd = { ...quake, id: 'bmkg:2', region: 'Wilayah yang tidak dikenali dengan nama yang sangat panjang sekali', felt: 'II - III Kab. Gorontalo Utara' };
  hook.mockReturnValue({ status: 'ready', items: [odd], retry: jest.fn() });
  const view = render(<DiscoverDisaster />);
  expect(view.getByText('Shaking felt in Kab. Gorontalo Utara')).toBeTruthy();
  expect(view.getByText('Earthquake M4.3')).toBeTruthy(); // title fallback when the place cannot be parsed
  expect(view.getByText(odd.region)).toHaveProp('numberOfLines', 2);
});

test('error state retries and empty state explains', async () => {
  const retry = jest.fn();
  hook.mockReturnValue({ status: 'error', items: [], retry });
  const view = render(<DiscoverDisaster />);
  expect(view.getByText("Couldn't load disaster info.")).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'Try again' })));
  expect(retry).toHaveBeenCalled();
  hook.mockReturnValue({ status: 'ready', items: [], retry });
  view.rerender(<DiscoverDisaster />);
  expect(view.getByText('No recent disaster reports.')).toBeTruthy();
});

test('cards read naturally to VoiceOver: magnitude, place, where it was felt, time and source spelled out', () => {
  const threeHoursAgo = new Date(Date.now() - 3 * 3600_000 - 60_000).toISOString();
  hook.mockReturnValue({ status: 'ready', items: [{ ...quake, occurredAt: threeHoursAgo }, { ...volcano, occurredAt: threeHoursAgo, reportCount: 1 }], retry: jest.fn() });
  const view = render(<DiscoverDisaster />);
  expect(view.getByLabelText('Earthquake, magnitude 4.3. 82 km northeast of Ruteng. Depth 17 km · At sea. Shaking felt in Kab. Manggarai. 3 hours ago. Source: BMKG')).toBeTruthy();
  expect(view.getByLabelText('Volcano, 1 citizen report this week. Latest report 3 hours ago. Source: PetaBencana. unverified')).toBeTruthy();
});

test('a card is a button that opens that disaster\'s detail page', () => {
  hook.mockReturnValue({ status: 'ready', items: [quake], retry: jest.fn() });
  const view = render(<DiscoverDisaster />);
  fireEvent.press(view.getByRole('button', { name: /^Earthquake, magnitude 4\.3/ }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/hazard/[id]', params: { id: 'bmkg:1' } });
});
