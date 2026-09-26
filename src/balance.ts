/**
 * The wire shape of the balance readout, shared by both halves.
 *
 * The browser half only ever sees numbers and a reason code — never the API key,
 * which is resolved and used entirely inside the host half. That split is the
 * whole point of this module: the route's payload is the contract that keeps the
 * secret out of the page (and therefore out of any screenshot or error report).
 *
 * @module dsh-cost-stats/balance
 */

/** One currency's DeepSeek balance entry. */
export interface BalanceInfo {
  /** `CNY` or `USD` (whatever the account actually holds). */
  readonly currency: string
  /** Total available balance, granted + topped up. */
  readonly total: number
  /** Unexpired granted credit. */
  readonly granted: number
  /** Money the account holder paid in. */
  readonly toppedUp: number
}

/** Why a balance query produced no numbers. */
export type BalanceFailure =
  /** No `DEEPSEEK_API_KEY` is configured for this harness. */
  | 'no-key'
  /** The credentials service is not mounted, so the key cannot be read at all. */
  | 'credentials-unavailable'
  /** The caller is not on this machine; the key is only used for local readers. */
  | 'forbidden'
  /** The request to DeepSeek did not complete. */
  | 'network'
  /** DeepSeek answered 401/403: the configured key is rejected. */
  | 'unauthorized'
  /** DeepSeek answered something this plugin cannot read. */
  | 'bad-response'

/** The `GET /cost-stats/balance` payload. */
export interface BalancePayload {
  readonly ok: boolean
  /** DeepSeek's `is_available`: whether the balance can still pay for calls. */
  readonly available?: boolean
  readonly infos?: readonly BalanceInfo[]
  /** Epoch ms of the successful query. */
  readonly at?: number
  /** Present only when `ok` is false. */
  readonly reason?: BalanceFailure
  /** Short human-readable detail; never contains the key. */
  readonly message?: string
}
