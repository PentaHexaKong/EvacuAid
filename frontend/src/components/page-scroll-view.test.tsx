import { fireEvent, render } from '@testing-library/react-native';
import { Animated, ScrollView, Text, View } from 'react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { AppText, Page } from './ui';
import { pageHeaderLayout } from './page-scroll-view';
import { SystemReduceMotionContext } from '@/theme';

jest.mock('heroui-native/card', () => {
  const { View } = jest.requireActual('react-native');
  return { Card: Object.assign(View, { Body: View }) };
});

test('the native header follows the measured first heading, including reflow and returning to the top', () => {
  const setOptions = jest.fn();
  let titleBottom = 100;
  const measurement = jest.spyOn(Text.prototype, 'measureLayout').mockImplementation(function (this: Text, _relative, measured) {
    measured(0, this.props.testID === 'title' ? titleBottom - 40 : 300, 240, 40);
  });
  const content = (title: string) => <HeaderHeightContext.Provider value={64}>{pageHeaderLayout({
    options: { title }, navigation: { setOptions }, children: <Page>
      <View><AppText>Notice above the title</AppText><AppText testID="title" variant="title" accessibilityRole="header">{title}</AppText></View>
      <AppText testID="section" variant="section" accessibilityRole="header">Later section</AppText>
    </Page>,
  })}</HeaderHeightContext.Provider>;
  const view = render(content('Route simulation'));
  const scroll = (y: number) => fireEvent.scroll(view.UNSAFE_getByType(ScrollView), { nativeEvent: { contentOffset: { x: 0, y }, contentInset: { top: 64 } } });
  const measure = (id: string) => fireEvent(view.getByTestId(id), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 240, height: 40 } } });
  expect(setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerTitle: expect.any(Function), headerStyle: { backgroundColor: 'transparent' } }));
  measure('title');
  measure('section');
  scroll(-64);
  scroll(36);
  expect(setOptions).toHaveBeenCalledTimes(1);
  scroll(37);
  expect(setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerTitle: expect.any(Function), headerBlurEffect: 'systemUltraThinMaterialLight', headerStyle: { backgroundColor: 'rgba(235, 245, 255, 0.08)' } }));
  scroll(50);
  expect(setOptions).toHaveBeenCalledTimes(2);
  titleBottom = 150;
  measure('title');
  expect(setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerTitle: expect.any(Function), headerBlurEffect: undefined }));
  scroll(100);
  view.rerender(content('Simulasi rute'));
  expect(setOptions.mock.calls.at(-1)![0].headerTitle({}).props.children).toBe('Simulasi rute');
  scroll(-64);
  scroll(-90);
  expect(setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerTitle: expect.any(Function), headerBlurEffect: undefined, headerStyle: { backgroundColor: 'transparent' } }));
  expect(setOptions.mock.calls.at(-1)![0].headerTitle({}).props.accessibilityElementsHidden).toBe(true);
  measurement.mockRestore();
});

test('a hidden stack header leaves tab root pages alone', () => {
  const setOptions = jest.fn();
  const view = render(pageHeaderLayout({ options: { headerShown: false }, navigation: { setOptions }, children: <Page><AppText variant="title" accessibilityRole="header">Buddy</AppText></Page> }));
  fireEvent.scroll(view.UNSAFE_getByType(ScrollView), { nativeEvent: { contentOffset: { x: 0, y: 200 }, contentInset: { top: 0 } } });
  expect(setOptions).not.toHaveBeenCalled();
});


test('the title fades with the native driver, reverses on scroll, and respects reduced motion', () => {
  const setOptions = jest.fn();
  const start = jest.fn();
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start, stop, reset: jest.fn() });
  const content = (reduceMotion: boolean) => <SystemReduceMotionContext.Provider value={reduceMotion}><HeaderHeightContext.Provider value={64}>{pageHeaderLayout({ options: { title: 'Route simulation' }, navigation: { setOptions }, children: <Page><AppText>Content</AppText></Page> })}</HeaderHeightContext.Provider></SystemReduceMotionContext.Provider>;
  const view = render(content(false));
  const scroll = (y: number) => fireEvent.scroll(view.UNSAFE_getByType(ScrollView), { nativeEvent: { contentOffset: { x: 0, y } } });
  scroll(100);
  expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 180, useNativeDriver: true }));
  expect(setOptions.mock.calls.at(-1)![0].headerTitle({}).props.accessible).toBe(true);
  scroll(-64);
  expect(stop).toHaveBeenCalledTimes(2);
  expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, duration: 180 }));
  view.rerender(content(true));
  scroll(100);
  expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 0 }));
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(start.mock.calls.length);
  timing.mockRestore();
});
