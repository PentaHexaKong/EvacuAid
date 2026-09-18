const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([expoConfig, { ignores: ['dist/*', '.ai-artifacts/*'] }, { settings: { 'import/resolver': { typescript: { alwaysTryTypes: false, conditionNames: ['import', 'require', 'default'] } } } }]);
