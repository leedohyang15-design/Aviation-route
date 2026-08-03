// Resilient feed: OpenSky when it's delivering, mock as a live fallback.
//
// A museum display must never go blank. OpenSky can stall (rate limit / credits
// exhausted / network), so this wrapper keeps a mock feed running underneath and
// forwards it ONLY while real data is stale. When OpenSky recovers, real data
// takes over automatically — no restart. `source` reflects whichever is live, so
// the on-screen indicator stays honest.
//
// The operator can also force simulation from the control window (`setMode`),
// e.g. to demo the exhibit or when the daily credit budget is gone.

import type { Aircraft, FeedMode } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { OPENSKY_POLL_INTERVAL_MS } from '../src/shared/config'
import { createMockFeed } from './mock'
import { createOpenSkyFeed, hasOpenSkyCredentials } from './opensky'
import { opsLog } from './log'

/** How long without real data before the mock fallback takes over (ms). Must be
 * comfortably longer than the poll interval, otherwise the normal gap between
 * (deliberately slow) OpenSky polls would flap to simulation and back every
 * cycle. Only a genuine outage — several missed polls — should trigger mock. */
const STALE_MS = OPENSKY_POLL_INTERVAL_MS * 2 + 60_000

export interface SwitchableFeed extends FlightFeed {
  /** Force simulation ('mock') or return to live data ('auto'). */
  setMode(mode: FeedMode): void
  /** Stop/resume upstream polling entirely — used while the exhibit is showing
   * satellites, so those minutes don't spend the daily OpenSky credit budget. */
  setPaused(paused: boolean): void
}

export function createResilientFeed(): SwitchableFeed {
  // Without credentials there is nothing to poll — run simulation only, but keep
  // the same shape so the hub and the control toggle behave identically.
  const opensky = hasOpenSkyCredentials() ? createOpenSkyFeed() : null
  const mock = createMockFeed()
  let lastReal = 0
  let mode: FeedMode = 'auto'
  let emit: ((a: Aircraft[]) => void) | null = null
  let status: ((c: boolean) => void) | null = null
  let paused = false
  let lastMock: Aircraft[] = []
  let lastRealData: Aircraft[] = []

  const isRealFresh = () => mode === 'auto' && lastReal > 0 && Date.now() - lastReal < STALE_MS

  return {
    // Dynamic: honest about which source is currently on screen.
    get source() {
      return isRealFresh() ? 'opensky' : 'mock'
    },
    setMode(next: FeedMode) {
      if (next === mode) return
      mode = next
      opsLog(`[feed] mode → ${next === 'mock' ? 'simulation (forced)' : 'live data'}`)
      // Repaint from the target source immediately. Otherwise the screen would
      // keep the other source's planes until its next tick — and live polls can
      // be 90s apart, which would leave simulated traffic under a "live" label.
      if (next === 'mock') {
        if (lastMock.length) emit?.(lastMock)
      } else if (isRealFresh() && lastRealData.length) {
        emit?.(lastRealData)
      }
    },
    setPaused(next: boolean) {
      if (next === paused) return
      paused = next
      if (paused) {
        opensky?.stop()
        mock.stop()
        opsLog('[feed] paused (satellite mode) — no OpenSky credits are being spent')
      } else {
        opsLog('[feed] resumed')
        if (emit && status) startBoth(emit, status)
      }
    },
    start(onSnapshot: (a: Aircraft[]) => void, onStatus: (connected: boolean) => void) {
      emit = onSnapshot
      status = onStatus
      startBoth(onSnapshot, onStatus)
    },
    stop() {
      opensky?.stop()
      mock.stop()
    },
    getDetail(icao24: string) {
      // Delegate to whichever source is currently on screen.
      return isRealFresh() && opensky ? opensky.getDetail(icao24) : mock.getDetail(icao24)
    }
  }

  function startBoth(onSnapshot: (a: Aircraft[]) => void, onStatus: (connected: boolean) => void) {
      opensky?.start(
        (data) => {
          lastReal = Date.now()
          lastRealData = data
          // Ignore real data while the operator has pinned simulation.
          if (mode !== 'auto') return
          onSnapshot(data)
          onStatus(true)
        },
        () => {
          /* OpenSky connectivity is handled via staleness, not surfaced directly */
        }
      )
    mock.start(
      (data) => {
        lastMock = data
        // Only fill in when real data is stale or simulation is forced.
        if (!isRealFresh()) {
          onSnapshot(data)
          onStatus(true)
        }
      },
      () => {}
    )
  }
}
