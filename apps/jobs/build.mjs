import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });

// CommonJS: the Functions worker injects @azure/functions-core through require().
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  packages: 'bundle',
  external: ['@azure/functions-core'],
  sourcemap: true,
  logLevel: 'info',
});
