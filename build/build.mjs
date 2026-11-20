// Rebuild vendor/ after upgrading a dependency: `npm run build`.
import { build } from 'esbuild';

const out = new URL('../vendor/', import.meta.url);

await build({
  entryPoints: ['vendor-entry.js'],
  outfile: new URL('anthropic.js', out).pathname,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
});
console.log('Built vendor/');
