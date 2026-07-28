// Resilient feed: OpenSky when it's delivering, mock as a live fallback.
//
// A museum display must never go blank. OpenSky can stall (rate limit / credits
// exhausted / network), so this wrapper keeps a mock feed running underneath and
// forwards it ONLY while real data is stale. When OpenSky recovers, real data
// takes over automatically — no restart. `source` reflects whichever is live, so
// the on-screen indicator stays honest.

import type { Aircraft } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { createMockFeed } from './mock'
import { createOpenSkyFeed } from './opensky'

/** How long without real data before the mock fallback takes over (ms). */
const STALE_MS = 60_000

export function createResilientFeed(): FlightFeed {
  const opensky = createOpenSkyFeed()
  const mock = createMockFeed()
  let lastReal = 0

  const isRealFresh = () => lastReal > 0 && Date.now() - lastReal < STALE_MS

  return {
    // Dynamic: honest about which source is currently on screen.
    get source() {
      return isRealFresh() ? 'opensky' : 'mock'
    },
    start(onSnapshot: (a: Aircraft[]) => void, onStatus: (connected: boolean) => void) {
      opensky.start(
        (data) => {
          lastReal = Date.now()
          onSnapshot(data)
          onStatus(true)
        },
        () => {
          /* OpenSky connectivity is handled via staleness, not surfaced directly */
        }
      )
      mock.start(
        (data) => {
          // Only fill in when real data has gone stale.
          if (!isRealFresh()) {
            onSnapshot(data)
            onStatus(true)
          }
        },
        () => {}
      )
    },
    stop() {
      opensky.stop()
      mock.stop()
    },
    getRoute(icao24: string) {
      // In mock mode the ids are mock ids → mock route; in real mode OpenSky has
      // no route data yet (returns null).
      return isRealFresh() ? opensky.getRoute(icao24) : mock.getRoute(icao24)
    }
  }
}
