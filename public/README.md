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
