/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '<rootDir>/firestore.rules.test.ts',
    '<rootDir>/src/**/*.jest.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json'],
  transform: {
    '^.+\\.(ts|tsx|mjs|js)$': '<rootDir>/jest.transform.cjs',
  },
  transformIgnorePatterns: ['/node_modules/(?!(jose|jwks-rsa)/)'],
  verbose: true,
  testTimeout: 30000,
};
