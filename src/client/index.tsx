/**
 * Browser half of dsh-cost-stats: two contributions plus the plugin's own
 * stylesheet and dictionaries.
 *
 * 1. `conversation.chat.assistant-actions` — the per-turn cost chip beside the
 *    native turn-usage pill, behind an error boundary (see `Boundary.tsx`) so a
 *    failure can only remove the chip, never the official controls sharing that
 *    row.
 * 2. `settings.section` — the "Cost stats" settings page: per-session totals
 *    with day/month queries, read from the session list's host-projected usage
 *    and model selection (no session is activated to build it).
 *
 * Both slots are declared by core client plugins and served by the slot registry
 * in `@deepseek-ai/dsh-client-ui-renderer`; registering there needs no core
 * change and no host service. The plugin touches no store, no host API, and no
 * DOM outside its own elements.
 *
 * @module dsh-cost-stats/client
 */

import type { ReactNode } from 'react'
import type {
  ClientContextLike, CostChipProps, CostStatsProps,
} from './contract.ts'
import { CostChipBoundary } from './Boundary.tsx'
import { CostChip } from './CostChip.tsx'
import { CostStatsSection } from './StatsSection.tsx'
import { activeLocaleOf, localeOf, withFallback } from './locale-service.ts'
import { en, fallbackTranslator, NS, zh } from './locales.ts'
import { installStyles } from './styles.ts'

/** Required services: the slot registry (the only hard dependency). */
export const inject = ['slots']

/**
 * Settings nav position. The shipped sections take the low orders and the
 * sidebar plugin's "side card" page registers at 100, so the cost page lands
 * after it — the position asked for.
 */
const STATS_ORDER = 300

/**
 * The registered chip entry: the chip behind a containment boundary.
 *
 * Exported for the render tests, which mount the entry (not the inner component)
 * so the translator wrapping below is covered too.
 * @param props - the slot owner plus the framework standard seats.
 * @returns the contained chip.
 */
export function CostChipEntry(props: CostChipProps): ReactNode {
  return (
    <CostChipBoundary>
      <CostChip {...props} t={withFallback(props.t)} />
    </CostChipBoundary>
  )
}

/**
 * The registered settings page, contained the same way: a page that throws
 * should show nothing instead of replacing the settings content column.
 *
 * The seat's translator is wrapped so a host whose locale service cannot answer
 * this namespace still shows Chinese instead of raw keys (`withFallback`).
 * @param props - the session-list standard seat and the locale seat.
 * @returns the contained statistics page.
 */
export function CostStatsEntry(props: CostStatsProps): ReactNode {
  return (
    <CostChipBoundary>
      <CostStatsSection {...props} t={withFallback(props.t)} />
    </CostChipBoundary>
  )
}

/**
 * Resolve the registrant-localized settings nav label.
 * @param active - active locale id, when the locale service exposes one.
 * @returns the nav label.
 */
function navLabelFor(active: string | undefined): string {
  if (active === undefined) return fallbackTranslator('stats.nav')
  return (active.startsWith('zh') ? zh : en)['stats.nav'] ?? fallbackTranslator('stats.nav')
}

/**
 * Client plugin body: inject the sheet, publish dictionaries, and contribute the
 * chip entry and the statistics page.
 * @param ctx - browser-side cordis context.
 * @returns nothing.
 */
export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => installStyles(), 'dsh-cost-stats: styles')

  // Read the locale service through cordis's NON-STRICT lookup: this plugin does
  // not (and must not) declare `locale` in `inject`, because a host without that
  // provider would then never mount the plugin at all. The dictionaries are an
  // enhancement — and `withFallback` (used by both entries below) keeps the UI
  // readable even when this lookup finds nothing, which is exactly what a strict
  // lookup did to the settings page: it answered nothing, the framework's
  // translator echoed the keys, and the page read `stats.title` on screen.
  const locale = localeOf(ctx)
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { zh, en })
      } catch (error) {
        // A failed registration is not worth losing the page over: the bundled
        // dictionary still answers every key through `withFallback`.
        console.warn('dsh-cost-stats: registering dictionaries failed', error)
        return undefined
      }
    }, 'dsh-cost-stats: dictionaries')
  }

  // The settings shell owns the nav cell and reads the label from this
  // registrant's thunk on every render, so tracking the active locale is enough:
  // no re-registration and no locale subscription of the plugin's own.
  let activeLocale = activeLocaleOf(locale)
  ctx.on?.('locale/change', (snapshot: { active?: string } | undefined) => {
    activeLocale = snapshot?.active ?? activeLocale
  })

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'cost-stats',
    // After the core feedback entry (order 10); the core usage/time pills are
    // not list entries, so this chip sits in the plugin cell of the row.
    order: 20,
    locale: NS,
  }, CostChipEntry))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'cost-stats',
    order: STATS_ORDER,
    label: () => navLabelFor(activeLocale),
    locale: NS,
  }, CostStatsEntry))
}
