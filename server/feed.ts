// A FlightFeed is a source of live aircraft snapshots. One implementation now
// — OpenSky — but the hub still talks to it through this shape rather than to
// the client directly, which is what keeps the pause wrapper possible.

import type { Aircraft, FlightDetail } from '../src/shared/types'

export interface FlightFeed {
  readonly source: 'opensky'
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
