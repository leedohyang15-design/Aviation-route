// Rough flight category from the callsign prefix / aircraft type, used to badge
// planes whose scheduled route can't be looked up (military / cargo). Heuristic,
// not authoritative — just enough to give the exhibit a meaningful marker.

const CARGO = new Set([
  'FDX', // FedEx
  'UPS', // UPS
  'GTI', // Atlas Air
  'GEC', // Lufthansa Cargo
  'CLX', // Cargolux
  'CKS', // Kalitta
  'ABX', // ABX Air
  'BOX', // AeroLogic
  'CJT', // Cargojet
  'BCS', // European Air Transport (DHL)
  'MPH', // Martinair
  'TAY', // ASL Belgium
  'RCF', // Aircompany (cargo)
  'NCA', // Nippon Cargo
  'GSS', // Atlas Air (Global Supply)
  'CAO', // Air China Cargo
  'CKK', // China Cargo
  'QAC', // Qatar Cargo (aka QTR freighters)
  'SQC' // Singapore Cargo
])
const MILITARY = new Set([
  'RCH', // US Air Mobility (Reach)
  'CNV', // Convoy
  'PAT', // US Army Priority Air Transport
  'SPAR', // US special air mission
  'EVAC',
  'RRR', // UK RAF
  'CFC', // Canadian Forces
  'ASY', // (various)
  'BAF', // Belgian Air Force
  'GAF', // German Air Force
  'IAM', // Italian Air Force
  'FRF', // French AF
  'NOW' // (various mil)
])

export type FlightCategory = 'military' | 'cargo' | null

export function flightCategory(callsign?: string | null, type?: string | null): FlightCategory {
  const cs = (callsign ?? '').toUpperCase().trim()
  const p3 = cs.slice(0, 3)
  if (MILITARY.has(p3)) return 'military'
  if (CARGO.has(p3)) return 'cargo'
  if (type && /F$/.test(type.toUpperCase())) return 'cargo' // freighter type code, e.g. B77F/B74F
  return null
}

export function categoryLabel(cat: FlightCategory): string | null {
  return cat === 'military' ? '군용기' : cat === 'cargo' ? '화물기' : null
}
