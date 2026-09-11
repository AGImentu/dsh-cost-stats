/**
 * Plugin-owned stylesheet.
 *
 * Injected as a single `<style data-plugin="dsh-cost-stats">` tag when the
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
 * @module dsh-cost-stats/client/styles
 */

/** Plugin id used for the tagged style element. */
export const STYLE_PLUGIN_ID = 'dsh-cost-stats'

/** Class names shared by the chip and its panel. */
export const CLASS = {
  root: 'dsh-cost-stats',
  trigger: 'dsh-cost-stats__trigger',
  label: 'dsh-cost-stats__label',
  panel: 'dsh-cost-stats__panel',
  title: 'dsh-cost-stats__title',
  titleLabel: 'dsh-cost-stats__titleLabel',
  titleValue: 'dsh-cost-stats__titleValue',
  rule: 'dsh-cost-stats__rule',
  details: 'dsh-cost-stats__details',
  items: 'dsh-cost-stats__items',
  cost: 'dsh-cost-stats__cost',
  total: 'dsh-cost-stats__total',
  note: 'dsh-cost-stats__note',
  reasoning: 'dsh-cost-stats__reasoning',
  stats: 'dsh-cost-stats__stats',
  statsHead: 'dsh-cost-stats__statsHead',
  statsTitle: 'dsh-cost-stats__statsTitle',
  statsSubtitle: 'dsh-cost-stats__statsSubtitle',
  toolbar: 'dsh-cost-stats__toolbar',
  field: 'dsh-cost-stats__field',
  pickerPanel: 'dsh-cost-stats__picker',
  pickerHead: 'dsh-cost-stats__pickerHead',
  pickerTitle: 'dsh-cost-stats__pickerTitle',
  pickerNav: 'dsh-cost-stats__pickerNav',
  pickerFoot: 'dsh-cost-stats__pickerFoot',
  pickerAction: 'dsh-cost-stats__pickerAction',
  calGrid: 'dsh-cost-stats__calGrid',
  calMonths: 'dsh-cost-stats__calMonths',
  calWeekday: 'dsh-cost-stats__calWeekday',
  calCell: 'dsh-cost-stats__calCell',
  statsTotal: 'dsh-cost-stats__statsTotal',
  statsTotalRow: 'dsh-cost-stats__statsTotalRow',
  statsTotalValue: 'dsh-cost-stats__statsTotalValue',
  statsMetrics: 'dsh-cost-stats__statsMetrics',
  metric: 'dsh-cost-stats__metric',
  table: 'dsh-cost-stats__table',
  session: 'dsh-cost-stats__session',
  moneyCell: 'dsh-cost-stats__moneyCell',
  moneyInline: 'dsh-cost-stats__moneyInline',
  pager: 'dsh-cost-stats__pager',
  pagerInfo: 'dsh-cost-stats__pagerInfo',
  pagerActions: 'dsh-cost-stats__pagerActions',
  pagerAction: 'dsh-cost-stats__pagerAction',
  badge: 'dsh-cost-stats__badge',
  moneySub: 'dsh-cost-stats__moneySub',
  statsNote: 'dsh-cost-stats__statsNote',
  empty: 'dsh-cost-stats__empty',
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

/* Query toolbar: the two calendar fields plus text actions. */
.${CLASS.toolbar} {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* A picker's trigger field. */
.${CLASS.field} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.${CLASS.field}:hover {
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
}

.${CLASS.field}[data-active='true'] {
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.${CLASS.pickerAction} {
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}

.${CLASS.pickerAction}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Calendar popover: the same menu skin as the chip's stat panel. */
.${CLASS.pickerPanel} {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  padding: 10px;
  border: 0;
  border-radius: 12px;
  background: var(--dsw-specific-menu);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.${CLASS.pickerHead} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.${CLASS.pickerTitle} {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.${CLASS.pickerNav} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.${CLASS.pickerNav}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.${CLASS.calGrid},
.${CLASS.calMonths} {
  display: grid;
  gap: 2px;
}

.${CLASS.calGrid} {
  grid-template-columns: repeat(7, 28px);
}

.${CLASS.calMonths} {
  grid-template-columns: repeat(3, 56px);
}

.${CLASS.calWeekday} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.${CLASS.calCell} {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.${CLASS.calCell}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Days outside the displayed month stay visible for layout stability. */
.${CLASS.calCell}[data-outside='true'] {
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.6;
}

/* Days that actually carry replies read as primary; a dot marks them. */
.${CLASS.calCell}[data-has-data='true'] {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.${CLASS.calCell}[data-has-data='true']::after {
  content: '';
  position: absolute;
  margin-top: 18px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}

.${CLASS.calCell}[data-today='true'] {
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l4);
}

.${CLASS.calCell}[data-selected='true'] {
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.${CLASS.pickerFoot} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

/* Total card: the query's headline number, then one row of money + metrics. */
.${CLASS.statsTotal} {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}

/* Money on the left, the metric line on the right, sharing ONE baseline. */
.${CLASS.statsTotalRow} {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.${CLASS.statsTotalValue} {
  /* CNY leads, USD sits on the same baseline beside it — never a second line. */
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 22px;
  line-height: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.${CLASS.statsTotalValue} .${CLASS.moneyInline} {
  margin-left: 0;
  font-size: 13px;
  font-weight: 500;
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

/* Tables: quiet rows, left-aligned cells, one-line money. */
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
  padding: 6px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  /* Middle, so a taller cell (a tag, a long title) never leaves its
     neighbours' text floating at the top of the row. */
  vertical-align: middle;
}

.${CLASS.table} tbody tr:last-child td {
  border-bottom: none;
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

/* Money column: CNY first, USD beside it, never a second line. */
.${CLASS.moneyCell} {
  white-space: nowrap;
}

.${CLASS.moneyInline} {
  margin-left: 6px;
  color: var(--dsw-alias-label-tertiary);
}

/* Pager under the list: where you are on the left, the two steps on the right. */
.${CLASS.pager} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.${CLASS.pagerActions} {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.${CLASS.pagerAction} {
  height: 26px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.${CLASS.pagerAction}:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
}

.${CLASS.pagerAction}:disabled {
  opacity: 0.45;
  cursor: default;
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
