import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { paths } from '../paths'

/**
 * Installs the Python inference runtime on first launch:
 *   uv (fast Python package manager) → managed CPython 3.12 venv → mlx + mlx-audio.
 * Everything lives in the app's data folder, so nothing touches the user's system Python.
 */

/** uv release asset for this OS/CPU. Windows/Linux are listed so a future port only needs a backend. */
function uvAsset(): { url: string; dir: string; exe: string } | null {
  const assets: Record<string, string> = {
    'darwin-arm64': 'uv-aarch64-apple-darwin',
    'darwin-x64': 'uv-x86_64-apple-darwin',
    'win32-x64': 'uv-x86_64-pc-windows-msvc',
    'win32-arm64': 'uv-aarch64-pc-windows-msvc',
    'linux-x64': 'uv-x86_64-unknown-linux-gnu',
    'linux-arm64': 'uv-aarch64-unknown-linux-gnu'
  }
  const name = assets[`${process.platform}-${process.arch}`]
  if (!name) return null
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  return {
    url: `https://github.com/astral-sh/uv/releases/latest/download/${name}.${ext}`,
    dir: name,
    exe: process.platform === 'win32' ? 'uv.exe' : 'uv'
  }
}

export type InstallProgress = (step: string, progress: number, log?: string) => void

function requirementsHash() {
  const req = readFileSync(paths.engineRequirements, 'utf8')
  return createHash('sha256').update(req).digest('hex').slice(0, 16)
}

const manifestPath = () => join(paths.engine, 'manifest.json')

export function isRuntimeInstalled() {
  if (!existsSync(paths.python) || !existsSync(manifestPath())) return false
  try {
    const m = JSON.parse(readFileSync(manifestPath(), 'utf8'))
    return m.requirements === requirementsHash()
  } catch {
    return false
  }
}

export function findUv(): string | null {
  const candidates = [
    join(paths.bin, process.platform === 'win32' ? 'uv.exe' : 'uv'),
    join(homedir(), '.local', 'bin', 'uv'),
    join(homedir(), '.cargo', 'bin', 'uv'),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv'
  ]
  for (const c of candidates) if (existsSync(c)) return c
  try {
    const p = execFileSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).trim()
    if (p) return p
  } catch {
    /* not on PATH */
  }
  return null
}

async function downloadUv(onLog: (s: string) => void): Promise<string> {
  const asset = uvAsset()
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)
  onLog(`Downloading uv from ${asset.url}`)
  const res = await fetch(asset.url)
  if (!res.ok || !res.body) throw new Error(`Failed to download uv (${res.status})`)
  const tmpDir = join(paths.tmp, `uv-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const archive = join(tmpDir, asset.url.endsWith('.zip') ? 'uv.zip' : 'uv.tar.gz')
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive))
  // bsdtar (macOS, Windows 10+) extracts both .tar.gz and .zip.
  execFileSync(process.platform === 'win32' ? 'tar' : '/usr/bin/tar', ['-xf', archive, '-C', tmpDir])
  const extracted = existsSync(join(tmpDir, asset.dir, asset.exe)) ? join(tmpDir, asset.dir, asset.exe) : join(tmpDir, asset.exe)
  const dest = join(paths.bin, asset.exe)
  copyFileSync(extracted, dest)
  chmodSync(dest, 0o755)
  rmSync(tmpDir, { recursive: true, force: true })
  return dest
}

function run(cmd: string, args: string[], onLine: (line: string) => void, env: NodeJS.ProcessEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const feed = (buf: Buffer) => buf.toString().split(/\r?\n/).filter(Boolean).forEach(onLine)
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))))
  })
}

export async function installRuntime(progress: InstallProgress) {
  mkdirSync(paths.engine, { recursive: true })
  const log = (s: string) => progress('', -1, s)

  progress('Preparing package manager', 0.04)
  let uv = findUv()
  if (!uv) uv = await downloadUv(log)
  log(`Using uv at ${uv}`)

  const uvEnv = {
    UV_PYTHON_INSTALL_DIR: join(paths.engine, 'python'),
    UV_CACHE_DIR: join(paths.engine, 'uv-cache'),
    UV_NO_PROGRESS: '1'
  }

  progress('Creating Python 3.12 environment', 0.12)
  rmSync(paths.venv, { recursive: true, force: true })
  await run(uv, ['venv', '--python', '3.12', '--seed', paths.venv], log, uvEnv)

  progress('Installing MLX and mlx-audio (≈350 MB)', 0.3)
  let lines = 0
  await run(
    uv,
    ['pip', 'install', '--python', paths.python, '-r', paths.engineRequirements],
    (line) => {
      lines++
      log(line)
      progress('Installing MLX and mlx-audio (≈350 MB)', Math.min(0.9, 0.3 + lines * 0.006))
    },
    uvEnv
  )

  progress('Verifying installation', 0.95)
  await run(paths.python, ['-c', 'import mlx.core, mlx_audio, soundfile; print("mlx ok")'], log)

  writeFileSync(manifestPath(), JSON.stringify({ requirements: requirementsHash(), installedAt: Date.now() }, null, 2))
  progress('Ready', 1)
}
