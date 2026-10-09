import { compareVersions } from '../shared/semver';
import type { UpdateInfo } from '../shared/types';

export const UPDATE_REPOSITORY = 'vamshicodingmt-gif/Auraflow';
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPOSITORY}/releases`;

/** Checks the latest published GitHub release. Never throws; failures are reported in the result. */
export async function checkForUpdates(currentVersion: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: RELEASES_PAGE,
    error: null,
  };
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `AuraFlow-Goth-Edition/${currentVersion}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return base;
    if (!response.ok) return { ...base, error: `GitHub responded with HTTP ${response.status}.` };
    const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const latest = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : null;
    const url = typeof data.html_url === 'string' ? data.html_url : RELEASES_PAGE;
    return {
      ...base,
      latestVersion: latest,
      releaseUrl: url,
      updateAvailable: latest !== null && compareVersions(latest, currentVersion) > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ...base, error: `Could not reach GitHub (${message}).` };
  }
}
