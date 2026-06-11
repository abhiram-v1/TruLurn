import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(
  process.execPath,
  [nextBin, 'build', 'graph-sandbox'],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      GRAPH_SANDBOX_DIST_DIR: '.next-sandbox-build',
    },
    stdio: 'inherit',
    windowsHide: true,
  },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
