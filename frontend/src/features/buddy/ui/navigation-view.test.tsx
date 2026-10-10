import { fireEvent, render } from '@testing-library/react-native';
import type { Maneuver } from '../api';
import type { RouteGuidance } from '../use-route-guidance';
import { ManeuverBanner, TripBar } from './navigation-view';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'id' } }) }));

const step = (type: number, distanceM: number, streetNames?: string[]): Maneuver => ({ instruction: 'Engine sentence.', beginShapeIndex: 1, endShapeIndex: 2, distanceM, durationSec: 60, type, streetNames });
const progress = { segmentIndex: 0, offRouteM: 0, remainingM: 1040, nextManeuverM: 152, maneuverIndex: 0, nearDestination: false };
const guidance = (over: Partial<RouteGuidance> = {}): RouteGuidance => ({ arrived: false, ready: true, progress, maneuver: step(1, 152), next: step(10, 60, ['Jalan Melati']), after: step(15, 200), instruction: 'Mulai berjalan', upcoming: 'Belok kanan ke Jalan Melati', remainingM: 1040, minutes: 13, nextManeuverM: 152, walked: 0.1, ...over });

test('the banner shows the distance to the next turn, the turn and its street, then the turn after a short block', () => {
  const view = render(<ManeuverBanner guidance={guidance()} busy={false} name="Baim" top={60} />);
  expect(view.getByText('150 m')).toBeTruthy();
  expect(view.getByText('Belok kanan')).toBeTruthy();
  expect(view.getByText('Jalan Melati')).toBeTruthy();
  expect(view.getByText('Lalu')).toBeTruthy();
  expect(view.getByText('belok kiri')).toBeTruthy();
  expect(view.getByLabelText('150 m, Belok kanan, Jalan Melati')).toBeTruthy();
});

test('a long block hides the following turn, and an unknown maneuver keeps the engine sentence', () => {
  const view = render(<ManeuverBanner guidance={guidance({ next: step(99, 300) })} busy={false} name="Baim" top={60} />);
  expect(view.getByText('Engine sentence.')).toBeTruthy();
  expect(view.queryByText('Lalu')).toBeNull();
});

test('without a usable fix the banner says it is finding the location and shows no turn', () => {
  const view = render(<ManeuverBanner guidance={guidance({ progress: null })} busy={false} name="Baim" top={60} />);
  expect(view.getByText('Mencari lokasi…')).toBeTruthy();
  expect(view.queryByText('Belok kanan')).toBeNull();
});

test('re-routing and arrival replace the turn', () => {
  const view = render(<ManeuverBanner guidance={guidance()} busy name="Baim" top={60} />);
  expect(view.getByText('Menghitung ulang rute…')).toBeTruthy();
  view.rerender(<ManeuverBanner guidance={guidance({ progress: { ...progress, nearDestination: true } })} busy={false} name="Baim" top={60} />);
  expect(view.getByText('Kamu sudah dekat dengan Baim')).toBeTruthy();
  view.rerender(<ManeuverBanner guidance={guidance({ progress: { ...progress, nearDestination: true } })} busy={false} name={null} top={60} />);
  expect(view.getByText('Kamu sudah dekat dengan tempat berkumpul')).toBeTruthy();
});

test('the last stretch counts down the remaining distance to arrival', () => {
  const view = render(<ManeuverBanner guidance={guidance({ next: null, after: null, remainingM: 62 })} busy={false} name="Baim" top={60} />);
  expect(view.getByText('60 m')).toBeTruthy();
  expect(view.getByText('Tujuan di depan')).toBeTruthy();
});

test('the trip bar shows time left, distance in the locale format and an overview button', () => {
  const onOverview = jest.fn();
  const view = render(<TripBar guidance={guidance()} onOverview={onOverview} />);
  expect(view.getByText('13')).toBeTruthy();
  expect(view.getByText(/^1,0 km · tiba /)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Ikhtisar' }));
  expect(onOverview).toHaveBeenCalledTimes(1);
});
