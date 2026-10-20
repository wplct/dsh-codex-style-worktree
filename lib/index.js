/**
 * dsh-codex-worktree — Codex-style local worktree for DSH sessions.
 *
 * The user picks a work location for the workspace (`本地` / `新建本地工作树`,
 * remembered per workspace), sends the first prompt, and the first `agent/created`
 * for that Session creates a detached checkout and switches the Session's
 * working directory into it. Nothing is named up front: the branch is owned by
 * Git at commit time. The Session stays attached to its original Workspace — the
 * plugin never creates a Workspace or a Session.
 *
 * Host half only: routes/commands/projection/settings are mounted lazily so the
 * plugin still loads in compositions that do not provide those services.
 */
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_PLACEMENT,
  MODE_BRANCH,
  MODE_DETACHED,
  PLACEMENT_LOCAL,
  PLACEMENT_WORKTREE,
  PLUGIN_ID,
} from './constants.js'
import { resolveConfig } from './config.js'
import { createLiveConfig } from './live-config.js'
import { createGit } from './git.js'
import { createRuntime } from './session-worktree.js'
import { createStateStore, resolveDshHome, statePathFor } from './state.js'
import { createProjectionPublisher, projectionDefinition } from './projection.js'
import { createSettingsApi } from './settings.js'
import { registerCommands } from './commands.js'
import { registerRoutes } from './routes.js'

export const name = PLUGIN_ID

/** Services the runtime cannot work without (all provided by `dsh-base`). */
export const inject = ['agents', 'subprocess', 'workingDirectory', 'fs']

/**
 * Mark one user-visible field as volatile.
 *
 * Volatile fields are the ones DSH's Settings service may edit: the loader
 * commits a saved value into the running config references and emits
 * `loader/volatile-update`, so the plugin re-reads it without restarting. Fields
 * not marked here (`gitCommand`, `cleanupOnDispose`) stay internal and never
 * appear in any settings form.
 */
const editable = (schema) => schema.volatile()

export const Config = z.object({
  enabled: editable(z.boolean().default(true).description('Create an isolated worktree automatically for new sessions.')),
  defaultPlacement: editable(
    z
      .union([z.const(PLACEMENT_WORKTREE), z.const(PLACEMENT_LOCAL)])
      .default(DEFAULT_PLACEMENT)
      .description('Where a new session runs when its workspace has no remembered choice.'),
  ),
  directory: editable(
    z
      .string()
      .default('.agents/worktrees')
      .description('Pool directory inside the repository; relative, no dot segments.'),
  ),
  root: editable(
    z
      .string()
      .default('')
      .description('Absolute (or repository-relative) root for checkouts; empty keeps them inside the repository.'),
  ),
  fetchBeforeCreate: editable(
    z
      .boolean()
      .default(false)
      .description('Run `git fetch --prune origin` before creating a checkout; failures only warn.'),
  ),
  autoPrune: editable(z.boolean().default(true).description('Delete the oldest clean checkouts beyond autoPruneKeep.')),
  autoPruneKeep: editable(
    z.number().default(15).description('How many checkouts to keep per repository when autoPrune is on.'),
  ),
  pruneGraceMs: editable(
    z.number().default(60000).description('Never prune a checkout younger than this (milliseconds).'),
  ),
  cleanupOnArchive: editable(
    z
      .boolean()
      .default(false)
      .description('Remove a clean checkout after its Session is archived (swept at natural trigger points).'),
  ),
  mode: editable(
    z
      // `z.enum` does not exist in @deepseek-ai/schemastery 3.x (the version DSH
      // ships), so this must be a union of consts: the entry failed to import
      // with "TypeError: z.enum is not a function" and never activated.
      .union([z.const(MODE_DETACHED), z.const(MODE_BRANCH)])
      .default(MODE_DETACHED)
      .description('detached: no branch name until you name it; branch: create a prefixed branch up front.'),
  ),
  namePrefix: editable(z.string().default('wt-').description('Prefix of the generated checkout name.')),
  branchPrefix: editable(z.string().default('wt/').description('Branch prefix used when mode is "branch".')),
  baseRef: editable(z.string().default('HEAD').description('Local revision to start from; nothing is fetched.')),
  poolGitignore: editable(
    z
      .boolean()
      .default(true)
      .description('Write a self-ignoring .gitignore into the pool so the main checkout stays clean.'),
  ),
  gitTimeoutMs: editable(z.number().default(20000).description('Hard timeout for one git command.')),
  skipChildAgents: editable(
    z.boolean().default(true).description('Never create a worktree for subagents or child agents.'),
  ),
  skipSessionIdPatterns: editable(
    z
      .array(z.string())
      .default(['^session-taskboard-'])
      .description('Session ids to leave alone (regular expressions), e.g. sessions the task board already isolates.'),
  ),
  skipPresets: editable(z.array(z.string()).default([]).description('Agent preset ids to leave alone (regular expressions).')),
  disableMarker: editable(
    z
      .string()
      .default('.dsh-codex-worktree-off')
      .description('A file with this name in the repository root disables the plugin for that repository.'),
  ),
  maxPerRepo: editable(z.number().default(32).description('Upper bound of live automatic worktrees per repository.')),
  cleanupOnDispose: z.boolean().default(false).description('Reserved: sessions keep their checkout, like Codex.'),
  noticeOnCreate: editable(
    z
      .boolean()
      .default(false)
      .description('Queue one extra user-context message describing the new checkout (the cwd context already covers it).'),
  ),
})

/**
 * Mount the plugin.
 * @param {object} ctx plugin context.
 * @param {object} rawConfig loader config (already validated by {@link Config}; volatile fields are references).
 */
export function apply(ctx, rawConfig = {}) {
  // One mutable snapshot: saved settings mutate the loader's volatile references
  // in place, and `refresh` copies them back into this object, which every
  // consumer (git helpers, runtime, routes) reads at call time.
  const live = createLiveConfig(rawConfig, resolveConfig)
  const config = live.config
  let sidecarWarned = false
  const store = createStateStore(statePathFor(resolveDshHome()), {
    onError(error) {
      if (sidecarWarned) return
      sidecarWarned = true
      warnOnce(ctx, `cannot persist ${store.file} (${error instanceof Error ? error.message : String(error)}); continuing with in-memory records`)
    },
  })
  const git = createGit(ctx, config)
  const projection = createProjectionPublisher({ ctx })
  const runtime = createRuntime({ ctx, config, store, git, projection })
  const settings = createSettingsApi({ ctx, config })

  // Settings writes land on the volatile references, so re-read them whenever the
  // loader commits a volatile update. A missed event can never leave the runtime
  // more than one session behind: agent/created refreshes too.
  ctx.effect(
    () =>
      ctx.on('loader/volatile-update', () => {
        live.refresh(rawConfig)
      }),
    'dsh-codex-worktree volatile config',
  )

  ctx.on('agent/created', async (payload) => {
    try {
      live.refresh(rawConfig)
      await runtime.ensureForAgent(payload ?? {})
    } catch (error) {
      // A throwing listener would roll back agent creation; this plugin must
      // never be able to keep a session from starting.
      warnOnce(ctx, `unexpected failure: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // Archiving a Session with running work asks providers to stop it after the
  // durable archive write. When `cleanupOnArchive` is on, sweep shortly after:
  // the archived id is already committed, and the sweep itself re-checks that
  // the checkout is clean and unused. Unref'd: never keeps the process alive.
  ctx.on('workspace/session-stop', () => {
    if (config.cleanupOnArchive !== true) return
    const timer = setTimeout(() => {
      void runtime.sweepArchived().catch(() => undefined)
    }, 1000)
    timer.unref?.()
  })

  // The `codexWorktree` session projection: clients read markers/progress from
  // the session-list snapshot instead of polling an endpoint.
  ctx.inject(['sessionProjections'], (sub) => {
    try {
      sub.sessionProjections.register(projectionDefinition)
      projection.attach(sub.sessionProjections)
      sub.effect(() => () => projection.detach(), 'dsh-codex-worktree projection publisher')
    } catch (error) {
      warnOnce(ctx, `cannot register the codexWorktree session projection: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // Expose an auto-generated config form on DSH's own plugin settings page in
  // addition to this plugin's page; both write through the same revisioned
  // Settings service. `auto` only advertises the form — it never changes values.
  ctx.inject(['settings'], (sub) => {
    sub.effect(() => {
      try {
        return sub.settings.configure({ auto: true }, ctx.fiber)
      } catch {
        /* another registration already owns this instance's presentation */
        return () => undefined
      }
    }, 'dsh-codex-worktree settings presentation')
  })

  // Optional surfaces: mounted only when the composition provides them.
  ctx.inject(['commands'], (sub) => registerCommands(sub, runtime))
  ctx.inject(['connection'], (sub) => registerRoutes(sub, { runtime, settings }))

  ctx.logger?.info?.(
    `dsh-codex-worktree: mode=${config.mode} placement=${config.defaultPlacement} pool=${config.directory} state=${store.file}${
      config.enabled ? '' : ' (disabled)'
    }${settings.available ? '' : ' (settings unavailable)'}`,
  )
}

function warnOnce(ctx, message) {
  try {
    ctx.logger?.warn?.(`dsh-codex-worktree: ${message}`)
  } catch {
    /* ignore */
  }
}
