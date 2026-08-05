// Run the hub on its own (without Electron), e.g. for development or testing:
//   npm run hub            # OpenSky if creds present, else mock
//   FEED=mock npm run hub  # force mock
// FIRST, above every other import: it populates process.env from .env, and the
// config module reads process.env the moment it is evaluated.
import './boot-env'
import { startHub } from './hub'

const hub = startHub()

process.on('SIGINT', () => {
  hub.close()
  process.exit(0)
})
