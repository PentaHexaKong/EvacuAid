import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton, AppText } from '@/components/ui';

export function SheetScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24, gap: 24 }}>
    <AppText>{t('sheetBody')}</AppText>
    <ActionButton label={t('sheetClose')} onPress={() => router.back()} />
  </ScrollView>;
}
