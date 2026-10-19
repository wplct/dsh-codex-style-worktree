import test from 'node:test'
import assert from 'node:assert/strict'
import { earlySkipReason, lateSkipReason, matchesAny, recordsForRepo } from '../lib/session-policy.js'

const base = {
  enabled: true,
  source: 'startup',
  isRootAgent: true,
  skipChildAgents: true,
  sessionId: 'session-abc',
  skipSessionIdPatterns: ['^session-taskboard-'],
  skipPresets: [],
  preset: undefined,
  cwd: '/repo',
  headerCwd: '/repo',
  record: null,
  markerPresent: false,
}

test('early stage continues for a plain new session', () => {
  assert.equal(earlySkipReason(base), null)
})

test('early stage skips on every held fact', () => {
  assert.equal(earlySkipReason({ ...base, enabled: false }), 'disabled')
  assert.equal(earlySkipReason({ ...base, source: 'clear' }), 'source')
  assert.equal(earlySkipReason({ ...base, source: 'compaction' }), 'source')
  assert.equal(earlySkipReason({ ...base, isRootAgent: false }), 'child-agent')
  assert.equal(earlySkipReason({ ...base, skipChildAgents: false, isRootAgent: false }), null)
  assert.equal(earlySkipReason({ ...base, sessionId: 'session-taskboard-1' }), 'session-pattern')
  assert.equal(earlySkipReason({ ...base, preset: 'board' , skipPresets: ['^board$'] }), 'preset')
  assert.equal(earlySkipReason({ ...base, record: { path: '/x' } }), 'recorded')
  assert.equal(earlySkipReason({ ...base, headerCwd: '/repo', cwd: '/repo/.agents/worktrees/wt-1' }), 'already-moved')
  assert.equal(earlySkipReason({ ...base, markerPresent: true }), 'marker')
})

test('late stage skips on repository facts', () => {
  const ok = { repoRoot: '/repo', hasCommit: true, isLinkedWorktree: false, cwdInsidePool: false, recordCount: 0, maxPerRepo: 32 }
  assert.equal(lateSkipReason(ok), null)
  assert.equal(lateSkipReason({ ...ok, repoRoot: null }), 'not-git')
  assert.equal(lateSkipReason({ ...ok, cwdInsidePool: true }), 'pool-context')
  assert.equal(lateSkipReason({ ...ok, isLinkedWorktree: true }), 'linked-worktree')
  assert.equal(lateSkipReason({ ...ok, hasCommit: false }), 'no-commit')
  assert.equal(lateSkipReason({ ...ok, recordCount: 32 }), 'limit')
})

test('invalid user patterns never match and never throw', () => {
  assert.equal(matchesAny(['('], 'anything'), false)
  assert.equal(matchesAny([null, 42, ''], 'anything'), false)
  assert.equal(matchesAny(undefined, 'anything'), false)
})

test('recordsForRepo compares paths without trailing separators', () => {
  const records = [{ repoRoot: '/repo/' }, { repoRoot: '/other' }, { repoRoot: '/repo' }]
  assert.equal(recordsForRepo(records, '/repo').length, 2)
})
