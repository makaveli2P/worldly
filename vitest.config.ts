import { defaultExclude, defineConfig } from 'vitest/config';

// Vitest reads this file in place of vite.config.ts. So the tests do not load the dev plugins
// or the keys in .env, and no test can call a paid API by accident.
export default defineConfig({
  test: {
    // .claude/worktrees holds full copies of the repo. Do not collect their tests.
    exclude: [...defaultExclude, '.claude/**', 'dist/**'],
  },
});
