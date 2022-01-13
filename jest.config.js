module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    testMatch: ['**/*.test.ts'],
    transform: {
      '^.+\\.tsx?$': 'ts-jest'
    },
    moduleNameMapper: {
        "^/opt/nodejs/constants": "<rootDir>/src/layer/nodejs/constants"
    }
};