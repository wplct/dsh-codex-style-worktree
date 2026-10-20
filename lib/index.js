/**
 * dsh-codex-worktree — Codex-style default worktree per DSH session.
 *
 * Every new top-level agent that starts inside a Git repository gets an
 * isolated checkout created and entered automatically; no name, branch or
 * button is required from the user. The branch can be named later (at commit
 * time: the plugin never creates a branch, so Git (the commit) owns naming.
 *
 * Host half only: tools/commands/routes are mounted lazily so the plugin still
 * loads in headless compositions that do not provide those services.
 */
import z from '@deepseek-ai/schemastery'
import { MODE_BRANCH, MODE_DETACHED, PLUGIN_ID } from './constants.js'
import { resolveConfig } from './config.js'
import { createGit } from './git.js'
import { createRuntime } from './session-worktree.js'
import { createStateStore, resolveDshHome, statePathFor } from './state.js'
import { registerCommands } from './commands.js'
import { registerRoutes } from './routes.js'

export const name = PLUGIN_ID

/** Services the runtime cannot work without (all provided by `dsh-base`). */
export const inject = ['agents', 'subprocess', 'workingDirectory', 'fs']

export const Config = z.object({
  enabled: z.boolean().default(true).description('Create an isolated worktree automatically for every new session.'),
  directory: z
    .string()
    .default('.agents/worktrees')
    .description('Pool directory inside the repository; relative, no dot segments.'),
  root: z
    .string()
    .default('')
    .description('Absolute (or repository-relative) root for checkouts; empty keeps them inside the repository.'),
  fetchBeforeCreate: z
    .boolean()
    .default(false)
    .description('Run `git fetch --prune origin` before creating a checkout; failures only warn.'),
  autoPrune: z.boolean().default(true).description('Delete the oldest clean checkouts beyond autoPruneKeep.'),
  autoPruneKeep: z.number().default(15).description('How many checkouts to keep per repository when autoPrune is on.'),
  pruneGraceMs: z.number().default(60000).description('Never prune a checkout younger than this (milliseconds).'),
  mode: z
    // `z.enum` does not exist in @deepseek-ai/schemastery 3.x (the version DSH
    // ships), so this must be a union of consts: the entry failed to import
    // with "TypeError: z.enum is not a function" and never activated.
    .union([z.const(MODE_DETACHED), z.const(MODE_BRANCH)])
    .default(MODE_DETACHED)
    .description('detached: no branch name until you name it; branch: create a prefixed branch up front.'),
  namePrefix: z.string().default('wt-').description('Prefix of the generated checkout name.'),
  branchPrefix: z.string().default('wt/').description('Branch prefix used when mode is "branch".'),
  baseRef: z.string().default('HEAD').description('Local revision to start from; nothing is fetched.'),
  poolGitignore: z
    .boolean()
    .default(true)
    .description('Write a self-ignoring .gitignore into the pool so the main checkout stays clean.'),
  gitTimeoutMs: z.number().default(20000).description('Hard timeout for one git command.'),
  skipChildAgents: z.boolean().default(true).description('Never create a worktree for subagents or child agents.'),
  skipSessionIdPatterns: z
    .array(z.string())
    .default(['^session-taskboard-'])
    .description('Session ids to leave alone (regular expressions), e.g. sessions the task board already isolates.'),
  skipPresets: z.array(z.string()).default([]).description('Agent preset ids to leave alone (regular expressions).'),
  disableMarker: z
    .string()
    .default('.dsh-codex-worktree-off')
    .description('A file with this name in the repository root disables the plugin for that repository.'),
  maxPerRepo: z.number().default(32).description('Upper bound of live automatic worktrees per repository.'),
  cleanupOnDispose: z.boolean().default(false).description('Reserved: sessions keep their checkout, like Codex.'),
  noticeOnCreate: z
    .boolean()
    .default(false)
    .description('Queue one extra user-context message describing the new checkout (the cwd context already covers it).'),
})

/**
 * Mount the plugin.
 * @param {object} ctx plugin context.
 * @param {object} rawConfig loader config (already validated by {@link Config}).
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  let sidecarWarned = false
  const store = createStateStore(statePathFor(resolveDshHome()), {
    onError(error) {
      if (sidecarWarned) return
      sidecarWarned = true
      warnOnce(ctx, `cannot persist ${store.file} (${error instanceof Error ? error.message : String(error)}); continuing with in-memory records`)
    },
  })
  const git = createGit(ctx, config)
  const runtime = createRuntime({ ctx, config, store, git })

  ctx.on('agent/created', async (payload) => {
    try {
      await runtime.ensureForAgent(payload ?? {})
    } catch (error) {
      // A throwing listener would roll back agent creation; this plugin must
      // never be able to keep a session from starting.
      warnOnce(ctx, `unexpected failure: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // Optional surfaces: mounted only when the composition provides them.
  ctx.inject(['commands'], (sub) => registerCommands(sub, runtime))
  ctx.inject(['connection'], (sub) => registerRoutes(sub, runtime))

  ctx.logger?.info?.(
    `dsh-codex-worktree: mode=${config.mode} pool=${config.directory} state=${store.file}${
      config.enabled ? '' : ' (disabled)'
    }`,
  )
}

function warnOnce(ctx, message) {
  try {
    ctx.logger?.warn?.(`dsh-codex-worktree: ${message}`)
  } catch {
    /* ignore */
  }
}
