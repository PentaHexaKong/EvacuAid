import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/features/auth/client';
import { ForgotPasswordScreen, LoginScreen, RegisterScreen, ResetPasswordScreen } from './auth';

const mockRouter = { back: jest.fn(), canGoBack: () => true, push: jest.fn(), replace: jest.fn() };
const mockAuth = { register: jest.fn(), login: jest.fn(), loginGoogle: jest.fn(), requestReset: jest.fn(), resetPassword: jest.fn() };
let mockResetToken: string | undefined = 'reset-token-that-is-long-enough';

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ token: mockResetToken }) }));
jest.mock('expo-auth-session/providers/google', () => ({ useIdTokenAuthRequest: () => [{}, null, jest.fn()] }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/en.json')[key] ?? key }) }));
jest.mock('@/features/auth/context', () => ({ useAuth: () => mockAuth }));
jest.mock('@/components/ui', () => {
  const { Text } = jest.requireActual('react-native');
  return { AppText: ({ children, ...props }: { children?: unknown }) => <Text {...props}>{children}</Text> };
});
jest.mock('@tabler/icons-react-native', () => ({ IconArrowLeft: () => null, IconBrandGoogle: () => null, IconCheck: () => null, IconEye: () => null, IconEyeOff: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockResetToken = 'reset-token-that-is-long-enough';
  Object.values(mockAuth).forEach((method) => method.mockResolvedValue(undefined));
});

test('register validates fields, then creates the account', async () => {
  const view = render(<RegisterScreen />);
  fireEvent.press(view.getByLabelText('Create account'));
  expect(view.getByText('Enter your name to continue.')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Name'), 'Dewi');
  fireEvent.changeText(view.getByLabelText('Email'), 'dewi@example.com');
  fireEvent.changeText(view.getByLabelText('Password'), 'a-long-test-password');
  fireEvent.press(view.getByLabelText('Create account'));
  await waitFor(() => expect(mockAuth.register).toHaveBeenCalledWith({ name: 'Dewi', email: 'dewi@example.com', password: 'a-long-test-password', rememberMe: true }));
});

test('login handles remember-me, forgot-password navigation, and invalid credentials', async () => {
  mockAuth.login.mockRejectedValueOnce(new ApiError(401, 'invalid credentials'));
  const view = render(<LoginScreen />);
  fireEvent.press(view.getByLabelText('Remember me'));
  fireEvent.press(view.getByText('Forgot password?'));
  expect(mockRouter.push).toHaveBeenCalledWith('/auth/forgot-password');
  fireEvent.changeText(view.getByLabelText('Email'), 'dewi@example.com');
  fireEvent.changeText(view.getByLabelText('Password'), 'a-long-test-password');
  fireEvent.press(view.getByLabelText('Sign in'));
  await waitFor(() => expect(view.getByText('Email or password is incorrect.')).toBeTruthy());
  expect(mockAuth.login).toHaveBeenCalledWith({ email: 'dewi@example.com', password: 'a-long-test-password', rememberMe: false });
});

test('forgot password gives the same generic confirmation after a valid email', async () => {
  const view = render(<ForgotPasswordScreen />);
  fireEvent.changeText(view.getByLabelText('Email'), 'dewi@example.com');
  fireEvent.press(view.getByLabelText('Send reset link'));
  await waitFor(() => expect(mockAuth.requestReset).toHaveBeenCalledWith('dewi@example.com'));
  expect(view.getByText('Check your email.')).toBeTruthy();
});

test('reset password validates confirmation and submits a deep-link token', async () => {
  const view = render(<ResetPasswordScreen />);
  fireEvent.changeText(view.getByLabelText('New password'), 'a-long-test-password');
  fireEvent.changeText(view.getByLabelText('Confirm password'), 'different-long-password');
  fireEvent.press(view.getByLabelText('Save new password'));
  expect(view.getByText('Passwords do not match.')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Confirm password'), 'a-long-test-password');
  fireEvent.press(view.getByLabelText('Save new password'));
  await waitFor(() => expect(mockAuth.resetPassword).toHaveBeenCalledWith('reset-token-that-is-long-enough', 'a-long-test-password'));
});
