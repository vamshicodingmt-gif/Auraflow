#!/usr/bin/env node
// Bundles the Electron main process and the preload script into dist-electron/.
// The preload must be self-contained (sandboxed preloads cannot require local files),
// which esbuild guarantees by inlining shared modules.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const electronBundleOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
  entryPoints: {
    'main/index': path.join(root, 'src/main/index.ts'),
    'preload/index': path.join(root, 'src/preload/index.ts'),
  },
  outdir: path.join(root, 'dist-electron'),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await rm(path.join(root, 'dist-electron'), { recursive: true, force: true });
  await esbuild.build(electronBundleOptions);
  console.log('Built Electron main and preload bundles into dist-electron/');
}
