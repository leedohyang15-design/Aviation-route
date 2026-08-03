// Where the exhibit keeps the files an operator is meant to see and keep: the
// diagnostic log, the route cache, the orbital elements.
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

import { basename, dirname, join } from 'node:path'

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

/** Directory for operator-visible files: the project root in dev, beside the
 * executable once packaged. */
export function dataDir(): string {
  return isPackaged() ? dirname(process.execPath) : process.cwd()
}

/** Full path for one of those files. */
export function dataPath(name: string): string {
  return join(dataDir(), name)
}

/**
 * Every place a file might reasonably be, the one we'd write to first. Used
 * when READING, so a cache written by an older build (or by a differently
 * launched run) is still found instead of silently starting from nothing.
 */
export function dataPathCandidates(name: string): string[] {
  const seen = new Set<string>()
  return [dataDir(), process.cwd(), dirname(process.execPath)]
    .map((dir) => join(dir, name))
    .filter((p) => {
      if (seen.has(p)) return false
      seen.add(p)
      return true
    })
}
