import type { ComponentType } from 'react';
import { usesMapbox } from './map-engine';
import type { DiscoverMapProps } from './discover-map';

export const DiscoverMap: ComponentType<DiscoverMapProps> = usesMapbox()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require('./discover-map.mapbox').DiscoverMap
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  : require('./discover-map.rnmaps').DiscoverMap;
