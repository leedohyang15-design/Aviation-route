// Injected by electron.vite.config.ts's `define` at build time — a git short
// hash and build timestamp, so a running exe can say exactly which commit it
// was built from. Only exists under electron-vite's build/dev (main and
// renderer); `tsx server/standalone.ts` never goes through Vite, so callers
// must guard with `typeof __BUILD_ID__ !== 'undefined'`.
declare const __BUILD_ID__: string
