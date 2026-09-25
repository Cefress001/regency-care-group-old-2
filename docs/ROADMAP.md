# Roadmap and decisions

Imported by `CLAUDE.md`, so every session starts with it. Each task is a GitHub issue; this file
holds the decisions and the order. Close the issue and update this file in the same change.

## Where we are (2026-09-25)

- Pre-launch: no sales yet. The goal is a product-ready launch, not new features.
- **Price: $59.** Either one-time with the buyer's own AI key (today's model), or a monthly plan
  with AI included (#16). The site still says $49 (#3).
- Auth plan changed: **Supabase, not Firebase** (#14). Postgres suits sales reporting, row-level
  security isolates users, and it has an MCP server. `toolkit.html` comments still say Firebase;
  they go when the interim gate is deleted.

## Order

| Stage | Issues | Notes |
| --- | --- | --- |
| Launch blockers | #3 price · #4 privacy/AI disclosure · #5 `.vercelignore` · #6 phone overflow · #9 calculation tests | Product-ready means these are closed |
| Owner tasks | #7 Vercel plan (Hobby is non-commercial) · #8 Sentry cleanup + live test | Only the owner can do these |
| Phase 0 | #10 analytics · #11 installable/offline (PWA) · #12 axe + Lighthouse | Find out why visitors don't buy |
| Process | #13 `/retro` skill | Lessons become checks, not more prose |
| Phase 1 | #14 Supabase accounts + Stripe webhook, retire the interim gate | Access is currently bypassable |
| Phase 2 | #15 cloud sync + import from localStorage/backup | Needs #14 |
| Phase 3 | #16 server-side AI + monthly plan | Needs #14; AI cost must be capped per user |
| Phase 4 | #17 split `toolkit.html` into ES modules | After #9, so the move is verifiable |

## Considered and rejected (don't re-propose without new reasons)

- **Lovable MCP**: an app builder with its own React/Supabase codebase; it would compete with this one.
- **Beads / standing parallel agents**: overkill for one developer and about 15 issues. Most work
  hits `toolkit.html` and `styles.css`, so parallel agents conflict. Run parallel sessions only
  for tasks on disjoint files. Revisit after #17, and only with more than about 20 dependent tasks.
- **shadcn/ui, Tailwind, or a Next.js rewrite**: they need a build step and a framework. Worth it
  only if the product grows into many signed-in screens.
- **A hard edit-blocking brainstorm gate**: the reminder hook plus the rule is enough; a hard
  block adds friction to exempt one-line fixes.
