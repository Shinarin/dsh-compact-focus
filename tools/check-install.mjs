#!/usr/bin/env node
/**
 * Verify that the installed bundle can be imported the way the Host imports it.
 *
 * The Host's loader resolves each plugin row with
 * `internal.import(specifier, <profile baseUrl>)` (see the shipped
 * `cordis-plugin-loader`). Node then resolves the bundle through the profile's
 * `node_modules`, and — because a `link:` install is a junction — continues
 * resolving that file's own bare imports from its *physical* location, which is
 * the checkout, not the profile.
 *
 * A checkout therefore has to provide the `@deepseek-ai/*` peer packages the
 * Host supplies. When it does not, every row of the bundle fails with
 * `ERR_MODULE_NOT_FOUND` and DSH starts without the plugin: the symptom is
 * "installed but nothing happens", with no visible error in the UI.
 *
 * Run with `--expose-internals` (the same flag the Host process uses):
 *
 *   node --expose-internals tools/check-install.mjs
 *
 * Environment: DSH_HOME, DSH_PROFILE, DSH_PROFILE_DIR (same defaults as the
 * install scripts).
 */
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh')
const profileName = process.env.DSH_PROFILE ?? 'desktop'
const profileDir =
  process.env.DSH_PROFILE_DIR ?? join(dshHome, 'profiles', profileName)

/** Directory base URL, trailing separator included. */
function baseUrl(dir) {
  return pathToFileURL(dir.replace(/[\\/]+$/, '') + sep).href
}

const require = createRequire(import.meta.url)
let loader
try {
  loader = require('internal/modules/esm/loader').getOrInitializeCascadedLoader()
} catch (error) {
  console.error(
    `cannot reach the Node internal ESM loader (${error.code ?? error.message}).\n` +
      're-run with --expose-internals, exactly as the Host does.',
  )
  process.exit(2)
}
if (!loader || typeof loader.import !== 'function') {
  console.error('Node internal ESM loader has an unsupported shape; cannot verify.')
  process.exit(2)
}

const specs = ['dsh-compact-focus', 'dsh-compact-focus/command']
const base = baseUrl(profileDir)
let failed = false

for (const spec of specs) {
  try {
    const ns = await loader.import(spec, base, {})
    console.log(`ok    ${spec}  [exports: ${Object.keys(ns).join(', ')}]`)
  } catch (error) {
    failed = true
    console.log(`FAIL  ${spec}  [${error.code ?? 'error'}] ${String(error.message).split('\n')[0]}`)
  }
}

if (failed) {
  console.error(
    '\nThe bundle cannot resolve its peer packages from its physical location.\n' +
      'For a link: install the checkout needs node_modules/@deepseek-ai, e.g.:\n' +
      `  node_modules\\@deepseek-ai -> ${join(dshHome, 'profiles', 'node_modules', '@deepseek-ai')}\n` +
      'Re-run install.ps1 to repair it.',
  )
}
process.exit(failed ? 1 : 0)
