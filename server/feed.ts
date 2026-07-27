// A FlightFeed is any source of live aircraft snapshots. The hub is agnostic to
// which one is running (real OpenSky vs. dev mock), so they share this shape.

import type { Aircraft, GeoPoint } from '../src/shared/types'

export interface FlightFeed {
  readonly source: 'opensky' | 'mock'
  /** Begin polling. `onSnapshot` fires with the full current aircraft set. */
  start(onSnapshot: (aircraft: Aircraft[]) => void, onStatus: (connected: boolean) => void): void
  stop(): void
  /**
   * Best-effort route for one aircraft as geographic points (great-circle
   * origin→destination). Returns null when the source can't supply a route.
   */
  getRoute(icao24: string): GeoPoint[] | null
}
