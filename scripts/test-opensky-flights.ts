// Diagnostic: does OpenSky's /flights/all endpoint give us usable
// origin/destination data in bulk?
//
// The exhibit currently resolves routes one callsign at a time from adsbdb,
// which takes ~25 minutes to work through a day's traffic. OpenSky's state
// vectors carry no origin/destination, but its /flights endpoints do — and in
// bulk. Before building on that, this script checks what actually comes back:
// whether the request succeeds, how many flights it returns, how many carry BOTH
// airports, and what it costs in credits.
//
// Deliberately makes ONE small request so it can't eat the daily budget.
//
//   npx tsx scripts/test-opensky-flights.ts
//
// Reads OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET from .env, same as the app.

import { loadEnv } from '../server/env'

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

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

async function main(): Promise<void> {
  loadEnv()
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    console.error('No OpenSky credentials found — put .env next to this project first.')
    process.exit(1)
  }

  const bearer = await token()
  console.log('token OK\n')

  // A 2-hour window that ended an hour ago: flights need to have LANDED before
  // OpenSky can estimate an arrival airport, so a live window would be empty.
  const end = Math.floor(Date.now() / 1000) - 3600
  const begin = end - 2 * 3600
  const url = `https://opensky-network.org/api/flights/all?begin=${begin}&end=${end}`
  console.log(`GET ${url}`)
  console.log(`(window: ${new Date(begin * 1000).toISOString()} → ${new Date(end * 1000).toISOString()})\n`)

  const t0 = Date.now()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } })
  const ms = Date.now() - t0
  console.log(`status         : ${res.status} ${res.statusText}  (${ms}ms)`)
  console.log(`credits left   : ${res.headers.get('X-Rate-Limit-Remaining') ?? '(not reported)'}`)

  const text = await res.text()
  console.log(`body size      : ${text.length.toLocaleString()} bytes`)
  if (!res.ok) {
    console.log(`body           : ${text.slice(0, 300)}`)
    console.log('\n=> /flights/all is NOT usable with this account/window.')
    return
  }

  let rows: Record<string, unknown>[]
  try {
    rows = JSON.parse(text)
  } catch {
    console.log(`body           : ${text.slice(0, 300)}`)
    console.log('\n=> response is not JSON — not usable.')
    return
  }
  if (!Array.isArray(rows)) {
    console.log('\n=> response is not an array — not usable.')
    return
  }

  const withBoth = rows.filter((r) => r.estDepartureAirport && r.estArrivalAirport)
  const withCallsign = withBoth.filter((r) => (r.callsign as string)?.trim())
  const uniqueCallsigns = new Set(withCallsign.map((r) => (r.callsign as string).trim().toUpperCase()))

  console.log(`\nflights        : ${rows.length.toLocaleString()}`)
  console.log(`  with BOTH airports  : ${withBoth.length.toLocaleString()}`)
  console.log(`  …and a callsign     : ${withCallsign.length.toLocaleString()}`)
  console.log(`  unique callsigns    : ${uniqueCallsigns.size.toLocaleString()}   <-- routes we could seed`)
  console.log('\nsample rows:')
  for (const r of withCallsign.slice(0, 5)) {
    console.log(
      `  ${String(r.callsign).trim().padEnd(8)} ${r.estDepartureAirport} → ${r.estArrivalAirport}`
    )
  }

  console.log('\n--- verdict ---')
  if (uniqueCallsigns.size > 200) {
    console.log(`One request seeded ${uniqueCallsigns.size} callsigns. Bulk seeding is worth building.`)
    console.log('Note: airports come back as ICAO codes with NO coordinates, so the app would')
    console.log('also need a bundled ICAO -> lat/lon table to draw the route lines.')
  } else {
    console.log(`Only ${uniqueCallsigns.size} usable callsigns — not enough to beat adsbdb.`)
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
