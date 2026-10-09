/** Tiny semantic-version comparison for update checks. Build metadata is ignored. */

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

export function parseVersion(input: string): ParsedVersion | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim());
  if (!match) return null;
  return {
    core: match[1].split('.').map((part) => Number.parseInt(part, 10)),
    prerelease: match[2] ? match[2].split('.') : [],
  };
}

/** Returns a negative number when a < b, 0 when equal, positive when a > b. Unparseable input sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  const length = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // A release outranks its own pre-release (1.2.0 > 1.2.0-rc.1).
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;
  const preLength = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < preLength; i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== null) {
      return -1;
    } else if (ny !== null) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
