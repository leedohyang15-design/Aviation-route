// Minimal preload. The windows talk to the hub over a normal WebSocket, so no
// privileged bridge is needed today. Kept as a seam for future native features
// (e.g. reading a config file, controlling projector power).
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('exhibit', {
  version: '0.1.0'
})
