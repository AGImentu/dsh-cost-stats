import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node for the pure logic; the one DOM test opts in per file with
    // `// @vitest-environment jsdom` (it renders the page with real React).
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
