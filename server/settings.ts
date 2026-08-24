/*
 * Operator settings — the values that can change without a rebuild.
 *
 * Everything here used to be a constant compiled into the bundle, which meant
 * that adjusting the exhibit by one number needed a developer, a toolchain and
 * a new build. This reads them from a file beside the exe instead, and the
 * settings screen writes to it.
 *
 * PRECEDENCE, and it matters: environment > file > default.
 *
 * The environment wins because that is where an existing install already keeps
 * its keys — a `.env` next to the exe — and a settings screen that silently
 * ignored the file somebody has been maintaining for months would be the worse
 * surprise. So a value coming from the environment is reported as such and the
 * screen shows it as locked, rather than accepting an edit that would do
 * nothing. Take the line out of `.env` and the screen owns it again.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dataDir, dataPath, dataPathCandidates } from './datadir'
import { LOG_PATH, opsLog } from './log'
import {
  HUB_PORT,
  JUPITER_DAY_PERIOD_MS,
  JUPITER_MAP_LAT_LIMIT,
  MARS_LIFT,
  MARS_TINT,
  MAPTILER_KEY,
  OPENSKY_POLL_INTERVAL_MS,
  SAT_TICK_MS,
  WEATHER_CACHE_MAX_AGE_MS,
  WEATHER_POLL_MS
} from '../src/shared/config'
import type { SecretState, Settings, SettingsView } from '../src/shared/types'
import { SETTINGS_NEED_RESTART } from '../src/shared/types'

const FILE = 'aviation-route-settings.json'
const VERSION = 1

interface Persisted {
  version: number
  saved: number
  settings: Partial<Settings>
}

/** Keys that are never sent to a window. See SettingsView. */
const SECRET_KEYS = ['openskyClientId', 'openskyClientSecret', 'maptilerKey'] as const
type SecretKey = (typeof SECRET_KEYS)[number]

/**
 * The defaults, taken from config.ts rather than restated.
 *
 * config.ts already reads the environment, so anything set in `.env` arrives
 * here as the default — which is exactly the precedence described above, for
 * free, and with no second copy of the numbers to drift out of step.
 */
function defaults(): Settings {
  return {
    openskyPollMs: OPENSKY_POLL_INTERVAL_MS,
    satTickMs: SAT_TICK_MS,
    weatherPollMs: WEATHER_POLL_MS,
    weatherMaxAgeMs: WEATHER_CACHE_MAX_AGE_MS,
    jupiterMapLatLimit: JUPITER_MAP_LAT_LIMIT,
    jupiterDayPeriodMs: JUPITER_DAY_PERIOD_MS,
    marsLift: MARS_LIFT,
    marsTint: [MARS_TINT[0] ?? 1, MARS_TINT[1] ?? 1, MARS_TINT[2] ?? 1],
    hubPort: HUB_PORT,
    openskyClientId: process.env.OPENSKY_CLIENT_ID ?? '',
    openskyClientSecret: process.env.OPENSKY_CLIENT_SECRET ?? '',
    maptilerKey: MAPTILER_KEY
  }
}

/**
 * Bounds, so a slip of a finger on a touchscreen cannot take the exhibit down.
 *
 * These are not opinions about the right value — they are the range in which
 * the program still works. The poll floor in particular is a real limit rather
 * than a preference: OpenSky's free budget is about a thousand requests a day,
 * so anything under thirty seconds empties the sky before the museum closes.
 */
const LIMITS: Record<string, { min: number; max: number }> = {
  openskyPollMs: { min: 30_000, max: 600_000 },
  satTickMs: { min: 500, max: 30_000 },
  weatherPollMs: { min: 60_000, max: 3_600_000 },
  weatherMaxAgeMs: { min: 10 * 60_000, max: 24 * 3600_000 },
  jupiterMapLatLimit: { min: 20, max: 90 },
  jupiterDayPeriodMs: { min: 0, max: 3_600_000 },
  marsLift: { min: 0.4, max: 2.5 },
  hubPort: { min: 1024, max: 65535 }
}

function clampNumber(key: string, value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const lim = LIMITS[key]
  if (!lim) return value
  return Math.min(lim.max, Math.max(lim.min, value))
}

let current: Settings = defaults()
/** Which keys the file actually carries — so the screen can say where a value
 *  came from, and so writing one key never re-saves the other twenty. */
let fromFile = new Set<string>()
/** Restart-only keys changed since the process started. */
const dirtyRestart = new Set<string>()
let loaded = false

/** The live settings. Read this at the point of USE, never at import time —
 *  the whole point is that these change while the exhibit is running. */
export function settings(): Settings {
  if (!loaded) load()
  return current
}

/** Which environment variables are pinning a key, and therefore which edits the
 *  settings screen must refuse rather than silently drop. */
function envHeld(key: keyof Settings): boolean {
  const names: Partial<Record<keyof Settings, string>> = {
    openskyPollMs: 'OPENSKY_POLL_INTERVAL_MS',
    satTickMs: 'SAT_TICK_MS',
    weatherPollMs: 'WEATHER_POLL_MS',
    weatherMaxAgeMs: 'WEATHER_CACHE_MAX_AGE_MS',
    jupiterMapLatLimit: 'JUPITER_MAP_LAT_LIMIT',
    jupiterDayPeriodMs: 'JUPITER_DAY_PERIOD_MS',
    marsLift: 'MARS_LIFT',
    hubPort: 'HUB_PORT',
    openskyClientId: 'OPENSKY_CLIENT_ID',
    openskyClientSecret: 'OPENSKY_CLIENT_SECRET',
    maptilerKey: 'MAPTILER_KEY'
  }
  const name = names[key]
  return !!name && process.env[name] != null && process.env[name] !== ''
}

export function load(): void {
  loaded = true
  current = defaults()
  fromFile = new Set()
  for (const path of dataPathCandidates(FILE)) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    try {
      const data = JSON.parse(raw) as Persisted
      if (data.version !== VERSION || !data.settings) {
        opsLog(`[settings] ${path} is version ${data.version}, expected ${VERSION} — ignored`)
        continue
      }
      const merged = { ...current }
      for (const [k, v] of Object.entries(data.settings)) {
        if (!(k in merged)) continue
        const key = k as keyof Settings
        // The environment keeps the last word — see the note at the top.
        if (envHeld(key)) continue
        if (key === 'marsTint') {
          const t = v as unknown[]
          if (!Array.isArray(t) || t.length !== 3) continue
          merged.marsTint = [Number(t[0]) || 1, Number(t[1]) || 1, Number(t[2]) || 1]
        } else if (typeof merged[key] === 'number') {
          ;(merged[key] as number) = clampNumber(key, Number(v), merged[key] as number)
        } else if (typeof merged[key] === 'string') {
          ;(merged[key] as string) = String(v ?? '')
        } else {
          continue
        }
        fromFile.add(key)
      }
      current = merged
      opsLog(`[settings] ${fromFile.size} value(s) from ${path}`)
      return
    } catch (err) {
      opsLog(`[settings] ${path} could not be read: ${(err as Error).message} — using defaults`)
    }
  }
  opsLog(`[settings] no settings file yet — defaults (and .env) in force`)
}

function save(): void {
  // Only what the file owns. Saving the whole object would bake this build's
  // defaults into the file, and then a later build's better default could never
  // reach a machine that had once opened the settings screen.
  const out: Partial<Settings> = {}
  for (const key of fromFile) out[key as keyof Settings] = current[key as keyof Settings] as never
  const path = dataPath(FILE)
  try {
    writeFileSync(path, JSON.stringify({ version: VERSION, saved: Date.now(), settings: out }, null, 2))
  } catch (err) {
    opsLog(`[settings] COULD NOT SAVE to ${path}: ${(err as Error).message}`)
  }
}

/**
 * Apply a patch and persist it. Returns what actually changed, because the
 * caller has to restart the loops whose interval moved and nothing else.
 */
export function update(patch: Partial<Settings>): (keyof Settings)[] {
  if (!loaded) load()
  const changed: (keyof Settings)[] = []
  for (const [k, raw] of Object.entries(patch)) {
    if (!(k in current)) continue
    const key = k as keyof Settings
    if (envHeld(key)) {
      opsLog(`[settings] ${key} is pinned by the environment — the edit was refused`)
      continue
    }
    let next: unknown
    if (key === 'marsTint') {
      const t = raw as unknown[]
      if (!Array.isArray(t) || t.length !== 3) continue
      next = [Number(t[0]) || 1, Number(t[1]) || 1, Number(t[2]) || 1]
      if ((next as number[]).join() === current.marsTint.join()) continue
    } else if (SECRET_KEYS.includes(key as SecretKey)) {
      const v = String(raw ?? '')
      // Empty means "I did not touch this box"; a single dash means "clear it".
      if (v === '') continue
      next = v === '-' ? '' : v
      if (next === current[key]) continue
    } else if (typeof current[key] === 'number') {
      next = clampNumber(key, Number(raw), current[key] as number)
      if (next === current[key]) continue
    } else {
      continue
    }
    ;(current[key] as unknown) = next
    fromFile.add(key)
    changed.push(key)
    if ((SETTINGS_NEED_RESTART as readonly string[]).includes(key)) dirtyRestart.add(key)
  }
  if (!changed.length) return changed
  save()
  // Never the values — this line goes in a file somebody may well email.
  opsLog(`[settings] changed: ${changed.join(', ')}`)
  return changed
}

/** Restore every value the file owns, i.e. go back to defaults and `.env`. */
export function reset(): (keyof Settings)[] {
  if (!loaded) load()
  const changed = [...fromFile] as (keyof Settings)[]
  fromFile = new Set()
  current = defaults()
  for (const key of changed) {
    if ((SETTINGS_NEED_RESTART as readonly string[]).includes(key)) dirtyRestart.add(key)
  }
  save()
  opsLog(`[settings] reset to defaults (${changed.length} value(s) dropped)`)
  return changed
}

function secretState(key: SecretKey): SecretState {
  const v = current[key]
  return { set: !!v, tail: v ? v.slice(-4) : '', fromEnv: envHeld(key) }
}

/** What a window is allowed to see. The secrets are described, never sent. */
export function view(): SettingsView {
  const s = settings()
  const source: SettingsView['source'] = {}
  for (const key of Object.keys(s) as (keyof Settings)[]) {
    source[key] = envHeld(key) ? 'env' : fromFile.has(key) ? 'file' : 'default'
  }
  return {
    openskyPollMs: s.openskyPollMs,
    satTickMs: s.satTickMs,
    weatherPollMs: s.weatherPollMs,
    weatherMaxAgeMs: s.weatherMaxAgeMs,
    jupiterMapLatLimit: s.jupiterMapLatLimit,
    jupiterDayPeriodMs: s.jupiterDayPeriodMs,
    marsLift: s.marsLift,
    marsTint: s.marsTint,
    hubPort: s.hubPort,
    secrets: {
      openskyClientId: secretState('openskyClientId'),
      openskyClientSecret: secretState('openskyClientSecret'),
      maptilerKey: secretState('maptilerKey')
    },
    dataDir: dataDir(),
    logPath: LOG_PATH,
    restartPending: dirtyRestart.size > 0,
    source
  }
}
