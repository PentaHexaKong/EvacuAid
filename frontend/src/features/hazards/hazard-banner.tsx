import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/theme';
import earthquake from '../../../assets/brand/hazards/photos/earthquake.jpg';
import flood from '../../../assets/brand/hazards/photos/flood.jpg';
import volcano from '../../../assets/brand/hazards/photos/volcano.jpg';
import haze from '../../../assets/brand/hazards/photos/haze.jpg';
import fire from '../../../assets/brand/hazards/photos/fire.jpg';
import wind from '../../../assets/brand/hazards/photos/wind.jpg';
import fallback from '../../../assets/brand/hazards/photos/fallback.jpg';
import type { HazardType } from './api';

// One stock photo per disaster type; the feed has no photo of the event itself. Credits mirror assets/brand/hazards/photos/CREDITS.txt,
// and the CC BY ones must stay visible in the app (the detail page prints them).
const PHOTOS: Record<HazardType, { source: ImageSourcePropType; credit: string }> = {
  earthquake: { source: earthquake, credit: 'U.S. Geological Survey, public domain' },
  flood: { source: flood, credit: 'Sandy Syafrudin Nina, CC BY 4.0' },
  volcano: { source: volcano, credit: 'Yosh Ginsu, CC0' },
  haze: { source: haze, credit: 'OttaEl, CC BY 4.0' },
  fire: { source: fire, credit: 'MWul, CC BY 4.0' },
  wind: { source: wind, credit: 'Peter Shanks, CC BY 2.0' },
};
// A type the app does not know yet still gets a banner.
const FALLBACK = { source: fallback, credit: 'SATELITBM, CC0' };

export const hazardPhotoCredit = (type: HazardType) => (PHOTOS[type] ?? FALLBACK).credit;

// The photo dissolves into the surface below it, so the text that follows reads as part of the same card.
export function HazardBanner({ type, height, fade, fadeTo }: { type: HazardType; height: number; fade: number; fadeTo: string }) {
  return <View style={{ height, backgroundColor: colors.chip }}>
    <Image source={(PHOTOS[type] ?? FALLBACK).source} resizeMode="cover" accessibilityIgnoresInvertColors style={styles.photo} />
    <LinearGradient pointerEvents="none" colors={[fadeTo + '00', fadeTo + 'B3', fadeTo]} locations={[0, 0.6, 1]} style={[styles.fade, { height: fade }]} />
  </View>;
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: '100%' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
