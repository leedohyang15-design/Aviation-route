// Apply the operator's FlightFilter to the aircraft snapshot. Used by both the
// control map and the display so the two screens always show the same set.
import type { Aircraft, FlightFilter } from '@shared/types'

export function applyFilter(aircraft: Aircraft[], f: FlightFilter): Aircraft[] {
  return aircraft.filter((a) => {
    if (f.airborneOnly && a.onGround) return false
    if (f.originCountry && a.originCountry !== f.originCountry) return false
    if (f.airlinePrefix && !a.callsign.toUpperCase().startsWith(f.airlinePrefix.toUpperCase()))
      return false
    if (f.minAltitude != null && (a.altitude ?? 0) < f.minAltitude) return false
    if (f.maxAltitude != null && (a.altitude ?? Infinity) > f.maxAltitude) return false
    return true
  })
}
