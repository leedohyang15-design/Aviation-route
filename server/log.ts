// One diagnostic log written next to the executable. A packaged .exe has no
// console, so this file is the only way to see startup decisions (which .env was
// found, whether OpenSky credentials loaded, which feed is live, why a poll
// failed) on a museum kiosk. In dev it also prints to the real console.
//
// It is also kept in memory, so the app can show it to the operator on the 기록
// tab without anybody opening a text editor on a kiosk — which on Windows also
// sidesteps the console's code page turning every Korean line into "??".
import { appendFileSync } from 'node:fs'
import { dataPath } from './datadir'
import type { LogLevel, LogLine } from '../src/shared/types'

export const LOG_PATH = dataPath('aviation-route.log')

/**
 * How many lines are kept for the 기록 tab.
 *
 * A day's worth is far more than anybody scrolls, and the tab is for "what just
 * happened" rather than for an archive — the FILE is the archive. Two thousand
 * lines is a few hundred kilobytes and covers a normal day of startup, polls
 * and tab switches with room to spare.
 */
const KEEP = 2000

/**
 * Which lines are a problem, and which are just news.
 *
 * Judged from the text rather than declared at each of the hundred call sites,
 * because retrofitting a level argument onto every one of them would be a
 * hundred chances to get it wrong for no benefit the operator can see. It is a
 * heuristic and it is allowed to be: it drives a colour and a filter chip, not
 * a decision. A line it misjudges is still there in full, under 전체.
 */
const BAD = /FATAL|COULD NOT|could not|failed|error|rejected|invalid/
const WARN =
  /NOTHING|not shown|refused|paused|stall|never answered|too old|WIDER THAN|no\/invalid|falling back|fallback|없음|holding|ignored/

function classify(msg: string): LogLevel {
  if (BAD.test(msg)) return 'bad'
  if (WARN.test(msg)) return 'warn'
  return 'info'
}

/** `[tag]` at the front of the line, which is how every message here is written
 *  — it is the subsystem, and it is what the filter chips are built from. */
function tagOf(msg: string): string {
  const m = /^\s*\[([a-z0-9-]+)\]/i.exec(msg)
  return m ? m[1].toLowerCase() : 'etc'
}

const buffer: LogLine[] = []
let nextId = 1
const listeners = new Set<(line: LogLine) => void>()

/** The lines held for the 기록 tab, oldest first. */
export function recentLog(limit = KEEP): LogLine[] {
  return limit >= buffer.length ? buffer.slice() : buffer.slice(buffer.length - limit)
}

/** Called for every new line. Used by the hub to stream to a window that has
 *  the 기록 tab open. */
export function onLogLine(fn: (line: LogLine) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function opsLog(msg: string): void {
  const at = Date.now()
  try {
    appendFileSync(LOG_PATH, `[${new Date(at).toISOString()}] ${msg}\n`)
  } catch {
    /* log location not writable — console below is the only sink then */
  }
  // eslint-disable-next-line no-console
  console.log(msg)

  /*
   * Identical consecutive lines are counted, not repeated.
   *
   * A poll that fails every thirty seconds writes the same sentence all night,
   * and scrolling past four hundred copies of it is how somebody misses the one
   * line underneath that says something else. The FILE still gets every
   * occurrence — it is the record — but the screen shows one row with a count.
   */
  const last = buffer[buffer.length - 1]
  if (last && last.text === msg) {
    last.count++
    last.at = at
    for (const fn of listeners) fn(last)
    return
  }

  const line: LogLine = {
    id: nextId++,
    at,
    text: msg,
    tag: tagOf(msg),
    level: classify(msg),
    count: 1
  }
  buffer.push(line)
  if (buffer.length > KEEP) buffer.splice(0, buffer.length - KEEP)
  for (const fn of listeners) fn(line)
}
