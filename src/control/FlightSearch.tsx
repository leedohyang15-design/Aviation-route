// Find an aircraft by flight number or airline from the control screen.
//
// The satellite layer has had this since the catalogue got too big to browse;
// the flight layer is the same problem for the same reason. Six thousand dots
// and a visitor who wants "the Korean Air one" or the flight their family is
// on has no way to get there by clicking — the aircraft is a two-pixel dot
// somewhere over Siberia.
//
// Deliberately the same markup and the same CSS classes as SatelliteSearch, so
// the two layers offer one control that behaves one way.

import { useMemo, useRef, useState } from 'react'
import type { Aircraft } from '@shared/types'
import { airlineFromCallsign } from '../common/airlines'
import { categoryKey, type CategoryKey } from '../common/flightClass'

const MAX_RESULTS = 7

const CAT_LABEL: Record<CategoryKey, string> = {
  passenger: '여객기',
  cargo: '화물기',
  military: '군용기',
  other: '자가용 · 기타'
}

interface Indexed {
  id: string
  callsign: string
  airline: string | null
  upper: string
  cat: CategoryKey
}

interface Props {
  aircraft: Aircraft[]
  /** Categories currently hidden — a hit in one of these needs unhiding. */
  hiddenCategories: CategoryKey[]
  onPick: (a: Aircraft) => void
}

export function FlightSearch({ aircraft, hiddenCategories, onPick }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // A snapshot lands every 90 seconds and the array is new each time, but the
  // callsigns in it barely change. Re-index on the roster size rather than on
  // identity so typing doesn't re-scan six thousand strings between keystrokes.
  const roster = aircraft.length
  const index = useMemo<Indexed[]>(
    () =>
      aircraft.map((a) => {
        const cs = (a.callsign ?? '').trim().toUpperCase()
        const airline = airlineFromCallsign(a.callsign)
        return {
          id: a.icao24,
          callsign: cs,
          airline,
          upper: `${cs} ${(airline ?? '').toUpperCase()}`,
          cat: categoryKey(a.callsign, null, a.hasRoute)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster]
  )

  const results = useMemo<Indexed[]>(() => {
    const q = query.trim().toUpperCase()
    if (q.length < 2) return []
    const starts: Indexed[] = []
    const contains: Indexed[] = []
    for (const a of index) {
      if (!a.callsign) continue
      if (a.callsign.startsWith(q)) starts.push(a)
      else if (a.upper.includes(q)) contains.push(a)
      if (starts.length >= MAX_RESULTS) break
    }
    const byName = (x: Indexed, y: Indexed) => x.callsign.localeCompare(y.callsign)
    return [...starts.sort(byName), ...contains.sort(byName)].slice(0, MAX_RESULTS)
  }, [index, query])

  const pick = (hit: Indexed): void => {
    const a = aircraft.find((x) => x.icao24 === hit.id)
    if (a) onPick(a)
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
        placeholder="🔍 편명 · 항공사 검색 (예: KAL, KE902, Korean)"
        aria-label="편명 또는 항공사 검색"
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
            <div className="sat-search-empty">지금 하늘에 그런 비행기가 없어요</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                className={'sat-search-hit' + (i === cursor ? ' on' : '')}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(r)}
              >
                <span className="sat-search-name">{r.callsign}</span>
                <span className="sat-search-meta">
                  {r.airline ?? CAT_LABEL[r.cat]}
                  {hiddenCategories.includes(r.cat) && <em> · 숨김 해제됨</em>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
