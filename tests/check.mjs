#!/usr/bin/env node
// SellerKit check: the feedback loop for this repo.
//
//   node tests/check.mjs            static checks + real-browser checks + screenshots
//   node tests/check.mjs --static   static checks only (no browser, ~1s) — what the edit hook runs
//   node tests/check.mjs --static toolkit.html   limit static checks to named files
//
// Exit 0 = clean, 1 = failures (printed one per line, prefixed ✗).
// Screenshots land in .checks/ (gitignored) so a change can be looked at, not just asserted.

import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, extname, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const STATIC_ONLY = args.includes('--static');
const onlyFiles = args.filter(a => !a.startsWith('--')).map(f => basename(f));

const PAGES = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
// Pages that report errors to Sentry. checkout.html is deliberately excluded (Stripe's page).
const SENTRY_PAGES = ['index.html', 'success.html', 'toolkit.html'];
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const read = f => readFileSync(join(ROOT, f), 'utf8');

// What Vercel deploys: .vercelignore ignores the whole root (`/*`), then re-includes each
// site file with `!/name`. Anything else (CLAUDE.md, .claude/, tests/ …) is not published.
const VERCELIGNORE = existsSync(join(ROOT, '.vercelignore')) ? read('.vercelignore') : '';
const SHIPPED = new Set([...VERCELIGNORE.matchAll(/^!\/([^\s/]+)$/gm)].map(m => m[1]));

// ─── Static checks ────────────────────────────────────────────────────────────

function staticChecks() {
  const htmlTargets = onlyFiles.length ? PAGES.filter(p => onlyFiles.includes(p)) : PAGES;
  const textTargets = readdirSync(ROOT).filter(f => /\.(html|css|js|mjs|md|json|txt)$/.test(f));

  for (const page of htmlTargets) {
    const src = read(page);

    // Every icon reference must resolve in this page's own sprite.
    const symbols = new Set([...src.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map(m => m[1]));
    const refs = new Set([
      ...[...src.matchAll(/<use\s+href="#([a-z0-9-]+)"/g)].map(m => m[1]),
      ...[...src.matchAll(/\bic\(\s*'([a-z0-9-]+)'\s*\)/g)].map(m => 'i-' + m[1]),
    ]);
    for (const r of refs) if (!symbols.has(r)) fail(page, `icon #${r} is referenced but not in the page's sprite`);

    // Inline scripts must at least parse.
    for (const m of src.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/type="(application\/ld\+json|module)"/.test(m[1])) continue;
      try { new vm.Script(m[2], { filename: page }); }
      catch (e) { fail(page, `inline <script> does not parse: ${e.message}`); }
    }

    if (/fonts\.(googleapis|gstatic)\.com/.test(src)) fail(page, 'Google Fonts link — Inter is vendored, see CLAUDE.md');
    if (/class="[^"]*\breveal\b[^"]*"/.test(src)) fail(page, 'hand-written class="reveal" — only JS may add it');

    // Duplicate ids in the static markup (getElementById then resolves to the wrong one).
    const ids = [...src.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    const seen = new Set();
    for (const id of ids) { if (seen.has(id)) fail(page, `duplicate id="${id}"`); seen.add(id); }
  }

  // Error reporting is wired on exactly these pages, library first, before any page script.
  for (const page of htmlTargets) {
    const src = read(page);
    const lib = src.indexOf('<script src="sentry.min.js"></script>');
    const init = src.indexOf('<script src="sentry-init.js"></script>');
    if (SENTRY_PAGES.includes(page)) {
      if (lib < 0 || init < 0) fail(page, 'missing the sentry.min.js / sentry-init.js tags');
      else if (init < lib || init > src.indexOf('</head>')) fail(page, 'sentry-init.js must follow sentry.min.js inside <head>');
    } else if (/sentry/i.test(src.replace(/<!--[\s\S]*?-->/g, '')) && page !== 'privacy.html') {
      fail(page, 'loads Sentry, but it is only meant for ' + SENTRY_PAGES.join(', '));
    }
  }

  // Standalone scripts must parse.
  for (const f of readdirSync(ROOT).filter(f => f.endsWith('.js'))) {
    try { new vm.Script(read(f), { filename: f }); }
    catch (e) { fail(f, `does not parse: ${e.message}`); }
  }

  // Deploy allowlist: every page and every file a shipped file references must be published,
  // and nothing internal may be. Otherwise it is a 404, or a leak, that only shows up live.
  if (!/^\/\*$/m.test(VERCELIGNORE)) fail('.vercelignore', 'missing, or no `/*` rule — the whole repo would be published');
  for (const f of SHIPPED) {
    if (!existsSync(join(ROOT, f))) fail('.vercelignore', `ships ${f}, which does not exist`);
    if (/^\.|\.(mjs|json|yml)$/.test(f) || (f.endsWith('.md') && f !== 'NOTICE.md')) fail('.vercelignore', `ships ${f}, which is internal`);
  }
  for (const page of PAGES) if (!SHIPPED.has(page)) fail('.vercelignore', `${page} is not shipped`);
  // Relative references, plus absolute ones to our own origin (og:image is only ever the
  // latter). The origin comes from index.html's canonical link, so a domain move follows.
  const origin = (read('index.html').match(/rel="canonical" href="(https?:\/\/[^/"]+)\//) || [])[1];
  if (!origin) fail('index.html', 'no canonical link to read the site origin from');
  const own = origin ? '|' + origin.replace(/[.]/g, '\\.') + '/' : '';
  const REF = new RegExp(`(?:["'(]${own})([A-Za-z0-9_.-]+\\.(?:html|css|js|png|webp|svg|woff2|txt|md|json|ico))(?=[?#"')])`, 'g');
  for (const f of [...SHIPPED].filter(f => /\.(html|css|js)$/.test(f) && f !== 'sentry.min.js' && existsSync(join(ROOT, f)))) {
    for (const r of new Set([...read(f).matchAll(REF)].map(m => m[1])))
      if (!SHIPPED.has(r)) fail(f, `references ${r}, which .vercelignore does not ship`);
  }

  // Secret keys must never be committed; only publishable keys are allowed.
  for (const f of textTargets) {
    if (/\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/.test(read(f))) fail(f, 'contains a Stripe secret/restricted key');
  }
}

// ─── Browser checks ───────────────────────────────────────────────────────────

function loadPlaywright() {
  const tries = [join(ROOT, 'package.json')];
  try { tries.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js')); } catch {}
  for (const base of tries) {
    try { return createRequire(base)('playwright'); } catch {}
  }
  return null;
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/plain' };

function serve() {
  return new Promise(res => {
    const srv = createServer((req, rsp) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = join(ROOT, p);
      // Serve only what Vercel publishes, so a file missing from .vercelignore 404s here too.
      if (!SHIPPED.has(p) || !existsSync(file)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      rsp.end(readFileSync(file));
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

async function browserChecks() {
  const pw = loadPlaywright();
  if (!pw) { fail('setup', 'playwright not found — run `npm install` (or use --static)'); return; }
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const shots = join(ROOT, '.checks');
  mkdirSync(shots, { recursive: true });

  const launch = { headless: true };
  if (existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
  let browser;
  try { browser = await pw.chromium.launch(launch); }
  catch { delete launch.executablePath; browser = await pw.chromium.launch(launch); }

  const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

  async function open(path, vpName) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName] });
    const page = await ctx.newPage();
    const errs = [];
    // Third-party hosts (Stripe) are unreachable in the sandbox; only first-party problems count.
    await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    page.on('pageerror', e => errs.push(`uncaught: ${e.message}`));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url || '';
      if (url && !url.startsWith(base)) return;
      if (/net::ERR_FAILED|ERR_BLOCKED/.test(m.text())) return;
      errs.push(`console.error: ${m.text()}`);
    });
    // On 127.0.0.1 sentry-init.js disables sending; a request here means that guard broke.
    page.on('request', r => { if (/sentry\.io/.test(r.url())) errs.push(`request to Sentry from a local page: ${r.url().slice(0, 80)}`); });
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) errs.push(`${r.status()} ${r.url().slice(base.length)}`); });
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    return { ctx, page, errs };
  }

  async function noHorizontalScroll(page, where) {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) fail(where, `page scrolls horizontally by ${over}px`);
  }

  for (const file of PAGES) {
    for (const vp of Object.keys(VIEWPORTS)) {
      const path = file === 'toolkit.html' ? 'toolkit.html?access=SKPRO500' : file;
      const { ctx, page, errs } = await open(path, vp);
      const where = `${file} [${vp}]`;
      await noHorizontalScroll(page, where);
      await page.screenshot({ path: join(shots, `${file.replace('.html', '')}-${vp}.png`), fullPage: file !== 'toolkit.html' });

      if (SENTRY_PAGES.includes(file) && vp === 'desktop') {
        const st = await page.evaluate(() => {
          const c = window.Sentry && Sentry.getClient && Sentry.getClient();
          return { client: !!c, enabled: c ? c.getOptions().enabled : null, local: window.skSentry && skSentry.local };
        });
        if (!st.client) fail(where, 'Sentry did not initialise');
        else if (st.enabled !== false || st.local !== true) fail(where, 'Sentry is not disabled on a local server');
      }

      if (file === 'toolkit.html') {
        if (await page.evaluate(() => document.documentElement.classList.contains('sk-locked')))
          fail(where, 'still locked after ?access=SKPRO500');
        const panels = await page.$$eval('[data-panel]', els => [...new Set(els.map(e => e.dataset.panel))]);
        for (const id of panels) {
          await page.evaluate(id => showPanel(id), id);
          // Wait out the .16s fade rather than sampling mid-animation.
          const ok = await page.waitForFunction(id => {
            const p = document.getElementById('panel-' + id);
            return p && p.classList.contains('active') && p.offsetHeight > 0 && getComputedStyle(p).opacity === '1';
          }, id, { timeout: 1500 }).then(() => true, () => false);
          if (!ok) fail(where, `panel "${id}" did not become visible`);
          await noHorizontalScroll(page, `${where} panel ${id}`);
          if (vp === 'desktop' || ['home', 'pricing'].includes(id))
            await page.screenshot({ path: join(shots, `toolkit-${id}-${vp}.png`) });
        }
        if (vp === 'mobile') {
          // < 900px the sidebar becomes a fixed bottom tab bar; it has broken twice before.
          const bar = await page.evaluate(() => {
            const n = document.querySelector('.tk-sidebar');
            if (!n) return null;
            const r = n.getBoundingClientRect();
            return { pos: getComputedStyle(n).position, bottom: Math.round(r.bottom), vh: innerHeight };
          });
          if (!bar) fail(where, 'no .tk-sidebar found');
          else if (bar.pos !== 'fixed' || Math.abs(bar.bottom - bar.vh) > 2)
            fail(where, `nav is not a fixed bottom bar (position=${bar.pos}, bottom=${bar.bottom}, vh=${bar.vh})`);
        }
      }
      for (const e of errs) fail(where, e);
      await ctx.close();
    }
  }

  await sentryEndToEnd(pw, launch, srv.address().port);

  // The gate must actually gate.
  {
    const { ctx, page, errs } = await open('toolkit.html?lock=1', 'desktop');
    if (!(await page.evaluate(() => document.documentElement.classList.contains('sk-locked'))))
      fail('toolkit.html ?lock=1', 'gate did not lock');
    await page.screenshot({ path: join(shots, 'toolkit-locked.png') });
    for (const e of errs) fail('toolkit.html ?lock=1', e);
    await ctx.close();
  }

  // Sold comps: the parser and the outlier rule set the three prices, so their cases are
  // pinned here, then one real paste is driven through the page at both widths.
  {
    const EBAY_BLOCK = [
      'Nintendo Switch OLED White 64GB', 'Pre-Owned', 'Sold  Sep 12, 2026', '$245.00', 'or Best Offer',
      '+$15.00 delivery', 'Located in United States',
      'Nintendo Switch OLED Neon', 'Sold  Sep 10, 2026', '$260.00', 'Free delivery',
      'Switch OLED bundle', 'Sold  Sep 9, 2026', '$239.99', 'Was: $299.99', '+$12.99 shipping',
      'Switch OLED', '$250.00 to $270.00', 'Switch OLED for parts', '$40.00', '$255.00',
    ].join('\n');
    const CASES = [
      // [label, text, kept values, skipped reasons]
      ['eBay block', EBAY_BLOCK, [40, 239.99, 245, 250, 255, 260], ['delivery', 'old price', 'shipping', 'top of range']],
      ['Facebook price cut', '$150$200\n$160\n$170', [150, 160, 170], ['earlier price']],
      ['no $, last number per line', 'Sold Sep 12 45\n2 bids 60\n48.50\nshipping 9', [45, 48.5, 60], ['shipping']],
      ['discount and extra cost', '$80 $20 off\nSave $10\n$90\n+$5', [80, 90], ['discount', 'discount', 'extra cost']],
      ['typed list with commas', '$45, $52, $48', [45, 48, 52], []],
    ];
    const STATS = [
      // [label, values, median, low, outliers]
      ['one $15 parts sale among $200s', [15, 195, 200, 205, 210, 220], 205, 195, [15]],
      ['three comps: nothing set aside', [15, 200, 210], 200, 15, []],
      ['tight cluster keeps the $101', [100, 100, 100, 100, 101], 100, 100, []],
      ['two items mixed: nothing set aside', [50, 55, 60, 200, 210, 220], 130, 50, []],
    ];
    const { ctx, page, errs } = await open('toolkit.html?access=SKPRO500', 'desktop');
    const where = 'toolkit.html comps';
    const got = await page.evaluate(([cases, stats]) => ({
      parse: cases.map(([, t]) => { const r = parseCompsDetailed(t); return [r.kept, r.skipped.map(x => x.reason)]; }),
      stats: stats.map(([, v]) => { const s = compStats(v); return [s.median, s.low, s.outliers]; }),
    }), [CASES, STATS]);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    CASES.forEach(([label, , kept, reasons], i) => {
      if (!same(got.parse[i][0], kept)) fail(where, `parse "${label}": kept ${JSON.stringify(got.parse[i][0])}, want ${JSON.stringify(kept)}`);
      if (!same(got.parse[i][1].slice().sort(), reasons.slice().sort())) fail(where, `parse "${label}": skipped ${JSON.stringify(got.parse[i][1])}, want ${JSON.stringify(reasons)}`);
    });
    STATS.forEach(([label, , median, low, outliers], i) => {
      if (!same(got.stats[i], [median, low, outliers])) fail(where, `stats "${label}": got median/low/outliers ${JSON.stringify(got.stats[i])}, want ${JSON.stringify([median, low, outliers])}`);
    });
    await ctx.close();

    for (const vp of Object.keys(VIEWPORTS)) {
      const { ctx, page, errs } = await open('toolkit.html?access=SKPRO500', vp);
      const w = `${where} [${vp}]`;
      await page.evaluate(() => showPanel('pricing'));
      // A fresh device has no item, so nothing but startup renders the source rows.
      const idle = await page.$$eval('#pc-comps-card .comp-src[aria-disabled="true"]', els => els.length);
      if (idle !== 5) fail(w, `with no item name, expected 5 disabled search buttons, got ${idle}`);
      await page.fill('#pc-name', 'Nintendo Switch OLED');
      await page.selectOption('#pc-platform', 'eBay');
      const links = await page.$$eval('#pc-src-sold a, #pc-src-ask a', as => as.map(a => a.href));
      if (links.length !== 5) fail(w, `expected 5 search links, got ${links.length}`);
      if (!/ebay\.com.*_nkw=Nintendo%20Switch%20OLED.*LH_Sold=1/.test(links[0] || '')) fail(w, `first sold link is not eBay sold for the item: ${links[0]}`);
      await page.fill('#pc-comp-q', 'Switch OLED HEG-001');
      await page.fill('#pc-name', 'Nintendo Switch OLED');     // same name: the edit sticks
      if ((await page.inputValue('#pc-comp-q')) !== 'Switch OLED HEG-001') fail(w, 'edited search was overwritten by the same item name');
      await page.fill('#pc-comps', EBAY_BLOCK);
      const r = await page.evaluate(() => ({
        med: document.getElementById('pc-comps-med').textContent,
        low: document.getElementById('pc-comps-low').textContent,
        ask: document.getElementById('pc-ideal').textContent,
        floor: document.getElementById('pc-floor').textContent,
        struck: document.querySelectorAll('#pc-comps-chips .comp-chip.skip').length,
        outl: document.querySelectorAll('#pc-comps-chips .comp-chip.out').length,
      }));
      // Kept 239.99–260 plus the $40 parts sale, which is set aside: median 250, floor 240.
      if (r.med !== '$250' || r.low !== '$240' || r.ask !== '$250' || r.floor !== '$240' || r.struck !== 4 || r.outl !== 1)
        fail(w, `pasted eBay block priced wrong: ${JSON.stringify(r)}`);
      await noHorizontalScroll(page, w);
      // "Find sold comps" must land with the card's heading below the sticky top bars.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => jumpToComps());
      await page.waitForTimeout(100);
      const land = await page.evaluate(() => ({
        card: Math.round(document.getElementById('pc-comps-card').getBoundingClientRect().top),
        bars: Math.round(document.querySelector('.tk-topbars').getBoundingClientRect().bottom),
      }));
      if (land.card < land.bars || land.card > land.bars + 120) fail(w, `jump to comps landed at ${land.card}px, top bars end at ${land.bars}px`);
      await page.screenshot({ path: join(shots, `toolkit-comps-${vp}.png`) });
      for (const e of errs) fail(w, e);
      await ctx.close();
    }
    for (const e of errs) fail(where, e);
  }

  await browser.close();
  srv.close();
}

// Serve the toolkit under a hostname that is not local, so sentry-init.js really sends,
// then intercept the envelope before it leaves the machine and read it. This checks the
// scrubbing on what the real SDK produces, not on a hand-built event.
async function sentryEndToEnd(pw, launch, port) {
  const where = 'sentry end-to-end';
  const HOST = 'sellerkit.test';
  const SECRETS = ['SKPRO500', 'AIzaSyTEST0000000000000000000000000000', 'sk-ant-api03-TESTTESTTESTTESTTEST'];
  const browser = await pw.chromium.launch({ ...launch, args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const envelopes = [];
  await page.route('**/*', r => {
    const u = r.request().url();
    if (/ingest\.(us\.)?sentry\.io/.test(u)) { envelopes.push(r.request().postData() || ''); return r.fulfill({ status: 200, body: '{}' }); }
    return new URL(u).hostname === HOST ? r.continue() : r.abort();
  });
  try {
    await page.goto(`http://${HOST}:${port}/toolkit.html?access=SKPRO500`, { waitUntil: 'load' });
    const enabled = await page.evaluate(() => Sentry.getClient().getOptions().enabled);
    if (!enabled) { fail(where, 'Sentry did not enable on a public hostname'); return; }
    await page.evaluate(([gk, ak]) => {
      // The AI layer's Google call carries the user's key in the URL.
      fetch('https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse&key=' + gk).catch(() => {});
      history.pushState({}, '', location.pathname + '?access=SKPRO500&lock=1');
      setTimeout(() => { throw new Error('check-e2e boom key=' + gk + ' ' + ak); }, 50);
    }, [SECRETS[1], SECRETS[2]]);
    for (let i = 0; i < 40 && !envelopes.some(e => e.includes('check-e2e boom')); i++) await page.waitForTimeout(100);
    const sent = envelopes.find(e => e.includes('check-e2e boom'));
    if (!sent) { fail(where, 'no error envelope was sent for a thrown error'); return; }
    for (const s of SECRETS) if (sent.includes(s)) fail(where, `secret leaked into the error report: ${s.slice(0, 12)}…`);
    if (/generativelanguage/.test(sent)) fail(where, 'AI provider request was recorded as a breadcrumb');
    if (!sent.includes('[redacted]')) fail(where, 'expected [redacted] markers in the report');
  } finally {
    await browser.close();
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

staticChecks();
if (!STATIC_ONLY) await browserChecks();

// tests/known-issues.txt lists pre-existing problems, one failure line (or its leading part) each. They
// print as warnings so they stay visible without blocking unrelated work. Delete a line
// once its bug is fixed; a stale line is reported so the list cannot silently rot.
const knownFile = join(ROOT, 'tests', 'known-issues.txt');
const known = existsSync(knownFile)
  ? read('tests/known-issues.txt').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  : [];
const isKnown = f => known.some(k => f.startsWith(k));
const real = failures.filter(f => !isKnown(f));
const accepted = failures.filter(isKnown);
if (accepted.length) console.log(accepted.map(f => '⚠ known: ' + f).join('\n'));
if (!STATIC_ONLY && !onlyFiles.length)
  for (const k of known) if (!failures.some(f => f.startsWith(k))) console.log(`⚠ known issue no longer reproduces — remove it from tests/known-issues.txt: ${k}`);

if (real.length) {
  console.error(real.map(f => '✗ ' + f).join('\n'));
  console.error(`\n${real.length} problem(s).${STATIC_ONLY ? '' : ' Screenshots: .checks/'}`);
  process.exit(1);
}
console.log(STATIC_ONLY ? '✓ static checks passed' : '✓ all checks passed — screenshots in .checks/');
