/**
 * Slash commands: the human side of the same operations the tool exposes.
 *
 * The checkout is always detached (Git owns branch naming, decided at commit
 * time), so this file only exposes management commands.
 *
 * `/wt-status` — show the managed checkout and its live git state.
 * `/wt-clean`  — remove it (refuses uncommitted work unless --force).
 */
import { COMMAND_CLEAN, COMMAND_STATUS } from './constants.js'
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
 * @param {object} runtime auto-worktree runtime.
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
        return {
          kind: 'success',
          text: `${result.removed ? 'removed' : 'kept'} ${result.path}${
            result.branchDeleted ? ' (branch deleted)' : ''
          }`,
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  })
}
