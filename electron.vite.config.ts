import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The renderer has TWO entry points that ship as separate windows:
//   - control.html  → operator's 2D MapLibre map (control monitor)
//   - display.html  → equirectangular three.js frame (sphere projector)
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
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
