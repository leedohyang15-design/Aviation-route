// Minimal .env loader (no dependency). Reads KEY=VALUE lines from a .env file in
// the current working directory and fills process.env for keys not already set.
// Keeps museum credentials out of the command line and out of git.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    console.log(`[env] no ${file} found at ${path} — using mock feed`)
    return
  }
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
  console.log(`[env] loaded ${count} vars from ${file} (OpenSky credentials: ${hasCreds ? 'yes' : 'NO'})`)
}
