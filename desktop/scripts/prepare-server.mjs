// Collects what the desktop app runs next to Electron: the app's production
// server (`.output`), its database migrations and the Node binary that built
// them. The server runs as a child process of this Node, not inside Electron,
// because better-sqlite3's native addon is compiled for this Node's ABI.
//
//   node scripts/prepare-server.mjs            copy what `pnpm build` already made
//   node scripts/prepare-server.mjs --build    run `pnpm build` first
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopDir, '..')
const target = join(desktopDir, 'build', 'server')

if (process.argv.includes('--build')) {
  // The speech model and the OCR language data go into the app (public/ai), so photos
  // and dictation work offline from the first use (ADR 0040); about 95 MB, downloaded once.
  const assets = spawnSync(process.execPath, ['scripts/ai-assets.mjs', '--models'], { cwd: repoRoot, stdio: 'inherit' })
  if (assets.status !== 0) {
    throw new Error('scripts/ai-assets.mjs --models failed')
  }

  // The production build needs more than Node's default heap (about 2 GB): it
  // ran out of memory there after 25 minutes of garbage collection.
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=3584`.trim() }
  const result = spawnSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit', shell: true, env })
  if (result.status !== 0) {
    throw new Error('pnpm build failed')
  }
}

const output = join(repoRoot, '.output')
if (!existsSync(join(output, 'server', 'index.mjs'))) {
  throw new Error('No .output/server/index.mjs: run `pnpm build` in the repository root first (or pass --build).')
}

function folderSize(path) {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    total += entry.isDirectory() ? folderSize(full) : statSync(full).size
  }
  return total
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

cpSync(output, join(target, '.output'), { recursive: true })
// Read from the filesystem at startup (server/plugins/migrate.ts), not bundled.
cpSync(join(repoRoot, 'server', 'db', 'migrations'), join(target, 'server', 'db', 'migrations'), { recursive: true })
cpSync(process.execPath, join(target, process.platform === 'win32' ? 'node.exe' : 'node'))

console.log(`Server prepared in ${target}`)
console.log(`  .output: ${(folderSize(join(target, '.output')) / 1024 / 1024).toFixed(0)} MB, Node ${process.version}`)
