#!/usr/bin/env node
// Development runner: Vite serves the renderer with hot reload, esbuild rebuilds the
// main/preload bundles on save, and Electron restarts whenever the main process changes.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronBinary from 'electron';
import * as esbuild from 'esbuild';
import { createServer } from 'vite';
import { electronBundleOptions } from './build-main.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.AURAFLOW_DEV_PORT ?? 5173);
const rendererUrl = `http://127.0.0.1:${port}`;

const server = await createServer({
  configFile: path.join(root, 'vite.config.mts'),
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
console.log(`Renderer dev server: ${rendererUrl}`);

let electron = null;
let stopping = false;

function launchElectron() {
  if (electron) electron.kill();
  const args = [root];
  // Chromium's sandbox needs a SUID helper that npm installs cannot set up on many Linux
  // distributions. Developers can opt back in with AURAFLOW_SANDBOX=1.
  if (process.platform === 'linux' && process.env.AURAFLOW_SANDBOX !== '1') args.push('--no-sandbox');
  electron = spawn(electronBinary, args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl },
    stdio: 'inherit',
  });
  electron.on('exit', (code) => {
    if (!stopping && code === 0) {
      void shutdown(0);
    }
  });
}

const context = await esbuild.context({
  ...electronBundleOptions,
  logLevel: 'info',
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) launchElectron();
        });
      },
    },
  ],
});
await context.watch();

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  if (electron) electron.kill();
  await context.dispose();
  await server.close();
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
