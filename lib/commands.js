/**
 * Slash commands: the human side of the same operations the tool exposes.
 *
 * The checkout is always detached (Git owns branch naming, decided at commit
 * time), so this file only exposes management commands.
 *
 * `/wt-status`    — show the managed checkout and its live git state.
 * `/wt-clean`     — remove it (refuses active use and uncommitted work unless --force).
 * `/wt-snapshots` — list snapshot refs saved before removals.
 * `/wt-restore`   — restore one snapshot ref into a fresh checkout.
 */
import { COMMAND_CLEAN, COMMAND_RESTORE, COMMAND_SNAPSHOTS, COMMAND_STATUS } from './constants.js'
import { errorText } from './util.js'

/** Parse `--flag` tokens out of a raw command tail. */
export function parseFlags(rawInput) {
  const words = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
  const flags = new Set()
  const rest = []
  for (const word of words) {
    if (word.startsWith('--')) flags.add(word.slice(2).toLowerCase())
    else rest.push(word)
  }
  return { flags, rest, text: rest.join(' ') }
}

/**
 * @param {object} ctx context that provides `commands`.
 * @param {object} runtime codex-worktree runtime.
 */
export function registerCommands(ctx, runtime) {
  ctx.commands.register({
    name: COMMAND_STATUS,
    description: 'Show this session\'s automatic worktree.',
    async handler({ agent }) {
      try {
        const status = await runtime.status(agent.session.id, agent.session)
        if (!status.managed) return { kind: 'success', text: 'this session is not in an automatic worktree' }
        const branch = status.branch === null ? 'detached' : status.branch
        const dirty = status.dirty === null ? 'unknown' : `${status.dirty} change(s)`
        return {
          kind: 'success',
          text: [
            `path:   ${status.path}`,
            `repo:   ${status.repoRoot}`,
            `branch: ${branch}`,
            `base:   ${status.baseCommit}`,
            `dirty:  ${dirty}`,
          ].join('\n'),
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })

  ctx.commands.register({
    name: COMMAND_CLEAN,
    description: 'Remove this session\'s automatic worktree (use --force for uncommitted work, --branch to delete its branch).',
    input: { hint: '[--force] [--branch]' },
    async handler({ agent, rawInput }) {
      const { flags } = parseFlags(rawInput)
      try {
        const result = await runtime.clean({
          sessionId: agent.session.id,
          force: flags.has('force'),
          deleteBranch: flags.has('branch'),
          session: agent.session,
        })
        const saved =
          Array.isArray(result.snapshots) && result.snapshots.length > 0
            ? `\nsnapshot: ${result.snapshots.map((row) => row.ref).join(', ')}`
            : ''
        return {
          kind: 'success',
          text: `${result.removed ? 'removed' : 'kept'} ${result.path}${
            result.branchDeleted ? ' (branch deleted)' : ''
          }${saved}`,
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })

  ctx.commands.register({
    name: COMMAND_SNAPSHOTS,
    description: 'List snapshot refs saved before worktrees were removed.',
    async handler({ agent }) {
      try {
        let repoRoot
        try {
          const status = await runtime.status(agent.session.id, agent.session)
          if (status.managed) repoRoot = status.repoRoot
        } catch {
          /* fall back to every repository */
        }
        const snapshots = await runtime.snapshotList(repoRoot === undefined ? {} : { repoRoot })
        if (snapshots.length === 0) return { kind: 'success', text: 'no saved snapshots' }
        return {
          kind: 'success',
          text: snapshots
            .map((row) => {
              const restored = row.restoredAt === undefined ? '' : `  restored ${row.restoredAt}`
              return `${row.ref}\n  commit ${row.commit.slice(0, 8)}  ${row.createdAt}${restored}`
            })
            .join('\n'),
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })

  ctx.commands.register({
    name: COMMAND_RESTORE,
    description: 'Restore one saved snapshot into a fresh checkout (detached, not bound to this session).',
    input: { hint: '<ref>' },
    async handler({ agent, rawInput }) {
      const { text } = parseFlags(rawInput)
      if (text.length === 0) return { kind: 'error', text: 'usage: /wt-restore <ref>' }
      try {
        const result = await runtime.restoreSnapshot({ ref: text, session: agent.session })
        return {
          kind: 'success',
          text: `restored ${result.path} (${result.commit.slice(0, 8)})`,
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })
}
