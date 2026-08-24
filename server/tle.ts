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
import { TLE_URL, TLE_FALLBACK_URLS, TLE_MAX_AGE_MS } from '../src/shared/config'
import { opsLog } from './log'

export interface TleRecord {
  noradId: string
  name: string
  line1: string
  line2: string
}

const CACHE_NAME = 'aviation-route-tle.txt'
const CACHE_PATH = dataPath(CACHE_NAME)

/**
 * When the element set on screen was downloaded, epoch ms — or null before
 * anything has loaded.
 *
 * An absolute instant rather than an age, because the windows are told once
 * and then run for months: an age would be right for a second and quietly
 * wrong for the rest of the day. Each window subtracts it from its own clock.
 */
let fetchedAt: number | null = null
export function tleFetchedAt(): number | null {
  return fetchedAt
}

/**
 * What actually went wrong on the last attempt, or null once something is on
 * screen.
 *
 * `fetchedAt` alone cannot say this: it starts at null and STAYS null when a
 * download fails with no cache to fall back on, which is indistinguishable
 * from "hasn't tried yet" to anything reading it. On screen that is a tab that
 * says "궤도 정보 불러오는 중" forever, because loading never actually starts
 * again until the next scheduled attempt — hours away — or somebody presses
 * 새로고침. A visitor has no way to tell "about to arrive" from "never coming"
 * by looking at the same three words.
 */
let lastError: string | null = null
export function tleLastError(): string | null {
  return lastError
}

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
 * One request, with the server's own explanation attached when it says no.
 *
 * `HTTP 403` on its own cost this project an afternoon: it reads like a
 * blocked network or a bad URL, and the actual body said "GP data has not
 * updated since your last successful download of GROUP=active at 04:38:22
 * UTC. Data is updated once every 2 hours." — an entirely different problem
 * with an entirely different fix. Celestrak answers in plain text, so the
 * reason is right there to be read; not reading it was the whole difficulty.
 */
async function fetchTle(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'aviation-route-exhibit/0.1 (museum kiosk)' }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${body ? ` — ${summarise(body)}` : ''}`)
  }
  return res.text()
}

/**
 * The gist of an error body, in one line.
 *
 * Celestrak's informative refusals are plain text and worth printing whole.
 * Its hard blocks are an IIS error PAGE — a full HTML document, doctype and
 * stylesheet and all — and printing the first 200 characters of that fills
 * the log with `<meta http-equiv=...` and never reaches the sentence that
 * matters. So HTML is reduced to its <title>, which is exactly the one useful
 * line ("403 - Forbidden: Access is denied").
 */
function summarise(body: string): string {
  const flat = body.trim()
  if (/^\s*<(!doctype|html)/i.test(flat)) {
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(flat)?.[1]?.trim()
    return title ? `${title} (서버가 HTML 오류 페이지를 보냈습니다)` : 'HTML 오류 페이지'
  }
  return flat.replace(/\s+/g, ' ').slice(0, 200)
}

/**
 * True for the refusal that means "you already have this", which names the
 * group it is refusing and is therefore worth answering by asking for a
 * DIFFERENT group. Any other refusal — an IIS block page, a 500, a timeout —
 * is about us or about the whole service, and trying six more URLs against a
 * server that just said no is how a soft block becomes a hard one.
 */
function isGroupRateLimit(message: string): boolean {
  return /has not updated|last successful download/i.test(message)
}

/**
 * The elements, from the configured group if it will have us and from the
 * smaller groups if it will not.
 *
 * The fallbacks are merged rather than raced: each is a different slice of the
 * catalogue, so taking only the first would put a handful of space stations on
 * screen when six requests could have filled the sky. Failures among them are
 * not fatal — the goal is "enough satellites", not "all of them" — but if
 * every single one refuses, the error thrown is the FIRST one, because that is
 * the primary group's answer and the one that explains what is going on.
 */
async function download(): Promise<string> {
  try {
    return await fetchTle(TLE_URL)
  } catch (err) {
    const primary = (err as Error).message
    if (!TLE_FALLBACK_URLS.length) throw err
    opsLog(`[tle] ${primary}`)
    // Only the "you already downloaded this group" refusal is worth walking
    // around; everything else means asking again — six more times — is part of
    // the problem rather than the way out.
    if (!isGroupRateLimit(primary)) {
      opsLog('[tle] 그룹별 제한이 아니라 서버가 통째로 거절한 것이라 우회하지 않습니다')
      throw err
    }
    opsLog(`[tle] 기본 목록이 막혀 다른 그룹 ${TLE_FALLBACK_URLS.length}개로 우회합니다`)

    const seen = new Set<string>()
    const parts: string[] = []
    const won: string[] = []
    for (const url of TLE_FALLBACK_URLS) {
      const group = /GROUP=([^&]+)/i.exec(url)?.[1] ?? url
      try {
        const text = await fetchTle(url)
        // Merge by catalogue number: a station listed in both `stations` and
        // `visual` would otherwise be propagated and drawn twice.
        let added = 0
        for (const rec of parseTle(text)) {
          if (seen.has(rec.noradId)) continue
          seen.add(rec.noradId)
          parts.push(`${rec.name}\n${rec.line1}\n${rec.line2}`)
          added++
        }
        if (added) won.push(`${group} ${added}개`)
      } catch (e) {
        opsLog(`[tle] ${group} 그룹도 실패: ${(e as Error).message}`)
      }
    }
    if (!parts.length) throw new Error(primary)
    opsLog(`[tle] 우회 성공 — ${won.join(', ')} (합계 ${seen.size}개)`)
    return `${parts.join('\n')}\n`
  }
}

/**
 * The current TLE set: cached copy when it's still fresh, otherwise a download
 * (falling back to a stale cache if the download fails). Returns an empty array
 * only when there is no cache AND no network — the caller logs that loudly
 * rather than quietly showing an empty sky.
 */
export async function loadTles(explicitPath?: string, force = false): Promise<TleRecord[]> {
  const hit = findCache(explicitPath)
  const cached = hit?.data ?? null
  const path = explicitPath ?? hit?.path ?? CACHE_PATH
  // `force` is the 새로고침 button: skip the freshness rule and go and ask.
  // The stale-cache fallback below still applies if the download fails, so the
  // worst case of pressing it is that nothing changes.
  if (!force && cached && cached.age < TLE_MAX_AGE_MS) {
    const recs = parseTle(cached.text)
    fetchedAt = Date.now() - cached.age
    lastError = null
    opsLog(`[tle] ${recs.length} satellites from cache (${Math.round(cached.age / 3600_000)}h old)`)
    return recs
  }

  try {
    const text = await download()
    const recs = parseTle(text)
    if (!recs.length) throw new Error(`downloaded ${text.length} bytes but parsed 0 satellites`)
    try {
      writeFileSync(path, `#saved ${Date.now()}\n${text}`)
    } catch (err) {
      opsLog(`[tle] could not cache to disk: ${(err as Error).message}`)
    }
    fetchedAt = Date.now()
    lastError = null
    opsLog(`[tle] downloaded ${recs.length} satellites from Celestrak`)
    return recs
  } catch (err) {
    // Loud, not silent: a satellite mode with no satellites should say why.
    const reason = (err as Error).message
    opsLog(`[tle] download failed: ${reason}`)
    if (cached) {
      const recs = parseTle(cached.text)
      fetchedAt = Date.now() - cached.age
      // A stale cache is still SOMETHING on screen, with its own age already
      // shown — not the dead end lastError exists to flag.
      lastError = null
      opsLog(`[tle] falling back to cached set (${Math.round(cached.age / 3600_000)}h old, ${recs.length} satellites)`)
      return recs
    }
    lastError = reason
    opsLog('[tle] no cached elements either — satellite mode will be empty')
    return []
  }
}
