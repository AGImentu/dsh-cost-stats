/**
 * Host half of dsh-session-cost.
 *
 * Deliberately a no-op cordis plugin. The mounted row exists so that
 * `dsh-client-modules` can scan a live Loader entry, resolve this package's
 * `package.json`, read its `dsh.client` declaration, and compose `lib/client.js`
 * into the browser boot graph. Nothing here runs in the session loop and no host
 * service is provided or consumed — the entire feature lives in the browser
 * half, reading the official per-turn usage the chat UI already has.
 *
 * @module dsh-session-cost
 */

/** Cordis plugin name, matching the package name and the patched row id. */
export const name = 'dsh-session-cost'

/**
 * No host behavior: mounting this module is the whole point.
 * @returns nothing.
 */
export function apply(): void {}
