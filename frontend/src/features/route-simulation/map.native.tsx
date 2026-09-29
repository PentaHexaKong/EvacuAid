import type { ComponentType } from 'react';
import { usesMapbox } from '@/components/map-engine';
import type { SimulationMapProps } from './map';

export const SimulationMap: ComponentType<SimulationMapProps> = usesMapbox()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require('./map.mapbox').SimulationMap
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  : require('./map.rnmaps').SimulationMap;
