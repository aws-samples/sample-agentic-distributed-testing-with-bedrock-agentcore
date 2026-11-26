import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasSteps, copyTitle, TITLE_MAX } from '../src/utils/caseSteps.js'

test('hasSteps: empty, blank and whitespace-only rows are not steps', () => {
  assert.equal(hasSteps({ given: [], when: [], then: [] }), false)
  assert.equal(hasSteps({ given: [''], when: [''], then: [''] }), false)
  assert.equal(hasSteps({ given: ['  '], when: ['\t'], then: ['\n '] }), false)
  assert.equal(hasSteps({}), false)
  assert.equal(hasSteps(null), false)
  assert.equal(hasSteps({ given: '', when: '   ', then: undefined }), false)
})

test('hasSteps: one real step in any section is enough', () => {
  assert.equal(hasSteps({ given: [''], when: ['click Pay'], then: [] }), true)
  assert.equal(hasSteps({ given: ['a'], when: [], then: [] }), true)
  assert.equal(hasSteps({ given: [], when: [], then: ['  ok  '] }), true)
  assert.equal(hasSteps({ when: 'a single string step' }), true)   // legacy shape: a string, not a list
})

test('copyTitle: first copy, repeats, and a copy of a copy', () => {
  assert.equal(copyTitle('Login', ['Login']), 'Copy of Login')
  assert.equal(copyTitle('Login', ['Login', 'Copy of Login']), 'Copy of Login (2)')
  assert.equal(copyTitle('Login', ['Login', 'Copy of Login', 'Copy of Login (2)']), 'Copy of Login (3)')
  // duplicating a copy names the same original
  assert.equal(copyTitle('Copy of Login', ['Login', 'Copy of Login']), 'Copy of Login (2)')
  assert.equal(copyTitle('Copy of Login (2)', ['Login', 'Copy of Login', 'Copy of Login (2)']), 'Copy of Login (3)')
  assert.equal(copyTitle('Copy of Copy of Login', ['Copy of Copy of Login']), 'Copy of Login')
})

test('copyTitle: a title the user wrote with (N) keeps it', () => {
  assert.equal(copyTitle('Login (2)', ['Login (2)']), 'Copy of Login (2)')
})

test('copyTitle: result never exceeds the title limit', () => {
  const long = 'x'.repeat(TITLE_MAX)
  const first = copyTitle(long, [long])
  assert.equal(first.length, TITLE_MAX)
  const second = copyTitle(first, [long, first])
  assert.equal(second.length, TITLE_MAX)
  assert.notEqual(second, first)
  assert.ok(second.endsWith(' (2)'))
})
