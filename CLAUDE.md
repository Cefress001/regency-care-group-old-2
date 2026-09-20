# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SellerKit — a static marketing site plus a client-side web app that helps people list and sell secondhand items (pricing, titles, descriptions, negotiation scripts, scam screening, etc.). Despite the repo name, there is no Regency Care content left; the site was replaced wholesale in commit `8faed20`.

## Build / run / test

There is no build system, package manager, test suite, or linter. The repo is five files served as-is.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Use a server rather than `file://` — `navigator.clipboard.writeText` (used by every copy button) requires a secure context.

Verification is manual: open the page, exercise the tool, check the browser console. When changing `toolkit.html`, also check the < 900px layout, since the sidebar becomes a fixed bottom tab bar there and has broken twice before (`a830a43`, `01331d5`).

## Architecture

Four pages, no shared JS. Each page carries its own `<script>` at the bottom; there is no module system, bundler, or framework.

| File | Role |
| --- | --- |
| `index.html` | Marketing landing page. Inline `<style>` holds page-specific additions on top of `styles.css`. |
| `toolkit.html` | The product. A single-page app (~2200 lines) holding all 13 tools. |
| `checkout.html` | Payment page. **Self-contained** — inline `<style>`, Google Fonts, does not load `styles.css`. |
| `success.html` | Post-purchase page. Also self-contained. |
| `styles.css` | Design system + landing-page styles (lines 1–332) + toolkit styles (line 333 onward). |

Two styling worlds coexist deliberately: `index.html` and `toolkit.html` share `styles.css` and its `:root` custom properties (`--blue`, `--gray-600`, `--radius`, …); `checkout.html` and `success.html` are standalone with hardcoded colors and the Inter webfont. Editing a token in `styles.css` will not reach the checkout flow.

### Toolkit SPA pattern

All 13 tools live in `toolkit.html` as sibling `<div class="tk-panel" id="panel-NAME">` elements. `showPanel(id)` toggles `.active` on the target panel and on every `[data-panel="NAME"]` nav item — the sidebar and the mobile tab bar are the same elements, restyled by media query.

The CSS fade-in animation is attached to `.tk-panel.active`, not `.tk-panel`. Moving it back to the base selector leaves hidden panels stuck at `opacity: 0` (`5283cf4`).

Interaction is inline `onclick="..."` throughout — no `addEventListener` wiring except the single `DOMContentLoaded` init block at the end of the script.

### State

Everything persists to `localStorage` under an `sk_` prefix; there is no backend.

- `saveLS(prefix)` / `loadLS(prefix)` serialize a fixed list of input IDs declared in the `ids` map inside `saveLS`. Prefixes: `pc` pricing, `tg` titles, `db` description, `ai` AI prompt, `pd` price drop, `ms` measurements, `sd` seven-day plan. **Adding an input to a form also means adding its ID to that map** or the value silently won't persist.
- `sk_photos` and `sk_tracker` are managed separately with their own read/write helpers.
- Every `localStorage` access is wrapped in `try/catch` (private-browsing mode throws). Keep that.
- The `DOMContentLoaded` handler restores all prefixes and re-runs `calcPrice()` / `calcPriceDrop()` so restored values re-render their results.

### Conventions

- **`fromButton` argument** — calculators take an optional `fromButton` flag. Truthy means a user clicked the action button, so show validation warnings; falsy means the call came from the init restore path, where empty inputs are normal and must stay silent.
- **Copy buttons** — `copyText(id, btn)` reads an element's `textContent`; `copyScript(btn)` reads `btn.previousElementSibling`. Both swap the label to `✅ Copied!` for 2s.
- **Downloads** — route file output through `downloadFile(filename, mime, content)` (Blob + object URL + revoke). CSV and ICS export both use CRLF line endings; ICS text values must go through `icsEscape()`.
- **Data tables** — per-tool constants (`FEE_TABLE`, `SCAM_WEIGHTS`, `PLATFORMS`, `KW_CHIPS`, `MEAS_FIELDS`, `PHOTO_LISTS`) sit at module scope next to the function that uses them, above their numbered `// ═══ N. Tool Name ═══` section banner.
- Inline `style="..."` is common in the toolkit markup for one-off spacing; component-level styling belongs in `styles.css`.

### Adding a tool to the toolkit

1. Nav item in `.tk-nav` with `data-panel="NAME"` and `onclick="showPanel('NAME')"`.
2. A `<div class="tk-panel" id="panel-NAME">` with a `.panel-header`.
3. A card on the home dashboard grid (`#panel-home`).
4. A numbered section in the `<script>` with the tool's logic and its data constants.
5. If it has persisted inputs, add the prefix to the `ids` map in `saveLS` and to the array in the `DOMContentLoaded` restore loop.

## Gotchas

- **Stripe is not wired up.** `checkout.html` ships a commented-out `<stripe-buy-button>` and a visible `.stripe-placeholder` div in its place. Real keys go in that comment block; the placeholder div gets deleted at the same time. Nothing currently takes payment.
- **The tool count appears in four files.** When the count changes, update: `index.html` (hero badge, hero stat, two CTAs, section heading, FAQ, sticky CTA), `checkout.html` (order line, feature list), `success.html` (two strings), and the Stripe product description on the Stripe Dashboard (a fifth copy outside the repo). `index.html` also has a derived string ("N more") — keep it consistent with the count minus 3 tools named inline.
- **`toolkit.html` overrides global nav styles.** The `.tk-*` rules exist partly to undo landing-page nav styling that otherwise turned the dark sidebar white (`a44f685`). Be careful when editing shared nav selectors in `styles.css`.
