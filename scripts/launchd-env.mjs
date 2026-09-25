#!/usr/bin/env node
// Render ~/.sampolio/launchd.env (sourced by scripts/launchd-run.sh) to stdout.
// Used by `SAMPOLIO_LAUNCHD_DOMAIN=system ./scripts/install-launchd.sh`, which
// writes the output to a 0600 file. Values never reach the terminal.
//
//   node scripts/launchd-env.mjs from-plist <plist>   the plist's EnvironmentVariables, minus PATH
//   node scripts/launchd-env.mjs from-env KEY...      those keys from this process's env (empty ones skipped)
//
// Every value is single-quoted for bash, so `set -a; . launchd.env` restores it
// byte for byte.
import { execFileSync } from 'node:child_process';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

const [mode, ...rest] = process.argv.slice(2);
let entries;
let source;
if (mode === 'from-plist' && rest.length === 1) {
  const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', rest[0]], {
    encoding: 'utf8',
  });
  const env = JSON.parse(json).EnvironmentVariables ?? {};
  entries = Object.keys(env)
    .sort()
    .filter((k) => k !== 'PATH')
    .map((k) => [k, env[k]]);
  source = 'the gui plist env block';
} else if (mode === 'from-env' && rest.length > 0) {
  entries = rest.filter((k) => process.env[k]).map((k) => [k, process.env[k]]);
  source = '~/sampolio/.env and the data-dir fallbacks';
} else {
  console.error('usage: launchd-env.mjs from-plist <plist> | from-env KEY...');
  process.exit(64);
}

const bad = entries.find(([k, v]) => !NAME.test(k) || /[\0\n]/.test(String(v)));
if (bad) {
  console.error(`launchd-env: refusing variable ${JSON.stringify(bad[0])} (bad name, or a newline/NUL in its value)`);
  process.exit(65);
}
if (!entries.some(([k]) => k === 'ENCRYPTION_KEY')) {
  console.error('launchd-env: no ENCRYPTION_KEY in the source; refusing to write an env file without it');
  process.exit(65);
}

process.stdout.write(
  [
    '# Sampolio launchd env, sourced by scripts/launchd-run.sh. Owner-only (0600).',
    `# Written by install-launchd.sh (SAMPOLIO_LAUNCHD_DOMAIN=system) from ${source}.`,
    ...entries.map(([k, v]) => `${k}=${quote(v)}`),
    '',
  ].join('\n'),
);
