/**
 * Route constants shared by the host half (which registers them) and the browser
 * half (which fetches them). Pure data, so both bundles inline the same value
 * instead of drifting apart.
 *
 * @module dsh-cost-stats/routes
 */

/** Exact webserver path that serves the aggregated per-reply usage payload. */
export const USAGE_ROUTE = '/cost-stats/usage'

/**
 * Exact webserver path that serves the DeepSeek account balance.
 *
 * Host-only by design: it is the one route that uses a credential, so it answers
 * local callers only and its payload never contains the key.
 */
export const BALANCE_ROUTE = '/cost-stats/balance'
