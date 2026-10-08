import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Stack, router } from 'expo-router';
import { Text } from 'react-native';
import { SheetStack } from '@/components/sheet-stack';
import Settings from '@/app/settings';
import ProfileLayout from '@/app/profile/_layout';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key === 'close' ? 'Close' : key }) }));

const routes = {
  _layout: () => <Stack><Stack.Screen name="alerts" dangerouslySingular options={{ presentation: 'formSheet', headerShown: false }} /><Stack.Screen name="profile" dangerouslySingular options={{ presentation: 'formSheet', headerShown: false }} /></Stack>,
  index: () => <Text>Home content</Text>,
  buddy: () => <Text>Buddy content</Text>,
  discover: () => <Text>Discover content</Text>,
  'alerts/_layout': { default: SheetStack, unstable_settings: { initialRouteName: 'index' } },
  'alerts/index': () => <Text>Notification list</Text>,
  'alerts/[id]': () => <Text>Notification detail</Text>,
  'profile/_layout': { default: ProfileLayout, unstable_settings: { initialRouteName: 'index' } },
  'profile/index': () => <Text>Profile overview</Text>,
  settings: Settings,
};

test('repeated sheet opens keep one presentation; Back stays inside and Close removes the sheet', () => {
  const view = renderRouter(routes);
  act(() => { router.navigate('/alerts'); router.navigate('/alerts'); });
  expect(view.getRouterState()?.routes[0]?.state?.routes.filter(route => route.name === 'alerts')).toHaveLength(1);
  act(() => router.push('/alerts/rain'));
  expect(view.getPathname()).toBe('/alerts/rain');
  act(() => router.back());
  expect(view.getPathname()).toBe('/alerts');
  act(() => router.push('/alerts/rain'));
  const header = screen.UNSAFE_root.findAll(node => node.props.onPressHeaderBarButtonItem).at(-1)!;
  const close = header.props.headerRightBarButtonItems[0];
  expect(close.title).toBe('Close');
  // The leading side is left to the native back button on a pushed page.
  expect(header.props.headerLeftBarButtonItems).toBeUndefined();
  expect(header.props.backButtonInCustomView).toBeFalsy();
  fireEvent(header, 'pressHeaderBarButtonItem', { nativeEvent: { buttonId: close.buttonId } });
  expect(view.getPathname()).toBe('/');
  expect(view.getRouterState()?.routes[0]?.state?.routes.some(route => route.name === 'alerts')).toBe(false);
});

test('onward navigation removes the complete notification stack and settings redirects into Profile', () => {
  const view = renderRouter(routes);
  act(() => router.navigate('/alerts'));
  act(() => router.push('/alerts/rain'));
  act(() => router.dismissTo('/discover'));
  expect(view.getPathname()).toBe('/discover');
  expect(view.getRouterState()?.routes[0]?.state?.routes.some(route => route.name === 'alerts')).toBe(false);
  act(() => router.navigate('/settings'));
  expect(view.getPathname()).toBe('/profile');
});

test('Profile has a centered title and a trailing native close button', () => {
  const view = renderRouter(routes);
  act(() => router.navigate('/profile'));
  const header = screen.UNSAFE_root.findAll(node => node.props.onPressHeaderBarButtonItem).at(-1)!;
  expect(header.props.title).toBe('profileTitle');
  const close = header.props.headerRightBarButtonItems[0];
  expect(close.title).toBe('Close');
  expect(header.props.headerLeftBarButtonItems).toBeUndefined();
  fireEvent(header, 'pressHeaderBarButtonItem', { nativeEvent: { buttonId: close.buttonId } });
  expect(view.getPathname()).toBe('/');
});
