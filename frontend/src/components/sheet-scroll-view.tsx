import { createContext, useRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { useNavigation } from 'expo-router';

export const SheetHeaderContext = createContext(false);

// Same bar as the tabs (see TabScrollView): clear at the top, frosted and bordered once content scrolls under it.
export function SheetScrollView(props: ScrollViewProps) {
  const navigation = useNavigation();
  const scrolled = useRef(false);
  return <ScrollView {...props} scrollEventThrottle={16} onScroll={event => {
    const { contentOffset, contentInset } = event.nativeEvent;
    const next = contentOffset.y + contentInset.top > 1;
    if (next !== scrolled.current) {
      scrolled.current = next;
      navigation.setOptions({ scrollEdgeEffects: { top: next ? 'hard' : 'soft' } });
    }
    props.onScroll?.(event);
  }} />;
}
