// The flight feed: OpenSky, and nothing behind it.
//
// There used to be a simulation running underneath, forwarded whenever real
// data went stale, plus an operator switch to pin it. It was there so a museum
// display would never go blank — but a globe covered in aircraft that do not
// exist is worse than an empty one, and it cost far more than it looked: two
// sets of aircraft with no icao24 in common, so every handover invalidated the
// selection, the route, the card and the camera; a source flag threaded through
// the hub; a mode in the presentation state and a control on screen; and a
// standing question, whenever anything looked odd, of which feed had drawn it.
//
// Now: if OpenSky is not answering, the sky is empty and the status line says
// so. What remains here is the pause, which is not a fallback — it stops the
// polling while the exhibit is showing satellites or weather, so those minutes
// do not spend the day's credit budget on aircraft nobody is looking at.

import type { Aircraft } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { createOpenSkyFeed, hasOpenSkyCredentials } from './opensky'
import { opsLog } from './log'

export interface PausableFeed extends FlightFeed {
  /** Stop/resume upstream polling entirely — used while the exhibit is showing
   * satellites or weather, so those minutes don't spend the daily OpenSky
   * credit budget. */
  setPaused(paused: boolean, why?: string): void
}

export function createFlightFeed(): PausableFeed {
  const upstream = hasOpenSkyCredentials() ? createOpenSkyFeed() : null
  let paused = false
  let started = false
  let emit: ((a: Aircraft[]) => void) | null = null
  let status: ((c: boolean) => void) | null = null

  if (!upstream) {
    opsLog(
      '[feed] OpenSky 키가 없어 하늘이 비어 있습니다 — 설정 화면(톱니바퀴 길게 누르기)의 ' +
        '"연결과 키"에 넣고 다시 시작하세요. 위성·화성·목성은 키 없이도 동작합니다.'
    )
  }

  return {
    source: 'opensky',
    start(onSnapshot, onStatus) {
      emit = onSnapshot
      status = onStatus
      if (!upstream) {
        // Say it once and settle: connected=false is what the control screen
        // reads to show "no live data" rather than "still connecting".
        onStatus(false)
        onSnapshot([])
        return
      }
      started = true
      upstream.start(
        (a) => {
          if (!paused) emit?.(a)
        },
        (c) => status?.(c)
      )
    },
    stop() {
      started = false
      upstream?.stop()
    },
    getDetail: (icao24) => upstream?.getDetail(icao24) ?? Promise.resolve(null),
    setPaused(next, why) {
      if (next === paused) return
      paused = next
      if (!upstream) return
      if (next) {
        upstream.stop()
        opsLog(`[feed] paused${why ? ` (${why})` : ''} — no OpenSky credits are being spent`)
      } else if (started) {
        upstream.start(
          (a) => {
            if (!paused) emit?.(a)
          },
          (c) => status?.(c)
        )
        opsLog('[feed] resumed')
      }
    }
  }
}
