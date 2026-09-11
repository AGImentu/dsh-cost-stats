/**
 * Host half of dsh-cost-stats.
 *
 * Two jobs:
 *
 * 1. be a live Loader row so `dsh-client-modules` discovers this package's
 *    `dsh.client` declaration and composes `lib/client.js` into the browser
 *    boot graph;
 * 2. serve the statistics page's data: `GET /cost-stats/usage` folds every
 *    stored session log into per-reply priced rows (`CostStatsIndex`).
 *
 * The route is a plain same-origin JSON endpoint registered through
 * `ctx.webServer`, so it rides the app's existing browser authentication and
 * needs no separate token, no RPC envelope and no client half cooperation beyond
 * a `fetch`. Nothing here touches the session loop, and a failure is contained:
 * the handler answers 500 with a message instead of throwing into the webserver.
 *
 * @module dsh-cost-stats
 */

import type { HostContextLike, ServerResponseLike } from './host/contract.ts'
import { CostStatsIndex } from './host/cost-stats-index.ts'
import { USAGE_ROUTE } from './routes.ts'

/** Cordis plugin name, matching the package name and the patched row id. */
export const name = 'dsh-cost-stats'

/** Host services required before mounting: the route table and session storage. */
export const inject = ['webServer', 'sessionPersistence']

/**
 * Write one JSON response.
 * @param res - the webserver response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function writeJson(res: ServerResponseLike, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  // The payload is cheap but time-sensitive; let the client's own cache decide.
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Whether the request asked to bypass the index cache.
 * @param req - the webserver request (Node `IncomingMessage`).
 * @returns whether `?refresh=1` was present.
 */
function wantsRefresh(req: unknown): boolean {
  const url = (req as { url?: unknown } | undefined)?.url
  if (typeof url !== 'string') return false
  const query = url.indexOf('?')
  if (query === -1) return false
  return new URLSearchParams(url.slice(query + 1)).get('refresh') === '1'
}

/**
 * Mount the plugin: one exact JSON route over the session cost index.
 * @param ctx - host-side cordis context.
 * @returns nothing.
 */
export function apply(ctx: HostContextLike): void {
  const index = new CostStatsIndex(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: USAGE_ROUTE,
    handler: async (req, res) => {
      try {
        writeJson(res, 200, await index.payload(wantsRefresh(req)))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn(`dsh-cost-stats: ${USAGE_ROUTE} failed: ${message}`)
        writeJson(res, 500, { error: message })
      }
    },
  }), 'dsh-cost-stats: usage route')
}
