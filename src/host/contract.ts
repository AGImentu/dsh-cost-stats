/**
 * Host-side contract mirrors.
 *
 * Like the browser mirrors (`client/contract.ts`), these are the slice of DSH's
 * host API this plugin consumes, declared locally instead of imported. The
 * official packages are not published at the version the running host uses, and
 * a plugin that imported them would be pinned to types describing a different
 * host. Every field is read defensively at runtime.
 *
 * Pinned against DSH 0.1.5-rc.2:
 * - `ctx.sessionPersistence` — `list()` / `open(id, 'read')` / `handle.read()`
 *   (`packages/session/session-persistence/src/index.ts`, `handle.ts`);
 * - `ctx.webServer.register({ kind, path, handler })` — Node `req`/`res` handler,
 *   returning its disposer (`packages/host/webserver`);
 * - the durable `session` header (id / createdAt / cwd / delegationDepth).
 *
 * @module dsh-session-cost/host/contract
 */

/** One durable session header, narrowed to the fields this plugin reads. */
export interface SessionHeaderLike {
  readonly id: string
  readonly createdAt?: number
  readonly cwd?: string
  /** Continuation depth: `0` for a human chat, `> 0` for a subagent session. */
  readonly delegationDepth?: number
  readonly agentPreset?: string
}

/** Per-session observation returned by `sessionPersistence.list()`. */
export interface SessionSnapshotLike {
  readonly header: SessionHeaderLike
  /** Logical event count when the backend knows it cheaply; `0` means empty. */
  readonly eventCount?: number
}

/** `sessionPersistence.open(id, access)` result, narrowed to the read path. */
export interface SessionHandleLike {
  /**
   * Read a slice of the valid contiguous log.
   * @param offset - first logical seq; defaults to 0.
   * @param length - maximum events; defaults to the rest.
   * @returns the owned slice.
   */
  read(offset?: number, length?: number): Promise<{ readonly events: readonly unknown[] }>
  /** Release the handle. */
  close(): Promise<void>
}

/** The persistence service slice this plugin uses. */
export interface SessionPersistenceLike {
  /** Enumerate stored sessions (metadata only). */
  list(options?: { readonly signal?: AbortSignal }): Promise<readonly SessionSnapshotLike[]>
  /**
   * Open one stored session.
   * @param id - session id.
   * @param access - `'read'` for the statistics page.
   */
  open(id: string, access: 'read' | 'write'): Promise<SessionHandleLike>
}

/** Node response surface the webserver hands to a route handler. */
export interface ServerResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

/** One webserver route registration. */
export interface WebRouteLike {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: unknown, res: ServerResponseLike) => Promise<void> | void
}

/** The webserver service slice this plugin uses. */
export interface WebServerLike {
  /**
   * Register a route.
   * @param route - path, match kind, and handler.
   * @returns the disposer that unregisters it.
   */
  register(route: WebRouteLike): () => void
}

/** The host-side cordis context surface this plugin's `apply` uses. */
export interface HostContextLike {
  readonly webServer: WebServerLike
  readonly sessionPersistence: SessionPersistenceLike
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
  /** Optional logger; failures are reported through it when present. */
  readonly logger?: { warn(message: unknown): void }
}
