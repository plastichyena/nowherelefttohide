import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    // Session artifacts and quarantined files can contain very large trees.
    // They are not source inputs and must not stall the dev/CLI watcher.
    watch: { ignored: ['**/.safe-delete/**', '**/output/**', '**/dist/**'] },
  },
});
