---
name: CrisisGrid Design System
colors:
  surface: '#0f131d'
  surface-dim: '#0f131d'
  surface-bright: '#353944'
  surface-container-lowest: '#0a0e17'
  surface-container-low: '#171c25'
  surface-container: '#1b2029'
  surface-container-high: '#262a34'
  surface-container-highest: '#31353f'
  on-surface: '#dfe2f0'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dfe2f0'
  inverse-on-surface: '#2c303b'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#b9c8de'
  on-secondary: '#233143'
  secondary-container: '#39485a'
  on-secondary-container: '#a7b6cc'
  tertiary: '#4ae176'
  on-tertiary: '#003915'
  tertiary-container: '#00a74b'
  on-tertiary-container: '#003111'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#d4e4fa'
  secondary-fixed-dim: '#b9c8de'
  on-secondary-fixed: '#0d1c2d'
  on-secondary-fixed-variant: '#39485a'
  tertiary-fixed: '#6bff8f'
  tertiary-fixed-dim: '#4ae176'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005321'
  background: '#0f131d'
  on-background: '#dfe2f0'
  surface-variant: '#31353f'
typography:
  display:
    fontFamily: Inter
    fontSize: 3rem
    fontWeight: '600'
    lineHeight: 3.5rem
    letterSpacing: -0.03em
  display-mobile:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.5rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.5rem
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '500'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '500'
    lineHeight: 1.5rem
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.625rem
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.06em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes a high-stakes, mission-critical command and coordination aesthetic tailored for civil protection directors, emergency operations centers (EOC), municipal leaders, and field coordinators.

The brand ethos prioritizes absolute composure under pressure:
- **Calm Authority:** Eliminates panic-inducing red saturation, alert fatigue, and visual clutter in favor of clinical clarity and deep structural hierarchy.
- **Architectural Subtlety:** Synthesizes the systematic precision of Stripe and Linear with the fluid, spatial legibility of visionOS and Apple pro platforms. Glass surfaces serve functional layering rather than decorative flair.
- **Civic Trust:** Strikes a non-militaristic, infrastructure-grade poise. The platform conveys resilience, institutional durability, and real-time situational fidelity without resorting to sci-fi tropes or cyberpunk neon.

## Colors

The palette is engineered specifically for prolonged operation in dim environments and emergency ops room displays:

- **Canvas & Surface Architecture:**
  - Base Obsidian Canvas: `#070B14`
  - Elevated Container / Secondary Slate: `#0B1220`
  - Glass Layer Tint: `rgba(15, 23, 42, 0.65)` with backdrop filter
  - Structural Ghost Border: `rgba(148, 163, 184, 0.08)`
  - Active Border / Focus Ring: `rgba(59, 130, 246, 0.4)`

- **Typography & Glyphs:**
  - High-Emphasis Content: `#F8FAFC` (Slate 50)
  - Secondary / Supporting Metadata: `#94A3B8` (Slate 400)
  - Muted / Disabled: `#475569` (Slate 600)

- **Calibrated Operational Signals (Restrained & Functional):**
  - **Critical:** `#EF4444` (Used sparingly for active threats, life-safety events, and critical alerts)
  - **Warning:** `#F59E0B` (Advisory, emerging hazards, capacity thresholds)
  - **Stable / Verified:** `#22C55E` (Resolved nodes, secured infrastructure, operational links)
  - **Information / System:** `#3B82F6` (Operational telemetry, active filters, route planning)

Status colors must never flood large background surfaces; they are strictly applied to micro-badges, state indicator pips (6–8px), subtle left border markers (2px), and pill text.

## Typography

The typography uses Inter across all viewports to ensure uniform tracking, optical legibility in low-light environments, and rapid scan-times during incidents:

- Numbers, coordinates, and crisis metrics must use tabular figures (`font-variant-numeric: tabular-nums`) to prevent jitter in live stream updates.
- Section pre-headers and incident taxonomy use `label-sm` set to uppercase with loose tracking (`0.06em`) for immediate cognitive parsing.
- Body copy adheres to generous line-heights (150%–160%) to reduce eye strain over multi-hour operational shifts.

## Layout & Spacing

The platform is constructed on a disciplined 8px spatial grid with 4px sub-increments for compact telemetry readouts:

- **Desktop (1024px+):** Tri-pane workstation layout. 12-column dynamic grid with collapsible command sidebars (320px fixed rail), live geospatial canvas (fluid flex), and tactical incident inspection feed (380px fixed drawer). Gutters maintain `1.5rem`, outer margins stay at `2rem`.
- **Tablet (768px - 1023px):** 8-column layout. Drawers transform into sheet overlays with backdrop blur. Margins scale to `1.5rem`, gutters to `1rem`.
- **Mobile (Below 768px):** Single-column stacked stream. Critical incident feed sits in a gesture-driven bottom card stack over the viewport map. Canvas margins compress to `1rem`, gutters to `1rem`.

Component internal density prioritizes breathing room around critical metrics to prevent misclicks during rapid operations.

## Elevation & Depth

Visual hierarchy is achieved through spatial refraction, dark glass depth, and hairline structural borders rather than heavy drop shadows:

- **Base Layer (L0):** Solid deep canvas (`#070B14`) hosting foundational GIS maps and node diagrams.
- **Surface Layer (L1):** Floating tactical cards and toolbars styled with visionOS-inspired dark glass:
  - Background: `rgba(11, 18, 32, 0.72)`
  - Backdrop Filter: `blur(16px) saturate(180%)`
  - Outline: 1px hairline border `rgba(148, 163, 184, 0.08)`
  - Shadow: `0 4px 20px rgba(0, 0, 0, 0.35)`
- **Modal / Urgent Overlay Layer (L2):** Incident command dispatchers, broadcast confirmation dialogs, and sensor inspect panels:
  - Background: `rgba(15, 23, 42, 0.85)`
  - Backdrop Filter: `blur(24px) saturate(200%)`
  - Outline: 1px hairline border `rgba(148, 163, 184, 0.16)`
  - Shadow: `0 12px 36px rgba(0, 0, 0, 0.65)`

No colored drop shadows or neon glows are permitted. Status illumination is confined to precise internal badges and subtle indicator lights.

## Shapes

The design system employs a refined, rounded geometric profile (`roundedness: 2`) that softens the software’s severe infrastructural context without looking playful:

- Standard controls, text fields, and list entries use `0.5rem` (8px).
- Incident cards, diagnostic modules, and glass panels use `rounded-lg` (`1rem` / 16px).
- Modal dialogues, action sheets, and full-screen dispatch modals use `rounded-xl` (`1.5rem` / 24px).
- Status pills, incident tags, and live-status pips utilize fully rounded pill contours.

## Components

### Buttons
- **Primary Action:** Solid slate fill (`#3B82F6`) with `#FFFFFF` text. Subtle inner top highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.2)`). Height: 40px (Desktop), 44px (Mobile).
- **Secondary / Ghost Glass:** Background `rgba(148, 163, 184, 0.06)`, border `1px solid rgba(148, 163, 184, 0.12)`, text `#F8FAFC`. On hover: background `rgba(148, 163, 184, 0.12)`.
- **Destructive / Emergency Dispatch:** Red tint surface `rgba(239, 68, 68, 0.12)`, border `1px solid rgba(239, 68, 68, 0.3)`, text `#EF4444`. Requires two-step verification or slide-to-confirm on critical broadcast triggers.

### Status Chips & Badges
- Pill-shaped (`rounded-full`), padding `2px 8px`, typography `label-sm`.
- Formatted with a 6px circular state dot on the left.
- **Critical:** Dot `#EF4444`, background `rgba(239, 68, 68, 0.10)`, text `#FCA5A5`.
- **Warning:** Dot `#F59E0B`, background `rgba(245, 158, 11, 0.10)`, text `#FCD34D`.
- **Stable:** Dot `#22C55E`, background `rgba(34, 197, 94, 0.10)`, text `#86EFAC`.
- **Information:** Dot `#3B82F6`, background `rgba(59, 130, 246, 0.10)`, text `#93C5FD`.

### Cards & Panels
- Translucent dark glass (`#0B1220` with 70% opacity and 16px blur) bounded by a uniform 1px perimeter stroke (`rgba(148, 163, 184, 0.08)`).
- Internal padding matches `space-lg` (24px) for summaries and `space-md` (16px) for compact feeds.
- Critical alert cards feature an anchored 3px solid vertical accent along the left edge instead of an aggressive full-card tint.

### Lists & Activity Feeds
- Low-profile row dividers using `1px solid rgba(148, 163, 184, 0.06)`.
- Interactive rows transition to `rgba(148, 163, 184, 0.04)` on hover with zero horizontal shift.
- Tabular telemetry columns (timestamps, incident IDs, unit callsigns) use monospaced digit alignments.

### Form Inputs & Search Fields
- Inset field base (`#070B14`) with a 1px border (`rgba(148, 163, 184, 0.12)`).
- Text styled in `#F8FAFC` with placeholder in `#475569`.
- Active focus state: border shifts to `#3B82F6` accompanied by an unobtrusive `0 0 0 2px rgba(59, 130, 246, 0.2)` ring. Height: 40px.

### Checkboxes & Radio Controls
- Base: 18px rounded square (checkbox) or circle (radio).
- Surface: `rgba(15, 23, 42, 0.8)` with a 1.5px border (`rgba(148, 163, 184, 0.25)`).
- Selected state: Solid `#3B82F6` with an `#070B14` icon glyph.

### Specialized Crisis Components
- **Telemetry Counter:** Oversized tabular figures paired with `label-sm` uppercase descriptors underneath.
- **Incident Map Marker:** 28px glass discs containing a high-contrast 16px outline icon, ringed by a 2px state perimeter line with no distracting pulsating waves.