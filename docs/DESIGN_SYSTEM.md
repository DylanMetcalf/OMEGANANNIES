# Design system

**Intent:** calm, trustworthy, editorial-leaning software for a premium childcare business. The aim is less "SaaS dashboard", more "well-run private office". The brand anchors (navy and gold) come from omeganannies.com. The app palette is a more neutral version suited to dense, all-day use.

## Typography
| Role | Face | Use |
|---|---|---|
| Display | **Manrope** 600–800 | Page titles (26/30 px), section titles (15 px), stat values (28 px), lining numerals |
| UI and body | **Inter** 400–600 | Body 15/1.55, labels 13, table text 14, captions 12. `cv11`/`ss01` for an unambiguous 1/l/I. Tabular numerals in tables |

Both fonts are self-hosted at build time through `next/font`: no runtime requests to Google, so they are CSP- and privacy-safe. The website's serif display face was dropped inside the app because its old-style "1" read as "I" in figures (Audit 3, A3-04).

## Tokens (`src/app/globals.css`)
| Token | Value | Use |
|---|---|---|
| `navy` / `navy-700` / `navy-50` | #172038 / #263152 / #eef0f6 | Primary actions, headings, active navigation |
| `gold` / `gold-600` / `gold-50` | #b9892e / #8a6413 / #f8f1e3 | Sparing accent. `gold-600` for accent text (≥ 4.5:1) |
| `cream`, `sand`, `surface`, `line` | #f7f6f3, #efede8, #fff, #e4e1da | Background, tracks, cards, dividers |
| `ink`, `muted` | #1c2233, #5a6070 | Primary and secondary text (both ≥ 4.5:1 on cream) |
| `subtle` | #8a8f9c | Icons, placeholders and disabled states only — **never text** (A3-01) |
| `ok` / `warn` / `bad` / `info` (+ `-50`) | green / amber / red / blue | Status, always paired with a dot and text |
| `focus` | #3d6fd9 | 2 px focus outline |
| Radius / shadow | 12 px cards, 10 px controls; `shadow-soft`, `shadow-pop` | |
| Motion | 160 ms fade-in; none under `prefers-reduced-motion` | |

## Components (`src/components`)
- **Layout:** `PageHeader` (eyebrow, title, description, actions), `Section` (card with title, description and action), `Stat`, `DefList`, `Empty` (empty state with the next action), `Notice` (status or alert semantics), `Steps` (progress), `Badge` (colour, dot and text), `Avatar`.
- **Forms:**
  - `ActionForm`: server action, input kept on error, double-submit guard, `aria-busy`, polite live region, global toast on success.
  - `Submit`: pending label.
  - Utilities `input`, `label`, `chip` (checkbox chips), `btn-primary|secondary|ghost|danger|gold`, `btn-sm`. Controls are ≥ 44 px tall (36 px for `btn-sm`).
- **Navigation:** desktop sidebar with lucide icons and per-link pending dots; mobile bottom tab bar (4 primary items plus More) and a native `<dialog>` drawer.
- **Tables:** `tbl`. Scroll wrappers are focusable and labelled regions (A3-02).

## Patterns
- Every status shows colour, a dot and words.
- Every list has an empty state that says what to do next.
- Every destructive action asks for confirmation.
- Errors stay inline next to the form. Successes appear as toasts. Messages that contain one-time links stay inline so they can be copied.
- On phones, the primary actions on detail pages come before the details.
- Brand photography from the public site appears on the landing and sign-in pages only.
- Nanny photos are shown only to roles allowed to see that profile (`/api/photos/[id]`).

## Final refinement additions
- **CTA token** `cta` #9F6A00 / `cta-600` #8C5C00 (hover) / `cta-700` #7A5000 (pressed): white text ≥ 4.63:1. `btn-cta` is the single treatment for "Book a nanny" style actions, with a warm shadow, a busy state (`aria-busy`) and a disabled state. The old `btn-gold` is retired.
- **Motion:** `animate-pop` (shortlist confirmation), `animate-rise` (drawers, confirmations), `grow` (welcome progress), `skeleton` shimmer. All are off under `prefers-reduced-motion`. `card-link` gives a gentle lift on clickable cards.
- **Components:**
  - `NannyPhoto`: fixed aspect, `object-cover` with a face-biased focal point, responsive `srcset` (160/480/960 WebP from the server). Without a photo it shows a scaled monogram.
  - `DiscoverCard`, `ShortlistButton` (optimistic, honest revert on failure), `AvailabilityPill`, `Rating` (average only from 3+).
  - `ProfileDrawer` (side drawer, bottom sheet on phones), `JourneySteps`, `ProgressTracker`, `LinkPending`.
  - `BarList` and `Columns` charts: single series, the `info` hue validated against the surface, values on hover and in a table.
- **Navigation:** the phone tab bar is three destinations + a raised role-aware centre action + More (safe-area aware, 56 px target). Website links sit in the sidebar footer and the mobile menu, keeping the main navigation uncluttered.
