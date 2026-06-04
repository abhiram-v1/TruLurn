const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const devDir = path.join(root, '.next')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const port = process.env.PORT || '3000'

if (fs.existsSync(devDir)) {
  fs.rmSync(devDir, { recursive: true, force: true })
  console.log('Removed stale .next dev cache.')
}

const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
