import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-webapp/**',
      'tests/responsive/**/*.spec.ts',
    ],
  },
});
