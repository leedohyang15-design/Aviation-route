# Renderer static assets (`public/`)

Files here are served at the web root in dev and copied next to the built HTML.

## Optional: photographic earth

Drop an **equirectangular (2:1) earth image** named `earth_equirect.jpg` here to
replace the procedural ocean+graticule background on the display window.

Good free sources:

- NASA Visible Earth — "Blue Marble" (public domain), e.g. the 5400×2700 or
  8192×4096 equirectangular JPEGs.
- Natural Earth raster (public domain).

The file must be exactly 2:1 (width = 2 × height). It is intentionally
git-ignored so the repo stays small.

## Optional: the other two planets

The Mars and Jupiter tabs each want an **equirectangular (2:1) map** here:

- `mars_equirect.jpg` — any global MOLA/Viking colour mosaic.
- `jupiter_equirect.jpg` — any cylindrical (plate carree) Jupiter map; the
  Cassini global mosaic is the usual one.

Same rules as the earth image: exactly 2:1, and git-ignored so the repo stays
small. Without one the tab falls back to the wireframe grid and the log says
which file it wanted. Keep them at or under the GPU's texture limit — usually
8192 or 16384 px wide — or three.js rescales them on the CPU at load and the
tab appears to hang when a visitor presses it. 8192x4096 is ample: the dome
frame is 1664px across.
