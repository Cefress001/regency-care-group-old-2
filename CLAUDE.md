# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SellerKit Pro — a static marketing site plus a client-side web app that helps people list and sell secondhand items (pricing, titles, descriptions, negotiation scripts, scam screening, etc.). Despite the repo name, there is no Regency Care content left; the site was replaced wholesale in commit `8faed20`.

## How we work (read first)

**Brainstorm → confirm → build → check.** Nothing that ships gets built until a brainstorm
(`/brainstorm`) has been confirmed by the user; every edit is followed by the static check; nothing
is called done until `node tests/check.mjs` passes and the screenshots have been looked at. The full
rule is `.claude/rules/workflow.md`; hooks in `.claude/settings.json` enforce it:

| Hook | When | What it does |
| --- | --- | --- |
| `brainstorm-gate.py` | `UserPromptSubmit` | Build-shaped prompt → injects the brainstorm-first reminder |
| `check-on-edit.sh` | `PostToolUse` on Edit/Write | Static check on the edited file; failures come straight back to Claude |
| `check-on-stop.sh` | `Stop` | Site files uncommitted → full browser check; blocks finishing while it fails |

## Where the rest of the guidance lives

This file holds what applies everywhere. Topic detail is in `.claude/rules/`, loaded automatically:

| File | Loads when | Covers |
| --- | --- | --- |
| `.claude/rules/workflow.md` | always | Brainstorm protocol, build/check loop, known-issues policy |
| `.claude/rules/design-system.md` | a `*.html` / `*.css` file is read | Tokens, typography, icon sprite, motion |
| `.claude/rules/toolkit.md` | `toolkit.html` / `styles.css` is read | Lightbox, SPA pattern, Item model, AI layer, tiers, pricing, money, identify, backup, playbooks, conventions, adding a tool |

When a change makes one of these wrong, fix the file in the same commit.

**What to work on next** — decisions (price, auth provider, rejected tools) and the issue order:

@docs/ROADMAP.md

## Build / run / test

There is no build system or bundler. The site is a handful of files served as-is; `package.json`
exists only to run the checks.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
node tests/check.mjs --static   # ~0.2s: icon refs, inline JS parses, duplicate ids, no Google Fonts, no Stripe secret keys
node tests/check.mjs            # ~20s: the above + every page in real Chromium at 1280px and 390px
```

Use a server rather than `file://` — `navigator.clipboard.writeText` (used by every copy button) requires a secure context.

The full check loads every page at desktop and phone width and fails on uncaught errors, first-party
`console.error`, 404s and horizontal scroll. It opens every toolkit panel, confirms the < 900px
sidebar is a fixed bottom tab bar (it has broken twice before, `a830a43`, `01331d5`), and confirms
`?lock=1` locks the gate. Screenshots go to `.checks/` (gitignored). Review them, because a passing
assertion does not mean the layout looks right. `tests/known-issues.txt` lists pre-existing failures,
which print as warnings. CI runs the same script (`.github/workflows/check.yml`). Playwright resolves
from `node_modules` or the global install; in the cloud sandbox it uses `/opt/pw-browsers/chromium`.

**Browser control (Playwright MCP).** `.mcp.json` registers a `playwright` MCP server
(`.claude/mcp/playwright.sh`, pinned `@playwright/mcp@0.0.82`, headless, isolated profile, output
to `.checks/mcp/`). It gives Claude `browser_navigate`, `browser_click`, `browser_type`,
`browser_snapshot`, `browser_take_screenshot`, `browser_console_messages` and similar tools, for driving a flow by hand while designing or
debugging: clicking through a playbook, filling the pricing form, checking a copy button. It
complements `tests/check.mjs`, which is repeatable and the one that gates. In the cloud sandbox the
script points at `/opt/pw-browsers/chromium` with `--no-sandbox` (the container runs as root);
elsewhere run `npx playwright install chromium` once. Serve the site first (`python3 -m http.server 8000`).

The toolkit is gated — open it locally at `http://localhost:8000/toolkit.html?access=199400` (free) or `?access=SKPRO500` (Pro), or you will only see the unlock overlay.

## Architecture

Seven pages, and no shared application JS: each page carries its own `<script>` at the bottom; there is no module system, bundler, or framework. The one shared script is error reporting (`sentry.min.js` + `sentry-init.js`), which is infrastructure, not app code.

| File | Role |
| --- | --- |
| `index.html` | Marketing landing page. Inline `<style>` holds page-specific additions on top of `styles.css`. |
| `toolkit.html` | The product. A single-page app holding all 13 tools, the playbook layer, and the interim access gate. |
| `checkout.html` | Payment page. **Self-contained** — inline `<style>`, Google Fonts, does not load `styles.css`. |
| `success.html` | Post-purchase page. Also self-contained. Grants toolkit access. |
| `terms.html` `privacy.html` `refund.html` | Legal pages. Share `legal.css`. |
| `styles.css` | Design system + landing-page styles (lines 1–313) + toolkit styles (line 315 onward). |
| `legal.css` | Styles for the three legal pages only. Own tokens — does not read `styles.css`. |
| `robots.txt` | Keeps `toolkit.html` and `success.html` out of search results. |
| `.vercelignore` | **Deploy allowlist.** Vercel publishes only the files named here (`!/name`); everything else — this file, `.claude/`, `docs/`, `tests/`, `package.json` — stays off the live domain. A new page or asset must be added or it 404s in production; the static check fails on a reference to an unlisted file, and the browser check serves only listed files. |
| `favicon.svg` | Linked from every page. |
| `apple-touch-icon.png` | 180×180 home-screen icon, linked from every page. |
| `og-image.png` | 1200×630 social share card, referenced by absolute URL in the `og:image` / `twitter:image` tags. |
| `screen-*.webp` | Real 2× toolkit screenshots used by the "Inside the Toolkit" section on `index.html`. |
| `inter-var-latin.woff2` | Vendored Inter variable font (latin, 100–900, 48KB). Shared by all four styling worlds. |
| `NOTICE.md` | Third-party license text for the vendored Lucide icons, Inter, Radix Colors and the Sentry SDK. |
| `sentry.min.js` | Vendored Sentry browser SDK (errors only, ~30KB gzip). **Generated**: rebuild with `npm run vendor:sentry` from `tools/sentry/entry.js`; never hand-edit. |
| `sentry-init.js` | Sentry config: the DSN, the scrubbing, and the local-server off switch. Loaded on `index.html`, `toolkit.html`, `success.html`. |
| `tools/sentry/entry.js` | The exports the vendored bundle keeps. Add one here before using a new Sentry API in `sentry-init.js`. |

Three styling worlds coexist deliberately: `index.html` and `toolkit.html` share `styles.css` and its `:root` custom properties (`--blue`, `--gray-600`, `--radius`, …); `checkout.html` and `success.html` are standalone with hardcoded colors and the Inter webfont; the legal pages share `legal.css`, which defines its own tokens. Editing a token in `styles.css` will not reach the checkout flow or the legal pages.

## Gotchas

- **Error reports must never carry a secret.** Sentry (project `rx-peptides-co-m5/claude-app1`,
  errors only, rate-limited to 300 events a day on the key) records page URLs, stack frames and
  fetch/navigation breadcrumbs, and two secrets travel in URLs here: the access codes
  (`?access=`, `?lock=`) and the user's Google AI key (`&key=` in `aiRequest`). `sentry-init.js`
  therefore scrubs the **whole serialised event**, not chosen fields, and drops every breadcrumb for
  an AI-provider request. `tests/check.mjs` proves it end to end: it serves the toolkit under a
  non-local hostname so the SDK really sends, intercepts the envelope, and fails if a planted secret
  survives. A new secret-bearing URL parameter or key format goes in `URL_SECRET` / `KEY_SHAPES`.
  Sending is disabled on localhost/127.0.0.1/`file:`, so development and the checks report nothing.
  `checkout.html` is deliberately excluded (Stripe's page), and the static check enforces the page
  list. `privacy.html` section 5 describes exactly what is sent, so keep it in step with any change.
- **Stripe is live.** `checkout.html` carries a real `<stripe-buy-button>` with a `pk_live_` publishable key. Only publishable keys belong in this repo — a `sk_live_`/`sk_test_` secret key must never be committed. The buy button's success URL is configured on the Stripe Dashboard, not here, and it must point at `success.html` or buyers never receive toolkit access.
- **The toolkit is gated.** `toolkit.html` hides itself behind an access code (`199400`), checked by an inline `<head>` script that adds `.sk-locked` to `<html>`. Access is granted by `success.html` (sets `sk_access` in `localStorage`), by `?access=<code>`, by typing the code into the overlay, or by the username/password sign-in on the overlay's second view. `?lock=1` clears `sk_access` and `sk_plan` and puts the gate back, which is the only way to re-test the locked state and the purchase flow once access has stuck on a device. This is **interim and trivially bypassed** — the whole block sits between the `interim access gate` comment markers in `toolkit.html` and is meant to be deleted wholesale when real accounts land (Supabase, issue #14). Keep the gate CSS/JS inline in `<head>`: moving it to `styles.css` reintroduces a flash of unlocked content.
- **Gate sign-in is browser-side, so the source carries a digest, not a password.** `LOGINS` maps a username to `{ h: PBKDF2-SHA256(user + ':' + pass, 'sellerkit-gate-v1', 150000) as hex, plan }`. There is no server to check a credential against, so this only raises the cost from reading the source to running an offline attack — pair it with a passphrase long enough that the attack is not worth running, and never treat it as real authentication. Add or rotate one with `node -e "console.log(require('crypto').pbkdf2Sync('user:password','sellerkit-gate-v1',150000,32,'sha256').toString('hex'))"`. `crypto.subtle` needs a secure context, so sign-in works on https and localhost but not `file://`; the access-code path stays as the fallback.
- **No invented social proof.** Testimonials, review counts, star ratings, forum quotes with vote counts, "average" result figures, countdown/scarcity chips, and struck-through reference prices were deliberately removed — they are a Stripe-account and chargeback risk on a live payment product, not just a style choice. Do not reintroduce them. Real numbers about the product (13 tools, 12 scam checks, condition percentages) are fine; the ROI table on `index.html` is allowed only because it is explicitly labelled an illustration.
- **`ai-*` element ids belong to the AI Prompt tool (tool 4); the AI layer uses `aix-*`.**
  `ai-item`, `ai-brand`, `ai-condition`, `ai-price`, `ai-details`, `ai-prompt-result` and
  `ai-output` were taken long before the AI layer existed, and `ai-price` in particular is wired
  into `CORE_TWO_WAY.asking`. Reusing one silently breaks two-way propagation and gives you a
  duplicate id that `getElementById` resolves to the wrong element.
- **Icon markup is HTML, so it cannot go into `textContent`.** `ic('name')` and the inline
  `<svg class="ic">` form both return markup. Assigning either to `textContent` (or to
  `alert()`, a `.value`, or any clipboard/download string) prints the literal tag. Use
  `innerHTML` and escape the surrounding text with `escHtml()`. Note the inverse too: an
  `"…"`-quoted JS string cannot hold the markup verbatim, since it contains `class="ic"`.
- **Business tools and playbooks do not move the tool count.** Only the thirteen
  consumer tools in the home grid are counted. See "Licence tiers" in `.claude/rules/toolkit.md`.
- **The tool count appears in four files.** When the count changes, update: `index.html` (hero badge, hero stat, two CTAs, section heading, FAQ, sticky CTA, and the `.price-includes` bullet list), `checkout.html` (order line, feature list), `success.html` (two strings), and the Stripe product description on the Stripe Dashboard (a fifth copy outside the repo). `index.html` also has a derived string ("N more") in its `<meta name="description">` and demo CTA — keep both consistent with the count minus the tools named inline.
- **`toolkit.html` overrides global nav styles.** The `.tk-*` rules exist partly to undo landing-page nav styling that otherwise turned the dark sidebar white (`a44f685`). Be careful when editing shared nav selectors in `styles.css`.
