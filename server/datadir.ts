// Where the exhibit keeps the files an operator is meant to see and keep: the
// diagnostic log, settings, and the route/TLE/weather caches.
//
// The obvious answer — next to the executable — is right for a packaged build
// and wrong everywhere else. `process.execPath` is whatever binary is running:
// Electron's own copy inside `node_modules` under `npm run dev`, or the system
// Node under `tsx`. Writing a hard-won route cache into `node_modules` means
// `npm install` silently deletes it; writing it beside `/usr/bin/node` puts it
// somewhere nobody would ever look (and usually isn't writable anyway).
//
// The working directory isn't a safe answer either: a packaged app launched
// from a shortcut can start anywhere, including a directory it may not write to.
// So pick by which situation we're actually in.
//
// "Next to the executable" turned out to be wrong for packaged builds too,
// just less obviously. `electron-builder`'s output directory (`dist/`, per
// electron-builder.yml) is deleted and recreated on every build, and the exe
// lives inside it — so shipping a bug fix (rebuild, copy the folder over the
// old one) silently erased every setting the operator had entered, including
// API keys, along with the caches. `app.getPath('userData')` is Electron's
// answer to exactly this: an OS-managed per-app folder that a rebuild never
// touches. Planet map images are the one exception — see mapsDir() below —
// because those are meant to be found and swapped by hand next to the app,
// and are legitimately part of a given build rather than operator state.

import { basename, dirname, join } from 'node:path'
// A DEFAULT import, deliberately. `import { app } from 'electron'` throws at
// module-instantiation time under plain Node — the electron package resolves
// there to a string (the path to the binary), which has no named exports, so
// `npm run hub` died with "does not provide an export named 'app'" before a
// line of it ran. The default import is that same string under Node and the
// real module object inside Electron, so both survive and the guard below
// decides which one we got.
import electron from 'electron'

/**
 * True only for a real packaged build. Three things have to hold at once:
 * we're inside Electron at all (rules out `tsx`/`node` scripts), the binary
 * isn't the dev copy in `node_modules`, and it hasn't kept Electron's stock
 * name — a packaged app is renamed to the product.
 */
function isPackaged(): boolean {
  if (!process.versions.electron) return false
  if (/[\\/]node_modules[\\/]/.test(process.execPath)) return false
  return !/^electron(\.exe)?$/i.test(basename(process.execPath))
}

/** Folder beside the running binary: the project root in dev, beside the exe
 * once packaged. For mapsDir() below, and for `.env` — both are meant to be
 * found and placed by hand next to the app, not operator state that a
 * rebuild would otherwise destroy, so they stay out of dataDir()'s move to
 * userData. */
export function exeAdjacentDir(): string {
  return isPackaged() ? dirname(process.execPath) : process.cwd()
}

/** Electron's `app`, or null anywhere that is not the Electron main process
 * (a `tsx` script, a renderer). */
function electronApp(): { getPath(name: 'userData'): string } | null {
  return (electron as unknown as { app?: { getPath(name: 'userData'): string } })?.app ?? null
}

/** Directory for operator state: the project root in dev, an OS-managed
 * per-app folder once packaged (see the file header for why not beside the
 * exe). `app.getPath('userData')` needs no OS call and works before the
 * Electron `ready` event, so it's safe to reach for this as early as
 * `boot-env.ts`'s module-scope `loadEnv()` call. */
export function dataDir(): string {
  if (!isPackaged()) return process.cwd()
  // Packaged means Electron, so `app` is there — but falling back to the exe's
  // own folder beats throwing on the path that every log line goes through.
  return electronApp()?.getPath('userData') ?? exeAdjacentDir()
}

/** Full path for one of those files. */
export function dataPath(name: string): string {
  return join(dataDir(), name)
}

/**
 * Every place a file might reasonably be, the one we'd write to first. Used
 * when READING, so a cache written by an older build (or by a differently
 * launched run) is still found instead of silently starting from nothing —
 * including one written under the old exe-adjacent scheme, before a rebuild
 * would have destroyed it.
 */
export function dataPathCandidates(name: string): string[] {
  const seen = new Set<string>()
  return [dataDir(), process.cwd(), exeAdjacentDir()]
    .map((dir) => join(dir, name))
    .filter((p) => {
      if (seen.has(p)) return false
      seen.add(p)
      return true
    })
}

/**
 * Where the planet maps live: a `public` folder beside the exe.
 *
 * They cannot travel inside the package. The renderer is loaded from an asar
 * archive, which is sealed — a map bundled at build time works, but one dropped
 * in afterwards has nowhere to go, and swapping a map would mean rebuilding the
 * whole application. For files this big, that is the wrong trade twice over: it
 * puts a hundred megabytes into an installer that then cannot be corrected.
 *
 * So the hub serves them over its own port from a folder next to the exe, and
 * an operator swaps a map by replacing a file. In dev this is the project's own
 * `public`, which is also where Vite serves it from — so the same URL works in
 * both, and the renderer tries the bundled path first regardless.
 */
export function mapsDir(): string {
  return join(exeAdjacentDir(), 'public')
}
