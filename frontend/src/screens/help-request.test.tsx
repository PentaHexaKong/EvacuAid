import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { HelpRequestScreen } from './help-request';
import { sky } from '@/theme';

const mockBack = jest.fn(), mockReplace = jest.fn(), mockTransition = jest.fn(), mockConfirm = jest.fn(), mockAlert = jest.fn(), mockRefresh = jest.fn(), mockOptions = jest.fn();
let mockError: string | null = null;
let mockIssue: string | null = null;
let mockSession: any;
let mockAttempt: any;
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'request' }), useRouter: () => ({ back: mockBack, replace: mockReplace }), Stack: { Screen: ({ options }: { options: unknown }) => { mockOptions(options); return null; } } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 10 }) }));
jest.mock('@/features/profile/session', () => ({ useGuestSession: () => ({ token: 'guest', user: { id: 'helper' } }) }));
jest.mock('@/features/feedback/haptics', () => ({ useHaptics: () => ({ alert: mockAlert, tap: jest.fn() }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: Record<string, string>) => jest.requireActual('@/localization/en.json')[key]?.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => params?.[name] ?? '') ?? key }) }));
jest.mock('@/features/buddy/use-buddy', () => ({ useBuddy: () => ({ loading: false, error: mockError, busy: false, refresh: mockRefresh, incomingContacts: [{ userId: 'requester', relation: 'TEMAN' }] }) }));
jest.mock('@/features/buddy/use-buddy-actions', () => ({ useBuddyActions: () => ({ session: mockSession, attempt: mockAttempt, transition: mockTransition, confirm: mockConfirm, support: (value: string) => value, c: (key: string) => key, issue: mockIssue }) }));

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-10T00:00:00Z')); jest.clearAllMocks(); mockTransition.mockResolvedValue(true);
  mockError = null; mockIssue = null;
  mockAttempt = { id: 'attempt', expiresAt: '2026-10-10T00:02:00Z' };
  mockSession = { id: 'request', requesterUserId: 'requester', requesterName: 'Ari', status: 'WAITING', nearby: false, supportNeeds: ['Mobility'], message: 'Please walk with me' };
});
afterEach(() => jest.useRealTimers());

test('accept sends consent directly and navigates into the session', async () => {
  const view = render(<HelpRequestScreen />);
  expect(mockRefresh).toHaveBeenCalledWith('request');
  expect(view.getByText('Shares your location with Ari while you help')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: "I'll help Ari" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/buddy', params: { requestId: 'request' } }));
  expect(mockTransition).toHaveBeenCalledWith('accept', { attemptId: 'attempt', sharingConsent: true });
  expect(mockConfirm).not.toHaveBeenCalled();
});

test.each([false, true])('decline confirms only for friends (nearby %s)', async nearby => {
  mockSession.nearby = nearby;
  const view = render(<HelpRequestScreen />);
  fireEvent.press(view.getByRole('button', { name: "I can't right now" }));
  if (!nearby) {
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith('declineTitle', expect.any(Function), 'declineBody');
    act(() => mockConfirm.mock.calls[0][1]());
  } else expect(mockConfirm).not.toHaveBeenCalled();
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockTransition).toHaveBeenCalledWith('decline', { attemptId: 'attempt' });
});

test('countdown ticks, shrinks and coarsens its accessible label until expiry', () => {
  const view = render(<HelpRequestScreen />);
  expect(view.getByText('Answer in 2:00')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1000));
  expect(view.getByText('Answer in 1:59')).toBeTruthy();
  expect(view.getByRole('timer')).toHaveProp('accessibilityLabel', 'Answer in 2:00');
  act(() => jest.advanceTimersByTime(14000));
  expect(view.getByText('Answer in 1:45')).toBeTruthy();
  expect(view.getByRole('timer')).toHaveProp('accessibilityLabel', 'Answer in 1:45');
  const fills = view.UNSAFE_getAllByType(View).map(node => StyleSheet.flatten(node.props.style)).filter(style => style?.height === 4 && style?.backgroundColor === sky.awas.ink);
  expect(fills[0].width).toBe('87.5%');
  act(() => jest.advanceTimersByTime(105000));
  expect(view.getByText('This request has moved on')).toBeTruthy();
  expect(view.queryByRole('timer')).toBeNull();
});

test.each(['missing', 'expired', 'accepted', 'wrong-session'])('ended state for %s', condition => {
  if (condition === 'missing') mockAttempt = undefined;
  if (condition === 'expired') mockAttempt.expiresAt = '2026-10-09T23:59:59Z';
  if (condition === 'accepted') mockSession.status = 'ACCEPTED';
  if (condition === 'wrong-session') mockSession.id = 'another';
  const view = render(<HelpRequestScreen />);
  expect(view.getByText('This request has moved on')).toBeTruthy();
  expect(view.queryByRole('button', { name: "I'll help Ari" })).toBeNull();
  expect(view.UNSAFE_getByType(LinearGradient).props.colors).toEqual(sky.normal.stops);
  expect(mockAlert).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Close' }));
  expect(mockBack).toHaveBeenCalled();
});

test.each([false, true])('haptic once per attempt (nearby %s)', nearby => {
  mockSession.nearby = nearby;
  const view = render(<HelpRequestScreen />);
  act(() => jest.advanceTimersByTime(2000)); view.rerender(<HelpRequestScreen />);
  expect(mockAlert).toHaveBeenCalledTimes(1);
  expect(mockAlert).toHaveBeenCalledWith(nearby ? 'siaga' : 'awas');
  mockAttempt = { ...mockAttempt, id: 'next-attempt' }; view.rerender(<HelpRequestScreen />);
  expect(mockAlert).toHaveBeenCalledTimes(2);
});

test('answer later closes and failed acceptance stays', async () => {
  mockTransition.mockResolvedValue(false);
  const view = render(<HelpRequestScreen />);
  fireEvent.press(view.getByRole('button', { name: "I'll help Ari" })); await act(async () => {});
  expect(mockReplace).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Answer later' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockTransition).toHaveBeenCalledTimes(1);
});

test('a refused accept stays on the takeover and says so', async () => {
  mockTransition.mockResolvedValue(false);
  const view = render(<HelpRequestScreen />);
  fireEvent.press(view.getByRole('button', { name: /^I'll help/ }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent("That didn't go through. Check your connection and location, then try again."));
  expect(mockReplace).not.toHaveBeenCalled();
});

test.each(['Connection unavailable', null])('a failed initial load offers retry with issue %s', issue => {
  mockSession = null; mockAttempt = undefined; mockError = 'Connection unavailable'; mockIssue = issue;
  const view = render(<HelpRequestScreen />);
  expect(view.getByRole('alert')).toHaveTextContent(issue ?? "That didn't go through. Check your connection and location, then try again.");
  expect(view.queryByText('This request has moved on')).toBeNull();
  mockRefresh.mockClear();
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(mockRefresh).toHaveBeenCalledWith('request');
  mockError = null;
  view.rerender(<HelpRequestScreen />);
  expect(view.getByText('This request has moved on')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: 'Close' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('a refused nearby decline stays on the takeover and says so', async () => {
  mockSession.nearby = true; mockTransition.mockResolvedValue(false);
  const view = render(<HelpRequestScreen />);
  fireEvent.press(view.getByRole('button', { name: "I can't right now" }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent("That didn't go through. Check your connection and location, then try again."));
  expect(mockBack).not.toHaveBeenCalled();
});
