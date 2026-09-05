/**
 * Put the environment files in place before anything needs them.
 *
 * Three tools read three different files: the API and the seed read `.env`
 * (both at the root and in apps/api, because the Prisma CLI looks beside the
 * schema), and Next reads apps/web/.env.local. Rather than ask somebody to copy
 * the same values into three places, this derives all of them from
 * .env.example. Existing files are never overwritten.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(root, '.env.example');

if (!existsSync(example)) {
  console.error('.env.example is missing, so there is nothing to copy from.');
  process.exit(1);
}

const rootEnv = join(root, '.env');
if (existsSync(rootEnv)) {
  console.log('.env is already there, leaving it alone.');
} else {
  copyFileSync(example, rootEnv);
  console.log('Created .env from .env.example.');
}

// The Prisma CLI resolves .env relative to where it runs, which is apps/api.
const apiEnv = join(root, 'apps', 'api', '.env');
if (existsSync(apiEnv)) {
  console.log('apps/api/.env is already there, leaving it alone.');
} else {
  copyFileSync(rootEnv, apiEnv);
  console.log('Created apps/api/.env.');
}

// Next only exposes variables prefixed NEXT_PUBLIC_, and only from its own file.
const webEnv = join(root, 'apps', 'web', '.env.local');
if (existsSync(webEnv)) {
  console.log('apps/web/.env.local is already there, leaving it alone.');
} else {
  const apiUrl =
    readFileSync(rootEnv, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('NEXT_PUBLIC_API_URL='))
      ?.slice('NEXT_PUBLIC_API_URL='.length)
      .trim() || 'http://localhost:4000';

  writeFileSync(webEnv, `NEXT_PUBLIC_API_URL=${apiUrl}\n`);
  console.log('Created apps/web/.env.local.');
}

if (readFileSync(rootEnv, 'utf8').includes('change-me-access-secret')) {
  console.log('');
  console.log('Heads up: the JWT secrets in .env are the example ones.');
  console.log('Change both before this runs anywhere other than your machine.');
}
