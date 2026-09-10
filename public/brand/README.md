# Brand assets

Generated from `components/layout/logo.tsx`, so these are the same mark the app
renders — 28x28 tile, 8px corner radius, 15x15 glyph, 10px gap, wordmark in
Plus Jakarta Sans Bold at 16px with -0.01em tracking.

| File | Use |
| --- | --- |
| `pixelforge-logo.svg` | Full lockup, for light backgrounds |
| `pixelforge-logo-inverse.svg` | Full lockup, for dark backgrounds |
| `pixelforge-mark.svg` | Square mark alone — avatars, favicons, app icons |
| `pixelforge-mark-inverse.svg` | Square mark on white |
| `pixelforge-logo@2x.png` / `@4x.png` | Lockup, transparent background (276x56, 552x112) |
| `pixelforge-logo-inverse@2x.png` / `@4x.png` | Same, for dark backgrounds |
| `pixelforge-mark-180.png` | 180x180 — Apple touch icon |
| `pixelforge-mark-512.png` | 512x512 — PWA manifest, store listings, social avatars |

## Which to upload

Prefer the **SVG** wherever the destination accepts one: it stays sharp at any
size. Use a **PNG** where it does not — GitHub org avatars, Slack, most social
profiles, Vercel project avatars.

For a square avatar use `pixelforge-mark-512.png`. For a header or an email
signature use `pixelforge-logo@4x.png` and scale it down; scaling a raster up is
what makes a logo look soft.

## One caveat on the SVG lockup

Its wordmark is live `<text>`, not outlines, because converting to paths needs
the font binary. Browsers render it correctly through the font stack, and so
will any tool with Plus Jakarta Sans installed (it is free on Google Fonts).

A tool without the font will substitute one and the wordmark will look subtly
wrong. If you are handing the logo to a printer, a agency, or anyone who cannot
install the font, **send the PNG** — or open the SVG in Figma or Illustrator and
export it with text converted to outlines.

The mark-only SVGs are pure geometry and have no such caveat.

## Favicon

`app/icon.svg` and `app/apple-icon.png` are copies of the mark. Next.js picks
those up by filename and serves them as the tab icon and the iOS home-screen
icon; there is nothing to link in `<head>`.
