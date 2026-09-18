import { Stack } from 'expo-router';
import { colors } from '@/theme';
import { PreviewStack } from '@/components/preview-stack';
import { useTranslation } from 'react-i18next';

export default function Layout() {
  const { t } = useTranslation();
  return <PreviewStack name="components" title={t('components')}>
    <Stack.Screen name="sheet" options={{ title: t('sheetTitle'), presentation: 'formSheet', headerLargeTitle: false, sheetGrabberVisible: true, sheetAllowedDetents: [0.5, 1], contentStyle: { backgroundColor: colors.surface }, headerStyle: { backgroundColor: colors.surface } }} />
  </PreviewStack>;
}
