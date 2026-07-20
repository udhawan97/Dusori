import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  dts: false,
  noExternal: ['@dusori/core'],
  banner: { js: '#!/usr/bin/env node' },
});
