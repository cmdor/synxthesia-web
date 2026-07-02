# synxthesia-web

Static landing page for [synxthesia](https://synxthesia.com).

## Page structure

The page is a single scrollable HTML file with four areas:

| Section | Element id | Notes |
|---|---|---|
| Hero | _(none)_ | Full-viewport animated gradient canvas — keep as-is |
| About | `#about` | Studio description — edit the two `<p>` tags freely |
| Products | `#products` | One `.product-card` per product — duplicate the block to add more |
| Contact | `#contact` | Email + LinkedIn — update `href` values as needed |

All copy is in `index.html`. Styles for the scrollable sections are at the bottom of `styles/main.css` under the `Content sections` comment block.

Brand source files (tokens, master logos) live in the sibling repo:

`/Users/cora/synxthesia`

## Preview locally

```bash
open index.html
```

Or serve the folder:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Logo asset

**Edit this file to change the logo:**

`assets/logo-mark.svg`

`index.html` references it on line with `src="assets/logo-mark.svg"`. Replace the SVG file (or point `src` at a PNG) when you export from Figma. You can also keep the master copy in `synxthesia/brand/assets/logo-mark.svg` and copy it here.

The bundled SVG is a placeholder until your final export is in place.

## Hero warp effect

`scripts/hero-warp.js` drives the full-width gradient canvas in the bottom section. Adjust warp strength via `warpStrength` in that file. Respects `prefers-reduced-motion` (static gradient only).

## Stack

Plain HTML + CSS. No build step. Font: [Averia Libre](https://fonts.google.com/specimen/Averia+Libre) via Google Fonts.
