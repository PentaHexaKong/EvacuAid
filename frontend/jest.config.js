const expoPreset = require('jest-expo/jest-preset');
const [babelTransformer, babelOptions] = expoPreset.transform['\\.[jt]sx?$'];

module.exports = {
  preset: 'jest-expo',
  // Preserve Expo's transforms while resolving lazy imports inside Jest's VM.
  transform: {
    '\\.[jt]sx?$': [babelTransformer, {
      ...babelOptions,
      plugins: [...(babelOptions.plugins || []), 'dynamic-import-node'],
    }],
  },
  setupFilesAfterEnv: ['./jest.setup.js'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
