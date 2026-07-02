import { useRef, useEffect, useState } from 'react'

/**
 * Auto-scroll a scrollable element to its bottom as new content arrives,
 * but pause that behaviour when the user has scrolled away from the bottom.
 *
 * The pattern:
 *   1. Track whether the element is currently "at the bottom" (within a
 *      small tolerance) by listening to scroll events
 *   2. On every change to `deps`, if we were at the bottom, snap back to
 *      the new bottom. Otherwise leave the viewport untouched so the user
 *      can keep reading their scroll-up position
 *   3. The moment the user scrolls back to the bottom, auto-scroll re-engages
 *
 * Returns:
 *   - ref            attach to the scrollable element
 *   - atBottom       true when the user is anchored to the bottom
 *   - newSinceScroll count of `deps` changes since they scrolled away
 *                    (useful for rendering a "↓ New messages" pill)
 *   - scrollToBottom imperative jump-to-bottom helper that also resets the pill
 */
export function useStickToBottom(deps, { threshold = 32 } = {}) {
  const ref = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newSinceScroll, setNewSinceScroll] = useState(0)

  // Track scroll position. Use a ref mirror so we can read the latest value
  // from the deps-effect without re-subscribing on every render.
  const atBottomRef = useRef(true)
  atBottomRef.current = atBottom

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const now = distance < threshold
      if (now !== atBottomRef.current) {
        atBottomRef.current = now
        setAtBottom(now)
        if (now) setNewSinceScroll(0)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [threshold])

  // On every deps change, decide: snap to bottom or leave alone
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    } else {
      setNewSinceScroll(n => n + 1)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = () => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    setNewSinceScroll(0)
  }

  return { ref, atBottom, newSinceScroll, scrollToBottom }
}
