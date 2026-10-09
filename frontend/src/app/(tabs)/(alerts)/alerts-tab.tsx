import { useTranslation } from 'react-i18next';
import { TabHeader } from '@/components/tab-shell';
import { AppText } from '@/components/ui';
import { AlertsScreen } from '@/screens/alerts';

export default function AlertsTab() {
  const { t } = useTranslation();
  return <>
    <TabHeader><AppText variant="title" accessibilityRole="header">{t('alertsTitle')}</AppText></TabHeader>
    <AlertsScreen />
  </>;
}
