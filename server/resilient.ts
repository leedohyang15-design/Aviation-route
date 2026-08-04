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
  setPaused(paused: boolean, why?: string): void
  /**
   * Called when the feed on screen changes between the simulation and live
   * data. The two have no aircraft in common, so anything holding an icao24 —
   * above all the current selection — is stale the moment this fires.
   */
  onSourceChange?: (source: 'opensky' | 'mock', count: number) => void
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
  let announcedLive = false

  /** Set the on-screen source, announcing a real handover exactly once. */
  function setLive(next: 'opensky' | 'mock', count: number): void {
    if (next === live && announcedLive) return
    const changed = next !== live || !announcedLive
    live = next
    announcedLive = true
    if (!changed) return
    opsLog(
      next === 'opensky'
        ? `[feed] live data took over — ${count} aircraft replace the simulation`
        : `[feed] simulation took over — ${count} aircraft replace the live data`
    )
    api.onSourceChange?.(next, count)
  }

  // Time since real data last arrived. Frozen while paused: pausing is a
  // deliberate stop for satellite mode, not an outage, and counting those
  // minutes as staleness made returning to flight mode look like an OpenSky
  // failure.
  const realAge = () => (paused && pausedAt ? pausedAt : Date.now()) - lastReal
  const isRealFresh = () => mode === 'auto' && lastReal > 0 && realAge() < STALE_MS

  // Declared as a const the closure can refer to, NOT built with Object.assign:
  // that copies a getter's current VALUE, which would freeze `source` at
  // whatever it was when the feed was created.
  const api: SwitchableFeed = {
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
          setLive('mock', lastMock.length)
          emit?.(lastMock)
        }
      } else if (isRealFresh() && lastRealData.length) {
        setLive('opensky', lastRealData.length)
        emit?.(lastRealData)
      }
    },
    setPaused(next: boolean, why = '다른 화면') {
      if (next === paused) return
      paused = next
      if (paused) {
        pausedAt = Date.now()
        opensky?.stop()
        mock.stop()
        // Say WHICH screen paused it. The log is the only thing anyone can read
        // on the packaged exe, and "why did polling stop" is a question it has
        // to answer honestly once there is more than one layer that pauses it.
        opsLog(`[feed] paused (${why}) — no OpenSky credits are being spent`)
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
  return api

  function startBoth(onSnapshot: (a: Aircraft[]) => void, onStatus: (connected: boolean) => void) {
      opensky?.start(
        (data) => {
          lastReal = Date.now()
          lastRealData = data
          // Ignore real data while the operator has pinned simulation.
          if (mode !== 'auto') return
          setLive('opensky', data.length)
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
          setLive('mock', data.length)
          onSnapshot(data)
          onStatus(true)
        }
      },
      () => {}
    )
  }
}
