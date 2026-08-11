/*
 * The card that stands in front of the exhibit while the maps land.
 *
 * Four planet maps are fetched the moment a window opens, and each one blocks
 * the main thread while it goes to the GPU — on the exhibit machine that is
 * about two seconds for Mars alone, plus eight hundred milliseconds for the
 * earth, in EVERY window. None of that work can be skipped and none of it can
 * be moved off the thread: it is a quarter of a billion pixels being resampled
 * by the browser before the driver will take them.
 *
 * What it can be is hidden. It all happens in the first few seconds after the
 * exhibit is switched on, when nobody is standing in front of it, and the only
 * thing wrong with it is that a half-drawn globe with a frozen window looks
 * broken. So the window puts this up first — it is painted before the loading
 * starts, so it survives the freeze on screen — and takes it away when the
 * renderer says every map has settled.
 *
 * The aeroplane keeps flying through all of it, and that is not luck. It moves
 * on transform alone, which the compositor animates on its own thread, so it
 * carries on while the main thread is stopped dead. Anything driven by
 * JavaScript — a counter, a spinner, a progress bar fed by real progress —
 * would freeze exactly when the wait is longest, and a stopped spinner reads as
 * a crash.
 */
import { useEffect, useState } from 'react'
import './boot-curtain.css'

interface Props {
  /** False until the renderer reports every map settled. */
  ready: boolean
  /** The dome frame draws its own furniture large; the control screen is a
   *  touchscreen at arm's length. Only the sizes differ. */
  variant?: 'dome' | 'control'
}

export function BootCurtain({ ready, variant = 'control' }: Props): JSX.Element | null {
  // Kept mounted through the fade so the last frame isn't a hard cut, then
  // unmounted so nothing sits over the map catching touches.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setGone(true), 600)
    return () => clearTimeout(t)
  }, [ready])
  if (gone) return null
  return (
    <div className={`boot-curtain ${variant} ${ready ? 'done' : ''}`}>
      <div className="boot-card">
        <div className="boot-title">여행 준비 중이에요</div>
        <div className="boot-sub">지구 · 화성 · 목성 지도를 펼치고 있어요</div>
        <div className="boot-route">
          <span className="boot-line" />
          <span className="boot-from" />
          <span className="boot-to" />
          <span className="boot-plane">
            {/* Drawn rather than an emoji: the exhibit machine's emoji font is
                not something this code gets to choose, and a tofu box in the
                middle of the opening screen is not a risk worth taking. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21 15.5 13.5 11V4.2a1.5 1.5 0 0 0-3 0V11L3 15.5v2l7.5-2.2v4l-2.2 1.4V22l3.7-1 3.7 1v-1.3L13.5 19.3v-4l7.5 2.2z"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>
  )
}
