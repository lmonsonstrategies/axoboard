# AxoBoard brand guide

Version 1.1 · August 2026

## Brand idea

**Make progress visible. Make wins feel alive.**

AxoBoard is a performance and celebration platform inspired by the leucistic axolotl: friendly, unmistakable, adaptable, and aquatic without feeling childish. The product should make serious operational data easy to understand while giving teams permission to enjoy the moments behind the numbers.

Brand attributes:

- warm, not sugary;
- playful, not juvenile;
- energetic, not chaotic;
- customizable, not generic;
- trustworthy, not clinical.

## Product promise

AxoBoard turns trusted performance data into visible progress, clear next actions, and celebrations teams remember.

## Logo

The primary mark is the symmetrical low-poly leucistic axolotl. Use the transparent production PNG until an optically refined SVG is available.

- Primary asset: `assets/brand/axoboard-logo-low-poly.png`
- Minimum digital size: 32px high for the symbol; 120px wide for symbol plus wordmark.
- Clear space: at least one eye-to-eye width of the mark on every side.
- Preferred backgrounds: warm white, shell pink, or very pale aquatic blue.
- Do not recolor the face green, stretch the mark, add heavy neon bloom, rotate it, or place it over visually noisy imagery.

The axolotl itself is the memorable device. Avoid adding explanatory badges such as “GFP glow” to the interface; the visual system should communicate the influence without naming the effect.

### Wordmark

The AxoBoard name is typeset in **Fredoka 700**, matching the rounded display system used throughout the product. The experimental custom vector wordmark is retired and must not appear in production UI or marketing.

- Pair the typeset wordmark with the low-poly axolotl mark in product navigation, sign-in, marketing lockups, and branded service surfaces.
- Use deep plum on light backgrounds and warm white on deep-plum backgrounds.
- Default tracking is `-0.03em`; keep capitalization exactly `AxoBoard`.
- Below 120px of available lockup width, use the axolotl symbol alone.
- Customer workspaces may use their own uploaded wordmarks on customer-facing dashboards and displays.

## Color system

### Primitive palette

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Warm canvas | `warm-white` | `#FFF9FB` | Main backgrounds |
| Pure surface | `surface-white` | `#FFFDFD` | Cards and modals |
| Shell wash | `shell-pink` | `#FBE7EF` | Selected and layered surfaces |
| Leucistic accent | `leucistic-pink` | `#F6A9C4` | Illustration and friendly detail |
| Celebration coral | `celebration-coral` | `#E96F98` | Primary action and celebration energy |
| Aquatic accent | `aquatic-blue` | `#43BDE8` | Focus, navigation, live charts, water cues |
| Aquatic wash | `aquatic-wash` | `#DDF6FF` | Secondary surfaces and depth |
| Fluorescent signal | `signal-green` | `#72DC67` | Live, healthy, success and momentum |
| Signal glow | `signal-glow` | `#B8F58E` | Restrained halo or highlight |
| Deep plum | `deep-plum` | `#34233A` | Primary text |
| Muted plum | `muted-plum` | `#7F7084` | Supporting text |

### Semantic rules

- Pink and warm white remain visually dominant across the product.
- Aquatic blue is the secondary system color for focus rings, selected navigation, charts, data selection, and structural depth.
- Fluorescent green is a signal, never a general background or primary-action color. Use it for healthy connections, live status, success, goal crossing, and brief celebratory glow.
- Deep plum carries body text. Never use signal green for paragraph text.
- Customer workspace themes may replace the palette, but semantic roles and contrast requirements remain intact.

Recommended composition on a standard product screen:

- 65–75% warm white and neutral surfaces;
- 15–25% shell/leucistic pink;
- 5–12% aquatic blue;
- under 4% fluorescent green.

## Typography

- Brand wordmark: **Fredoka 700**, deep plum by default, with `-0.03em` tracking.
- Display: **Fredoka**, weights 600–700. Use for product names, page titles, KPI values, and celebratory copy.
- UI and body: **DM Sans**, weights 400–700. Use for navigation, forms, descriptions, tables, and labels.
- Numbers: use tabular numerals where supported for KPI tables and changing values.

Type should feel rounded but disciplined. Avoid all-caps body copy, novelty typefaces, and large blocks of centered text.

## Layout and shape

- Base spacing unit: 4px.
- Standard card radius: 20px.
- Control radius: 10–12px.
- Major modal/preview radius: 24–30px.
- Minimum interactive target: 44×44px.
- Shadows are cool-plum and low contrast; they suggest floating in water rather than heavy elevation.
- Use asymmetrical pink, blue, and occasional green radial washes to create aquatic depth.

## Components

### KPI cards

- Lead with the metric name and value.
- Always show source lineage in compact form.
- Show freshness or stale state.
- Comparisons must state the comparison period.
- Goal/status color supplements text; it never replaces it.

### Buttons

- Primary: coral fill, white text.
- Secondary: pale pink or aquatic wash with readable plum/blue text.
- Ghost: white surface with a visible border.
- Success actions remain coral; green communicates result/status.

### Integrations

- Use the provider's actual approved company or product mark—never improvised initials, emoji, or generic placeholders once a connector is named.
- Preserve the provider's official colors, proportions, clear space, and trademark requirements. Never recolor a provider mark to match the AxoBoard theme.
- Render provider marks on a neutral white tile with a subtle AxoBoard border so marks remain recognizable without competing with the product theme.
- Store provider assets locally in `assets/integrations/` and mirror only the approved public subset into `wireframes/assets/integrations/`.
- Every connector asset must record its source, retrieval date, license/trademark status, approved surfaces, and owner in the integration asset registry before production release.
- If provider approval is required but not yet granted, the beta may use the mark only as an internal prototype and must flag it as `approval_pending`; public marketing and marketplace surfaces stay blocked.
- Display connection health, account/portal, last sync, and mappings.
- Connection errors use plain-language recovery actions.
- Never expose access or refresh tokens in the interface, logs, or URLs.

### Celebrations

- Combine two or three brand colors; avoid full-screen fluorescent green.
- Motion should peak quickly and resolve within seconds.
- Respect reduced motion, quiet hours, mute settings, and replay limits.

## Illustration and imagery

Preferred illustration traits:

- low-poly or softly geometric axolotls;
- translucent water gradients and gentle refraction;
- sparse fluorescent highlights inspired by GFP axolotls;
- expressive but simple faces;
- enough negative space for operational data.

Avoid generic corporate people illustrations, aquarium clip art, cartoon bubbles everywhere, or biological/scientific imagery that feels clinical.

## Voice

Use short, positive, action-oriented language.

| Situation | Preferred | Avoid |
| --- | --- | --- |
| Empty state | “Add your first KPI” | “No data exists” |
| Success | “KPI added to draft” | “Operation completed successfully” |
| Stale data | “Last refreshed 42 minutes ago” | “Sync failure 409” |
| Celebration | “Maya closed $18,420!” | “GFP MODE ACTIVATED!” |
| Recovery | “Reconnect Google Sheets” | “Authentication exception” |

## Accessibility

- Target WCAG 2.2 AA.
- Body text contrast: at least 4.5:1; large text and essential UI: at least 3:1.
- Every status has text or icon meaning in addition to color.
- Visible focus uses aquatic blue.
- Support keyboard navigation, reduced motion, zoom to 200%, and responsive layouts down to 320px.
- Celebration sound and animation are user-controllable.

## Service identity versus customer identity

AxoBoard is a commercial white-label service with two intentionally separate visual layers:

- **AxoBoard service identity** uses the leucistic pink, warm white, aquatic blue, deep plum, and restrained GFP system for sign-in, workspace administration, billing, permissions, support, legal, and platform status.
- **Customer workspace identity** applies the customer's logo, colors, language, sprites, sounds, and terminology to dashboards, displays, shares, celebrations, and games.

Customer themes may personalize content but must not disguise AxoBoard security warnings, permission boundaries, billing state, accessibility controls, or support diagnostics. System-danger and service-health semantics remain controlled by AxoBoard.

Workspace Admin should feel calm, trustworthy, and easy to operate. It may use fewer playful elements than Celebration HQ or Team Competitions, while remaining visibly part of the same axolotl-inspired product family.

## Brand checklist

Before publishing a surface:

1. Is the operational purpose obvious within five seconds?
2. Are pink and warm white still the dominant identity?
3. Is blue supporting structure rather than competing with coral?
4. Is green limited to meaningful signal states?
5. Can every KPI be traced to a source and freshness timestamp?
6. Does the experience work without motion, sound, or color perception?
7. Is it clear whether the user is managing the AxoBoard service or the customer's branded content?
