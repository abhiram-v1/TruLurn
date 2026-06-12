const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const markitdownDir = path.join(root, 'services', 'markitdown')
const markitdownPython = path.join(markitdownDir, '.venv', 'Scripts', 'python.exe')
const port = process.env.PORT || '3000'
const children = []

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  })
  children.push(child)
  return child
}

if (fs.existsSync(markitdownPython)) {
  const converter = start(
    markitdownPython,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '3002'],
    { cwd: markitdownDir },
  )
  converter.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`MarkItDown service exited with code ${code}. Rich document uploads will be unavailable.`)
    }
  })
} else {
  console.warn('MarkItDown environment is missing. PDF and Office uploads will be unavailable.')
}

const next = start(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: root,
  env: {
    ...process.env,
    MARKITDOWN_SERVICE_URL: process.env.MARKITDOWN_SERVICE_URL || 'http://127.0.0.1:3002',
  },
})

function stop(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(exitCode)
}

next.on('exit', (code) => stop(code ?? 1))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
