/**
 * The slice of DSH's browser chat contract this plugin reads.
 *
 * These are MIRRORED declarations, not imports, and that is deliberate:
 *
 * - The canonical types live in `@deepseek-ai/dsh-client-ui-chat` inside the DSH
 *   repository. The published npm copies of DSH's client UI packages lag far
 *   behind the running shell (0.1.2-alpha.x / 0.0.1-rc.x while the shell is
 *   0.1.5-rc.2), so importing them would pin this plugin to types that do not
 *   describe the host it actually runs in.
 * - The plugin's real dependencies are therefore exactly two things: the frozen
 *   platform module table (`react`, `react/jsx-runtime`, `react-dom`) and the
 *   slot contract below. Every field is read defensively at runtime, so a DSH
 *   version that drops or renames a field degrades to "chip not rendered"
 *   instead of a crash.
 *
 * Pinned against DSH 0.1.5-rc.2:
 * - `conversation.chat.assistant-actions` — list slot, session scope, owner
 *   `{ messageId }` (`packages/client/ui-chat/src/client/contract/slots.ts`).
 * - `TurnTailChatData.tokenUsage` — exact provider-reported buckets plus route
 *   attribution (`.../contract/chat-nodes.ts`).
 * - Session-scope slot components receive the framework standard kit, which
 *   includes `useChat` (the chat snapshot selector hook) and the locale seat.
 *
 * @module dsh-session-cost/client/contract
 */

/** One provider/model route that contributed a billed attempt to a turn. */
export interface TurnTokenUsageRoute {
  readonly provider: string
  readonly model: string
}

/** Exact provider-reported accounting for one completed turn. */
export interface TurnTokenUsage {
  /** Prompt input tokens not served from cache. */
  readonly uncachedInputTokens: number
  /** Output tokens, reasoning included. */
  readonly outputTokens: number
  /** Exact aggregate prompt plus output total. */
  readonly totalTokens: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheReadTokens?: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheWriteTokens?: number
  /** Output subset; present only when every attempt reported it. */
  readonly reasoningTokens?: number
  /** Present only when every billed attempt carries provider/model attribution. */
  readonly routes?: readonly TurnTokenUsageRoute[]
}

/** Settled assistant payload carried by a turn-tail node. */
export interface TurnTailClosingLike {
  readonly messageId?: string
  readonly finalNode?: { readonly messageId?: string }
}

/** Payload of the `turn-tail` chat node, the slice this plugin needs. */
export interface TurnTailData {
  readonly turn: number
  readonly closing?: TurnTailClosingLike | null
  readonly tokenUsage?: TurnTokenUsage
}

/** One turn's start/end instants in the conversation timeline. */
export interface TurnLocationLike {
  readonly start?: { readonly time: number }
  readonly end?: { readonly time: number }
}

/** A materialized chat node, narrowed to the fields read here. */
export interface ChatNodeLike {
  readonly kind: string
  readonly data?: unknown
  readonly location?: { readonly turn?: TurnLocationLike }
}

/** The chat snapshot surface this plugin selects from. */
export interface ChatSnapshotLike {
  readonly nodes: {
    values(): readonly ChatNodeLike[]
  }
  readonly order?: readonly string[]
}

/** Selector hook over the current conversation's chat snapshot. */
export type UseChatLike = <T>(selector: (snapshot: ChatSnapshotLike) => T) => T

/** Translator bound to this plugin's locale namespace by the slot renderer. */
export type Translator = (key: string, vars?: Readonly<Record<string, string | number>>) => string

/** Owner currency plus the standard seats this entry reads. */
export interface CostChipProps {
  /** Durable assistant message this action row belongs to. */
  readonly messageId: string
  /** Chat snapshot selector hook from the framework standard kit. */
  readonly useChat?: UseChatLike
  /** Locale translator for this plugin's namespace. */
  readonly t?: Translator
}

/** Options accepted by `ctx.slots.register` for a list slot. */
export interface SlotRegistrationOptions {
  readonly name: string
  readonly id: string
  readonly order?: number
  readonly locale?: string
  /**
   * Display label for list entries whose owner renders one (the settings nav).
   * A thunk is re-evaluated per render, so registrant-localized copy stays live
   * without re-registering on every locale change.
   */
  readonly label?: string | (() => string)
}

/** The slot registry service contributed by `@deepseek-ai/dsh-client-ui-renderer`. */
export interface SlotsService {
  /**
   * Run `contribute` as soon as `key` is declared, disposing its result when the
   * registration is torn down.
   * @param key - slot key this entry targets.
   * @param contribute - registration callback.
   */
  inject(key: string, contribute: () => () => void): unknown
  /**
   * Register one entry into a declared slot.
   * @param options - entry identity and ordering.
   * @param component - the entry component.
   * @returns the unregister function.
   */
  register(options: SlotRegistrationOptions, component: unknown): () => void
}

/** Locale service contributed by `@deepseek-ai/dsh-client-locale`. */
export interface LocaleServiceLike {
  /**
   * Register dictionaries for a namespace.
   * @param ns - namespace key.
   * @param dictionaries - locale id → flat key/value dictionary.
   * @returns the unregister function.
   */
  register(ns: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
  /**
   * Read the current locale snapshot, when the service exposes one.
   * @returns the snapshot carrying the active locale id.
   */
  getSnapshot?(): { readonly active?: string }
}

/** The browser-side cordis context surface this plugin's `apply` uses. */
export interface ClientContextLike {
  readonly slots: SlotsService
  /**
   * Register a disposable effect.
   * @param callback - body returning its disposer.
   * @param label - diagnostic label.
   */
  effect(callback: () => (() => void) | void, label?: string): void
  /**
   * Read a service from the root reflect store, tolerating its absence.
   * @param name - service name.
   * @returns the service, or undefined.
   */
  get?(name: string): unknown
  /**
   * Subscribe to a framework event, tolerating a host that does not emit it.
   * @param event - event name.
   * @param listener - event listener.
   */
  on?(event: string, listener: (payload: never) => void): void
}

/**
 * Props of the settings section entry (`settings.section`, root scope).
 *
 * The page needs no standard data seat: it reads its numbers from the plugin's
 * own host route (the durable logs live there), so the owner props the shell
 * passes are ignored and only the locale seat is used.
 */
export interface CostStatsProps {
  /** Locale translator for this plugin's namespace. */
  readonly t?: Translator
}
