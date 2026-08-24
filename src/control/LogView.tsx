/*
 * The 기록 tab: the operator's log, on screen, in the app.
 *
 * The file it comes from is a wall of English sentences in the order they
 * happened, and on a Windows console the Korean parts of it come out as "??"
 * because the console's code page is not UTF-8. Neither of those is a good way
 * to answer "what is wrong with the exhibit right now".
 *
 * So this does four things the file cannot:
 *   - groups by subsystem, so 날씨 trouble can be read without 위성 noise
 *   - separates problems from news, so the one line that matters is findable
 *   - collapses a line that repeated four hundred times into one row with a
 *     count (the file still has all four hundred — it is the record)
 *   - copies what is on screen to the clipboard, which is how a log gets sent
 *     to somebody who can read it
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogLine } from '@shared/types'

interface Props {
  lines: LogLine[]
  /** Where the file itself lives, for somebody who wants the whole archive. */
  path: string
}

/** The subsystems, in the order they matter to somebody diagnosing a screen.
 *  `tag` is what server/log.ts pulled out of the `[...]` prefix. */
const GROUPS: { id: string; label: string; tags: string[] }[] = [
  { id: 'all', label: '전체', tags: [] },
  { id: 'flight', label: '비행기', tags: ['opensky', 'routes', 'feed'] },
  { id: 'sat', label: '위성', tags: ['sat', 'tle'] },
  { id: 'weather', label: '날씨', tags: ['weather'] },
  { id: 'planet', label: '화성 · 목성', tags: ['mars', 'jupiter'] },
  { id: 'screen', label: '화면', tags: ['layer', 'stall', 'boot', 'earth', 'night', 'switch'] },
  { id: 'system', label: '시스템', tags: ['hub', 'settings', 'env'] }
]

function hhmmss(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function LogView({ lines, path }: Props): JSX.Element {
  const [group, setGroup] = useState('all')
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [follow, setFollow] = useState(true)
  const [copied, setCopied] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group)
    return lines.filter((l) => {
      if (problemsOnly && l.level === 'info') return false
      if (!g || !g.tags.length) return true
      return g.tags.includes(l.tag)
    })
  }, [lines, group, problemsOnly])

  const problemCount = useMemo(() => lines.filter((l) => l.level !== 'info').length, [lines])

  /* Follow the tail, unless the operator has scrolled up to read something —
     yanking the view back to the bottom mid-sentence is the single most
     annoying thing a log window can do. */
  useEffect(() => {
    if (!follow) return
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown, follow])

  const onScroll = (): void => {
    const el = boxRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== follow) setFollow(atBottom)
  }

  const copy = async (): Promise<void> => {
    const text = shown.map((l) => `${hhmmss(l.at)} ${l.text}${l.count > 1 ? ` (x${l.count})` : ''}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* Clipboard refused (no permission, no focus). The lines are on screen
         and the file is on disk; there is nothing to recover here. */
    }
  }

  return (
    <div className="logview">
      <div className="log-bar">
        <div className="log-groups">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              className={'log-chip' + (group === g.id ? ' on' : '')}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <button
          className={'log-chip problems' + (problemsOnly ? ' on' : '')}
          onClick={() => setProblemsOnly((v) => !v)}
        >
          문제만 {problemCount > 0 && <span className="log-count">{problemCount}</span>}
        </button>
      </div>

      <div className="log-box" ref={boxRef} onScroll={onScroll}>
        {shown.length === 0 && (
          <p className="log-empty">
            {lines.length === 0 ? '기록을 불러오는 중이에요…' : '이 조건에 해당하는 줄이 없습니다.'}
          </p>
        )}
        {shown.map((l) => (
          <div className={`log-line ${l.level}`} key={l.id}>
            <span className="log-time">{hhmmss(l.at)}</span>
            <span className="log-tag">{l.tag}</span>
            <span className="log-text">
              {l.text.replace(/^\s*\[[a-z0-9-]+\]\s*/i, '')}
              {l.count > 1 && <span className="log-rep">{l.count}번</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="log-foot">
        <button className="log-chip" onClick={copy}>
          {copied ? '복사했습니다' : `보이는 ${shown.length}줄 복사`}
        </button>
        {!follow && (
          <button
            className="log-chip"
            onClick={() => {
              setFollow(true)
              const el = boxRef.current
              if (el) el.scrollTop = el.scrollHeight
            }}
          >
            맨 아래로
          </button>
        )}
        <span className="log-path" title={path}>
          전체 기록: {path}
        </span>
      </div>
    </div>
  )
}
