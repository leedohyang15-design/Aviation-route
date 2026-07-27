// Minimal .env loader (no dependency). Reads KEY=VALUE lines from a .env file in
// the current working directory and fills process.env for keys not already set.
// Keeps museum credentials out of the command line and out of git.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnv(file = '.env'): void {
  let text: string
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8')
  } catch {
    return // no .env — that's fine (mock feed will be used)
  }
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
    if (key && process.env[key] === undefined) process.env[key] = val
  }
}
