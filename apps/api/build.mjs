import { build } from 'esbuild';
import { cp, rm, writeFile } from 'node:fs/promises';

const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: { server: 'src/server.ts', migrate: 'src/db/migrate.ts' },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'bundle',
  sourcemap: true,
  // Native packages go here once they exist (sharp, step 5).
  external: [],
  define: {
    'process.env.GIT_SHA': JSON.stringify(process.env.GIT_SHA ?? 'local'),
  },
  banner: {
    js: "import { createRequire as __afiCreateRequire } from 'node:module'; const require = __afiCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

await cp('../../packages/db/migrations', `${outdir}/migrations`, { recursive: true });
await writeFile(`${outdir}/package.json`, JSON.stringify({ type: 'module' }, null, 2) + '\n');
