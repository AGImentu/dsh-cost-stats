/**
 * Route constants shared by the host half (which registers them) and the browser
 * half (which fetches them). Pure data, so both bundles inline the same value
 * instead of drifting apart.
 *
 * @module dsh-session-cost/routes
 */

/** Exact webserver path that serves the aggregated per-reply usage payload. */
export const USAGE_ROUTE = '/session-cost/usage'
