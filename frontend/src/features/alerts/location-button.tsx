import { useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { ActionButton } from '@/components/ui';
import { useProfile } from '@/features/profile/context';

export function AlertLocationButton({ reload }: { reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const { saveLocation } = useProfile();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    let position: Location.LocationObject;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('permission');
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch (cause) {
      setBusy(false);
      Alert.alert(t('locationSaveErrorTitle'), cause instanceof Error && cause.message === 'permission' ? t('locationPermissionDenied') : t('locationRetrieveError'));
      return;
    }
    Alert.alert(t('locationConsentTitle'), t('locationConsentBody', {
      latitude: position.coords.latitude.toFixed(5), longitude: position.coords.longitude.toFixed(5),
    }), [
      { text: t('cancel'), style: 'cancel', onPress: () => setBusy(false) },
      { text: t('uploadLocation'), onPress: () => void (async () => {
        try {
          await saveLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy, new Date(position.timestamp).toISOString());
          await reload();
          Alert.alert(t('locationSavedTitle'), t('locationSavedBody'));
        } catch { Alert.alert(t('locationSaveErrorTitle'), t('locationUploadError')); }
        finally { setBusy(false); }
      })() },
    ], { cancelable: false });
  };
  return <ActionButton label={t('saveLocation')} loading={busy} onPress={() => void save()} />;
}
