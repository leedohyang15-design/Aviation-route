// Diagnostic: could OpenSky's /flights endpoint replace per-callsign route
// lookups?
//
// A first probe showed one 2-hour window returning ~210 usable callsigns, but
// that number alone doesn't decide anything. What matters is COVERAGE: of the
// aircraft actually flying right now, how many would we already have a route
// for? OpenSky can only estimate departure/arrival where its ground receivers
// saw the takeoff and landing, so coverage is uneven by region — and the exhibit
// is in Korea.
//
// So this sweeps a day of history, then compares it against a live snapshot and
// reports the one number that settles it. It also counts how many distinct
// airports would need coordinates, since OpenSky returns ICAO codes only.
//
//   npx tsx scripts/test-opensky-flights.ts [hours]      (default 24)
//
// Costs roughly one credit-charge per 2-hour window plus one snapshot — about
// 13 requests for the default sweep, out of a 4,000/day budget.

import { loadEnv } from '../server/env'
import { isKnownFlight } from '../src/common/flightClass'

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

interface Flight {
  callsign?: string | null
  estDepartureAirport?: string | null
  estArrivalAirport?: string | null
}

async function token(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID as string,
      client_secret: process.env.OPENSKY_CLIENT_SECRET as string
    })
  })
  if (!res.ok) throw new Error(`token failed: ${res.status} ${await res.text().catch(() => '')}`)
  return ((await res.json()) as { access_token: string }).access_token
}

const norm = (cs: string) => cs.trim().toUpperCase()

async function main(): Promise<void> {
  loadEnv()
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    console.error('No OpenSky credentials found — put .env next to this project first.')
    process.exit(1)
  }
  const hours = Number(process.argv[2] ?? 24)
  const bearer = await token()
  console.log(`token OK — sweeping the last ${hours}h in 2h windows\n`)

  // callsign -> "DEP→ARR", plus the set of airports we'd need coordinates for.
  const routes = new Map<string, string>()
  const airports = new Set<string>()
  let rawFlights = 0
  let sameAirport = 0
  let credits = ''

  // Flights need to have LANDED before OpenSky can estimate an arrival airport,
  // so the sweep stops an hour short of now.
  const newest = Math.floor(Date.now() / 1000) - 3600
  for (let w = 0; w < Math.ceil(hours / 2); w++) {
    const end = newest - w * 2 * 3600
    const begin = end - 2 * 3600
    const url = `https://opensky-network.org/api/flights/all?begin=${begin}&end=${end}`
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } })
    } catch (err) {
      console.log(`  window -${w * 2}h: request failed (${(err as Error).message})`)
      continue
    }
    credits = res.headers.get('X-Rate-Limit-Remaining') ?? credits
    if (!res.ok) {
      console.log(`  window -${w * 2}h: HTTP ${res.status}`)
      continue
    }
    const rows = (await res.json().catch(() => null)) as Flight[] | null
    if (!Array.isArray(rows)) {
      console.log(`  window -${w * 2}h: unexpected body`)
      continue
    }
    rawFlights += rows.length
    let added = 0
    for (const f of rows) {
      const cs = f.callsign ? norm(f.callsign) : ''
      const dep = f.estDepartureAirport ?? ''
      const arr = f.estArrivalAirport ?? ''
      if (!cs || !dep || !arr) continue
      if (dep === arr) {
        sameAirport++ // local/training flight — no route line to draw
        continue
      }
      if (!routes.has(cs)) added++
      routes.set(cs, `${dep}→${arr}`) // newest window wins
      airports.add(dep)
      airports.add(arr)
    }
    console.log(`  window -${w * 2}h: ${rows.length} flights, +${added} new callsigns`)
  }

  console.log(`\n--- what a ${hours}h sweep yields ---`)
  console.log(`flights seen        : ${rawFlights.toLocaleString()}`)
  console.log(`usable routes       : ${routes.size.toLocaleString()} callsigns`)
  console.log(`dropped (dep==arr)  : ${sameAirport.toLocaleString()}`)
  console.log(`airports needing xy : ${airports.size.toLocaleString()}   <-- coordinate table size`)
  console.log(`credits left        : ${credits || '(not reported)'}`)

  // The decisive test: how much of what's flying RIGHT NOW would this cover?
  console.log('\n--- coverage against live traffic ---')
  const sres = await fetch('https://opensky-network.org/api/states/all', {
    headers: { Authorization: `Bearer ${bearer}` }
  })
  if (!sres.ok) {
    console.log(`could not fetch live states (HTTP ${sres.status}) — skipping coverage check`)
    return
  }
  const snap = (await sres.json()) as { states: (string | number | boolean | null)[][] | null }
  const live = (snap.states ?? [])
    .map((s) => ((s[1] as string) ?? '').trim().toUpperCase())
    .filter(Boolean)
  // The exhibit only ever looks up identifiable airline/cargo/military callsigns.
  const known = [...new Set(live.filter((cs) => isKnownFlight(cs)))]
  const covered = known.filter((cs) => routes.has(cs))
  const pct = known.length ? Math.round((covered.length / known.length) * 100) : 0

  console.log(`airborne now        : ${live.length.toLocaleString()}`)
  console.log(`identifiable        : ${known.length.toLocaleString()}  (what we'd need routes for)`)
  console.log(`covered by sweep    : ${covered.length.toLocaleString()}  = ${pct}%`)

  console.log('\n--- verdict ---')
  if (pct >= 70) {
    console.log(`${pct}% coverage from ~${Math.ceil(hours / 2)} requests. Worth building.`)
  } else if (pct >= 35) {
    console.log(`${pct}% coverage — a useful head start, but ${100 - pct}% would still be unknown.`)
  } else {
    console.log(`Only ${pct}% coverage — OpenSky history alone can't carry this.`)
  }
  console.log(`A coordinate table of ~${airports.size.toLocaleString()} ICAO airports is required either way.`)
}

main().catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
