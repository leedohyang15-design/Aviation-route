/*
 * The exhibit's icons, drawn rather than typed.
 *
 * These were emoji — 🛰 for the satellite tab, 🪐 for Jupiter, 🌧 for rain —
 * and emoji are a font, not a picture. Copy the folder onto a PC whose Windows
 * install has no emoji font (a stripped or LTSC image, or one whose Segoe UI
 * Emoji predates the character) and they render as nothing at all: the tabs
 * come up with a blank where the icon was, and the exhibit looks broken on a
 * machine nobody can debug on site.
 *
 * The failure is not uniform either, which is what made it confusing to
 * report: ✈ (U+2708) and ☁ (U+2601) live in the Basic Multilingual Plane and
 * ship with the old symbol fonts, so those two kept working while 🛰 (U+1F6F0),
 * 🔴 (U+1F534) and 🪐 (U+1FA90) vanished — "비행기랑 날씨는 되는데 나머지는
 * 안 된다". Same cause, different vintage of glyph.
 *
 * Inline SVG has no such dependency: the shape travels in the code. Every icon
 * inherits `currentColor` so it takes the colour of the text beside it, and
 * the two that carried meaning by colour (Mars red, Jupiter amber) can be
 * given one explicitly.
 */
import type { CSSProperties } from 'react'

interface Props {
  /** Height in em, so an icon sits on the text baseline at any font size. */
  size?: number
  color?: string
  style?: CSSProperties
}

function Svg({
  size = 1.05,
  color,
  style,
  children
}: Props & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={`${size}em`}
      height={`${size}em`}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ verticalAlign: '-0.16em', flex: 'none', ...style }}
    >
      {children}
    </svg>
  )
}

/** Aircraft — a plan-view airliner. */
export function IconPlane(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <path d="M12 2.6c.9 0 1.5 1 1.5 2.2v3.9l7.4 4.3v2.1l-7.4-2.2v4.2l2.4 1.7v1.6L12 19.3l-3.9 1.1v-1.6l2.4-1.7v-4.2l-7.4 2.2v-2.1l7.4-4.3V4.8c0-1.2.6-2.2 1.5-2.2z" />
    </Svg>
  )
}

/** Satellite — a body with two solar wings, matching the map sprite. */
export function IconSatellite(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <rect x="9.6" y="8.4" width="4.8" height="7.2" rx="1" />
      <path d="M9.6 12H7.2M16.8 12h-2.4" />
      <rect x="2.4" y="9" width="4.8" height="6" rx="1" />
      <rect x="16.8" y="9" width="4.8" height="6" rx="1" />
      <path d="M12 8.4V5.6" />
      <circle cx="12" cy="4" r="1.6" />
    </Svg>
  )
}

/** Weather — a cloud. */
export function IconCloud(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <path d="M7 18.5a4.2 4.2 0 0 1-.3-8.4 5.6 5.6 0 0 1 10.7-1.2A3.9 3.9 0 0 1 17.6 18.5z" />
    </Svg>
  )
}

/** Rain and snow — a cloud with fall beneath it. */
export function IconRain(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <path d="M7.2 15.2a3.8 3.8 0 0 1-.3-7.6 5.1 5.1 0 0 1 9.7-1.1 3.5 3.5 0 0 1 .3 8.7" />
      <path d="M8.6 18l-1 2.4M12.4 18l-1 2.4M16.2 18l-1 2.4" />
    </Svg>
  )
}

/** Wind — moving air. */
export function IconWind(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <path d="M3.4 8.6h9.2a2.6 2.6 0 1 0-2.6-2.6" />
      <path d="M3.4 12.8h13a2.6 2.6 0 1 1-2.6 2.6" />
      <path d="M3.4 17h6.4" />
    </Svg>
  )
}

/** Mars — the planet, with the polar cap that names it on the tab. */
export function IconMars(p: Props): JSX.Element {
  return (
    <Svg color="#ff7b6b" {...p}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M6.6 6.6c2.6.9 5.6.6 7.7-.8M5.2 14.4c3.4-1.5 7.6-1.2 10.9.8M9.6 19.9c1.6-1.9 4-3 6.6-3.1" />
    </Svg>
  )
}

/** Jupiter — a banded planet with its ring. */
export function IconJupiter(p: Props): JSX.Element {
  return (
    <Svg color="#ffd166" {...p}>
      <circle cx="11.2" cy="11.2" r="7" />
      <path d="M4.5 9h13.4M4.6 13.6h13.2" />
      <path d="M4.2 17.6c-1.9 1.5-2.9 2.9-2.5 3.6.6 1.1 4.2.3 8.2-1.9s6.8-4.9 6.2-6c-.3-.5-1.4-.6-3-.2" />
    </Svg>
  )
}

/** An open hand — the "touch and drag" hint. */
export function IconHand(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <path d="M9 11V4.9a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 11V3.9a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11.4V6.4a1.5 1.5 0 0 1 3 0V14" />
      <path d="M9 11V9.4a1.5 1.5 0 0 0-3 0v5.2" />
      <path d="M6 14.6c0 3.6 2.6 6.5 6 6.5s6-2.9 6-6.5" />
    </Svg>
  )
}

/** A magnifier — the search boxes. */
export function IconSearch(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="M15.4 15.4L20.4 20.4" />
    </Svg>
  )
}

/** The whole earth — "show everything". */
export function IconGlobe(p: Props): JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.6a13 13 0 0 1 0 16.8 13 13 0 0 1 0-16.8z" />
    </Svg>
  )
}
