import fs from 'node:fs';
import path from 'node:path';
import { protocol } from 'electron';

/**
 * Renderer pages are served from a privileged app:// origin instead of file://, so ES modules,
 * AudioWorklets and fonts all load under one secure, same-origin scheme.
 */
export const RENDERER_HOST = 'renderer';
export const RENDERER_ORIGIN = `app://${RENDERER_HOST}`;

export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.map': 'application/json',
};

export function installRendererProtocol(rendererDir: string): void {
  const root = path.resolve(rendererDir);
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) return new Response('Not found', { status: 404 });

    let relative = decodeURIComponent(url.pathname);
    if (relative === '' || relative === '/') relative = '/index.html';
    const filePath = path.resolve(root, `.${path.posix.normalize(relative)}`);
    if (!filePath.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });

    try {
      const data = await fs.promises.readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
