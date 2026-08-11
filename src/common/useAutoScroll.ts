import { useEffect, useRef } from 'react'

/**
 * Scroll a box by itself, slowly, so nobody has to know it scrolls.
 *
 * The Mars cards are the only ones in the exhibit that can hold more text than
 * fits, and how much they hide depends on the screen: on a 1080p control panel
 * Opportunity's timeline runs 19px past the bottom of its box, and on a 900px
 * one it runs 114. Either way the gesture that would reveal the rest is a drag
 * inside a 300px panel, which is not something a seven-year-old standing at a
 * museum kiosk knows to try. Content nobody can reach is content that is not
 * there.
 *
 * So it crawls. Not a carousel and not an animation: 8 pixels a second is
 * slower than anybody reads, which is the point — it should never take a line
 * away from somebody in the middle of it, and it should be possible to ignore
 * entirely while reading the part already on screen.
 */

/** Pixels per second. Deliberately below reading pace. */
const SPEED = 8
/** Sit still at the top before setting off, so movement is not the first thing
 *  the card does — that reads as a glitch rather than as an invitation. */
const TOP_HOLD = 4000
/** And at the bottom, which is where the ending is and worth dwelling on. */
const BOTTOM_HOLD = 6000
/** Crawling back up reads as aimless drift; a quick rewind reads as "again". */
const RETURN_MS = 700
/** A hand on the box wins, and keeps winning for a while after it lets go. */
const TOUCH_PAUSE = 8000
/**
 * Driven by a timer rather than requestAnimationFrame.
 *
 * rAF is the right tool for something that has to look smooth at 60fps, and
 * the wrong one here twice over: at 8 pixels a second a frame moves a seventh
 * of a pixel, so the extra 55 callbacks a second buy nothing, and rAF is tied
 * to the compositor — it stops when nothing is being painted. This exhibit
 * runs two windows for months at a time, one of them full-screen on a
 * projector, and a text panel that silently stops scrolling whenever the
 * compositor decides to idle is a failure nobody would ever catch on a desk.
 * A 50ms timer is 0.4px a step, which is below the eye's threshold anyway.
 */
const TICK_MS = 50

type Phase = 'holdTop' | 'crawl' | 'holdBottom' | 'rewind'

export function useAutoScroll<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let phase: Phase = 'holdTop'
    /** End of the current hold, or the start of the rewind. */
    let mark = Date.now() + TOP_HOLD
    /** Where the rewind started from. */
    let from = 0
    let touchedAt = 0
    /*
     * The position is kept here, not read back from the element.
     *
     * A step is 0.4px. Reading scrollTop back and adding to it relies on the
     * browser storing sub-pixel scroll offsets, and where it does not the sum
     * rounds to zero every time and the panel sits still forever — a bug that
     * would look exactly like the feature never having been written.
     */
    let pos = 0

    const step = (): void => {
      // Nothing to reveal — Viking 1 and Curiosity fit their boxes exactly, and
      // a panel that twitches for no reason is worse than one that sits still.
      const room = el.scrollHeight - el.clientHeight
      if (room < 8) return

      const now = Date.now()
      if (now - touchedAt < TOUCH_PAUSE) {
        // Somebody is reading it themselves. Give up the cycle and restart from
        // wherever they left it rather than yanking the page back.
        phase = 'holdTop'
        mark = now + TOP_HOLD
        pos = el.scrollTop
        return
      }

      switch (phase) {
        case 'holdTop':
        case 'holdBottom':
          if (now < mark) return
          if (phase === 'holdTop') {
            phase = 'crawl'
          } else {
            phase = 'rewind'
            from = pos
            mark = now
          }
          return
        case 'crawl':
          pos = Math.min(room, pos + (SPEED * TICK_MS) / 1000)
          el.scrollTop = pos
          if (pos >= room - 0.5) {
            phase = 'holdBottom'
            mark = now + BOTTOM_HOLD
          }
          return
        case 'rewind': {
          const k = Math.min(1, (now - mark) / RETURN_MS)
          // Ease out, so the rewind arrives rather than stops.
          pos = from * (1 - k) * (1 - k)
          el.scrollTop = pos
          if (k >= 1) {
            phase = 'holdTop'
            mark = now + TOP_HOLD
          }
          return
        }
      }
    }

    const touched = (): void => {
      touchedAt = Date.now()
    }
    const EVENTS = ['pointerdown', 'wheel', 'touchstart'] as const
    for (const ev of EVENTS) el.addEventListener(ev, touched, { passive: true })

    const timer = setInterval(step, TICK_MS)
    return () => {
      clearInterval(timer)
      for (const ev of EVENTS) el.removeEventListener(ev, touched)
    }
  }, [])

  return ref
}
