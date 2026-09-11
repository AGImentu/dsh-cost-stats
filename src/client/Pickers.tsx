/**
 * Date and month pickers for the statistics page.
 *
 * Both are a trigger field plus an anchored popover — the classic calendar
 * affordance, not a tab strip: "按日" is a day grid you click, "按月" is a month
 * grid you click, and each picker clears the other through its caller.
 *
 * The popover mirrors the chip's panel mechanics (portal, viewport clamp,
 * Escape / outside-press close) so the plugin has one interaction language.
 *
 * @module dsh-cost-stats/client/Pickers
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  dayKeyShifted, monthGrid, parseYearMonthKey, shiftMonth, WEEKDAYS, yearMonthKey, type YearMonth,
} from './calendar.ts'
import type { Translator } from './contract.ts'
import { CLASS } from './styles.ts'

/** Popover position before its first measurement: rendered hidden, then placed. */
const HIDDEN: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * Anchored popover shared by both pickers: fixed-position portal above or below
 * the trigger, clamped into the viewport.
 * @param props - anchor element, close callback, and content.
 * @returns the portaled panel.
 */
function Popover({ anchor, onClose, children }: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
}): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>(undefined)

  const place = useCallback((): void => {
    const panel = panelRef.current
    if (anchor === null || panel === null) return
    const rect = anchor.getBoundingClientRect()
    const width = panel.offsetWidth
    const height = panel.offsetHeight
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
    const below = rect.bottom + 6
    const top = below + height <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - height - 6)
    setPos({ left, top })
  }, [anchor])

  useLayoutEffect(() => { place() }, [place])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (panelRef.current?.contains(target) === true) return
      if (anchor?.contains(target) === true) return
      onClose()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [anchor, onClose, place])

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      className={CLASS.pickerPanel}
      style={pos === undefined ? HIDDEN : { left: pos.left, top: pos.top }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Shared popover header: ‹ title ›. */
function PickerHead({ title, onShift, tr }: {
  title: string
  onShift: (delta: number) => void
  tr: Translator
}): ReactNode {
  return (
    <div className={CLASS.pickerHead}>
      <button type="button" className={CLASS.pickerNav} aria-label={tr('stats.pick.prev')} onClick={() => { onShift(-1) }}>
        ‹
      </button>
      <span className={CLASS.pickerTitle}>{title}</span>
      <button type="button" className={CLASS.pickerNav} aria-label={tr('stats.pick.next')} onClick={() => { onShift(1) }}>
        ›
      </button>
    </div>
  )
}

/** Shared footer: clear + jump-to-now. */
function PickerFoot({ onClear, onNow, clearLabel, nowLabel }: {
  onClear: () => void
  onNow: () => void
  clearLabel: string
  nowLabel: string
}): ReactNode {
  return (
    <div className={CLASS.pickerFoot}>
      <button type="button" className={CLASS.pickerAction} onClick={onClear}>{clearLabel}</button>
      <button type="button" className={CLASS.pickerAction} onClick={onNow}>{nowLabel}</button>
    </div>
  )
}

/** Props of the day picker. */
export interface DayPickerProps {
  /** Selected `YYYY-MM-DD`, or undefined for "no day filter". */
  readonly value: string | undefined
  /** Days that carry replies, marked in the grid. */
  readonly dataDays: ReadonlySet<string>
  readonly tr: Translator
  /** Called with a day key, or undefined to clear. */
  readonly onPick: (key: string | undefined) => void
}

/**
 * Day picker: a calendar grid.
 * @param props - selection, data markers, translator, and pick callback.
 * @returns the trigger field and, while open, its popover.
 */
export function DayPicker({ value, dataDays, tr, onPick }: DayPickerProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<YearMonth>(() => parseYearMonthKey(value?.slice(0, 7)) ?? fromDay(value))
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const today = dayKeyShifted(Date.now(), 0)
  const grid = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month])

  useEffect(() => {
    // Reopening on a new selection should show that selection's month.
    const parsed = parseYearMonthKey(value?.slice(0, 7))
    if (parsed !== undefined) setView(parsed)
  }, [value])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={CLASS.field}
        data-active={value === undefined ? undefined : 'true'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
      >
        {value ?? tr('stats.pick.day')}
      </button>
      {open && (
        <Popover anchor={triggerRef.current} onClose={() => { setOpen(false) }}>
          <PickerHead
            tr={tr}
            title={yearMonthKey(view)}
            onShift={delta => { setView(current => shiftMonth(current, delta)) }}
          />
          <div className={CLASS.calGrid} data-weekdays>
            {WEEKDAYS.map(label => <span key={label} className={CLASS.calWeekday}>{label}</span>)}
          </div>
          <div className={CLASS.calGrid}>
            {grid.flat().map(cell => (
              <button
                key={cell.key}
                type="button"
                className={CLASS.calCell}
                data-outside={cell.inMonth ? undefined : 'true'}
                data-today={cell.key === today ? 'true' : undefined}
                data-has-data={dataDays.has(cell.key) ? 'true' : undefined}
                data-selected={cell.key === value ? 'true' : undefined}
                onClick={() => { onPick(cell.key); setOpen(false) }}
              >
                {cell.label}
              </button>
            ))}
          </div>
          <PickerFoot
            clearLabel={tr('stats.pick.clear')}
            nowLabel={tr('stats.pick.today')}
            onClear={() => { onPick(undefined); setOpen(false) }}
            onNow={() => { onPick(today); setOpen(false) }}
          />
        </Popover>
      )}
    </>
  )
}

/** Props of the month picker. */
export interface MonthPickerProps {
  /** Selected `YYYY-MM`, or undefined for "no month filter". */
  readonly value: string | undefined
  /** Months that carry replies, marked in the grid. */
  readonly dataMonths: ReadonlySet<string>
  readonly tr: Translator
  /** Called with a month key, or undefined to clear. */
  readonly onPick: (key: string | undefined) => void
}

/**
 * Month picker: a twelve-month grid for one year.
 * @param props - selection, data markers, translator, and pick callback.
 * @returns the trigger field and, while open, its popover.
 */
export function MonthPicker({ value, dataMonths, tr, onPick }: MonthPickerProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<YearMonth>(() => parseYearMonthKey(value) ?? fromDay(value))
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const parsed = parseYearMonthKey(value)
    if (parsed !== undefined) setView(parsed)
  }, [value])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={CLASS.field}
        data-active={value === undefined ? undefined : 'true'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
      >
        {value ?? tr('stats.pick.month')}
      </button>
      {open && (
        <Popover anchor={triggerRef.current} onClose={() => { setOpen(false) }}>
          <PickerHead
            tr={tr}
            title={String(view.year)}
            onShift={delta => { setView(current => shiftMonth(current, delta * 12)) }}
          />
          <div className={CLASS.calMonths}>
            {Array.from({ length: 12 }, (_unused, index) => {
              const key = yearMonthKey({ year: view.year, month: index + 1 })
              return (
                <button
                  key={key}
                  type="button"
                  className={CLASS.calCell}
                  data-has-data={dataMonths.has(key) ? 'true' : undefined}
                  data-selected={key === value ? 'true' : undefined}
                  onClick={() => { onPick(key); setOpen(false) }}
                >
                  {tr('stats.pick.monthShort', { month: index + 1 })}
                </button>
              )
            })}
          </div>
          <PickerFoot
            clearLabel={tr('stats.pick.clear')}
            nowLabel={tr('stats.pick.thisMonth')}
            onClear={() => { onPick(undefined); setOpen(false) }}
            onNow={() => {
              onPick(yearMonthKey(fromDay(dayKeyShifted(Date.now(), 0))))
              setOpen(false)
            }}
          />
        </Popover>
      )}
    </>
  )
}

/**
 * Resolve a `YYYY-MM-DD` day key to its year/month, falling back to today.
 * @param dayKey - day key, or undefined.
 * @returns the year/month pair to display.
 */
function fromDay(dayKey: string | undefined): YearMonth {
  if (dayKey !== undefined) {
    const parsed = parseYearMonthKey(dayKey.slice(0, 7))
    if (parsed !== undefined) return parsed
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}
