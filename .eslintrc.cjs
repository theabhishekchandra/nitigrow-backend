/* eslint-env node */
module.exports = {
  root: true,
  env: {
    node: true,
    es2023: true,
  },
  parserOptions: {
    ecmaVersion: 2023,
    sourceType: 'script', // CommonJS
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    // Logger migration is incomplete — leave console allowed for now.
    'no-console': 'off',
    'prefer-const': 'warn',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
};
