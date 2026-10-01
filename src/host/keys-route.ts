/**
 * The key catalog route: `GET /cost-stats/keys`.
 *
 * The page's model dropdown asks this route "which models have a credential?"
 * and receives names, provider ids, display labels and a configured flag —
 * never a value. The work itself lives in `key-catalog.ts`; this file is only the
 * webserver edge: refuse non-local callers, answer JSON, and never throw into the
 * webserver.
 *
 * @module dsh-cost-stats/host/keys-route
 */

import { isLocalRequest } from './balance.ts'
import { API_KEY_REF } from './api-key.ts'
import { keysPayload } from './key-catalog.ts'
import { KEYS_ROUTE } from '../routes.ts'
import type { KeysPayload } from '../balance.ts'
import type { HostContextLike, ServerRequestLike, ServerResponseLike } from './contract.ts'

/**
 * Serve the route.
 * @param ctx - host context.
 * @param req - incoming request.
 * @param res - response to write.
 * @returns nothing.
 */
export async function handleKeysRequest(
  ctx: object,
  req: ServerRequestLike,
  res: ServerResponseLike,
): Promise<void> {
  const respond = (status: number, body: KeysPayload): void => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  }

  if (!isLocalRequest(req)) {
    respond(403, {
      ok: false,
      default: API_KEY_REF,
      refs: [],
      message: '凭据清单仅对本机请求开放',
    })
    return
  }

  try {
    respond(200, await keysPayload(ctx))
  } catch (error) {
    // Catalog building is discovery, not a contract: the page still gets the
    // default reference and can query it, so a listing failure never takes the
    // balance readout down with it.
    const message = error instanceof Error ? error.message : String(error)
    const logger = (ctx as { logger?: { warn(message: unknown): void } }).logger
    logger?.warn(`dsh-cost-stats: ${KEYS_ROUTE} failed: ${message}`)
    respond(200, { ok: false, default: API_KEY_REF, refs: [], message })
  }
}

/** Register the route. @returns the disposer. */
export function registerKeysRoute(ctx: HostContextLike): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: KEYS_ROUTE,
    handler: (req, res) => {
      handleKeysRequest(ctx, req as ServerRequestLike, res).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn(`dsh-cost-stats: keys route failed: ${message}`)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({
          ok: false,
          default: API_KEY_REF,
          refs: [],
          message,
        }))
      })
    },
  })
}
