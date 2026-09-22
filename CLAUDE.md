# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SellerKit — a static marketing site plus a client-side web app that helps people list and sell secondhand items (pricing, titles, descriptions, negotiation scripts, scam screening, etc.). Despite the repo name, there is no Regency Care content left; the site was replaced wholesale in commit `8faed20`.

## Build / run / test

There is no build system, package manager, test suite, or linter. The repo is a handful of files served as-is.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Use a server rather than `file://` — `navigator.clipboard.writeText` (used by every copy button) requires a secure context.

Verification is manual: open the page, exercise the tool, check the browser console. When changing `toolkit.html`, also check the < 900px layout, since the sidebar becomes a fixed bottom tab bar there and has broken twice before (`a830a43`, `01331d5`).

The toolkit is gated — open it locally at `http://localhost:8000/toolkit.html?access=SK-PRO-2026`, or you will only see the unlock overlay.

## Architecture

Seven pages, no shared JS. Each page carries its own `<script>` at the bottom; there is no module system, bundler, or framework.

| File | Role |
| --- | --- |
| `index.html` | Marketing landing page. Inline `<style>` holds page-specific additions on top of `styles.css`. |
| `toolkit.html` | The product. A single-page app (~2270 lines) holding all 13 tools, behind the interim access gate. |
| `checkout.html` | Payment page. **Self-contained** — inline `<style>`, Google Fonts, does not load `styles.css`. |
| `success.html` | Post-purchase page. Also self-contained. Grants toolkit access. |
| `terms.html` `privacy.html` `refund.html` | Legal pages. Share `legal.css`. |
| `styles.css` | Design system + landing-page styles (lines 1–313) + toolkit styles (line 315 onward). |
| `legal.css` | Styles for the three legal pages only. Own tokens — does not read `styles.css`. |
| `robots.txt` | Keeps `toolkit.html` and `success.html` out of search results. |
| `favicon.svg` | Linked from every page. |

Three styling worlds coexist deliberately: `index.html` and `toolkit.html` share `styles.css` and its `:root` custom properties (`--blue`, `--gray-600`, `--radius`, …); `checkout.html` and `success.html` are standalone with hardcoded colors and the Inter webfont; the legal pages share `legal.css`, which defines its own tokens. Editing a token in `styles.css` will not reach the checkout flow or the legal pages.

### Toolkit SPA pattern

All 13 tools live in `toolkit.html` as sibling `<div class="tk-panel" id="panel-NAME">` elements. `showPanel(id)` toggles `.active` on the target panel and on every `[data-panel="NAME"]` nav item — the sidebar and the mobile tab bar are the same elements, restyled by media query.

The CSS fade-in animation is attached to `.tk-panel.active`, not `.tk-panel`. Moving it back to the base selector leaves hidden panels stuck at `opacity: 0` (`5283cf4`).

Interaction is inline `onclick="..."` throughout — no `addEventListener` wiring except the single `DOMContentLoaded` init block at the end of the script.

### State — the Item model

Everything persists to `localStorage` under an `sk_` prefix; there is no backend.

`sk_items` holds an array of items and `sk_active_item` holds the active item's id. **An item owns the entire workspace** — switching items swaps every tool's contents at once:

```js
{ id, name, category, brand, model, condition, retail, asking, createdAt,
  tools: { pc:{…}, tg:{…}, db:{…}, ai:{…}, pd:{…}, ms:{…}, sd:{…} },  // per-tool inputs, keyed by element id
  photos: { furniture: [0,3,7] },                                      // checked shots, per category
  measurements: { 'Width (W)': '84"' } }                               // keyed by label, not element id
```

- `saveLS(prefix)` / `loadLS(prefix)` read and write `activeItem().tools[prefix]` rather than a flat key. The 35 existing `saveLS('xx')` call sites in the markup are unchanged. **Adding an input to a form also means adding its ID to `TOOL_FIELDS`** or the value silently won't persist.
- `updateActiveItem(fn)` is the only safe way to mutate — `loadItems()` returns parsed JSON, so a mutation is lost unless the whole array is written back. **Never nest `updateActiveItem` calls**: the inner write is clobbered by the outer one. `saveLS` deliberately calls `applyDerived` *after* its mutation closes for exactly this reason.
- Core fields propagate in two directions depending on ambiguity. `name`, `brand`, `model`, `retail`, `asking` are **two-way** (`CORE_TWO_WAY` / `CORE_SOURCES`) — edit them in any tool and the item follows. `category` and `condition` are **one-way out of the item** (`CORE_ONE_WAY`, `CAT_TO_*`, `COND_TO_*`), because each tool's dropdown uses its own vocabulary and `'Works Great'` can't be read back as a single multiplier.
- Touching any tool with no item yet auto-creates one, so input is never silently dropped.
- `migrateLegacyItem()` folds the old flat keys (`sk_pc`, `sk_tg`, … `sk_photos`) into a single item on first load and deletes them. Leave it in place until well past the point where users could still be carrying old data.
- `sk_tracker` stays separate — it is a financial log of sales, not the working set. `addActiveItemToTracker()` is the one-way bridge from an item into it.
- The AI connection lives in **`sk_ai_cfg`** (`{provider, key, baseUrl, model}`), read through
  `aiConfig()` and written only by `saveAndTestAI()`. **It cannot be called `sk_ai`**: that is the
  AI Prompt tool's legacy flat key, so `migrateLegacyItem()` would fold the config into an item's
  `tools.ai` and then delete it — wiping the user's key and creating a phantom item on next load.
- The copilot transcript is `item.aiChat`, so conversations switch with the item like every other
  tool's state. A chat started before any item exists goes to the flat `sk_ai_chat`, and
  `createItem()` adopts it exactly once via `takeOrphanChat()` rather than stranding it.
- Every `localStorage` access is wrapped in `try/catch` (private-browsing mode throws). Keep that.
- The `DOMContentLoaded` handler migrates, then calls `applyItem()` on the active item, which re-runs `calcPrice()` / `calcPriceDrop()` and rebuilds the measurement and photo panels.

### The AI layer

AI is a **layer over the 13 tools, not a 14th tool** — the same treatment "My Items" gets. It is
absent from the home tools grid (a `.ai-banner` sits above the grid instead) and from the four
counted files, so adding to it never triggers the tool-count chore below.

There is no SellerKit server and no OAuth, so the only architecture available is bring-your-own-key:
the browser calls the provider directly with a key the user pasted. "Sign in with your AI account"
is not implementable here — consumer OAuth needs a server for the token exchange. Do not ship a
sign-in button that only collects a key.

Everything goes through one function:

```js
aiStream(messages, { system, maxTokens, onDelta })   // → Promise<full text>
```

`aiRequest(cfg, …)` is the only place that knows a provider's shape. It returns `{url, headers,
body, extract}`, where `extract(sseEvent)` pulls the text delta out of that provider's event.
`aiStream` then runs one generic SSE reader over all of them. Four shapes are live: Anthropic
(`content_block_delta`), Google (`candidates[].content.parts[]`), and OpenAI/OpenRouter/custom
(`choices[0].delta.content`).

- **Anthropic needs `anthropic-dangerous-direct-browser-access: true`** or it refuses a
  browser-origin call outright. Google takes the key as a query param, not a header.
- Model lists go stale. Every provider's dropdown ends in "Other / newer model…", which reveals
  a free-text model id — that is the escape hatch, not a list update.
- `aiStream` retries once, automatically, when an OpenAI-shaped 400 complains about
  `max_completion_tokens`. Newer models renamed `max_tokens`.
- HTTP failures go through `aiErrorText()`, which turns a status into something a seller can act
  on. Keep new errors in that register — "re-copy the key", not "401".
- `aiAbort()` cancels the request in flight; the copilot's Stop button is the only caller.

**Model output is escaped before it is formatted.** `aiMd()` runs `escHtml()` first, then applies
bold and headings to the escaped string. Reversing that order lets a model inject HTML. Anything
new that renders model text goes through `aiMd()`.

Adding an AI action to a tool:

1. An output card in the panel: `<div class="tk-card ai-out-card" id="aix-NAME-card" style="display:none;">`
   holding `<div class="ai-out" id="aix-NAME">` and a `<span class="ai-out-model" id="aix-NAME-model">`.
2. A `.btn.btn-ai` in the tool's `.action-row`.
3. A function that calls `aiRunInto('aix-NAME-card', 'aix-NAME', btn, { messages, system, maxTokens })`.
   It handles the locked state, the streaming paint, the error rendering and the button label.
4. Build the prompt with `aiWithContext(prompt)` so the model sees the item.

`aiItemContext()` is what every feature knows before the user types: the active item's core fields,
the calculator's current output, the description form, measurements. Extend it there rather than
threading fields through individual prompts.

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
5. If it has persisted inputs, add its field IDs to `TOOL_FIELDS` under a new prefix, and call `saveLS('PREFIX')` from each input's handler.
6. If it should prefill from the active item, add its fields to `CORE_TWO_WAY` / `CORE_SOURCES` (unambiguous values) or to `CORE_ONE_WAY` plus a `*_TO_*` map (its own vocabulary).
7. Bump the tool count in the four files listed under Gotchas.

**"My Items" is not a tool** — it is the workspace that feeds the 13 tools. It lives in the Overview nav section next to "All Tools" and is deliberately absent from the home tools grid, so it does not change the advertised count.

## Gotchas

- **Stripe is live.** `checkout.html` carries a real `<stripe-buy-button>` with a `pk_live_` publishable key. Only publishable keys belong in this repo — a `sk_live_`/`sk_test_` secret key must never be committed. The buy button's success URL is configured on the Stripe Dashboard, not here, and it must point at `success.html` or buyers never receive toolkit access.
- **The toolkit is gated.** `toolkit.html` hides itself behind an access code (`SK-PRO-2026`), checked by an inline `<head>` script that adds `.sk-locked` to `<html>`. Access is granted by `success.html` (sets `sk_access` in `localStorage`), by `?access=<code>`, or by typing the code into the overlay. This is **interim and trivially bypassed** — the whole block sits between the `interim access gate` comment markers in `toolkit.html` and is meant to be deleted wholesale when Firebase Auth lands. Keep the gate CSS/JS inline in `<head>`: moving it to `styles.css` reintroduces a flash of unlocked content.
- **No invented social proof.** Testimonials, review counts, star ratings, forum quotes with vote counts, "average" result figures, countdown/scarcity chips, and struck-through reference prices were deliberately removed — they are a Stripe-account and chargeback risk on a live payment product, not just a style choice. Do not reintroduce them. Real numbers about the product (13 tools, 12 scam checks, condition percentages) are fine; the ROI table on `index.html` is allowed only because it is explicitly labelled an illustration.
- **`ai-*` element ids belong to the AI Prompt tool (tool 4); the AI layer uses `aix-*`.**
  `ai-item`, `ai-brand`, `ai-condition`, `ai-price`, `ai-details`, `ai-prompt-result` and
  `ai-output` were taken long before the AI layer existed, and `ai-price` in particular is wired
  into `CORE_TWO_WAY.asking`. Reusing one silently breaks two-way propagation and gives you a
  duplicate id that `getElementById` resolves to the wrong element.
- **The tool count appears in four files.** When the count changes, update: `index.html` (hero badge, hero stat, two CTAs, section heading, FAQ, sticky CTA, and the `.price-includes` bullet list), `checkout.html` (order line, feature list), `success.html` (two strings), and the Stripe product description on the Stripe Dashboard (a fifth copy outside the repo). `index.html` also has a derived string ("N more") in its `<meta name="description">` and demo CTA — keep both consistent with the count minus the tools named inline.
- **`toolkit.html` overrides global nav styles.** The `.tk-*` rules exist partly to undo landing-page nav styling that otherwise turned the dark sidebar white (`a44f685`). Be careful when editing shared nav selectors in `styles.css`.
