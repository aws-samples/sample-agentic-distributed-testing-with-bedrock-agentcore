import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trapTarget } from '../src/utils/focusTrap.js'

const [a, b, c] = ['a', 'b', 'c']
const items = [a, b, c]

test('Tab on the last item wraps to the first; Shift+Tab on the first wraps to the last', () => {
  assert.equal(trapTarget(items, c, false), a)
  assert.equal(trapTarget(items, a, true), c)
})

test('Tab inside the list is left to the browser', () => {
  assert.equal(trapTarget(items, a, false), null)
  assert.equal(trapTarget(items, b, true), null)
})

test('focus on the dialog box or outside it is pulled to the first (Tab) or last (Shift+Tab) item', () => {
  assert.equal(trapTarget(items, 'box', false), a)
  assert.equal(trapTarget(items, 'box', true), c)
})

test('a dialog with one item keeps focus on it; with none, nothing to move', () => {
  assert.equal(trapTarget([a], a, false), a)
  assert.equal(trapTarget([a], a, true), a)
  assert.equal(trapTarget([], 'box', false), null)
})
