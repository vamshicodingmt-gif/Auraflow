import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));

/**
 * Renderer build: four Electron windows share one bundle layout.
 *  - index.html   dashboard (also the browser preview entry)
 *  - pill.html    floating recording pill
 *  - settings.html mini settings window
 *  - tray.html    dark tray popup
 */
export default defineConfig({
  root: rendererRoot,
  base: '/',
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('./dist-renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
        pill: fileURLToPath(new URL('./src/renderer/pill.html', import.meta.url)),
        settings: fileURLToPath(new URL('./src/renderer/settings.html', import.meta.url)),
        tray: fileURLToPath(new URL('./src/renderer/tray.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
});
