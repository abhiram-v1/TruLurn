const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const devDir = path.join(root, '.next')
const devScript = path.join(root, 'scripts', 'dev.js')

if (fs.existsSync(devDir)) {
  fs.rmSync(devDir, { recursive: true, force: true })
  console.log('Removed stale .next dev cache.')
}

const child = spawn(process.execPath, [devScript], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
