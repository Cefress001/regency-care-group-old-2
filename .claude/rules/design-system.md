---
paths:
  - "*.html"
  - "*.css"
---

# Design system, typography, icons, motion

Loaded when Claude reads any page or stylesheet. Covers all four styling worlds.

## The design system

`styles.css` opens with the token block, and **the tokens are the API** — a new
rule should reach for a token, not a hex value.

- **The neutral ramp is Radix Colors "slate"** (MIT, see `NOTICE.md`), copied in
  as `--slate-1` … `--slate-12`. Each step has a fixed job (1–2 backgrounds,
  3–5 raised surfaces, 6 hairline borders, 7 strong borders, 8–9 placeholder
  text, 11 secondary text, 12 primary text). The old `--gray-*` names are still
  defined, as **aliases onto this ramp**, so the rules written against them keep
  working; new rules should use the semantic names (`--text`, `--text-muted`,
  `--surface`, `--surface-sunken`, `--line`).
- **Borders use the alpha tokens** `--line`, `--line-subtle`, `--line-strong`,
  not the solid scale. An alpha border composites over whatever is beneath it,
  so one token is correct on white, on the sunken canvas and inside a tinted
  callout. A solid border has to be re-picked per background, which is how
  borders drift.
- **Blue is the only decorative colour.** Green, amber and red mean something —
  a result, a warning, a failure. Using them for emphasis is what makes a UI
  read as a template. (The purchase button is green because completing a
  purchase is the state it signals, not for contrast.)
- **Elevation is a hairline ring plus a short drop.** `--shadow*` all carry
  `0 0 0 1px` as their last layer; the blur stays small so edges stay crisp.
  Wide soft shadows (the old `0 20px 60px`) smear the edge.
- **No gradients on controls, and no hover lifts.** Hover is a colour change;
  the only movement is `:active`. A `translateY` on a card grid makes the whole
  page twitch under the cursor and moves the target out from under it. Four
  large-area gradients survive on purpose: the two hero washes, the dark AI
  section, and the red→amber→green price bar, which is data.
- **Focus is one token,** `--ring`, on `:focus-visible`. The previous ring was
  `rgba(37,99,235,.08)` — below the threshold of visibility, which is what
  happens when a `:focus` rule gets dialled down instead of being scoped to
  `:focus-visible`.
- **Panels have a measure.** `.tk-panel > *` caps at 1080px so a price field is
  not 700px wide on a large display. Panels whose content is a card grid, a wide
  table or a chat column carry `.tk-panel-wide` to opt out.

## Typography

**Inter is vendored, not loaded from a CDN** — `inter-var-latin.woff2`, OFL, one
variable file covering 100–900. It is declared with a separate `@font-face` in
`styles.css`, `legal.css` and the inline `<style>` of `checkout.html` and
`success.html`; all four point at the same file, and every page preloads it.

- **Do not reintroduce a Google Fonts `<link>`.** It is a third-party request on
  a page that takes payment, and it is a visible swap on first paint. It also
  fails TLS in the sandbox this repo is developed in, which silently turned two
  console-error assertions red and, worse, meant screenshots were rendered in
  the fallback face rather than the real one.
- **Weights top out at 700, and display type sits at 600.** Inter's 800/900 are
  poster weights with no matching optical size here.
- The base layer tightens `letter-spacing` as headings grow; `clamp()`-sized
  headings (`.hero h1`, `.section-header h2`) state their own tracking because
  they outgrow the `h1`/`h2` defaults.
- **Numbers the eye compares down a column get `.tnum`** (tabular figures) so
  digits line up between rows.

## The icon system

Every icon is an inline SVG from **Lucide** (ISC + MIT, see `NOTICE.md`), vendored rather
than loaded from a CDN. Each page carries one `<svg class="sk-sprite">` block of `<symbol>`
definitions immediately after `<body>`, and an icon is a reference to it:

```html
<svg class="ic" aria-hidden="true"><use href="#i-camera"/></svg>
```

`.ic` sets `stroke: currentColor`, so **an icon has no color of its own** — it inherits the
parent's text color and themes itself from the existing tokens. Size defaults to `1em` and
follows `font-size`; per-container overrides live at the bottom of `styles.css`. `checkout.html`
and `success.html` are standalone, so they carry their own copy of the `.ic` rules.

- **A `<use href="#i-NAME">` only resolves if that symbol is in the page's sprite.** The sprite
  holds a fixed set; adding an icon means adding its symbol to *every* page that uses it.
  `tests/check.mjs` asserts every reference resolves, so a missing symbol fails rather than
  silently rendering nothing.
- **In JavaScript, build icons with `ic('name')`**, which returns the same markup. Because it
  returns *HTML*, anything built with it must be assigned through `innerHTML` — assigning it
  to `textContent` prints the raw tag on screen. Several call sites were converted from
  `textContent` to `innerHTML` for exactly this reason; text interpolated next to an icon
  goes through `escHtml()`.
- **Emoji are still correct in exported text.** The generated listing description
  (the `desc +=` block) is copied to the clipboard and downloaded as `.txt`, never rendered as
  HTML, so it deliberately keeps its emoji. Do not "finish the job" by converting those.
- Typographic marks (`✓`, `✗`, `→`, `·`) are not emoji and stay as characters.

## Motion

Two pieces of motion exist, and the rule between them is that **decorative motion stops at
the checkout boundary**. The landing page may have personality; the toolkit is a workspace,
so motion there is only ever feedback that something happened.

- **Scroll reveal** is landing-page only. Its CSS lives in `index.html`'s inline `<style>`,
  deliberately *not* in `styles.css`, which `toolkit.html` also loads — a stray `.reveal`
  rule there could leave a tool panel at `opacity: 0`.
- **The `.reveal` class is only ever added by JavaScript**, never written into the markup.
  With JS off, an unsupported `IntersectionObserver`, or a script error before init, the page
  is simply fully visible. Never hand-write `class="reveal"`.
- Elements already on screen at load are skipped entirely, so nothing above the fold flashes
  blank for a frame before the observer fires.
- The observer's `rootMargin` has a **positive** bottom value, so the fade starts slightly
  before an element reaches the viewport. The more common negative value means a fast scroll
  shows the element blank first and only then fades it in.
- **Every stylesheet honours `prefers-reduced-motion: reduce`.** Durations collapse to
  `.01ms` rather than being removed, so anything that animates *into* view — the
  `.tk-panel.active` fade, most importantly — still settles on its final frame instead of
  sticking at `opacity: 0`. Reveal opts out entirely under that setting.
