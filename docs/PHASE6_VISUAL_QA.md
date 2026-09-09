# Visual comparison (Phase 6)

```
serve → capture per breakpoint → compare geometry → pixel diff → score → regions
```

## Two signals, deliberately separate

**DOM geometry** compares the rendered page's measured boxes against the Design
IR. It produces differences with real numbers: *"Hero top padding is 88px, the
design says 96px"*. That is directly actionable — the repair agent knows the
element, the property and the target value.

**Pixel diff** compares a screenshot against the Figma reference render. It
catches what geometry cannot see: wrong colours, missing images, bad font
rendering. It says **where**, not **what**.

Geometry drives the repair loop, because only geometry produces a fix. Pixels
contribute to the score the user sees, because that is what "does it look right"
actually means.

Pixel regions are only reported where geometry found nothing. Otherwise the same
problem appears twice — once actionable, once not — and the actionable one gets
lost in the list.

## Why the comparison is pure

`compareDom`, `diffImages`, `clusterRegions` and the scoring functions have no
browser, network or database. That is what makes the part deciding *what counts
as a difference* testable — 42 tests, including real PNG encode/decode and real
pixel data.

## Tolerances exist for a reason

Sub-pixel differences are noise. Browsers round differently, fonts hint
differently, and a report full of 0.4px deltas trains users to ignore it. The
pixel threshold is 12 per channel for the same reason: a zero threshold flags
every antialiased glyph edge.

Height is only compared for fixed-height elements. Text reflows, and a taller
paragraph is usually correct rather than broken.

Fully transparent is treated as *no colour*, not black — otherwise every
unstyled element reports a false background difference.

## Region clustering

A mask of ten thousand scattered pixels is unusable in a UI. Flood fill on a
16px grid turns it into a handful of boxes a person can look at. 8-connected, so
a diagonal shift stays one region rather than fragmenting into a staircase.
Clusters below a minimum size are dropped as antialiasing noise.

## Scoring

Five sub-scores plus a weighted headline. The decisions that matter:

- **Any difference caps the score below 100.** Showing "100% match" beside a
  list of problems destroys trust in every other number on the screen.
- **Severity is weighted**, so one missing section is not equivalent to twenty
  half-pixel nudges.
- **Normalised by page size** — ten differences across 400 nodes is a much
  better result than ten across twelve.
- **Layout is weighted highest.** Right structure with slightly wrong colours is
  far closer to correct than the reverse.
- **The headline is the widest breakpoint**, not an average. Averaging would
  hide a broken mobile layout behind a good desktop one.

`matched_nodes` is stored alongside the score, so a 99% match measured on three
nodes cannot be mistaken for a good result.

## Scores cannot be forged

`record_visual_comparison` is revoked from `authenticated`: the comparison, its
regions and the project's headline score are written by one service-role RPC, in
one transaction. A client cannot set its own match score, and the project score
can never reference a comparison that was not stored. Tested.

## Honest gap

**The Playwright screenshotter is not exercised by the test suite.** This
environment has no browser: the Playwright CDN is blocked and the distro's
`chromium-browser` is a snap stub. The capture code is written against the
documented API and needs a run against a real browser before it is trusted.

Everything downstream of `Capture` is fully tested, which is the part that
decides what a difference is and what it scores. The interface exists so a
remote browser pool or a recorded fixture can replace Playwright without
touching the comparison logic.

Also not built: serving the built project (builds are checked, not served), and
Figma reference-render export, which the pixel path needs to become active.

## Status

Implemented: DOM geometry comparison, node matching with attribute and text
fallback, pixel diff, region clustering, diff-image rendering, scoring,
prioritisation, persistence, and the stage orchestration.
