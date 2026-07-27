// Shared runtime configuration.
//
// On the Node side (hub / electron main) values come from process.env so the
// exhibit machine can be tuned without a rebuild. In the browser renderer
// `process` is undefined, so the defaults below are used — the defaults are the
// correct local values, and only advanced deployments need to override them.

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env[key] != null) {
    return process.env[key]
  }
  return undefined
}

/** Port the local WebSocket hub listens on. */
export const HUB_PORT = Number(readEnv('HUB_PORT') ?? 8787)

/** ws:// URL the renderer windows connect to (hub is always local). */
export const HUB_URL = readEnv('HUB_URL') ?? `ws://127.0.0.1:${HUB_PORT}`

/** Poll interval (ms) for the upstream flight-data source. */
export const POLL_INTERVAL_MS = Number(readEnv('POLL_INTERVAL_MS') ?? 8000)

/** Equirectangular render target. Must stay exactly 2:1 for sphere projection. */
export const EQUIRECT_WIDTH = Number(readEnv('EQUIRECT_WIDTH') ?? 4096)
export const EQUIRECT_HEIGHT = EQUIRECT_WIDTH / 2

/**
 * Optional photographic earth texture. Drop an equirectangular (2:1) image at
 * this path (renderer `public/` in dev, next to the built html in production).
 * If absent, the display falls back to a procedural ocean + graticule.
 */
export const EARTH_TEXTURE_URL = 'earth_equirect.jpg'
