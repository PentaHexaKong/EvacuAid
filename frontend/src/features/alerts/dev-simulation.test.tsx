import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AlertSimulation } from './dev-simulation';
import { clearSimulatedAlerts, simulateAlert } from './api';

jest.mock('./api', () => ({ simulateAlert: jest.fn(), clearSimulatedAlerts: jest.fn() }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'token' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => jest.clearAllMocks());

test('the red earthquake button asks the backend for an Awas earthquake, then reloads', async () => {
  jest.mocked(simulateAlert).mockResolvedValue({} as never);
  const reload = jest.fn().mockResolvedValue(undefined);
  const view = render(<AlertSimulation reload={reload} />);
  fireEvent.press(view.getByRole('button', { name: 'devSimulateEarthquake' }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(simulateAlert).toHaveBeenCalledWith('token', { level: 'awas', hazard: 'EARTHQUAKE' });
});

test('a rejected request shows the backend message and skips the reload', async () => {
  jest.mocked(clearSimulatedAlerts).mockRejectedValue(new Error('Not Found'));
  const reload = jest.fn();
  const view = render(<AlertSimulation reload={reload} />);
  fireEvent.press(view.getByRole('button', { name: 'devSimulationClear' }));
  await view.findByText('Not Found');
  expect(reload).not.toHaveBeenCalled();
});
