/**
 * Host half of dsh-cost-stats.
 *
 * Three jobs:
 *
 * 1. be a live Loader row so `dsh-client-modules` discovers this package's
 *    `dsh.client` declaration and composes `lib/client.js` into the browser
 *    boot graph;
 * 2. serve the statistics page's data: `GET /cost-stats/usage` folds every
 *    stored session log into per-reply priced rows (`CostStatsIndex`);
 * 3. serve the account's balance: `GET /cost-stats/balance` resolves the
 *    harness's own `DEEPSEEK_API_KEY` from the credential service, asks DeepSeek
 *    once, and returns numbers only (`host/balance-route.ts`). The key is never
 *    stored by the plugin, never sent to the page, and never logged — which is
 *    what makes publishing this plugin safe.
 *
 * Both routes are plain same-origin JSON endpoints registered through
 * `ctx.webServer`, so they ride the app's existing browser authentication and
 * need no separate token, no RPC envelope and no client half cooperation beyond
 * a `fetch`. Nothing here touches the session loop, and a failure is contained:
 * each handler answers with a payload the page can render instead of throwing
 * into the webserver.
 *
 * @module dsh-cost-stats
 */

import type { HostContextLike, ServerResponseLike } from './host/contract.ts'
import { CostStatsIndex } from './host/cost-stats-index.ts'
import { registerBalanceRoute } from './host/balance-route.ts'
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
 * Mount the plugin: the usage route plus the balance readout.
 *
 * `credentials` is deliberately NOT in `inject`: the balance is a decoration on
 * the statistics page, and a host without that provider should still get the
 * page (the readout degrades to "cannot read the key") instead of losing the
 * plugin entirely. The service is looked up lazily per request.
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

  ctx.effect(() => registerBalanceRoute(ctx), 'dsh-cost-stats: balance route')
}
