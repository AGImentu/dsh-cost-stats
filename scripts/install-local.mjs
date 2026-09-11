#!/usr/bin/env node
/**
 * Link this checkout into a DSH profile and reconcile the bundle stack.
 *
 * Why a script instead of one `dsh plugin` call: `dsh plugin --profile <name>
 * add <spec>` does exactly these two steps, and it is the preferred path. This
 * script exists for the case where the CLI is not on PATH (a source checkout, a
 * packaged runtime, or a sandboxed shell) and for iterating on a clone with
 * `link:` instead of a registry tarball.
 *
 * It performs the same two operations, in the same order, with the same
 * reconciliation rule as `dsh plugin`:
 *
 * 1. `pnpm add link:<this checkout>` inside the profile directory, so the
 *    profile gets a symlinked dependency and rebuilds here are picked up
 *    without reinstalling.
 * 2. Reconcile `dsh.profile.bundles`: every installed dependency whose manifest
 *    declares `dsh.bundle.patch` joins the bundle stack, appended in
 *    dependency order. Packages that already declare it and are already listed
 *    are left alone (idempotent), and in-box template bundles are never touched.
 *
 * Usage:
 *   node scripts/install-local.mjs [--profile web] [--no-install]
 *
 * @module dsh-cost-stats/scripts/install-local
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))

/** Parse `--profile <name>` and `--no-install`. */
function parseArgs(argv) {
  let profile = 'web'
  let install = true
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--profile needs a value')
      profile = value
      index += 1
    } else if (arg === '--no-install') {
      install = false
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { profile, install }
}

const { profile, install } = parseArgs(process.argv.slice(2))
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`dsh-cost-stats: no profile at ${profileDir}`)
  console.error('run `dsh web` once to initialize it, or pass --profile <name>')
  process.exit(1)
}

if (install) {
  console.log(`dsh-cost-stats: linking ${repo} into ${profileDir}`)
  // Windows resolves pnpm through its .cmd shim, which execFile refuses
  // without a shell; the spec is quoted so a checkout path with spaces stays
  // one argument.
  execFileSync(`pnpm add "link:${repo}"`, {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const dependencies = Object.keys(profileManifest.dependencies ?? {})
const bundles = profileManifest.dsh?.profile?.bundles ?? []
let changed = false

for (const name of dependencies) {
  const dependencyDir = join(profileDir, 'node_modules', name)
  const dependencyManifest = join(dependencyDir, 'package.json')
  if (!existsSync(dependencyManifest)) continue
  const dependency = JSON.parse(readFileSync(dependencyManifest, 'utf8'))
  const isBundle = dependency.dsh?.bundle?.patch !== undefined
  if (isBundle && !bundles.includes(name)) {
    bundles.push(name)
    changed = true
    console.log(`dsh-cost-stats: + bundle ${name}`)
  }
}

if (changed) {
  profileManifest.dsh = {
    ...profileManifest.dsh,
    profile: { ...profileManifest.dsh?.profile, bundles },
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(profileManifest, undefined, 2) + '\n')
  console.log(`dsh-cost-stats: bundles = ${bundles.join(', ')}`)
} else {
  console.log('dsh-cost-stats: manifest already reconciled')
}

const linked = join(profileDir, 'node_modules', manifest.name)
if (!existsSync(join(linked, 'lib', 'client.js'))) {
  console.error(`dsh-cost-stats: ${linked}/lib/client.js is missing — run \`pnpm run build\` here first`)
  process.exit(1)
}
console.log(`dsh-cost-stats: ready — restart \`dsh web\` and hard-refresh the page (Ctrl/Cmd+Shift+R)`)
