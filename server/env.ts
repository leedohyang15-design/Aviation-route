// Minimal .env loader (no dependency). Reads KEY=VALUE lines from a .env file and
// fills process.env for keys not already set. Keeps museum credentials out of the
// command line and out of git. Looks in the working directory AND next to the
// executable / resources, so a packaged build finds a .env dropped beside the exe.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

export function loadEnv(file = '.env'): void {
  const candidates = [
    resolve(process.cwd(), file), // dev / launched-from-here
    resolve(dirname(process.execPath), file), // next to the .exe (packaged)
    (process as { resourcesPath?: string }).resourcesPath
      ? resolve((process as { resourcesPath?: string }).resourcesPath as string, file)
      : '' // app resources dir
  ].filter(Boolean)

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
    console.log(`[env] no ${file} found (looked in: ${candidates.join(', ')}) — using mock feed`)
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
  console.log(`[env] loaded ${count} vars from ${path} (OpenSky credentials: ${hasCreds ? 'yes' : 'NO'})`)
}
