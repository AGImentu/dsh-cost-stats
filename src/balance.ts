/**
 * The wire shape of the balance readout, shared by both halves.
 *
 * The browser half only ever sees numbers, key NAMES and a reason code — never
 * an API key value. Keys resolved from DSH's credential service never leave the
 * host half at all, and a key typed into the page is used for exactly one
 * request (unless the reader asks to store it in DSH's own credential store,
 * which is the host's business and never echoed back).
 *
 * That split is the whole point of this module: the route's payload is the
 * contract that keeps secrets out of the page (and therefore out of any
 * screenshot, error report or browser history).
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
  /** The request carried a reference or a key this plugin refuses to use. */
  | 'bad-request'
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
  /**
   * The credential NAME the numbers belong to (`DEEPSEEK_API_KEY`).
   *
   * A name is not a secret — it is the identifier the reader picked in the
   * page's dropdown — and it is what lets the readout say whose money this is.
   */
  readonly ref?: string
  /** Present only when `ok` is false. */
  readonly reason?: BalanceFailure
  /** Short human-readable detail; never contains the key. */
  readonly message?: string
}

/** Where a candidate model entry was discovered. */
export type KeyRefOrigin =
  /** The harness default: DSH's own model configuration uses this name. */
  | 'default'
  /** Present in DSH's local credential store. */
  | 'store'
  /** Named by a provider's `apiKeyEnv` in the profile configuration. */
  | 'config'
  /** Shipped by the harness itself (its configuration is not a file on disk). */
  | 'harness'

/** One selectable model, described WITHOUT any key value. */
export interface KeyRefInfo {
  /**
   * The dropdown value: a credential reference, OR — for a model that has no key
   * at all — the synthetic provider id (`deepseek-account`).
   *
   * The synthetic form is deliberately NOT a valid reference (the pattern below
   * rejects it), so it can never be mistaken for a credential by the balance
   * route, and `noKey` marks it so the page never asks.
   */
  readonly ref: string
  /**
   * What to CALL this entry in the page: the model provider's own name.
   *
   * The reader picks from a dropdown that mirrors 「设置 → 模型」, so it has to
   * carry the same names that page shows — a provider whose display name is a
   * base URL (as the profile in front of us does) reads as that URL, exactly
   * like it does there. The credential reference stays on the option's tooltip.
   */
  readonly label?: string
  /** Whether the reference currently resolves to something. */
  readonly configured: boolean
  readonly origin: KeyRefOrigin
  /** Provider id from the profile configuration, when one was found. */
  readonly provider?: string
  /**
   * The model-provider ids whose traffic this entry stands for.
   *
   * This is what the page filters the statistics by: a stored reply records the
   * provider that served it (`deepseek-official`, `mixtoken`, …), so "show me
   * what THIS model was used for" is a set membership test against these ids.
   * Collected from every configuration block declaring the reference, plus a
   * built-in list for the models the harness itself ships.
   */
  readonly providers?: readonly string[]
  /**
   * `true` when this model has NO API key, so no balance can be asked for.
   *
   * `deepseek-account` is DSH's login account: its credential is a login token,
   * not an API key — measured against the official endpoint, a token like that
   * answers `401 Authentication Fails, Your api key … is invalid`. Such an entry
   * is still listed (the table can be filtered to it), but the page says why the
   * balance is unavailable instead of pretending the key is merely missing.
   */
  readonly noKey?: true
}

/** The `GET /cost-stats/keys` payload: what can be picked, never what it is. */
export interface KeysPayload {
  readonly ok: boolean
  /** The reference used when the reader picks nothing. */
  readonly default: string
  /** Every credential that can be selected, in display order. */
  readonly refs: readonly KeyRefInfo[]
  /** Present only when the catalog could not be built (the default still is). */
  readonly message?: string
}

