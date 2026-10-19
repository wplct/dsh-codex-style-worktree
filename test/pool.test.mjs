import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateName, generateName, isInsidePool, normalizePoolDirectory, poolPathFor, destinationFor, POOL_GITIGNORE } from '../lib/pool.js'

test('normalizePoolDirectory accepts a plain relative directory', () => {
  assert.deepEqual(normalizePoolDirectory('.agents/worktrees'), { ok: true, value: '.agents/worktrees' })
  assert.deepEqual(normalizePoolDirectory('sub/x'), { ok: true, value: 'sub/x' })
})

test('normalizePoolDirectory rejects absolute and dot-segment paths', () => {
  for (const value of ['/abs/path', 'C:\\abs', '', '   ', '..', '../x', 'a/../b', './a']) {
    assert.equal(normalizePoolDirectory(value).ok, false, `expected rejection for ${JSON.stringify(value)}`)
  }
})

test('generateName is deterministic, sortable and prefix-bound', () => {
  const date = new Date(2026, 9, 19, 19, 5, 7)
  assert.equal(generateName('wt-', date), 'wt-261019-190507')
  assert.match(generateName('worktree-'), /^worktree-\d{6}-\d{6}$/)
})

test('candidateName keeps attempt 0 and suffixes later attempts', () => {
  assert.equal(candidateName('wt-261019-190507', 0), 'wt-261019-190507')
  assert.equal(candidateName('wt-261019-190507', 1), 'wt-261019-190507-2')
  assert.equal(candidateName('wt-261019-190507', 4), 'wt-261019-190507-5')
})

test('pool helpers join under the repository root', () => {
  const pool = poolPathFor('/repo', '.agents/worktrees')
  assert.equal(pool, '/repo/.agents/worktrees')
  assert.equal(destinationFor(pool, 'wt-1'), '/repo/.agents/worktrees/wt-1')
})

test('isInsidePool is lexical and separator-aware', () => {
  assert.equal(isInsidePool('/repo/.agents/worktrees', '/repo/.agents/worktrees/wt-1'), true)
  assert.equal(isInsidePool('/repo/.agents/worktrees', '/repo/.agents/worktrees'), true)
  assert.equal(isInsidePool('/repo/.agents/worktrees/', '/repo/.agents/worktrees/wt-1'), true)
  assert.equal(isInsidePool('/repo/.agents/worktrees', '/repo/.agents/worktrees2/wt-1'), false)
  assert.equal(isInsidePool('/repo/.agents/worktrees', '/repo'), false)
})

test('the pool ignore file ignores everything inside it', () => {
  assert.equal(POOL_GITIGNORE, '*\n')
})
