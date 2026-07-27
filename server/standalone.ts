// Run the hub on its own (without Electron), e.g. for development or testing:
//   npm run hub            # OpenSky if creds present, else mock
//   FEED=mock npm run hub  # force mock
import { startHub } from './hub'

const hub = startHub()

process.on('SIGINT', () => {
  hub.close()
  process.exit(0)
})
