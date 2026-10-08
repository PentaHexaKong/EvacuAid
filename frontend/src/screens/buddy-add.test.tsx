import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { BuddyAddScreen } from './buddy-add';

const mockRequest = jest.fn();
const mockBack = jest.fn();
let mockParams: { code?: string } = {};
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }), useLocalSearchParams: () => mockParams }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'private' }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/features/buddy-pilot/api', () => ({ ...jest.requireActual('@/features/buddy-pilot/api'), buddyRequest: (...args: unknown[]) => mockRequest(...args) }));

beforeEach(() => {
  jest.clearAllMocks(); mockParams = {};
  mockRequest.mockImplementation((_token: string, path: string) => Promise.resolve(path === '/me/code' ? { code: 'ABCD-1234' } : { id: 'invite' }));
});

test('invitation input formats typed and prefilled codes', async () => {
  mockParams = { code: 'abcd5678' };
  const view = render(<BuddyAddScreen />);
  expect(view.getByLabelText('Invitation code')).toHaveProp('value', 'ABCD-5678');
  fireEvent.changeText(view.getByLabelText('Invitation code'), 'k7q2m9xd');
  expect(view.getByLabelText('Invitation code')).toHaveProp('value', 'K7Q2-M9XD');
  await act(async () => {});
});

test('sending uses the default relationship and OFFER_HELP direction', async () => {
  const view = render(<BuddyAddScreen />);
  expect(view.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  fireEvent.changeText(view.getByLabelText('Invitation code'), 'k7q2m9xd');
  fireEvent.press(view.getByRole('button', { name: 'Send invitation' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('private', '/invitations/direct', 'POST', { code: 'K7Q2-M9XD', relation: 'KELUARGA', direction: 'OFFER_HELP' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test.each([
  [404, 'Code not found. Check it and try again.'],
  [409, 'You are already connected, or an invitation is still waiting.'],
  [422, 'The code is 8 letters or numbers.'],
])('HTTP %s shows an inline error with the alert role', async (status, message) => {
  mockRequest.mockImplementation((_token: string, path: string) => path === '/me/code' ? Promise.resolve({ code: 'ABCD-1234' }) : Promise.reject(Object.assign(new Error('HTTP error'), { status })));
  const view = render(<BuddyAddScreen />);
  fireEvent.changeText(view.getByLabelText('Invitation code'), 'k7q2m9xd');
  fireEvent.press(view.getByRole('button', { name: 'Send invitation' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(message));
  expect(mockBack).not.toHaveBeenCalled();
});

test('own code shows an inline error without sending an invitation', async () => {
  const view = render(<BuddyAddScreen />);
  await waitFor(() => expect(view.getByText('ABCD-1234')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Invitation code'), 'abcd1234');
  fireEvent.press(view.getByRole('button', { name: 'Send invitation' }));
  expect(view.getByRole('alert')).toHaveTextContent('That is your own code.');
  expect(mockRequest.mock.calls.filter(call => call[1] === '/invitations/direct')).toHaveLength(0);
});

test('a one-time invitation code from a shared link is redeemed as typed', async () => {
  mockParams = { code: 'aB3_dE-6gH9kLmNo' };
  const view = render(<BuddyAddScreen />);
  expect(view.getByLabelText('Invitation code')).toHaveProp('value', 'aB3_dE-6gH9kLmNo');
  fireEvent.press(view.getByRole('button', { name: 'Send invitation' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('private', '/invitations/redeem', 'POST', { code: 'aB3_dE-6gH9kLmNo' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
