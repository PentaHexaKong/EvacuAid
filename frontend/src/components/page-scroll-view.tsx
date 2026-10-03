import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, View, useAnimatedValue, type ScrollViewProps, type Text } from 'react-native';
import { HeaderTitle, useHeaderHeight } from 'expo-router/react-navigation';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import { SystemReduceMotionContext } from '@/theme';

type Header = { title: string; setOptions: (options: NativeStackNavigationOptions) => void };
export const PageHeaderContext = createContext<Header | null>(null);
export const PageTitleContext = createContext<((title: Text | null) => void) | null>(null);

export function pageHeaderLayout({ children, options, navigation }: { children: ReactElement; options: NativeStackNavigationOptions; navigation: Pick<Header, 'setOptions'> }) {
  return <PageHeaderContext.Provider value={options.headerShown === false ? null : { title: options.title ?? '', setOptions: navigation.setOptions }}>{children}</PageHeaderContext.Provider>;
}

export function PageScrollView({ children, contentContainerStyle, ...props }: ScrollViewProps) {
  const { title: headerTitle, setOptions } = useContext(PageHeaderContext)!;
  const headerHeight = useHeaderHeight();
  const content = useRef<View>(null);
  const title = useRef<{ node: Text; top: number; bottom: number } | null>(null);
  const offset = useRef(Platform.OS === 'ios' ? -headerHeight : 0);
  const [visible, setVisible] = useState(false);
  const opacity = useAnimatedValue(0);
  const reduceMotion = useContext(SystemReduceMotionContext);
  const update = useCallback(() => setVisible(offset.current + headerHeight > (title.current?.bottom ?? (Platform.OS === 'ios' ? 0 : headerHeight))), [headerHeight]);
  const measureTitle = useCallback((node: Text | null) => {
    if (!node || !content.current) return;
    node.measureLayout(content.current, (_x, y, _width, height) => {
      if (!title.current || title.current.node === node || y < title.current.top) {
        title.current = { node, top: y, bottom: y + height };
        update();
      }
    });
  }, [update]);
  useLayoutEffect(() => {
    setOptions({ headerTitle: props => <HeaderTitle {...props} style={{ opacity }} accessible={visible} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>{headerTitle}</HeaderTitle>, headerTransparent: true, headerShadowVisible: false, scrollEdgeEffects: { top: 'hidden' }, headerBlurEffect: visible ? 'systemUltraThinMaterialLight' : undefined, headerStyle: { backgroundColor: visible ? 'rgba(235, 245, 255, 0.08)' : 'transparent' } });
  }, [setOptions, headerTitle, visible, opacity]);
  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion, visible]);
  const paddingTop = StyleSheet.flatten(contentContainerStyle)?.paddingTop ?? StyleSheet.flatten(contentContainerStyle)?.padding ?? 0;
  return <ScrollView {...props} scrollEventThrottle={16} onScroll={event => {
    offset.current = event.nativeEvent.contentOffset.y;
    update();
    props.onScroll?.(event);
  }}>
    <View ref={content} collapsable={false} style={[contentContainerStyle, Platform.OS !== 'ios' && { paddingTop: headerHeight + Number(paddingTop) }]} onLayout={() => measureTitle(title.current?.node ?? null)}>
      <PageTitleContext.Provider value={measureTitle}>{children}</PageTitleContext.Provider>
    </View>
  </ScrollView>;
}
