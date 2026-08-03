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
  let pausedAt = 0
  let lastMock: Aircraft[] = []
  let lastRealData: Aircraft[] = []
  /**
   * Which feed produced the snapshot currently on screen.
   *
   * `source` and `getDetail` used to infer this from staleness, which is a
   * proxy, not the fact. When the two disagreed — during a transition, or after
   * a pause — the hub would ask the simulation for the detail of a real
   * aircraft, get null, and the flight would draw with no route at all.
   */
  let live: 'opensky' | 'mock' = 'mock'

  // Time since real data last arrived. Frozen while paused: pausing is a
  // deliberate stop for satellite mode, not an outage, and counting those
  // minutes as staleness made returning to flight mode look like an OpenSky
  // failure.
  const realAge = () => (paused && pausedAt ? pausedAt : Date.now()) - lastReal
  const isRealFresh = () => mode === 'auto' && lastReal > 0 && realAge() < STALE_MS

  return {
    // What is actually on screen, not what freshness suggests should be.
    get source() {
      return live
    },
    setMode(next: FeedMode) {
      if (next === mode) return
      mode = next
      opsLog(`[feed] mode → ${next === 'mock' ? 'simulation (forced)' : 'live data'}`)
      // Repaint from the target source immediately. Otherwise the screen would
      // keep the other source's planes until its next tick — and live polls can
      // be 90s apart, which would leave simulated traffic under a "live" label.
      if (next === 'mock') {
        if (lastMock.length) {
          live = 'mock'
          emit?.(lastMock)
        }
      } else if (isRealFresh() && lastRealData.length) {
        live = 'opensky'
        emit?.(lastRealData)
      }
    },
    setPaused(next: boolean) {
      if (next === paused) return
      paused = next
      if (paused) {
        pausedAt = Date.now()
        opensky?.stop()
        mock.stop()
        opsLog('[feed] paused (satellite mode) — no OpenSky credits are being spent')
      } else {
        // Carry the freshness clock over the pause, so the first poll after
        // resuming isn't racing a fallback that shouldn't have armed.
        if (pausedAt && lastReal) lastReal += Date.now() - pausedAt
        pausedAt = 0
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
      // Delegate to whichever source actually produced the aircraft on screen.
      return live === 'opensky' && opensky ? opensky.getDetail(icao24) : mock.getDetail(icao24)
    }
  }

  function startBoth(onSnapshot: (a: Aircraft[]) => void, onStatus: (connected: boolean) => void) {
      opensky?.start(
        (data) => {
          lastReal = Date.now()
          lastRealData = data
          // Ignore real data while the operator has pinned simulation.
          if (mode !== 'auto') return
          live = 'opensky'
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
          live = 'mock'
          onSnapshot(data)
          onStatus(true)
        }
      },
      () => {}
    )
  }
}
