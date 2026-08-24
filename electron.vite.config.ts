import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * A build fingerprint, baked in at build time and shown on the settings
 * screen — see server/settings.ts.
 *
 * This exists because a bug report and its fix kept turning out to be about
 * two different builds: an operator tests, reports something is still
 * broken, and it takes a whole round trip to learn the exe they were running
 * predates the fix. Reading it off the running app removes the guess: if the
 * commit shown does not match the fix's commit, the exe is stale, full stop.
 * `execSync` at build time, not runtime — the packaged app ships without
 * `.git`, so this has to be captured while the repo is still there.
 */
function buildId(): string {
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim()
  } catch {
    /* not a git checkout (e.g. a source zip) — keep 'unknown' */
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `${commit} · ${stamp}`
}

// The renderer has TWO entry points that ship as separate windows:
//   - control.html  → operator's 2D MapLibre map (control monitor)
//   - display.html  → equirectangular three.js frame (sphere projector)
export default defineConfig({
  main: {
    // Keep node_modules (e.g. `ws`) external so their optional native deps
    // (bufferutil/utf-8-validate) resolve at runtime instead of being bundled.
    plugins: [externalizeDepsPlugin()],
    define: {
      __BUILD_ID__: JSON.stringify(buildId())
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@assets': resolve(__dirname, 'assets')
      }
    },
    build: {
      rollupOptions: {
        input: {
          control: resolve(__dirname, 'control.html'),
          display: resolve(__dirname, 'display.html')
        }
      }
    },
    plugins: [react()]
  }
})
