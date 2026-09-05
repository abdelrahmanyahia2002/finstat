/**
 * Record the product walkthrough.
 *
 * Drives the real app in Chrome and captures the screen with the DevTools
 * screencast, which pushes a frame whenever the page repaints. Frames carry
 * their own timestamps, so the encoder can rebuild the true timing instead of
 * guessing at a frame rate.
 *
 * Captions are injected into the page rather than burned in afterwards. That
 * keeps them in the same coordinate space as the app, so they never drift out
 * of sync with what is on screen.
 *
 *   node scripts/record-demo.mjs
 *
 * Needs both servers running and the seeded demo company present.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES = join(ROOT, '.demo-frames');
const OUT_DIR = join(ROOT, 'docs');

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@finstat.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';

const WIDTH = 1440;
const HEIGHT = 900;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.error('Could not find Chrome. Set CHROME_PATH to its executable.');
  process.exit(1);
}

/**
 * Find ffmpeg.
 *
 * A winget install does not reach a shell that was already open, so falling
 * back to the package location saves anyone recording right after installing
 * it from having to open a new terminal.
 */
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    // Not on PATH; look where winget puts it.
  }

  const local = process.env.LOCALAPPDATA;
  if (local) {
    const packages = join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const entry of readdirSync(packages)) {
        if (!entry.startsWith('Gyan.FFmpeg')) continue;
        for (const build of readdirSync(join(packages, entry))) {
          const candidate = join(packages, entry, build, 'bin', 'ffmpeg.exe');
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Nothing there; fall through to the error below.
    }
  }

  console.error('Could not find ffmpeg. Install it, or set FFMPEG_PATH to its executable.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Talking to the API directly, for setup and teardown around the recording
// ---------------------------------------------------------------------------

let token = '';

async function api(path, options = {}) {
  const response = await fetch(`${API}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (response.status === 204) return null;
  return response.json();
}

async function resetDemoState() {
  const session = await api('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  token = session.accessToken;

  const companies = await api('/companies');
  const company = companies.find((c) => c.name === 'Northwind Trading Ltd');
  if (!company) throw new Error('The seeded demo company is missing. Run npm run db:seed.');

  // A previous recording or smoke test may have left the carried forward year
  // behind, and the walkthrough creates it on camera.
  const years = await api(`/companies/${company.id}/years`);
  for (const year of years.filter((y) => y.label === 'FY2026')) {
    await api(`/companies/${company.id}/years/${year.id}`, { method: 'DELETE' });
  }

  const refreshed = await api(`/companies/${company.id}/years`);
  const current = refreshed.find((y) => y.label === 'FY2025');
  if (!current) throw new Error('FY2025 is missing from the seeded company.');

  // A recording that stopped part way through can leave the pasted rows behind.
  await clearPastedRows(company.id, current.id);

  return { companyId: company.id, yearId: current.id };
}

/** Zero the two accounts the walkthrough pastes into, so state is repeatable. */
async function clearPastedRows(companyId, yearId) {
  const trialBalance = await api(`/companies/${companyId}/years/${yearId}/trial-balance`);
  const entries = trialBalance.rows
    .filter((row) => row.code === '1520' || row.code === '2780')
    .map((row) => ({ accountId: row.accountId, debit: 0, credit: 0 }));

  if (entries.length === 0) return;

  await api(`/companies/${companyId}/years/${yearId}/trial-balance`, {
    method: 'PUT',
    body: { entries },
  });
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const frames = [];
let frameIndex = 0;

async function startRecording(page) {
  const client = await page.createCDPSession();

  client.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    const name = `frame-${String(frameIndex).padStart(5, '0')}.jpg`;
    writeFileSync(join(FRAMES, name), Buffer.from(data, 'base64'));
    frames.push({ name, timestamp: metadata.timestamp });
    frameIndex += 1;

    // Acknowledging is what asks Chrome for the next frame. Dropping this
    // silently ends the stream after one frame.
    try {
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch {
      // The session closes at the end of the run; nothing to do.
    }
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: 1,
  });

  return client;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

const CAPTION_ID = 'finstat-demo-caption';

/**
 * The caption bar lives inside the page so it is captured with everything
 * else. Pointer events are off so it can never intercept a click the script is
 * trying to make.
 */
async function installCaption(page) {
  await page.evaluate((id) => {
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.textContent = `
      #${id} {
        position: fixed;
        left: 24px;
        bottom: 24px;
        z-index: 2147483647;
        max-width: 620px;
        padding: 10px 18px;
        border-radius: 999px;
        background: rgba(21, 29, 49, 0.94);
        color: #fff;
        font: 500 14px/1.4 ui-sans-serif, system-ui, 'Segoe UI', sans-serif;
        letter-spacing: 0.01em;
        box-shadow: 0 8px 28px rgba(21, 29, 49, 0.28);
        pointer-events: none;
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 260ms ease, transform 260ms ease;
      }
      #${id}.visible { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);

    const node = document.createElement('div');
    node.id = id;
    document.body.appendChild(node);
  }, CAPTION_ID);
}

async function caption(page, text) {
  await installCaption(page);
  await page.evaluate(
    (id, value) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.textContent = value;
      node.classList.add('visible');
    },
    CAPTION_ID,
    text,
  );
}

async function clearCaption(page) {
  await page.evaluate((id) => {
    document.getElementById(id)?.classList.remove('visible');
  }, CAPTION_ID);
}

const beat = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scroll in small steps so the capture reads as motion rather than a jump. */
async function glide(page, distance, steps = 26) {
  const step = distance / steps;
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((amount) => window.scrollBy(0, amount), step);
    await beat(22);
  }
}

async function goTo(page, path, waitFor) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle2' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20_000 });

  // networkidle2 fires while the first render is still a spinner, so the
  // recording would otherwise catch a loading state and hold a caption over
  // it. Wait until every spinner on the page has gone.
  await page
    .waitForFunction(() => document.querySelectorAll('.animate-spin').length === 0, {
      timeout: 20_000,
    })
    .catch(() => undefined);

  await installCaption(page);
}

/** Click whichever element contains this text, since the UI has no test ids. */
async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, needle) =>
      [...document.querySelectorAll(sel)].find((node) =>
        node.textContent?.trim().toLowerCase().includes(needle.toLowerCase()),
      ) ?? null,
    selector,
    text,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`Could not find a ${selector} containing "${text}".`);
  await element.click();
}

// ---------------------------------------------------------------------------
// The walkthrough
// ---------------------------------------------------------------------------

async function walkthrough(page, { companyId, yearId }) {
  const year = `/c/${companyId}/y/${yearId}`;

  // ---- Sign in ----
  await goTo(page, '/login', 'input[type="email"]');
  await caption(page, 'FinStat — annual financial statements, from the trial balance up');
  await beat(2600);

  await clearCaption(page);
  await page.type('input[type="email"]', EMAIL, { delay: 55 });
  await page.type('input[type="password"]', PASSWORD, { delay: 55 });
  await beat(500);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => undefined),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForSelector('h1', { timeout: 20_000 });
  await installCaption(page);
  await caption(page, 'Every company you work on, with the year you left off in');
  await beat(2600);

  // ---- Company overview ----
  await goTo(page, `/c/${companyId}`, 'h1');
  await caption(page, 'One company, two financial years, a chart of accounts behind both');
  await beat(3000);

  // ---- Chart of accounts ----
  await goTo(page, `/c/${companyId}/accounts`, 'table');
  await caption(page, 'Every account maps to one line in the statements. That mapping drives everything');
  await beat(2400);
  await glide(page, 520);
  await beat(1800);

  // ---- Trial balance ----
  await goTo(page, `${year}/trial-balance`, 'table');
  await caption(page, 'The trial balance. Type into it, and the totals move as you go');
  await beat(2800);
  await glide(page, 420);
  await beat(1600);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await beat(700);

  // ---- Paste from Excel ----
  await caption(page, 'Or paste a block straight out of Excel');
  await beat(1400);
  await clickByText(page, 'button', 'Paste from Excel');
  await page.waitForSelector('textarea', { timeout: 10_000 });
  await beat(900);

  // Both amounts sit in the debit column: the bracketed one is a negative
  // debit, which is a credit, so the block balances. That is the point being
  // demonstrated, and it keeps the trial balance right on camera.
  const block = [
    'Code\tAccount name\tDebit\tCredit',
    '1520\tPetty cash\t1,500.00\t',
    '2780\tAccrued expenses\t(1,500.00)\t',
  ].join('\n');

  await page.type('textarea', block, { delay: 22 });
  await beat(1000);
  await caption(page, 'It reads headings, thousands separators, and brackets as negatives');
  await beat(2400);

  await clickByText(page, 'button', 'Check it first');
  await beat(1800);
  await caption(page, 'Nothing is written until you have seen exactly what it would do');
  await beat(2600);

  await clickByText(page, 'button', 'Apply');
  await beat(2400);
  await caption(page, 'Applied, and the trial balance still balances');
  await beat(2400);

  // Put the figures back, so the scenes after this show the seeded company and
  // the recording can be run again from the same starting point.
  await clearPastedRows(companyId, yearId);

  // ---- Debtors ----
  await goTo(page, `${year}/debtors`, 'table');
  await caption(page, 'The debtors listing, aged, agreeing to its control account to the cent');
  await beat(3400);

  // ---- Statements ----
  await goTo(page, `${year}/statements`, 'table');
  await caption(page, 'The statements are computed from that trial balance every time you open them');
  await beat(3000);
  await clearCaption(page);
  await glide(page, 700, 34);
  await beat(1400);
  await caption(page, 'Balance sheet, with last year alongside and note numbers threaded through');
  await beat(2600);
  await clearCaption(page);
  await glide(page, 900, 40);
  await beat(1200);
  await caption(page, 'Profit and loss, worked down to profit for the year');
  await beat(2600);
  await clearCaption(page);
  await glide(page, 900, 40);
  await beat(1200);
  await caption(page, 'And a cash flow statement that reconciles to the movement in cash exactly');
  await beat(3400);

  // ---- Validation ----
  await goTo(page, `${year}/validation`, 'h1');
  await caption(page, 'The checks a reviewer would run by hand, before anything is signed off');
  await beat(3600);

  // ---- Notes ----
  await goTo(page, `${year}/notes`, 'h1');
  await caption(page, 'Notes: policies you write, and supporting notes built from the figures');
  await beat(2800);
  await clearCaption(page);
  await glide(page, 800, 36);
  await beat(1600);
  await caption(page, 'Each one has to tie back to the face of the statements');
  await beat(2600);

  // ---- Reports ----
  await goTo(page, `${year}/reports`, 'h1');
  await caption(page, 'PDF and Excel, built in the background so you can carry on working');
  await beat(2600);
  await clickByText(page, 'button', 'Generate');
  await beat(3600);
  await caption(page, 'A full annual financial statements pack, ready to download');
  await beat(3000);

  // ---- Carry forward ----
  await goTo(page, `/c/${companyId}/years`, 'table');
  await caption(page, 'And when the year is done, it opens the next one');
  await beat(2200);
  await clickByText(page, 'button', 'Carry forward');
  await page.waitForSelector('input[type="date"]', { timeout: 10_000 });
  await beat(1400);
  await caption(page, 'Balance sheet accounts open where they closed. Profit and loss starts at nil');
  await beat(3200);

  await clickByText(page, 'div[role="dialog"] button', 'Carry forward');
  await beat(3200);
  await caption(page, 'Retained earnings, the listings and the policy notes all come across');
  await beat(3200);

  // ---- Close ----
  await goTo(page, `/c/${companyId}`, 'h1');
  await caption(page, 'FinStat — Next.js, NestJS, PostgreSQL, Prisma, Redis, ExcelJS, pdfmake');
  await beat(3600);
  await clearCaption(page);
  await beat(900);
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function encode() {
  if (frames.length < 2) {
    throw new Error('Barely any frames were captured, so there is nothing to encode.');
  }

  // Screencast frames arrive only when the page repaints, so their spacing is
  // the real timing of the walkthrough. The concat demuxer replays that
  // spacing; the fps filter then resamples it to a constant rate.
  const lines = [];
  for (let i = 0; i < frames.length; i += 1) {
    const next = frames[i + 1];
    const duration = next
      ? Math.max(0.016, Math.min(4, next.timestamp - frames[i].timestamp))
      : 1.2;
    lines.push(`file '${frames[i].name}'`);
    lines.push(`duration ${duration.toFixed(4)}`);
  }
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file '${frames[frames.length - 1].name}'`);

  const listPath = join(FRAMES, 'frames.txt');
  writeFileSync(listPath, lines.join('\n'));

  mkdirSync(OUT_DIR, { recursive: true });
  const mp4 = join(OUT_DIR, 'demo.mp4');
  const gif = join(OUT_DIR, 'demo.gif');
  const palette = join(FRAMES, 'palette.png');

  const ffmpeg = resolveFfmpeg();
  const run = (args) =>
    execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      stdio: 'inherit',
    });

  console.log('Encoding the video');
  run([
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-vf', 'fps=24,scale=1440:-2:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '24',
    // Lets the file start playing before it has fully downloaded.
    '-movflags', '+faststart',
    mp4,
  ]);

  console.log('Encoding the looping preview');
  // A generated palette is what keeps a GIF of a mostly-white UI from banding.
  run([
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-vf', 'fps=12,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff',
    palette,
  ]);
  run([
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-i', palette,
    '-lavfi', 'fps=12,scale=900:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0',
    gif,
  ]);

  return { mp4, gif };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('Resetting the demo company');
  const target = await resetDemoState();

  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  console.log('Opening Chrome');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--disable-features=TranslateUI',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  const client = await startRecording(page);

  try {
    console.log('Recording the walkthrough');
    await walkthrough(page, target);
  } finally {
    await client.send('Page.stopScreencast').catch(() => undefined);
    await beat(400);
    await browser.close();
  }

  const seconds = frames.length
    ? (frames[frames.length - 1].timestamp - frames[0].timestamp).toFixed(1)
    : 0;
  console.log(`Captured ${frames.length} frames over ${seconds}s`);

  const output = encode();

  // Clean up after teardown, so a failed encode leaves the frames to debug.
  await api(`/companies/${target.companyId}/years`).then(async (years) => {
    for (const y of years.filter((candidate) => candidate.label === 'FY2026')) {
      await api(`/companies/${target.companyId}/years/${y.id}`, { method: 'DELETE' });
    }
  });

  rmSync(FRAMES, { recursive: true, force: true });

  console.log('');
  console.log(`Video: ${output.mp4}`);
  console.log(`Loop:  ${output.gif}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
