import { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import type { StudioEvents } from '@shared/ipc'

/** In-process event bus that also fans out to every renderer window. */
class Bus extends EventEmitter {
  publish<E extends keyof StudioEvents>(event: E, payload: StudioEvents[E]) {
    this.emit(event, payload)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(`studio:event:${event}`, payload)
    }
  }
}

export const bus = new Bus()
bus.setMaxListeners(100)
