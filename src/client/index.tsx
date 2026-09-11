/**
 * Browser half of dsh-session-cost: registers the cost chip into the assistant
 * action row and owns the plugin's stylesheet and dictionaries.
 *
 * The slot is DSH's documented plugin seat inside the turn-tail action strip
 * (`conversation.chat.assistant-actions`, a list slot declared by
 * `@deepseek-ai/dsh-client-ui-chat` and served by the slot registry in
 * `@deepseek-ai/dsh-client-ui-renderer`). Registering there needs no core change
 * and no host service: the entry receives the durable `messageId` plus the
 * framework standard kit, including the `useChat` snapshot hook that exposes the
 * same turn usage the native pill renders.
 *
 * @module dsh-session-cost/client
 */

import type { ClientContextLike, CostChipProps, LocaleServiceLike } from './contract.ts'
import { CostChip } from './CostChip.tsx'
import { en, NS, zh } from './locales.ts'
import { installStyles } from './styles.ts'

/** Required services: the slot registry (the only hard dependency). */
export const inject = ['slots']

/** Type-level check that the registered component matches the slot's props. */
const entryComponent = CostChip satisfies (props: CostChipProps) => unknown

/**
 * Client plugin body: inject the sheet, publish dictionaries when the locale
 * service is mounted, and contribute the chip entry.
 * @param ctx - browser-side cordis context.
 * @returns nothing.
 */
export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => installStyles(), 'dsh-session-cost: styles')

  // Read the locale service through the root reflect store: the dictionaries are
  // an enhancement, so a host without the service still renders the chip (with
  // the built-in Chinese fallback) instead of leaving the entry pending.
  const locale = ctx.get?.('locale') as LocaleServiceLike | undefined
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-session-cost: dictionaries')
  }

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'session-cost',
    // After the core feedback entry (order 10); the core usage/time pills are
    // not list entries, so this chip sits in the plugin cell of the row.
    order: 20,
    locale: NS,
  }, entryComponent))
}
