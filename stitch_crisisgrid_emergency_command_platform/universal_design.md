# Design System — Master Reference

*A working design constitution, not a style guide. Style guides describe what things look like; this describes how to make decisions. Use it on every screen, every component, every line of copy — for SaaS dashboards, consumer apps, marketing sites, and storefronts alike.*

---

## 0. The One Rule

**Every design decision must be traceable to the subject matter, the user's task, or the brand — never to "what looks good on a template."**

If you can't answer "why this, why here, why now" for a color, a shadow, a border-radius, or a word, delete it. The single biggest tell of a mediocre — or AI-generated — product is that every choice *could have been made for any other product too*. Premium design is design that could only exist for this specific thing, this specific user, this specific moment.

Before shipping any screen, ask: **"If I swapped the logo and copy for a competitor's, would anyone notice?"** If the answer is no, you haven't designed anything yet — you've assembled a kit.

---

## 1. Ground Every Screen in Its Subject

Before touching color or type, answer three questions in one sentence each:

1. **Who is this for, in this exact moment?** (A tired founder checking revenue at 11pm ≠ a first-time visitor deciding whether to trust you ≠ a shopper comparing two products.)
2. **What is the single job this screen does?** Not "informs the user" — the actual job: *convert*, *reassure*, *let them finish a task fast*, *make them feel something*.
3. **What does this subject's world actually look like?** A fintech dashboard for CFOs borrows from Bloomberg terminals and private banking, not from consumer social apps. A children's learning app borrows from playgrounds and picture books, not from B2B SaaS. A luxury skincare store borrows from print editorial and apothecary aesthetics, not from generic Shopify themes.

Every palette, typeface, and layout decision downstream should trace back to these three answers. Write them down before you design anything — a two-line brief at the top of your working file.

---

## 2. Color: Build a Palette, Not a Swatch Grab

**Never start from a default.** Tailwind's default palette, Material Design's baseline, and "professional blue + white + grey" are the resting state of a product with no point of view. Treat them as a last resort.

### How to build one
- Pick **one dominant neutral** (not pure white/black — a warm or cool-tinted off-white/off-black that matches the subject's temperament).
- Pick **one primary brand color** with real cultural/emotional weight for the category (not "blue because trustworthy" — that's the same reasoning everyone uses).
- Pick **one accent** used sparingly for the single most important action per screen.
- Derive **2–3 semantic colors** (success, warning, danger) that are tonally consistent with the primary — don't drop in raw #22C55E green and #EF4444 red from a component library; shift them toward your palette's hue family.
- Name every token by role, not by appearance: `surface-raised`, `text-muted`, `accent-critical` — never `blue-500`, `gray-3`. Appearance-named tokens rot the moment you redesign.

### Explicitly avoid (current AI/template tells)
- Warm cream background (~`#F4F1EA`) + high-contrast serif + terracotta accent (~`#D97757`).
- Near-black background with one bright acid-green or vermilion accent, no other color relationships.
- The "SaaS card kit": every content block in an identically-rounded card, one border-radius used everywhere regardless of hierarchy, the same soft grey shadow (`rgba(0,0,0,.1)`) under all of them, gradient washes as pure decoration.
- Purple-to-blue gradients on buttons/heroes as a default "premium" signal.

### Dark mode is a second design, not an inversion
Don't just flip lightness values. Reduce saturation of large surfaces in dark mode (pure saturated color on black vibrates), increase saturation slightly on small accent elements (they recede on dark backgrounds otherwise), and never use pure black (`#000`) or pure white (`#FFF`) — both create harsh, headache-inducing contrast at scale. Apple's dark UI sits around `#000000`→`#1C1C1E` layered surfaces; Linear's sits around `#08090A`→`#151516`. Build layered near-black/near-white surfaces the same way.

---

## 3. Typography: The Voice Before the Words

Typography carries more brand personality than color does. Most products need **one typeface family**, used with a deliberate scale of weights and sizes — not two competing display fonts fighting for attention.

### Choosing type
- Choose typefaces for what they connote about the subject, not because they're currently trending in design Twitter screenshots (Söhne, General Sans, Inter, and Geist are extremely overused as of 2025–2026 defaults — fine choices, but if you reach for them by default, notice that you're defaulting).
- If you use two families, make the contrast obvious and purposeful: a characterful display serif for headlines against a neutral grotesque for body, for example — not two sans-serifs that are 90% similar.
- Set an actual type scale (a ratio-based system — 1.25×, 1.333×, or a custom set of stops), not ad-hoc sizes picked per screen.
- Line length under ~80 characters for body text; serif body text can run slightly longer and needs slightly more line-height than sans-serif.
- Tighten letter-spacing on large display type (headlines above ~48px almost always need negative tracking); loosen it slightly on small uppercase labels *only if you're using uppercase labels at all* (see below).

### Avoid these typographic tells
- Bolding, italicizing, or color-accenting a single word in a headline for "emphasis" — the most common generated-content tic.
- Defaulting to tracked-out ALL-CAPS labels above every section.
- Adding a typographic eyebrow/label above content that doesn't earn its place (a label should encode real information — a category, a status — not just add visual rhythm).
- Middle-dot-joined meta strings (`Design · Engineering · 2026`) and em-dash headline constructions (`Ship faster — without the chaos`) as reflexive habits rather than considered choices.
- Monospace fonts for data labels "because it looks technical" when the content isn't actually code or data.

### Use type as an active design element
When type *is* the hero (a headline, a big stat, a pull quote), treat its size, weight, and placement as the primary visual decision on the page — not a neutral text box dropped into a layout built around something else.

---

## 4. Layout & Spacing

- Establish a spacing scale (4px or 8px base unit) and use it religiously — random 13px/19px gaps are the fastest way to make a screen feel unresolved, even if no single value looks "wrong."
- Decide alignment intentionally per section: centered layouts read as confident and editorial for hero/marketing moments; left-aligned reads as functional and scannable for dashboards and content-dense screens. Don't default to center-everything.
- Hierarchy comes from **contrast of scale, weight, and space** — not from adding more borders, more cards, or more color. If two elements need to look different in importance, the fix is usually spacing and size, not a new visual style.
- Grids should breathe. Premium products (Apple, Linear, Stripe) use generous negative space as a status signal — cramped layouts read as budget, no matter how nice the components are.
- Border-radius should encode hierarchy: don't use one radius value on every card, button, input, and modal regardless of size or importance. Larger containers can take a different radius than small interactive elements (or none at all) — the decision should be visible and consistent, not uniform-by-accident.

### Wireframe before you build
Sketch the layout in one-sentence descriptions and rough ASCII blocks before writing code:
```
[ nav: logo left · 3 links center · CTA right ]
[ hero: left-aligned headline (60%) + product shot bleeding off right edge ]
[ proof strip: logos, small, low-contrast, single row ]
[ 3-col feature grid, left-aligned text per card, no icons-in-circles cliché ]
```
This catches generic patterns before they're expensive to change.

---

## 5. Motion: One Moment, Not Fifty Effects

Motion should answer a user's action or draw attention to exactly one thing per experience — not decorate every element.

- **Welcome:** motion in direct response to a user action (opening a panel, confirming a save, dragging a card) — this should feel instant and physical, not decorative.
- **Use sparingly:** one orchestrated page-load sequence, one signature interaction — done well, once — beats scattered fade-and-slide-up entrances on every section and hover-lift on every card. That pattern (`opacity: 0 → 1, translateY(20px) → 0` on scroll, on everything) is the single most recognizable generated-site tell in 2026.
- **Duration and easing matter more than the effect itself.** 150–250ms with a proper ease-out for UI feedback; anything longer feels laggy, anything with a bouncy spring on *every* interaction feels juvenile unless that's genuinely the brand's register (a kids' app, a playful consumer tool).
- Always respect `prefers-reduced-motion`.

---

## 6. Components: Systems, Not Kits

Treat every component as an instance of a system, not a one-off pulled from a library:

- **Buttons:** a clear primary/secondary/tertiary hierarchy, with exactly one primary action visible at a time in any given view. Copy states what happens ("Save changes"), not a generic verb ("Submit").
- **Forms:** label above field (not floating labels for anything complex), inline validation that explains *what to fix*, not just *that something's wrong*. Errors are specific and human, never "Something went wrong."
- **Cards:** only use a card when content genuinely needs a contained, discrete boundary — not as a default wrapper for every piece of content on a page. Overuse of identical cards is the fastest way to flatten a design's hierarchy.
- **Navigation:** the nav's structure should reflect the product's actual information architecture, not a template's default (logo / 4 links / CTA button). A dense dashboard's nav looks nothing like a marketing site's.
- **Empty and error states:** these are *design opportunities*, not afterthoughts. An empty state should invite action in the product's own voice; an error should explain what happened and how to fix it without apologizing on the user's behalf.

---

## 7. Copy: Words Are Design Material

Copy can make a beautifully-designed screen feel templated, and plain copy can make a modest layout feel premium. Bring the same intentionality to words as to spacing.

- **Write from the user's vocabulary**, not the system's internals. A user "manages notifications," not "configures webhook subscriptions."
- **Active voice, consistent naming.** Whatever a button is called, the confirmation and the resulting state use the same word — a "Publish" button produces a "Published" toast, never a "Success!" toast.
- **Be specific over clever.** "3 seats left on your plan" beats "You're almost at capacity!" Specificity reads as competence; forced enthusiasm reads as filler.
- **Sentence case everywhere** unless the brand has a deliberate, consistent reason not to (a title-case-heavy editorial brand, for instance — but that's a choice, not a default).
- **No filler transitions.** Cut "Simply," "Just," "Easily," "Powerful," "Seamless," "Effortless" — these words appear because nothing more specific was said. Say the specific thing instead.
- **Errors and empty states speak in the interface's voice** — direct, not apologetic, not cute. "We couldn't find that page" beats both "404 Error" and "Oopsie! Page not found 🙈."

---

## 8. The Quality Floor (Non-Negotiable, Every Screen)

- Responsive down to a real mobile viewport — not just a squeeze of the desktop layout.
- Visible keyboard focus states on every interactive element.
- Color contrast meets WCAG AA minimum (4.5:1 body text, 3:1 large text) — check this even on "just internal tools."
- `prefers-reduced-motion` respected.
- Loading, empty, and error states designed with the same care as the "happy path" — most real usage lives in these states, not the pristine demo screenshot.
- Touch targets ≥44×44px on anything tappable.

---

## 9. Platform-Specific Notes

**Marketing / landing sites** — the hero must open with the single most characteristic thing about the subject (a real product shot, a live demo, a striking claim backed by a real number) — not a generic headline + gradient blob + two buttons. Proof (logos, numbers, testimonials) should feel earned and specific, not decorative.

**SaaS / dashboards** — density and scanability beat decoration. Users here are repeat visitors doing a job; optimize for speed of comprehension on the 500th visit, not first-impression wow. Data hierarchy (what's the one number that matters on this screen?) should be obvious in under a second.

**Consumer apps (mobile-first)** — design for thumb reach, one-handed use, and interruption (users will be pulled away mid-task constantly — state must persist gracefully). Motion can carry more personality here than on a dashboard, but stay disciplined: one signature interaction, not fifty micro-animations.

**E-commerce / storefronts** — the product photography and product copy *are* the design; layout should showcase them, not compete with them. Trust signals (reviews, return policy, security) need to be present but quiet — anxiety-reducing, not banner-shouted. Checkout flow above all else: fewer steps, visible progress, no surprise costs.

---

## 10. Pre-Ship Critique (Run This Every Time)

Work in two passes. First, write a one-paragraph plan: palette (4–6 named tokens), type (families + roles), layout concept (one sentence + ASCII wireframe), and the one or two principles that make *this* screen distinct. Then interrogate that plan honestly:

1. **The swap test:** could this exact design pass for three other brands in the same category with just a logo swap? If yes, revise.
2. **The mirror test** (Chanel's rule): before shipping, remove one accessory — one gradient, one extra shadow, one decorative icon, one redundant label. Premium restraint almost always beats premium abundance.
3. **The template checklist** — flag and reconsider any of these if present without a specific reason:
   - Cream background + serif + terracotta, or near-black + single neon accent
   - Every content block in an identically-rounded card with the same soft shadow
   - ALL-CAPS eyebrow label above every heading
   - Middle-dot or em-dash headline constructions used reflexively
   - Fade-and-slide-up entrance on every section, hover-lift on every card
   - A single bolded/italicized/colored word inside a headline for "emphasis"
   - Numbered markers (01/02/03) on content that isn't actually a sequence
4. **Spend your boldness in exactly one place.** Pick the single most memorable element on the screen — it should be obvious which one it is. Everything else stays quiet, disciplined, and in service of it.

If a design plan comes back clean on all four checks, build it. If not, revise the plan *before* writing code — cheap to fix as a paragraph, expensive to fix as shipped CSS.
