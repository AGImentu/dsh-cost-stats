/**
 * Containment boundary for this plugin's entry.
 *
 * The chip renders INSIDE the shared turn-tail action row — the same React
 * subtree that carries the official copy / branch / usage / time controls. A
 * throw from a plugin component therefore must not be allowed to reach that
 * subtree: React unwinds to the nearest error boundary, and if the boundary is
 * above the whole row, the official controls go with it.
 *
 * This boundary is that guarantee, in this plugin: any render or lifecycle error
 * in the cost chip degrades to "no chip" and leaves every sibling control
 * exactly as the core rendered it.
 *
 * @module dsh-session-cost/client/Boundary
 */

import { Component, type ReactNode } from 'react'

/** State of the containment boundary. */
interface CostBoundaryState {
  /** Set once a descendant threw; the boundary then renders nothing. */
  failed: boolean
}

/**
 * Render children until one throws, then render nothing.
 *
 * A class component is deliberate: `getDerivedStateFromError` is the only
 * React-18 error-boundary hook, and the guard costs no dependency.
 */
export class CostChipBoundary extends Component<{ children: ReactNode }, CostBoundaryState> {
  override state: CostBoundaryState = { failed: false }

  /**
   * React calls this during the render phase after a descendant throws.
   * @returns the state that hides the subtree.
   */
  static getDerivedStateFromError(): CostBoundaryState {
    return { failed: true }
  }

  /**
   * Report the swallowed failure once, without rethrowing: the plugin is
   * decoration, and its failure must not surface as a chat error.
   * @param error - the error a descendant threw.
   */
  override componentDidCatch(error: unknown): void {
    console.warn('[dsh-session-cost] cost chip disabled after a render error:', error)
  }

  /**
   * Render the contained subtree, or nothing after a failure.
   * @returns the children while healthy, otherwise null.
   */
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
