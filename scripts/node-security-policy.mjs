// Assessed LTS security floors: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
const minimumVersions = new Map([[22, [23, 4]], [24, [22, 1]], [26, [12, 1]]]);

export function assertSecureNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match) {
    const [major, minor, patch] = match.slice(1).map(Number);
    const minimum = minimumVersions.get(major);
    if (minimum && (minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1]))) return;
  }
  throw new Error(`Unsupported bundled Node ${version}; use patched LTS Node 22.23.4+, 24.22.1+, or 26.12.1+ within those major lines. Rebuild the Player package; its runtime is independent of system Node.`);
}
