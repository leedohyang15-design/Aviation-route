// A FlightFeed is any source of live aircraft snapshots. The hub is agnostic to
// which one is running (real OpenSky vs. dev mock), so they share this shape.

import type { Aircraft, FlightDetail } from '../src/shared/types'

export interface FlightFeed {
  readonly source: 'opensky' | 'mock'
  /** Begin polling. `onSnapshot` fires with the full current aircraft set. */
  start(onSnapshot: (aircraft: Aircraft[]) => void, onStatus: (connected: boolean) => void): void
  stop(): void
  /**
   * Rich detail for one aircraft (route + origin/destination/type/times).
   * Async because real sources may enrich over the network. Returns null when
   * nothing is known.
   */
  getDetail(icao24: string): Promise<FlightDetail | null>
}
