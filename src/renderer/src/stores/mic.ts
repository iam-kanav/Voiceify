import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** The microphone used for recording ('' = the system default). Device ids are per app, so this stays local. */
export const useMic = create<{ deviceId: string }>()(persist(() => ({ deviceId: '' }), { name: 'mic-state' }))

export interface MicDevice {
  deviceId: string
  label: string
}

/** Audio inputs on this computer, kept up to date as devices are plugged in or out. */
export function useMicDevices() {
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [labelled, setLabelled] = useState(true)
  useEffect(() => {
    const load = async () => {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      // Names are hidden until the app has been allowed to use the microphone once.
      setLabelled(inputs.every((d) => d.label))
      setDevices(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
    }
    load().catch(() => undefined)
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])
  /** Ask for microphone access once so device names can be shown. */
  const unlock = async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  }
  return { devices, labelled, unlock }
}

/** getUserMedia for the chosen microphone; falls back to the default if it's gone. */
export async function openMic(constraints: MediaTrackConstraints = {}): Promise<{ stream: MediaStream; fellBack: boolean }> {
  const { deviceId } = useMic.getState()
  if (deviceId) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: { ...constraints, deviceId: { exact: deviceId } } }), fellBack: false }
    } catch (e) {
      if (!(e instanceof DOMException) || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e
    }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: constraints }), fellBack: !!deviceId }
}
