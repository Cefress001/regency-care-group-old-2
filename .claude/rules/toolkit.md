---
paths:
  - "toolkit.html"
  - "styles.css"
---

# Toolkit internals (`toolkit.html`)

Loaded when Claude reads `toolkit.html` or `styles.css`. The Gotchas in `CLAUDE.md`
still apply and are always loaded.

## The photo lightbox

`phZoom(i)` opens the AI Vision photos full size; state is just an index into `_phShots`.
The markup is static at the bottom of `toolkit.html` and the styles are in `styles.css` —
neither is built at runtime, so nothing accumulates in the document as it is reopened.

- The thumbnail's photo is a `.ph-thumb-open` **button** so it is keyboard reachable, and it
  is a *sibling* of the remove button rather than wrapping it — nested buttons are invalid.
- It is modal: `phZoomKey(e)` runs first in the single `keydown` handler and returns `true`
  when it consumed the event, so Escape closes the lightbox without also reaching the command
  palette. Tab is trapped inside the dialog, and focus returns to the thumbnail on close.
- Closing clears the `<img>` `src`, so a large `data:` URL is not retained by a hidden element.
- `phZoomStep` and `phZoomPaint` both close the dialog if `_phShots` has emptied underneath
  them, rather than throwing.

## Toolkit SPA pattern

All 13 tools live in `toolkit.html` as sibling `<div class="tk-panel" id="panel-NAME">` elements. `showPanel(id)` toggles `.active` on the target panel and on every `[data-panel="NAME"]` nav item — the sidebar and the mobile tab bar are the same elements, restyled by media query.

The CSS fade-in animation is attached to `.tk-panel.active`, not `.tk-panel`. Moving it back to the base selector leaves hidden panels stuck at `opacity: 0` (`5283cf4`).

Interaction is inline `onclick="..."` throughout — no `addEventListener` wiring except the single `DOMContentLoaded` init block at the end of the script.

## State — the Item model

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

## The AI layer

AI is a **layer over the 13 tools, not a 14th tool** — the same treatment "My Items" gets. It is
absent from the home tools grid (a `.ai-banner` sits above the grid instead) and from the four
counted files, so adding to it never triggers the tool-count chore (Gotchas in `CLAUDE.md`).

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

## Licence tiers — free and business

Two tiers ship from one file. The gate resolves an access code to a plan via
`CODES`, stores it in `sk_plan`, and writes it onto `<html data-plan="…">`.
`LOGINS` carries a plan beside each digest.

- **CSS does the hiding, not JavaScript.** One rule — `html:not([data-plan="pro"])
  [data-plan="pro"] { display: none !important; }` — lives in the gate's own inline
  `<style>`, beside the lock CSS and for the same reason: a stylesheet arriving later
  would let a Pro panel paint first. Marking something Pro is adding
  `data-plan="pro"` to it, nothing more.
- **`skIsPro()` is for the few places that must branch in JS** — an export that
  should add columns, a list built at runtime. It reads the attribute rather than
  `localStorage`, so it agrees with what is on screen even when storage threw.
- **Anything built at runtime has to filter itself.** The command palette
  (`PRO_PANELS`) and the playbook cards (`visiblePlaybooks()`) build their own lists
  and would otherwise offer a jump into a panel that cannot be shown.
- **A licence sold before the tier existed has no `sk_plan` and reads as free**, so
  existing buyers keep exactly what they bought. `?lock=1` clears the plan as well as
  the access flag.
- **This is a UI convention, not entitlement.** There is no server to enforce
  against, and the gate it hangs off is still trivially bypassed.

**Business tools are not counted.** `sourcing`, `aging` and `bulk` live in their own
Business nav section, are absent from the 13-card tools grid, and are absent from the
four counted files — the same treatment My Items, the AI layer and the playbooks get.
The advertised thirteen are the consumer product, so **adding a business tool never
triggers the tool-count chore.** A playbook that steps through a Pro panel carries
`pro: true`.

## Pricing — the formula and the comps

Two bases produce the three prices, and `#pc-basis` says which one ran.

- **Three or more comps win.** `COMPS_MIN` is the threshold; below it the sample is
  called too thin and the formula still rules. Above it the numbers come straight out
  of the data — median to ask, lowest sold as the floor, halfway between for the quick
  flip — with **no multiplier invented anywhere** on that path. Enough comps also make
  retail, condition and demand optional, because someone pricing a trade-in has no
  idea what it cost new.
- **`parseComps` is deliberately not "find every number".** "Sold Sep 12 · $45" holds
  two numbers and one price. When the text carries any `$`, only `$`-prefixed numbers
  count; otherwise the last number on each line wins. Everything parsed is echoed back
  as chips so a misread is visible *before* it reaches the price.
- **Sell-time needs condition and demand**, so it hides on the comps-only path rather
  than printing a number with nothing behind it.
- **A price is not what you get.** `pc-platform` drives a net line under all three
  result chips and a You Keep column on the drop schedule, and highlights its row in
  the fee block.

## Money — cost basis and profit

- **The platform's cut is computed once, at the moment of sale, and stored on the
  row.** Reading it back out of `FEE_TABLE` at render time would silently restate last
  year's profit the day a platform changes its rates.
- `trProfit()` returns `null` for anything unsold; callers must handle that rather
  than treating it as zero.
- **A free licence still gets the fee recorded** on every sale, so upgrading later
  finds a correct history instead of a year of blanks.
- Marking sold is an inline form, not `prompt()`. It pre-quotes the fee from the
  listed price and re-quotes as the price is typed — until `dataset.touched` is set by
  a hand edit, after which it is left alone.

## Identify from a photo

`aiIdentifyPhotos()` sends up to three shots and a strict JSON contract, then fills
the item from the reply.

- **Nothing is written until Apply.** A vision model names the wrong model number with
  complete confidence; the result lands in a review list first.
- **Rows that would replace an existing value arrive unticked** and say what they would
  overwrite. Filling a blank is a favour; replacing typed work is the seller's call.
- **The model is held to the app's vocabulary, not its own.** `IDP_CATEGORIES` and
  `IDP_CONDITIONS` map the reply onto the eight categories and the condition
  multipliers; anything that does not map is dropped rather than half-applied.
- **`aiExtractJson` walks braces while tracking strings and escapes**, so a reply
  wrapped in prose or a code fence — or carrying a brace or an escaped quote inside a
  value — still parses. A plain `indexOf('}')` does not survive `12\" riser`.
- Applying is **one `updateActiveItem` followed by propagation outside it**. Nesting
  the two lets the outer write clobber the inner one.
- `_idpShots` never reaches `localStorage`, for the same reason `_phShots` does not.

## Backup, import and print

- **The backup file carries no AI key.** `sk_ai_cfg` is excluded on purpose — a backup
  is the sort of file people mail themselves.
- Restore offers merge or replace, matches items by `id`, and always leaves the active
  id pointing at something that exists.
- **`parseCSV` is a real parser**, not a split on commas: quoted commas, doubled
  quotes and newlines inside fields are the normal case in exported inventory.
  `BK_ALIASES` folds the header names people actually use onto the item model's.
- **The print sheet is a direct child of `<body>`** so the print rule can hide every
  sibling and leave it alone, rather than trying to un-style the whole app. It is
  built on demand and is empty until then, which is what the `:not(:empty)` guard
  keys off.

## Playbooks — the job first, the tools second

The toolkit opens on **Start Here** (`#panel-home`), which asks what the person came to do
rather than listing tools. Four playbooks cover the highest-intent jobs — sell one item, fix a
listing nobody bites on, handle a buyer who just messaged, clear out a whole pile — and an
**Access all tools** button drops to `#panel-alltools`, which holds the original 13-card grid
unchanged.

**A playbook is a layer over the 13 tools, not a 14th tool** — the same treatment My Items and
the AI layer get. It sequences tools that already exist and owns no inputs of its own, so it is
absent from the tools grid and from the four counted files. Adding one never triggers the
tool-count chore (Gotchas in `CLAUDE.md`).

Everything renders from one constant:

```js
PLAYBOOKS[id] = { icon, name, time, blurb, steps: [ { panel, icon, title, guide, why? } ] }
```

`panel` is the tool the step opens. Keep `guide` about what to actually do and `why` about what
it costs to skip — a step that only says "open the pricing tool" is a menu, not a playbook.

- **Progress rides on the item** (`item.flows[playbookId] = [stepIndex, …]`), like `photos` and
  `measurements`, so it switches with the item. Ticking a step with no item yet auto-creates one,
  the way `saveLS()` does; the write is guarded on a non-empty array so merely opening a playbook
  leaves nothing behind.
- **Position is UI state**, not item data, so it lives in the flat `sk_flow` key. That name is
  deliberately not one of the legacy tool keys `migrateLegacyItem()` folds away.
- **The flow bar** (`#flow-bar`) is one element for all 13 tools rather than a strip inside each.
  `syncFlowBar(panelId)` is called from `showPanel`; `FLOW_BAR_HIDDEN` keeps it off the panels
  that are about choosing a playbook rather than working one.
- **Both top bars stick as one unit** via `.tk-topbars`. Making the flow bar separately sticky
  with a hardcoded item-bar offset drifts the moment the item bar wraps to two lines.
- `PANEL_NAMES` maps a panel id to its display name and is the single source for the palette,
  the step buttons, and the tool list on a playbook card. A new tool panel belongs in it.

**Listing readiness** (`RD_CHECKS`) scores the active item against seven signals a buyer looks
for and renders each as a chip that opens the tool filling that gap. Every check reads state that
already exists — none of them asks the user for anything new. Wrap a new check's `test` so a
malformed item cannot throw the whole card away.

**The command palette** (⌘K / Ctrl+K) lists every playbook and every entry in `PANEL_NAMES`.
It is wired from the single `DOMContentLoaded` handler, which is the only place in the toolkit
that attaches a listener rather than using inline `onclick`.

## Conventions

- **`fromButton` argument** — calculators take an optional `fromButton` flag. Truthy means a user clicked the action button, so show validation warnings; falsy means the call came from the init restore path, where empty inputs are normal and must stay silent.
- **Copy buttons** — `copyText(id, btn)` reads an element's `textContent`; `copyScript(btn)` reads `btn.previousElementSibling`. Both swap the label to `✅ Copied!` for 2s.
- **Downloads** — route file output through `downloadFile(filename, mime, content)` (Blob + object URL + revoke). CSV and ICS export both use CRLF line endings; ICS text values must go through `icsEscape()`.
- **Data tables** — per-tool constants (`FEE_TABLE`, `SCAM_WEIGHTS`, `PLATFORMS`, `KW_CHIPS`, `MEAS_FIELDS`, `PHOTO_LISTS`) sit at module scope next to the function that uses them, above their numbered `// ═══ N. Tool Name ═══` section banner.
- Inline `style="..."` is common in the toolkit markup for one-off spacing; component-level styling belongs in `styles.css`.

## Adding a tool to the toolkit

1. Nav item in `.tk-nav` with `data-panel="NAME"` and `onclick="showPanel('NAME')"`.
2. A `<div class="tk-panel" id="panel-NAME">` with a `.panel-header`.
3. A card on the home dashboard grid (`#panel-home`).
4. A numbered section in the `<script>` with the tool's logic and its data constants.
5. If it has persisted inputs, add its field IDs to `TOOL_FIELDS` under a new prefix, and call `saveLS('PREFIX')` from each input's handler.
6. If it should prefill from the active item, add its fields to `CORE_TWO_WAY` / `CORE_SOURCES` (unambiguous values) or to `CORE_ONE_WAY` plus a `*_TO_*` map (its own vocabulary).
7. Bump the tool count in the four files listed under Gotchas in `CLAUDE.md`.

**"My Items" is not a tool** — it is the workspace that feeds the 13 tools. It lives in the Overview nav section next to "All Tools" and is deliberately absent from the home tools grid, so it does not change the advertised count.
