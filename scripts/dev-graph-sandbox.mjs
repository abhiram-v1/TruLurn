import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')

nextEnv.loadEnvConfig(projectRoot, true, console, true)

const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
const child = spawn(
  process.execPath,
  [nextBin, 'dev', 'graph-sandbox', '-p', '3100'],
  {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'inherit',
    windowsHide: true,
  },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
