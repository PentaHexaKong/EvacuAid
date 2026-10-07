import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import IconVolume from '@tabler/icons-react-native/IconVolume';
import IconPlayerStop from '@tabler/icons-react-native/IconPlayerStop';
import { ActionButton } from '@/components/ui';
import { useReadAloud } from '@/features/feedback/speech';
import { colors } from '@/theme';

export function ListenButton({ text, auto }: { text: string; auto: boolean }) {
  const { t } = useTranslation();
  const { speaking, toggle } = useReadAloud(text, { auto });
  // Sized to its label and left-aligned: a full-width button here would compete with the page's main action.
  return <View style={{ alignSelf: 'flex-start' }}><ActionButton variant="secondary" compact label={t(speaking ? 'stopListening' : 'listen')} icon={speaking ? <IconPlayerStop size={20} color={colors.primary} /> : <IconVolume size={20} color={colors.primary} />} onPress={toggle} /></View>;
}
