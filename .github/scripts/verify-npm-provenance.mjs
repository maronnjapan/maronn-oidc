import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

export function assertPublishedPackageProvenance(publishedPackages, auditResult) {
  const verified = Array.isArray(auditResult?.verified) ? auditResult.verified : [];
  const missing = publishedPackages.filter(({ name, version }) => {
    return !verified.some((entry) => {
      return (
        entry?.name === name &&
        entry?.version === version &&
        entry?.attestations?.provenance?.predicateType === SLSA_PROVENANCE_V1
      );
    });
  });

  if (missing.length > 0) {
    const packageVersions = missing.map(({ name, version }) => `${name}@${version}`);
    throw new Error(
      `Missing verified SLSA provenance attestation for: ${packageVersions.join(', ')}`,
    );
  }
}

function parsePublishedPackages(value) {
  const publishedPackages = JSON.parse(value ?? '[]');
  if (!Array.isArray(publishedPackages) || publishedPackages.length === 0) {
    throw new Error('PUBLISHED_PACKAGES must contain at least one published package');
  }

  const names = new Set();
  for (const { name, version } of publishedPackages) {
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      typeof version !== 'string' ||
      version.length === 0
    ) {
      throw new Error('Each published package must include non-empty string name and version values');
    }
    if (names.has(name)) {
      throw new Error(`PUBLISHED_PACKAGES contains duplicate package name: ${name}`);
    }
    names.add(name);
  }

  return publishedPackages;
}

function verifyPublishedPackages() {
  const publishedPackages = parsePublishedPackages(process.env.PUBLISHED_PACKAGES);
  const dependencies = Object.fromEntries(
    publishedPackages.map(({ name, version }) => [name, version]),
  );
  const verificationDirectory = mkdtempSync(join(tmpdir(), 'maronn-npm-provenance-'));

  try {
    writeFileSync(
      join(verificationDirectory, 'package.json'),
      `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`,
    );
    execFileSync('npm', ['install', '--ignore-scripts', '--package-lock=true'], {
      cwd: verificationDirectory,
      stdio: 'inherit',
    });
    const auditOutput = execFileSync(
      'npm',
      ['audit', 'signatures', '--json', '--include-attestations'],
      {
        cwd: verificationDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    const auditResult = JSON.parse(auditOutput);
    assertPublishedPackageProvenance(publishedPackages, auditResult);
    console.log(
      `Verified SLSA provenance for ${publishedPackages
        .map(({ name, version }) => `${name}@${version}`)
        .join(', ')}`,
    );
  } finally {
    rmSync(verificationDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublishedPackages();
}
