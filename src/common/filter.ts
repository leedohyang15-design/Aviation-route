// Apply the operator's FlightFilter to the aircraft snapshot. Used by both the
// control map and the display so the two screens always show the same set.
import type { Aircraft, FlightFilter } from '@shared/types'
import { categoryKey } from './flightClass'

export function applyFilter(aircraft: Aircraft[], f: FlightFilter, keepId?: string | null): Aircraft[] {
  const hidden = f.hiddenCategories
  return aircraft.filter((a) => {
    // Always keep the selected/tracked plane, even if it momentarily goes
    // on-ground near its endpoints — otherwise dropping it mid-flight would
    // vanish the selection and freeze the dome that follows it.
    if (keepId && a.icao24 === keepId) return true
    if (hidden && hidden.length && hidden.includes(categoryKey(a.callsign))) return false
    if (f.airborneOnly && a.onGround) return false
    if (f.originCountry && a.originCountry !== f.originCountry) return false
    if (f.minAltitude != null && (a.altitude ?? 0) < f.minAltitude) return false
    if (f.maxAltitude != null && (a.altitude ?? Infinity) > f.maxAltitude) return false
    return true
  })
}
