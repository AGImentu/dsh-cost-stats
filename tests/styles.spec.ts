import { describe, expect, it } from 'vitest'
import { CLASS, STYLES } from '../src/client/styles.ts'

/** The rule block that styles one class, so an assertion can talk about a surface. */
function blockOf(className: string): string {
  const start = STYLES.indexOf(`.${className} {`)
  expect(start, `no rule for .${className}`).toBeGreaterThanOrEqual(0)
  const end = STYLES.indexOf('}', start)
  return STYLES.slice(start, end)
}

describe('floating surfaces', () => {
  // 0.15.0 and earlier copied DSH's menu colour without the frosted layer the host
  // pairs with it, so both popovers let the page show through: the turn-cost panel
  // was unreadable over chat text, and the calendar over the table.
  it('paint the turn-cost panel on an opaque surface', () => {
    const block = blockOf(CLASS.panel)
    expect(block).toContain('background: var(--dsw-alias-bg-base')
    // A bare translucent menu fill is the bug; it must not come back.
    expect(block).not.toMatch(/background: var\(--dsw-specific-menu\)/)
  })

  it('paint the calendar popover on the same opaque surface', () => {
    const block = blockOf(CLASS.pickerPanel)
    expect(block).toContain('background: var(--dsw-alias-bg-base')
    expect(block).not.toMatch(/background: var\(--dsw-specific-menu\)/)
  })

  it('keeps a visible edge, so an opaque panel still reads as a layer', () => {
    expect(blockOf(CLASS.panel)).toContain('box-shadow: var(--dsw-elevation-prominent)')
    expect(blockOf(CLASS.pickerPanel)).toContain('box-shadow: var(--dsw-elevation-prominent)')
  })
})
