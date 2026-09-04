import { build, context } from 'esbuild';

// Two bundles with different targets: the extension host runs in Node and gets `vscode` from
// the runtime, while the webview runs in a browser context and must carry everything it uses.
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const targets = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'out/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  },
];

if (watch) {
  // Rebuilds on save. Reload the Extension Development Host window to pick the result up --
  // VS Code does not re-read the bundle on its own.
  await Promise.all(targets.map(async (options) => (await context(options)).watch()));
} else {
  await Promise.all(targets.map((options) => build(options)));
}
