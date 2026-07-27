// Run the hub on its own (without Electron), e.g. for development or testing:
//   npm run hub            # OpenSky if creds present, else mock
//   FEED=mock npm run hub  # force mock
import { loadEnv } from './env'
import { startHub } from './hub'

loadEnv() // read OPENSKY_* from .env if present
const hub = startHub()

process.on('SIGINT', () => {
  hub.close()
  process.exit(0)
})
