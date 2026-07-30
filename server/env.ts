// Minimal .env loader (no dependency). Reads KEY=VALUE lines from a .env file and
// fills process.env for keys not already set. Keeps museum credentials out of the
// command line and out of git. Looks in the working directory AND next to the
// executable / resources, so a packaged build finds a .env dropped beside the exe.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { opsLog } from './log'

export function loadEnv(file = '.env'): void {
  const dirs = [
    process.cwd(), // dev / launched-from-here
    dirname(process.execPath), // next to the .exe (packaged)
    (process as { resourcesPath?: string }).resourcesPath ?? '' // app resources dir
  ].filter(Boolean) as string[]
  // Windows Notepad silently saves ".env" as ".env.txt" (hidden extension), so
  // accept that spelling too — it's the #1 reason a dropped-in .env "does nothing".
  const names = [file, `${file}.txt`]
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const d of dirs) {
    for (const n of names) {
      const p = resolve(d, n)
      // cwd and the exe's directory are the same when launched in place — don't
      // list the same path twice in the log.
      if (seen.has(p)) continue
      seen.add(p)
      candidates.push(p)
    }
  }

  let text: string | null = null
  let path = ''
  for (const p of candidates) {
    try {
      text = readFileSync(p, 'utf8')
      path = p
      break
    } catch {
      /* try the next location */
    }
  }
  if (text == null) {
    opsLog(`[env] no ${file} found (looked in: ${candidates.join(', ')}) — using mock feed`)
    return
  }
  // Strip a UTF-8 BOM (Notepad "UTF-8" adds one), else the first key becomes
  // an invisible-prefixed "OPENSKY_CLIENT_ID" and never matches — credentials
  // would be silently ignored.
  text = text.replace(/^﻿/, '')
  let count = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // Strip surrounding quotes if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val
      count++
    }
  }
  const hasCreds = Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
  opsLog(`[env] loaded ${count} vars from ${path} (OpenSky credentials: ${hasCreds ? 'yes' : 'NO'})`)
}
