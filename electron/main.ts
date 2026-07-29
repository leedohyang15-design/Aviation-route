// Electron main process:
//  - starts the in-process WebSocket hub (single upstream poller), and
//  - opens two windows: the operator's control map on the primary display and
//    the equirectangular frame full-screen on the projector display.

import { app, BrowserWindow, screen, dialog } from 'electron'
import { join, dirname } from 'node:path'
import { appendFileSync } from 'node:fs'
import { loadEnv } from '../server/env'
import { startHub, type Hub } from '../server/hub'

// Museum kiosk safety net: a packaged .exe has no console, so if the main
// process throws (bad GPU driver, port already held, missing file, …) the
// window would just silently fail to appear. Write every fatal error to a log
// next to the executable and show a dialog, so the operator can see *why*
// instead of "double-clicked and nothing happened".
const CRASH_LOG = join(dirname(process.execPath), 'aviation-route-error.log')
function logCrash(kind: string, err: unknown): void {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  const line = `[${new Date().toISOString()}] ${kind}: ${msg}\n`
  try {
    appendFileSync(CRASH_LOG, line)
  } catch {
    /* log dir not writable — nothing more we can do */
  }
  try {
    dialog.showErrorBox('Aviation Route — 오류', `${kind}\n\n${msg}\n\n로그: ${CRASH_LOG}`)
  } catch {
    /* too early / no display for a dialog */
  }
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err))
process.on('unhandledRejection', (reason) => logCrash('unhandledRejection', reason))

loadEnv() // read OPENSKY_* from .env (project root in dev) before starting the hub

const isDev = !!process.env.ELECTRON_RENDERER_URL

let hub: Hub | null = null
let controlWin: BrowserWindow | null = null
let displayWin: BrowserWindow | null = null

function rendererUrl(page: 'control' | 'display'): string {
  if (isDev) return `${process.env.ELECTRON_RENDERER_URL}/${page}.html`
  return join(__dirname, `../renderer/${page}.html`)
}

function loadPage(win: BrowserWindow, page: 'control' | 'display'): void {
  if (isDev) win.loadURL(rendererUrl(page))
  else win.loadFile(rendererUrl(page))
}

function createWindows(): void {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  // The projector is the first non-primary display, if present.
  const projector = displays.find((d) => d.id !== primary.id) ?? primary

  const preload = join(__dirname, '../preload/index.mjs')

  // --- Control window (operator, primary display) ---
  controlWin = new BrowserWindow({
    x: primary.bounds.x,
    y: primary.bounds.y,
    width: Math.min(1440, primary.workAreaSize.width),
    height: Math.min(900, primary.workAreaSize.height),
    title: 'Aviation Route — Control',
    backgroundColor: '#0b1020',
    // Keep running full-speed even when minimized/backgrounded so plane tracking
    // and the display sync don't stall when the operator lowers this window.
    webPreferences: { preload, contextIsolation: true, sandbox: false, backgroundThrottling: false }
  })
  loadPage(controlWin, 'control')

  // --- Display window (projector, full-screen, no chrome) ---
  const onProjector = projector.id !== primary.id
  displayWin = new BrowserWindow({
    x: projector.bounds.x,
    y: projector.bounds.y,
    width: projector.bounds.width,
    height: projector.bounds.height,
    title: 'Aviation Route — Display',
    backgroundColor: '#000000',
    frame: !onProjector, // keep chrome in single-monitor dev, drop it on the projector
    kiosk: onProjector,
    fullscreen: onProjector,
    autoHideMenuBar: true,
    // Keep rendering at full rate even if this window is ever backgrounded, so the
    // projected view never stalls (Electron throttles background rAF/timers by default).
    webPreferences: { preload, contextIsolation: true, sandbox: false, backgroundThrottling: false }
  })
  loadPage(displayWin, 'display')

  // Museum kiosk: if a renderer crashes, reload it rather than dying.
  for (const win of [controlWin, displayWin]) {
    win.webContents.on('render-process-gone', () => win.reload())
    // Surface a failed page load (wrong asset path, missing file) to the log.
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      logCrash('did-fail-load', `${code} ${desc} — ${url}`)
    })
  }

  controlWin.on('closed', () => (controlWin = null))
  displayWin.on('closed', () => (displayWin = null))
}

app.whenReady().then(() => {
  hub = startHub()
  createWindows()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows()
  })
})

app.on('window-all-closed', () => {
  hub?.close()
  if (process.platform !== 'darwin') app.quit()
})
