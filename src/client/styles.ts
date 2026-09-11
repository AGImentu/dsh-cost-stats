/**
 * Plugin-owned stylesheet.
 *
 * Injected as a single `<style data-plugin="dsh-session-cost">` tag when the
 * plugin applies, and removed with its disposer — the same tagged-style
 * convention the official client-bundle preset uses for CSS Modules. A plain
 * class-name sheet (instead of CSS Modules) is deliberate: an out-of-tree plugin
 * cannot import DSH's build preset, and this sheet is small enough that class
 * hashing would add machinery without buying isolation.
 *
 * Visual values consume DSH design tokens only (`--dsw-*` alias/specific tokens
 * and `--dsh-content-*` typography deltas), so the chip and its panel follow the
 * active light/dark theme and the interface font-size setting. The panel skin
 * mirrors the native turn-usage dialog
 * (`ui-chat/src/client/chat/stat-dialog.module.css`).
 *
 * @module dsh-session-cost/client/styles
 */

/** Plugin id used for the tagged style element. */
export const STYLE_PLUGIN_ID = 'dsh-session-cost'

/** Class names shared by the chip and its panel. */
export const CLASS = {
  root: 'dsh-session-cost',
  trigger: 'dsh-session-cost__trigger',
  label: 'dsh-session-cost__label',
  panel: 'dsh-session-cost__panel',
  title: 'dsh-session-cost__title',
  titleLabel: 'dsh-session-cost__titleLabel',
  titleValue: 'dsh-session-cost__titleValue',
  rule: 'dsh-session-cost__rule',
  details: 'dsh-session-cost__details',
  items: 'dsh-session-cost__items',
  cost: 'dsh-session-cost__cost',
  total: 'dsh-session-cost__total',
  note: 'dsh-session-cost__note',
  reasoning: 'dsh-session-cost__reasoning',
  stats: 'dsh-session-cost__stats',
  statsHead: 'dsh-session-cost__statsHead',
  statsTitle: 'dsh-session-cost__statsTitle',
  statsSubtitle: 'dsh-session-cost__statsSubtitle',
  tabs: 'dsh-session-cost__tabs',
  tab: 'dsh-session-cost__tab',
  statsTotal: 'dsh-session-cost__statsTotal',
  statsTotalValue: 'dsh-session-cost__statsTotalValue',
  statsMetrics: 'dsh-session-cost__statsMetrics',
  metric: 'dsh-session-cost__metric',
  table: 'dsh-session-cost__table',
  num: 'dsh-session-cost__num',
  session: 'dsh-session-cost__session',
  badge: 'dsh-session-cost__badge',
  moneySub: 'dsh-session-cost__moneySub',
  selectable: 'dsh-session-cost__rowSelectable',
  selected: 'dsh-session-cost__rowSelected',
  statsNote: 'dsh-session-cost__statsNote',
  empty: 'dsh-session-cost__empty',
} as const

/** The stylesheet text injected once per plugin lifetime. */
export const STYLES = `
.${CLASS.root} {
  display: inline-flex;
  min-width: 0;
}

.${CLASS.trigger} {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: calc(28px + var(--dsh-content-font-delta, 0px));
  padding: 6px 8px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-variant-numeric: tabular-nums;
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  white-space: nowrap;
  cursor: pointer;
}

.${CLASS.trigger} svg {
  width: calc(15px + var(--dsh-content-font-delta, 0px));
  height: calc(15px + var(--dsh-content-font-delta, 0px));
  flex: none;
}

.${CLASS.trigger}:hover,
.${CLASS.trigger}[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.${CLASS.label} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.${CLASS.panel} {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  width: max-content;
  min-width: min(320px, calc(100vw - 24px));
  max-width: min(460px, calc(100vw - 24px));
  padding: 16px;
  border: 0;
  border-radius: 12px;
  background: var(--dsw-specific-menu);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}

.${CLASS.title} {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.${CLASS.titleLabel} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.${CLASS.titleLabel} svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.${CLASS.titleValue} {
  font-variant-numeric: tabular-nums;
}

.${CLASS.rule} {
  margin-bottom: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.${CLASS.details},
.${CLASS.items} {
  display: grid;
  gap: 6px 16px;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
}

.${CLASS.details} {
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
}

.${CLASS.items} {
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr) auto;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.${CLASS.details} dt,
.${CLASS.details} dd,
.${CLASS.items} dt,
.${CLASS.items} dd {
  min-width: 0;
  margin: 0;
}

.${CLASS.details} dd,
.${CLASS.items} dd {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.${CLASS.details} dd {
  overflow-wrap: anywhere;
  text-align: right;
}

.${CLASS.cost} {
  text-align: right;
  white-space: nowrap;
}

.${CLASS.total} {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.${CLASS.reasoning} {
  color: var(--dsw-alias-label-tertiary);
}

.${CLASS.note} {
  margin-top: 10px;
  color: var(--dsw-alias-label-tertiary);
  line-height: 16px;
}

/* ---------------------------------------------------------------- stats page */

.${CLASS.stats} {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

.${CLASS.statsHead} {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.${CLASS.statsTitle} {
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
}

.${CLASS.statsSubtitle} {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

/* Segmented mode switch: the settings panel's own chip geometry. */
.${CLASS.tabs} {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}

.${CLASS.tab} {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}

.${CLASS.tab}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.${CLASS.tab}[aria-pressed='true'] {
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

/* Total card: the query's headline number. */
.${CLASS.statsTotal} {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}

.${CLASS.statsTotalValue} {
  color: var(--dsw-alias-label-primary);
  font-size: 22px;
  line-height: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.${CLASS.statsMetrics} {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.${CLASS.metric} {
  white-space: nowrap;
}

/* Tables: quiet rows, right-aligned numerics, tappable bucket rows. */
.${CLASS.table} {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.${CLASS.table} th {
  padding: 0 8px 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
  text-align: left;
  white-space: nowrap;
}

.${CLASS.table} td {
  padding: 7px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  vertical-align: top;
}

.${CLASS.table} tbody tr:last-child td {
  border-bottom: none;
}

.${CLASS.table} th.${CLASS.num},
.${CLASS.table} td.${CLASS.num} {
  text-align: right;
  white-space: nowrap;
}

.${CLASS.table} th:first-child,
.${CLASS.table} td:first-child {
  padding-left: 0;
}

.${CLASS.table} th:last-child,
.${CLASS.table} td:last-child {
  padding-right: 0;
}

.${CLASS.session} {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.${CLASS.moneySub} {
  display: block;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.${CLASS.badge} {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  vertical-align: 1px;
}

.${CLASS.selectable} {
  cursor: pointer;
}

.${CLASS.selectable}:hover td {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${CLASS.selected} td {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.${CLASS.statsNote} {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.${CLASS.empty} {
  padding: 16px;
  border: 0.5px dashed var(--dsw-alias-border-l2);
  border-radius: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}
`

/**
 * Install the stylesheet once, returning its disposer.
 * @returns the disposer that removes the style tag.
 */
export function installStyles(): () => void {
  const existing = document.querySelector(`style[data-plugin="${STYLE_PLUGIN_ID}"]`)
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_PLUGIN_ID
  tag.textContent = STYLES
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
