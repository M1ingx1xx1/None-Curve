import { defineConfig } from 'vitest/config'

// Two projects. `fast` (npm test, and CI): everything under tests/ except tests/slow, well under a minute.
// `slow` (npm run test:slow): the 42 s test track and every glyph of both fixture fonts, about 5 minutes. The slow
// project exists only when it is asked for by name, so a plain `vitest run` stays fast.
const wantsSlow = process.argv.some((arg, i, args) => arg === '--project=slow' || (arg === '--project' && args[i + 1] === 'slow'))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'fast',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/slow/**'],
          testTimeout: 60_000,
        },
      },
      ...(wantsSlow
        ? [
            {
              test: {
                name: 'slow',
                environment: 'node',
                include: ['tests/slow/**/*.test.ts'],
                testTimeout: 600_000,
              },
            },
          ]
        : []),
    ],
  },
})
