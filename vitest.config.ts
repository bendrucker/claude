import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['**/*.test.ts'],
          exclude: ['**/*.integration.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['**/*.integration.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 60000,
        },
      },
    ],
  },
})
