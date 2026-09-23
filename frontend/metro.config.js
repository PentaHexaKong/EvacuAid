const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Allow React Native to import shared clients from EvacuAid repository root.
config.watchFolders = [path.resolve(__dirname, '..')];

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
