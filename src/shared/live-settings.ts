/*
 * The settings, on the window's side of the socket.
 *
 * The renderer cannot read the settings file — it has no filesystem — so the
 * hub sends it, once on connect and again after every change. This holds that
 * copy, and the drawing code reads from here instead of from the constants it
 * used to import.
 *
 * A plain mutable module rather than React state, deliberately. Two of the
 * three readers are inside the three.js frame loop, which runs sixty times a
 * second outside React entirely; threading a prop down to it would mean
 * re-rendering a component to change a number that is read in a shader. The
 * values start at the build's defaults, so every window draws something correct
 * from its very first frame, before the socket has even opened.
 */
import type { SettingsView } from './types'
import { JUPITER_DAY_PERIOD_MS, JUPITER_MAP_LAT_LIMIT, MARS_LIFT, MARS_TINT } from './config'

/** Only the part of the settings the DRAWING depends on. The intervals belong
 *  to the hub and never reach a shader. */
export interface DrawSettings {
  jupiterMapLatLimit: number
  jupiterDayPeriodMs: number
  marsLift: number
  marsTint: [number, number, number]
}

const live: DrawSettings = {
  jupiterMapLatLimit: JUPITER_MAP_LAT_LIMIT,
  jupiterDayPeriodMs: JUPITER_DAY_PERIOD_MS,
  marsLift: MARS_LIFT,
  marsTint: [MARS_TINT[0] ?? 1, MARS_TINT[1] ?? 1, MARS_TINT[2] ?? 1]
}

/** Read at the point of use. Never destructure this into a module constant —
 *  that is exactly the mistake this file exists to undo. */
export function draw(): DrawSettings {
  return live
}

/** Told by whoever owns the socket when the hub sends a settings message. */
export function applySettings(v: SettingsView): void {
  live.jupiterMapLatLimit = v.jupiterMapLatLimit
  live.jupiterDayPeriodMs = v.jupiterDayPeriodMs
  live.marsLift = v.marsLift
  live.marsTint = [v.marsTint[0] ?? 1, v.marsTint[1] ?? 1, v.marsTint[2] ?? 1]
  for (const fn of listeners) fn()
}

/**
 * Called after every apply, so a renderer can push the new numbers into
 * uniforms it only writes when a planet changes.
 *
 * Without this the Mars grading would sit unchanged until somebody left the tab
 * and came back — which reads, from in front of the screen, as a settings
 * screen that does not work.
 */
const listeners = new Set<() => void>()
export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
