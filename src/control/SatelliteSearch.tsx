// Find a satellite by name from the control screen.
//
// The catalogue is sixteen thousand objects, so scrolling or clicking your way
// to a particular one is hopeless — "where is the ISS?" is a question the
// exhibit could not answer at all. Typing a few letters and pressing Enter now
// selects it, which centres both screens on it and draws its orbit.

import { useMemo, useRef, useState } from 'react'
import type { OrbitClass, Satellite } from '@shared/types'

const ORBIT_LABEL: Record<OrbitClass, string> = {
  leo: '저궤도',
  starlink: '스타링크',
  meo: '중궤도',
  geo: '정지궤도'
}

const MAX_RESULTS = 7

interface Indexed {
  id: string
  name: string
  upper: string
  orbit: OrbitClass
}

interface Props {
  satellites: Satellite[]
  /** Orbit classes currently hidden — a hit in one of these needs unhiding. */
  hiddenOrbits: OrbitClass[]
  onPick: (sat: Satellite) => void
}

export function SatelliteSearch({ satellites, hiddenOrbits, onPick }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // The positions arrive once a second, so `satellites` is a new array on every
  // tick — but names and ids only change when the orbital elements reload, once
  // a day. Key the uppercase index on the roster size so a live feed doesn't
  // re-scan sixteen thousand strings every second.
  const roster = satellites.length
  const index = useMemo<Indexed[]>(
    () => satellites.map((s) => ({ id: s.id, name: s.name, upper: s.name.toUpperCase(), orbit: s.orbit })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster]
  )

  const results = useMemo<Indexed[]>(() => {
    const q = query.trim().toUpperCase()
    if (q.length < 2) return []
    const starts: Indexed[] = []
    const contains: Indexed[] = []
    for (const s of index) {
      // NORAD number is worth matching too — it's what the panel and every
      // external tracking site identify a satellite by.
      if (s.id.startsWith(q)) starts.push(s)
      else if (s.upper.startsWith(q)) starts.push(s)
      else if (s.upper.includes(q)) contains.push(s)
      if (starts.length >= MAX_RESULTS) break
    }
    // Shorter names first: searching "ISS" should offer ISS before ISS DEB.
    const byLength = (a: Indexed, b: Indexed) => a.name.length - b.name.length
    return [...starts.sort(byLength), ...contains.sort(byLength)].slice(0, MAX_RESULTS)
  }, [index, query])

  const pick = (hit: Indexed): void => {
    const sat = satellites.find((s) => s.id === hit.id)
    if (sat) onPick(sat)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[Math.min(cursor, results.length - 1)])
    }
  }

  return (
    <div className="sat-search">
      <input
        ref={inputRef}
        className="sat-search-input"
        type="search"
        value={query}
        placeholder="🔍 위성 이름 검색 (예: ISS, STARLINK, NOAA)"
        aria-label="위성 이름 검색"
        onChange={(e) => {
          setQuery(e.target.value)
          setCursor(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // A click on a result would otherwise be eaten by the blur that closes
        // the list; the delay lets the pointerup land first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && query.trim().length >= 2 && (
        <div className="sat-search-results">
          {results.length === 0 ? (
            <div className="sat-search-empty">그런 이름의 위성이 없어요</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                className={'sat-search-hit' + (i === cursor ? ' on' : '')}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(r)}
              >
                <span className="sat-search-name">{r.name}</span>
                <span className="sat-search-meta">
                  {ORBIT_LABEL[r.orbit]}
                  {hiddenOrbits.includes(r.orbit) && <em> · 숨김 해제됨</em>} · #{r.id}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
