import { fireEvent, render } from '@testing-library/react-native';
import { AlertsScreen } from './alerts';
import { levelLabels, sampleAlerts } from '@/features/content/samples';
import id from '@/localization/id.json';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => jest.requireActual('../localization/id.json')[key] ?? key }) }));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])('each alert exposes its level and opens the matching route (sheet=%s)', sheet => {
  const view = render(<AlertsScreen sheet={sheet} />);
  expect(view.getAllByRole('button')).toHaveLength(sampleAlerts.length);
  sampleAlerts.forEach(alert => {
    const label = `${id[levelLabels[alert.level]]}. ${id[alert.title]}. ${id[alert.area]}. ${alert.issued}`;
    const row = view.getByRole('button', { name: label });
    expect(row.props.accessibilityLabel).toContain(id[levelLabels[alert.level]]);
    fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: sheet ? '/alerts/[id]' : '/alert/[id]', params: { id: alert.id } });
  });
});
