// Rough flight category from the callsign prefix / aircraft type, used to color
// planes and badge them. Heuristic (there's no authoritative passenger/cargo/
// military flag in OpenSky), but covers the common operators. Everything not
// recognised as cargo or military is treated as a passenger flight.

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

export function categoryLabel(cat: FlightCategory): string {
  return cat === 'military' ? '군용기' : cat === 'cargo' ? '화물기' : '여객기'
}

/** Icon/dot color per category (passenger cyan, cargo amber, military green). */
export function categoryColorHex(cat: FlightCategory): string {
  return cat === 'military' ? '#74d16a' : cat === 'cargo' ? '#f5a623' : '#35c1ff'
}
