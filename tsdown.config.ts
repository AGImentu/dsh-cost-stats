/**
 * tsdown build for dsh-session-cost.
 *
 * Two artifacts, mirroring the official DSH client-plugin shape:
 *
 * - `lib/index.js`  — the HOST half: a Node ESM cordis plugin (deliberately a
 *   no-op; see cordis.patch.yml). Its presence as a live Loader row is what
 *   makes `dsh-client-modules` discover this package's `dsh.client` manifest
 *   declaration.
 * - `lib/client.js` — the BROWSER half: a classic script that only *registers*
 *   a lazy factory (`window.__ModuleLoader__.load({ id, factory })`) with the
 *   `(require) => exports` CJS closure shape. The module body — including the
 *   style-tag injection — runs on first materialization.
 *
 * This replicates the essential contract of DSH's shared preset
 * (`packages/client/tsdown.client.ts`) without importing it: that preset lives
 * inside the DSH repository, and an out-of-tree plugin cannot depend on it.
 * The three contract points that must not drift:
 *
 * 1. the registered id MUST equal the package name (the client-modules compose
 *    keys on the package name, and every graph row is addressed by it);
 * 2. `format: 'cjs'` + `intro`/`banner`/`footer` produce the factory closure —
 *    the loader requires the module through the injected `require`, never ESM;
 * 3. externals resolve through the loader module table, everything else inlines.
 *    A specifier the table cannot answer is a guaranteed runtime throw, so the
 *    rule is the platform seed list: seeded specifiers stay imports, everything
 *    else is bundled.
 */
import { readFileSync } from 'node:fs'
import { defineConfig, type UserConfig } from 'tsdown'

/** This package's manifest, read for the plugin id and any declared externals. */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
  dsh?: { client?: { external?: string[] } }
}

/** The Loader registration id: MUST equal the package name. */
const PLUGIN_ID = pkg.name

/**
 * Module-table seeds shared by the web shell (DSH `PLATFORM_MODULES`). Mirrored
 * here because the canonical list lives in the DSH repository
 * (`packages/client/web/src/platform.ts`, 0.1.5-rc.2). Kept deliberately
 * literal: a wrong entry here fails loudly at bundle time rather than silently
 * inlining a duplicate React.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Everything the browser module table can answer for this package. */
const external = new Set<string>([
  ...PLATFORM_MODULES,
  ...(pkg.dsh?.client?.external ?? []),
])

const isExternal = (specifier: string): boolean => external.has(specifier)

/** The host half: plain Node ESM, no dependencies to inline. */
const hostHalf: UserConfig = {
  name: PLUGIN_ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: false,
  outputOptions: { entryFileNames: 'index.js' },
}

/** The browser half: one closure-factory classic script named `client.js`. */
const clientHalf: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: isExternal,
    alwaysBundle: (specifier: string) => !isExternal(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([hostHalf, clientHalf])
