import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nextEnv from '@next/env'

const sandboxDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(sandboxDir, '..')
const { loadEnvConfig } = nextEnv

// The sandbox is a separate Next project, but it deliberately shares the
// parent TruLurn environment so API keys remain in one ignored .env.local.
loadEnvConfig(projectRoot, process.env.NODE_ENV !== 'production')

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.GRAPH_SANDBOX_DIST_DIR ?? '.next-sandbox',
  experimental: {
    externalDir: true,
  },
}

export default nextConfig
