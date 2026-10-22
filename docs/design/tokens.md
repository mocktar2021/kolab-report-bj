# Design tokens

KolabReport has two themes with the same layout and type: light and dark. The default theme follows the device setting (`DEFAULT_THEME = "system"` in `src/components/theme/theme-config.ts`). Visitors switch between Clair, Sombre and Système from the landing header, the account menu at the top right of the app or the command palette. The choice is stored per device under `kolabreport:theme`.

Tokens live in `src/app/globals.css` as HSL values (`:root` for light, `.dark` for dark) and are exposed to Tailwind in `tailwind.config.ts`. Components use the Tailwind names, never raw hex values.

## Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#FAFAFA` | `#0E0E0E` | Page background |
| `foreground` | `#09090B` | `#FFFFFF` | Body text and headings |
| `card` | `#FFFFFF` | `#161616` | Cards, table, sidebar |
| `muted-foreground` | `#5F5F68` | `#A1A1A1` | Secondary text |
| `border` | `#E4E4E7` | `#262626` | Borders and dividers |
| `primary` | `#09090B` | `#FFFFFF` | Pill buttons (text in `primary-foreground`) |
| `highlight` | `#B93A26` | `#FF8975` | Focus rings, active filters and navigation, progress strokes, small badges |
| `status-not-started` | `#808EA3` | `#94A3B8` | Section status dot |
| `status-in-progress` | `#DB7706` | `#FBBD23` | Section status dot |
| `status-completed` | `#059467` | `#36D399` | Section status dot |

`highlight` is the only brand accent. Do not use it for large fills or button backgrounds. Status badges pair each dot with its French label, so color is never the only signal.

### Contrast

Measured with the WCAG formula on the real backgrounds.

| Pair | Light | Dark |
| --- | --- | --- |
| Body text on background | 19.1:1 | 19.3:1 |
| Muted text on card | 6.3:1 | 7.0:1 |
| Highlight text on background | 5.4:1 | 8.4:1 |
| Highlight text on its 10 % tint | 4.9:1 | 6.7:1 |
| Pill button label | 19.9:1 | 19.3:1 |
| Status badge labels | 6.8:1 to 9.5:1 | 10.4:1 to 11.1:1 |
| Status dots on card (non-text) | 3.2:1 to 3.8:1 | 7.1:1 to 10.7:1 |
| Focus ring on background (non-text) | 5.4:1 | 8.4:1 |

## Surfaces

| Class | Use |
| --- | --- |
| `surface-card` | Dashboard cards and table. On dark, a faint warm light from the top-left and a brighter top edge. |
| `surface-float` | Floating mockup cards on the landing page, with a layered shadow. |
| `surface-feature` | Large landing cards with light falling from the top-left corner. |
| `surface-panel` | Inset area inside a feature card that holds a mockup. |
| `bg-glow`, `bg-glow-bottom` | Lilac and ember light at the top of the landing and sign-in pages, and under the final call to action. |

Radius follows hierarchy: 28px for landing sections, 20px for panels, 16px for cards, full pills for buttons, chips and badges.

## Type

| Role | Family | Size | Notes |
| --- | --- | --- | --- |
| `text-display` | Instrument Sans 500 | 40px to 72px | Hero headline, tracking -0.035em |
| `text-h1` | Instrument Sans 500 | 32px to 48px | Section titles |
| `text-h2` | Instrument Sans 500 | 26px to 36px | Feature card and page titles |
| `text-h3` | Instrument Sans 500 | 19px | Card titles, FAQ questions |
| `text-lead` | Inter Tight 400 | 16px to 18px | Subtitles |
| `text-body`, `text-small` | Inter Tight 400 | 16px, 15px | Body text |

`h1` to `h3` use Instrument Sans by default (`font-display`). Large figures use `font-display` with `tabular-nums`. Labels are sentence case, never all caps.

## Motion

The landing page has one load sequence: the hero copy, then the app cards one after the other (70 ms apart), then a slow 6px drift of the cards. Sections below the fold fade in once when they scroll into view. Everything that moves sits behind `motion-safe`, and `MotionProvider` turns transforms off when the visitor asks the system for reduced motion.
