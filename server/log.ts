// One diagnostic log written next to the executable. A packaged .exe has no
// console, so this file is the only way to see startup decisions (which .env was
// found, whether OpenSky credentials loaded, which feed is live, why a poll
// failed) on a museum kiosk. In dev it also prints to the real console.
import { appendFileSync } from 'node:fs'
import { dataPath } from './datadir'

export const LOG_PATH = dataPath('aviation-route.log')

export function opsLog(msg: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* log location not writable — console below is the only sink then */
  }
  // eslint-disable-next-line no-console
  console.log(msg)
}
