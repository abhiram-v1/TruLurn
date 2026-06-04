const { spawn } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, 'build'], {
  cwd: root,
  env: {
    ...process.env,
    NEXT_DIST_DIR: '.next-build',
  },
  stdio: 'inherit',
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
