import { describe, expect, it, vi } from 'vitest';
import { checkForUpdates, RELEASES_PAGE } from '../src/main/updates';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('checkForUpdates', () => {
  it('reports a newer GitHub release', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { tag_name: 'v1.2.0', html_url: 'https://github.com/example/release' }));
    const info = await checkForUpdates('1.1.0', fetchImpl as unknown as typeof fetch);
    expect(info).toMatchObject({ latestVersion: '1.2.0', updateAvailable: true, releaseUrl: 'https://github.com/example/release', error: null });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/releases/latest'), expect.any(Object));
  });

  it('says so when the current build is the latest', async () => {
    const info = await checkForUpdates('1.2.0', (async () => jsonResponse(200, { tag_name: 'v1.2.0' })) as unknown as typeof fetch);
    expect(info.updateAvailable).toBe(false);
  });

  it('treats “no releases yet” as a normal state', async () => {
    const info = await checkForUpdates('1.0.0', (async () => jsonResponse(404, { message: 'Not Found' })) as unknown as typeof fetch);
    expect(info).toMatchObject({ latestVersion: null, updateAvailable: false, error: null, releaseUrl: RELEASES_PAGE });
  });

  it('reports HTTP and network failures without throwing', async () => {
    const http = await checkForUpdates('1.0.0', (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch);
    expect(http.error).toContain('503');
    const offline = await checkForUpdates('1.0.0', (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    }) as unknown as typeof fetch);
    expect(offline.error).toContain('Could not reach GitHub');
  });
});
