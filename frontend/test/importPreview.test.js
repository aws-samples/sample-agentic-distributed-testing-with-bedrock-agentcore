import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewRows, unsavedBlock, ROWS_SHOWN } from '../src/utils/importPreview.js'

const feature = (adds, skips) => ({
  add: Array.from({ length: adds }, (_, i) => ({ title: `Add ${i + 1}` })),
  skip: Array.from({ length: skips }, (_, i) => ({ title: `Skip ${i + 1}`, reason: 'title already exists' })),
})
const kinds = (rows) => rows.map(r => r.kind)

test('point 1: skipped rows come first, with their reason', () => {
  const { rows } = previewRows(feature(5, 3))
  assert.deepEqual(kinds(rows), ['skip', 'skip', 'skip', 'add', 'add', 'add', 'add', 'add'])
  assert.ok(rows.slice(0, 3).every(r => r.reason === 'title already exists'))
})

test('point 1: more skips than the fold limit are all shown; only to-add rows hide', () => {
  const { rows, hidden } = previewRows(feature(30, 14))
  assert.equal(rows.filter(r => r.kind === 'skip').length, 14)
  assert.equal(rows.length, 14)
  assert.equal(hidden, 30)
})

test('point 1: a long list folds after the limit; showAll shows every row', () => {
  const folded = previewRows(feature(30, 2))
  assert.equal(folded.rows.length, ROWS_SHOWN)
  assert.equal(folded.hidden, 32 - ROWS_SHOWN)
  const all = previewRows(feature(30, 2), true)
  assert.equal(all.rows.length, 32)
  assert.equal(all.hidden, 0)
})

test('point 3: unsaved edits block both Add to suite and Replace suite', () => {
  assert.match(unsavedBlock({ mode: 'add', dirty: true }), /saved suite/)
  assert.match(unsavedBlock({ mode: 'replace', dirty: true }), /throw them away/)
})

test('point 3: nothing blocks when the editor is saved', () => {
  assert.equal(unsavedBlock({ mode: 'add', dirty: false }), null)
  assert.equal(unsavedBlock({ mode: 'replace', dirty: false }), null)
})
