// Shared airplane icon (top-down silhouette, nose pointing "north"/+y).
// Used by the display (three.js texture), the control map (MapLibre image), and
// the detail panel (inline ✈). White fill + thin dark outline so it reads on
// both bright land and dark ocean.

// The explicit width/height matter: an SVG with only a viewBox has no intrinsic
// size, so a browser rasterizing it into an <img> (which is how three.js loads
// this) falls back to a small default. That low-resolution bitmap was then
// mip-mapped down again, which is why the icons looked chewed-up on the dome.
export const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64">
  <path d="M32 3 C34 3 35.5 6 35.5 12 L35.5 25 L59 40 L59 45 L35.5 37.5 L35.5 52 L44 58 L44 61 L32 57.5 L20 61 L20 58 L28.5 52 L28.5 37.5 L5 45 L5 40 L28.5 25 L28.5 12 C28.5 6 30 3 32 3 Z"
    fill="#ffffff" stroke="#0b1020" stroke-width="2" stroke-linejoin="round"/>
</svg>`

export const PLANE_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(PLANE_SVG)}`
