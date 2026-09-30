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
 * local callers only. Its payload never contains a key value — only numbers and
 * the NAME of the reference they came from.
 *
 * `GET ?ref=<NAME>&refresh=1` queries a named credential; `POST` with a JSON body
 * `{ ref?, key?, refresh?, remember? }` also accepts a key typed into the page.
 */
export const BALANCE_ROUTE = '/cost-stats/balance'

/**
 * Exact webserver path that lists the API keys this harness could query.
 *
 * Names and "configured / not configured" only — resolving a value is the
 * balance route's job, and the page has no use for one. Same local-only guard as
 * the balance route: knowing which key names exist is reconnaissance too.
 */
export const KEYS_ROUTE = '/cost-stats/keys'
