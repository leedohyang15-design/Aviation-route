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
 * It is deliberately not a spinner. A spinner that stops moving (which this one
 * would, the thread being blocked) reads as a crash; a still card reads as
 * waiting.
 */
import { useEffect, useState } from 'react'
import './boot-curtain.css'

interface Props {
  /** False until the renderer reports every map settled. */
  ready: boolean
  /** The dome frame draws its own furniture large; the control screen is a
   *  touchscreen at arm's length. Only the text size differs. */
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
        <div className="boot-title">전시를 준비하고 있어요</div>
        <div className="boot-sub">지구 · 화성 · 목성 지도를 불러오는 중</div>
        <div className="boot-bar">
          <span />
        </div>
      </div>
    </div>
  )
}
