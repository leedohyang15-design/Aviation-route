// Rough flight category from the callsign prefix / aircraft type, used to color
// planes and badge them. Heuristic (there's no authoritative passenger/cargo/
// military flag in OpenSky), but covers the common operators. Everything not
// recognised as cargo or military is treated as a passenger flight.

import { airlineFromCallsign } from './airlines'

// Cargo operator ICAO callsign prefixes.
const CARGO = new Set([
  'FDX', // FedEx
  'UPS', // UPS
  'GTI', // Atlas Air
  'GSS', // Atlas Air (Global Supply System)
  'GEC', // Lufthansa Cargo
  'CLX', // Cargolux
  'CLU', // Cargolux Italia
  'CKS', // Kalitta Air
  'CKK', // China Cargo
  'ABX', // ABX Air
  'ABW', // AirBridgeCargo
  'BOX', // AeroLogic
  'CJT', // Cargojet
  'BCS', // DHL (European Air Transport)
  'DHK', // DHL Air UK
  'DHX', // DHL Aero Expreso
  'DAE', // DHL Aviation
  'MPH', // Martinair
  'TAY', // ASL Airlines Belgium
  'ABR', // ASL Airlines Ireland
  'NCA', // Nippon Cargo
  'CAO', // Air China Cargo
  'CYZ', // China Postal
  'SQC', // Singapore Airlines Cargo
  'PAC', // Polar Air Cargo
  'WGN', // Western Global
  'KYE', // AeroTransCargo
  'RCF', // Aircompany cargo
  'NCR', // National Air Cargo
  'GEC',
  'MSX', // Aeronaves TSM
  'LCO', // LATAM Cargo
  'QTR', // (Qatar has freighters too — mostly passenger, but many QTR-freight)
  'CV', // Cargolux (IATA fallback)
  'RUN', // ACT Airlines
  'CWC', // Challenge / cargo
  'SVW', // (cargo)
  'ETH' // (Ethiopian has large freighter fleet) — mostly passenger though
])

// Military ICAO callsign prefixes (mostly transport / tanker / support).
const MILITARY = new Set([
  'RCH', // US Air Mobility Command (Reach)
  'CNV', // US Navy (Convoy)
  'PAT', // US Army Priority Air Transport
  'SPAR', // US special air mission
  'EVAC',
  'RRR', // UK RAF (Ascot)
  'CFC', // Canadian Forces (Canforce)
  'GAF', // German Air Force
  'IAM', // Italian Air Force
  'FAF', // French Air Force
  'CTM', // French military transport (COTAM)
  'BAF', // Belgian Air Force
  'NAF', // Netherlands Air Force
  'SUI', // Swiss Air Force (sometimes)
  'HUAF',
  'PLF', // Polish Air Force
  'ROF', // Romanian
  'NATO', // NATO
  'BRK', // (various mil)
  'MMF', // Multinational MRTT
  'IAF', // Indian Air Force
  'KAF', // Korean Air Force
  'RSF', // Royal Saudi
  'AME', // (military)
  'NOW' // (various mil)
])

export type FlightCategory = 'military' | 'cargo' | null

export function flightCategory(callsign?: string | null, type?: string | null): FlightCategory {
  const cs = (callsign ?? '').toUpperCase().trim()
  const p3 = cs.slice(0, 3)
  const p4 = cs.slice(0, 4)
  if (MILITARY.has(p3) || MILITARY.has(p4)) return 'military'
  if (CARGO.has(p3)) return 'cargo'
  // Freighter ICAO type codes end in F (B77F, B74F, A33F, MD1F…) — only known
  // for the enriched (selected) plane, but a useful extra signal when present.
  if (type && /F$/.test(type.toUpperCase())) return 'cargo'
  return null
}

/**
 * The shape of an ICAO flight callsign: a three-letter operator code followed
 * by a flight number — KAL902, NGN4830, QTR65R, QLK562D.
 *
 * This is what actually separates a scheduled flight from a private one, and it
 * does not depend on knowing the operator. Aircraft registrations, which is what
 * general aviation transmits, do not have this shape: N172SP is one letter then
 * digits, HL7788 and JA8088 are two, D-ABCD and G-ABCD are all letters. The
 * three-then-digit pattern is the discriminator.
 */
const AIRLINE_CALLSIGN = /^[A-Z]{3}\d/

/**
 * Whether this is a real commercial or military flight rather than private or
 * general-aviation traffic.
 *
 * This used to require the operator to be in our name table, which holds about a
 * hundred carriers against several thousand worldwide — so major airlines we
 * simply hadn't listed were being counted as private aircraft, and (worse) were
 * excluded from route lookups, which is why they had no route either. Matching
 * the callsign's shape covers every operator without a table to maintain, and a
 * route that adsbdb has actually resolved settles it outright.
 */
export function isKnownFlight(callsign?: string | null, hasRoute?: boolean): boolean {
  if (hasRoute === true) return true // adsbdb found a published route: it's a real flight
  const cs = (callsign ?? '').toUpperCase().trim()
  if (AIRLINE_CALLSIGN.test(cs)) return true
  return airlineFromCallsign(callsign) != null || flightCategory(callsign) != null
}

/**
 * The bucket an aircraft is counted and coloured in.
 *
 * `other` is its own category rather than a fallback to `passenger`. It holds
 * every aircraft whose callsign matches no known airline, cargo or military
 * operator: business jets and private aircraft (which broadcast a registration
 * like "N172SP" rather than a flight number), training flights, helicopters,
 * survey and medical aircraft, and anything transmitting a blank callsign.
 * These have no published route because they are not scheduled services.
 *
 * They are about half of everything OpenSky reports, so folding them into
 * "여객기" made that count roughly double what it should be. Their own chip and
 * their own colour keeps the numbers meaning what they say.
 */
export type CategoryKey = 'passenger' | 'cargo' | 'military' | 'other'
export function categoryKey(
  callsign?: string | null,
  type?: string | null,
  hasRoute?: boolean
): CategoryKey {
  const cat = flightCategory(callsign, type)
  if (cat) return cat
  return isKnownFlight(callsign, hasRoute) ? 'passenger' : 'other'
}

