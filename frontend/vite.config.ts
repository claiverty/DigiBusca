import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function getAppVersion() {
  const githubSha = process.env.GITHUB_SHA?.trim()
  if (githubSha && /^[\da-f]{7,64}$/i.test(githubSha)) return githubSha

  try {
    const gitSha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim()
    if (gitSha) return gitSha
  } catch {
    // A source archive or shallow build environment may not contain git metadata.
  }

  return process.env.npm_package_version?.trim() || 'dev'
}

const appVersion = getAppVersion()

const appVersionAsset = {
  name: 'app-version-asset',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'app-version.json',
      source: JSON.stringify({ version: appVersion }),
    })
  },
}

export default defineConfig({
  root: 'frontend',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), appVersionAsset],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules/,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
