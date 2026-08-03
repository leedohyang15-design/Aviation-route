// Orbital elements (TLEs) for the satellite mode.
//
// A TLE is a compact description of an orbit; feeding one to SGP4 gives a
// satellite's position at any moment, so the exhibit needs no live satellite
// feed at all — one download a day and everything after that is local maths.
// That is the opposite of the flight side, and much kinder to run.
//
// Celestrak regenerates these roughly daily and asks clients not to re-fetch
// faster than the data changes, so the set is cached next to the executable
// (same pattern as the route cache). If the network is down the exhibit keeps
// flying yesterday's elements — accuracy decays over days, not minutes.

import { readFileSync, writeFileSync } from 'node:fs'
import { dataPath, dataPathCandidates } from './datadir'
import { TLE_URL, TLE_MAX_AGE_MS } from '../src/shared/config'
import { opsLog } from './log'

export interface TleRecord {
  noradId: string
  name: string
  line1: string
  line2: string
}

const CACHE_NAME = 'aviation-route-tle.txt'
const CACHE_PATH = dataPath(CACHE_NAME)

function findCache(explicit?: string): { path: string; data: { text: string; age: number } } | null {
  for (const p of explicit ? [explicit] : dataPathCandidates(CACHE_NAME)) {
    const data = readCache(p)
    if (data) return { path: p, data }
  }
  return null
}

/**
 * Parse Celestrak's 3-line format: a name line followed by the two element
 * lines. Anything that doesn't look like a TLE pair is skipped rather than
 * throwing — a truncated download should cost us the tail, not everything.
 */
export function parseTle(text: string): TleRecord[] {
  const lines = text.split(/\r?\n/)
  const out: TleRecord[] = []
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const name = (lines[i] ?? '').trim()
    const l1 = (lines[i + 1] ?? '').trim()
    const l2 = (lines[i + 2] ?? '').trim()
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
    // Catalogue number lives in columns 3-7 of both element lines.
    const noradId = l1.slice(2, 7).trim()
    if (!noradId) continue
    out.push({ noradId, name: name || `SAT ${noradId}`, line1: l1, line2: l2 })
    i += 2
  }
  return out
}

function readCache(path: string): { text: string; age: number } | null {
  try {
    const raw = readFileSync(path, 'utf8')
    const nl = raw.indexOf('\n')
    const header = raw.slice(0, nl)
    if (!header.startsWith('#saved ')) return null
    const saved = Number(header.slice(7))
    if (!Number.isFinite(saved)) return null
    return { text: raw.slice(nl + 1), age: Date.now() - saved }
  } catch {
    return null // no cache yet — normal on first run
  }
}

/**
 * The current TLE set: cached copy when it's still fresh, otherwise a download
 * (falling back to a stale cache if the download fails). Returns an empty array
 * only when there is no cache AND no network — the caller logs that loudly
 * rather than quietly showing an empty sky.
 */
export async function loadTles(explicitPath?: string): Promise<TleRecord[]> {
  const hit = findCache(explicitPath)
  const cached = hit?.data ?? null
  const path = explicitPath ?? hit?.path ?? CACHE_PATH
  if (cached && cached.age < TLE_MAX_AGE_MS) {
    const recs = parseTle(cached.text)
    opsLog(`[tle] ${recs.length} satellites from cache (${Math.round(cached.age / 3600_000)}h old)`)
    return recs
  }

  try {
    const res = await fetch(TLE_URL, {
      headers: { 'User-Agent': 'aviation-route-exhibit/0.1 (museum kiosk)' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const recs = parseTle(text)
    if (!recs.length) throw new Error(`downloaded ${text.length} bytes but parsed 0 satellites`)
    try {
      writeFileSync(path, `#saved ${Date.now()}\n${text}`)
    } catch (err) {
      opsLog(`[tle] could not cache to disk: ${(err as Error).message}`)
    }
    opsLog(`[tle] downloaded ${recs.length} satellites from Celestrak`)
    return recs
  } catch (err) {
    // Loud, not silent: a satellite mode with no satellites should say why.
    opsLog(`[tle] download failed: ${(err as Error).message}`)
    if (cached) {
      const recs = parseTle(cached.text)
      opsLog(`[tle] falling back to cached set (${Math.round(cached.age / 3600_000)}h old, ${recs.length} satellites)`)
      return recs
    }
    opsLog('[tle] no cached elements either — satellite mode will be empty')
    return []
  }
}
