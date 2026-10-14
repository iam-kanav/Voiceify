import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { statfsSync } from 'node:fs'
import type { SystemInfo } from '@shared/types'
import { paths } from './paths'

let cached: SystemInfo | null = null

function sysctl(key: string) {
  try {
    return execFileSync('/usr/sbin/sysctl', ['-n', key], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export function freeDiskGB() {
  try {
    const s = statfsSync(paths.root)
    return Math.round(((s.bavail * s.bsize) / 1e9) * 10) / 10
  } catch {
    return 0
  }
}

export function getSystemInfo(): SystemInfo {
  if (!cached) {
    const chip = sysctl('machdep.cpu.brand_string') || os.cpus()[0]?.model || 'Unknown'
    const memoryGB = Math.round(os.totalmem() / 1024 ** 3)
    const appleSilicon = process.arch === 'arm64' && process.platform === 'darwin'
    let macos = ''
    try {
      macos = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
    } catch {
      macos = os.release()
    }
    const tier: SystemInfo['tier'] =
      memoryGB <= 8 ? 'entry' : memoryGB <= 24 ? 'standard' : memoryGB <= 64 ? 'pro' : 'max'
    const backend = appleSilicon ? ('mlx' as const) : null
    cached = { chip, memoryGB, arch: process.arch, macos, appleSilicon, platform: process.platform, backend, freeDiskGB: 0, tier }
  }
  return { ...cached, freeDiskGB: freeDiskGB() }
}
