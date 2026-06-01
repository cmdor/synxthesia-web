# synxthesia-web

Minimal static landing page for [synxthesia](https://synxthesia.com).

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
