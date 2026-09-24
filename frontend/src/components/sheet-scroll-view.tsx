import { createContext, useRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { useNavigation } from 'expo-router';

export const SheetHeaderContext = createContext(false);

export function SheetScrollView(props: ScrollViewProps) {
  const navigation = useNavigation();
  const scrolled = useRef(false);
  return <ScrollView {...props} scrollEventThrottle={16} onScroll={event => {
    const { contentOffset, contentInset } = event.nativeEvent;
    const next = contentOffset.y + contentInset.top > 1;
    if (next !== scrolled.current) {
      scrolled.current = next;
      navigation.setOptions({ headerBlurEffect: next ? 'systemThinMaterialLight' : undefined, headerStyle: { backgroundColor: next ? 'rgba(235, 245, 255, 0.15)' : 'transparent' } });
    }
    props.onScroll?.(event);
  }} />;
}
