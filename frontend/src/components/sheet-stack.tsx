import { SheetHeaderContext } from './sheet-scroll-view';
import { pageHeaderLayout } from './page-scroll-view';
import { Button } from 'react-native';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme';

export function SheetStack({ profile = false }: { profile?: boolean }) {
  const { t } = useTranslation();
  const root = useNavigation('/');
  const router = useRouter();
  const close = () => root.canGoBack() ? root.goBack() : router.replace('/');
  return <SheetHeaderContext.Provider value={true}><Stack screenLayout={props => props.route.name === 'index' ? props.children : pageHeaderLayout(props)} screenOptions={({ route }) => ({ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, scrollEdgeEffects: { top: 'hidden' }, title: t(route.name === 'name' ? 'editName' : 'alertDetailTitle'), headerTitle: route.name === 'index' ? t(profile ? 'profileTitle' : 'alertsTitle') : '', headerTitleAlign: 'center', headerShadowVisible: false, headerTintColor: colors.ink, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.canvas }, headerLeft: () => <Button title={t('close')} onPress={close} />, unstable_headerLeftItems: () => [{ type: 'button', label: t('close'), accessibilityLabel: t('close'), icon: { type: 'sfSymbol', name: 'xmark' }, onPress: close }] })}>
  </Stack></SheetHeaderContext.Provider>;
}
