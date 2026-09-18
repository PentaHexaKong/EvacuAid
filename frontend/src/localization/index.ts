import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { loadLanguage, persistLanguage, type Language } from './language';
import en from './en.json';
import id from './id.json';

export const i18n = createInstance();
export const localizationReady = loadLanguage(AsyncStorage, getLocales().map((locale) => locale.languageCode))
  .then((lng) => i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, id: { translation: id } },
    lng, fallbackLng: 'id', interpolation: { escapeValue: false },
  }));

export async function selectLanguage(language: Language) {
  await i18n.changeLanguage(language);
  await persistLanguage(AsyncStorage, language);
}
