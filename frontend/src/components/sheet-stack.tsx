import { SheetHeaderContext } from './sheet-scroll-view';
import { pageHeaderLayout } from './page-scroll-view';
import { memo } from 'react';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme';

type LayoutProps = Parameters<typeof pageHeaderLayout>[0] & { route: { name: string } };

// Memoized with no props: the toolbar writes to the screen options, which re-renders the layout, and re-rendering the toolbar from there would loop.
// Close sits on the trailing side of every sheet screen, which leaves the leading side to the native back button on pushed pages.
const CloseButton = memo(function CloseButton() {
  const { t } = useTranslation();
  const root = useNavigation('/');
  const router = useRouter();
  return <Stack.Toolbar placement="right"><Stack.Toolbar.Button icon="xmark" accessibilityLabel={t('close')} onPress={() => root.canGoBack() ? root.goBack() : router.replace('/')}>{t('close')}</Stack.Toolbar.Button></Stack.Toolbar>;
});

// Defined once at module scope: an inline layout would remount the screen every time the stack renders.
function SheetLayout(props: LayoutProps) {
  return <><CloseButton />{props.route.name === 'index' ? props.children : pageHeaderLayout(props)}</>;
}

export function SheetStack({ profile = false }: { profile?: boolean }) {
  const { t } = useTranslation();
  return <SheetHeaderContext.Provider value={true}><Stack screenLayout={SheetLayout} screenOptions={({ route }) => ({ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, scrollEdgeEffects: { top: 'soft' }, title: t(route.name === 'name' ? 'editName' : 'alertDetailTitle'), headerTitle: route.name === 'index' ? t(profile ? 'profileTitle' : 'alertsTitle') : '', headerTitleAlign: 'center', headerTitleStyle: { fontWeight: '600' }, headerShadowVisible: false, headerTintColor: colors.ink, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.canvas } })}>
  </Stack></SheetHeaderContext.Provider>;
}
