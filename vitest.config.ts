import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Public 51x51 projections include wall construction and economic diagnostics.
    testTimeout: 20000,
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
