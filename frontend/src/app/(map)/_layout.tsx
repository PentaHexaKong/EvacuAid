import { PreviewStack } from '@/components/preview-stack';
import { useTranslation } from 'react-i18next';

export default function Layout() {
  const { t } = useTranslation();
  return <PreviewStack name="buddy-map" title={t('map')} />;
}
