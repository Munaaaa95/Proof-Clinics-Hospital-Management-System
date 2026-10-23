import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // lets a second dev server (for tests) run beside the normal one without sharing a build folder
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // the repo root has its own lockfile; tell Next the app lives in this folder
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
}
export default nextConfig
