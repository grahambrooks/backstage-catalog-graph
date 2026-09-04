import { build } from 'esbuild';

// Two bundles with different targets: the extension host runs in Node and gets `vscode` from
// the runtime, while the webview runs in a browser context and must carry everything it uses.
const common = {
  bundle: true,
  minify: process.argv.includes('--production'),
  sourcemap: !process.argv.includes('--production'),
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
});

await build({
  ...common,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'out/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
});
