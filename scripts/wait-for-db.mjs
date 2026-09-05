/**
 * Wait for the database to accept connections.
 *
 * `docker compose up -d` returns as soon as the containers are started, which
 * is well before Postgres is ready to talk. Without this, the migration in the
 * setup script races the database on a cold start and fails on a machine that
 * has just pulled the image.
 */

import { createConnection } from 'node:net';

const HOST = process.env.DB_HOST ?? 'localhost';
const PORT = Number(process.env.DB_PORT ?? 5433);
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6380);
const TIMEOUT_MS = 90_000;

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(label, port) {
  const started = Date.now();
  process.stdout.write(`Waiting for ${label} on ${HOST}:${port}`);

  while (Date.now() - started < TIMEOUT_MS) {
    if (await canConnect(port)) {
      process.stdout.write(' ready\n');
      return true;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  process.stdout.write(' gave up\n');
  return false;
}

const postgres = await waitFor('PostgreSQL', PORT);
const redis = await waitFor('Redis', REDIS_PORT);

if (!postgres || !redis) {
  console.error('');
  console.error('The containers did not come up. Check `docker compose ps` and `docker compose logs`.');
  process.exit(1);
}
