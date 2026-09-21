import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

export function SettingsMenu({ notifications = false }: { notifications?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return <Stack.Toolbar placement="right">
    {notifications && <Stack.Toolbar.Button icon="bell" accessibilityLabel={t('alertsTitle')} onPress={() => router.navigate('/alerts')}>{t('alertsTitle')}</Stack.Toolbar.Button>}
    <Stack.Toolbar.Button icon="person.crop.circle" accessibilityLabel={t('profileTitle')} onPress={() => router.navigate('/profile')}>{t('profileTitle')}</Stack.Toolbar.Button>
  </Stack.Toolbar>;
}
