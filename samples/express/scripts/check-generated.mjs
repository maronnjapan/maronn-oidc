import { execFileSync } from 'node:child_process';

if (!isTracked('package.json')) {
  process.exit(0);
}

const status = execFileSync(
  'git',
  ['status', '--porcelain', '--', 'src/oidc-provider'],
  { encoding: 'utf8' },
).trim();

if (status.length > 0) {
  console.error('Generated OpenID Provider output is out of date:');
  console.error(status);
  process.exit(1);
}

function isTracked(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}
