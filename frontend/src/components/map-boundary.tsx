import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionButton, AppText } from './ui';
import { colors } from '@/theme';

export class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function MapFallback({ topInset, onRetry }: { topInset: number; onRetry?: () => void }) {
  const { t } = useTranslation();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas, padding: 24, paddingTop: topInset + 72, gap: 16 }]}>
    <AppText accessibilityRole="alert">{t('discoverMapUnavailable')}</AppText>
    {onRetry && <View style={{ alignSelf: 'flex-start' }}><ActionButton variant="secondary" label={t('tryAgain')} onPress={onRetry} /></View>}
  </View>;
}
