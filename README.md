# Codex-style Worktree (dsh-codex-worktree)

> "Work in a worktree by default" for DSH sessions: every new session automatically gets an isolated checkout inside the repository, and the session working directory is switched into it. No naming, no mandatory clicking; the plugin never creates a branch (the checkout stays on a detached HEAD) and Git owns branch naming at commit/push time. You can also create a checkout on demand with the *New Worktree* button in the new-session composer.

- Package / plugin id / loader row name: `dsh-codex-worktree` (host half + browser half; the profile-patch row id is `codex-worktree`)
- API namespace: `/api/dsh-codex-worktree`, RPC method prefix `dsh-codex-worktree/`; sidecar: `$DSH_HOME/dsh-codex-worktree/state.json`; disable marker: `.dsh-codex-worktree-off`
- GitHub: <https://github.com/wplct/dsh-codex-worktree>
- Compatibility: DSH `0.2.0-rc.2` / `0.2.1-rc.2` (see `dsh.compatibility` in `package.json`)
- License: MIT

## 1. What it does

When you start a new session (a top-level agent) inside a Git repository, the plugin automatically:

1. creates a checkout named `wt-YYMMDD-HHMMSS` in the repository's `.agents/worktrees/` pool, based on `baseRef` (default `HEAD`);
2. creates it on a **detached HEAD** by default (`mode: detached`, the way Codex-managed worktrees start): the plugin **never creates a branch**; Git decides the branch name at commit/push time;
3. switches that session's working directory (cwd context) into the new checkout, so later reads, writes, `bash` calls and relative paths happen inside it;
4. records the creation in the `$DSH_HOME/dsh-codex-worktree/state.json` sidecar, which powers `/wt-status`, `/wt-clean` and resume.

Zero manual naming:

| Step | Who decides |
| --- | --- |
| Directory name | The plugin ( `namePrefix` + timestamp, with an automatic numeric suffix on collision) |
| Branch name | **The plugin creates no branch**: the checkout stays detached; Git decides the branch name at commit/push time (`git switch -c`, `git branch <name>` after a commit). There is no naming entry point in the plugin |
| Whether to create | The plugin, by the rules in section 2 |

`mode: branch` switches back to "branch first": creation runs `git worktree add -b <branchPrefix><name>` (default `wt/<name>`) up front.

Three entry points:

| Entry point | What it does |
| --- | --- |
| Automatic (default) | Start a new session inside a Git repository → a detached checkout is created and the session cwd is switched into it (the flow in section 1). |
| *New Worktree* button in the new-session composer | Above the composer of a blank session (slot `conversation.input.dock`, shown only when the session is blank and its Workspace is not itself a worktree): creates a detached checkout for the current Workspace and opens a new session in it; for "I want to start now, without waiting for an ordinary session to be provisioned". |
| Session-header chip + settings page | Shows the current session's checkout state, checkouts grouped by repository and known conversations, and offers delete/prune/new-chat actions (section 7). |

## 2. How it works

The trigger is `agent/created`. A failed creation **never** breaks the session: the plugin logs one warning and the session keeps its original directory (degraded mode).

Created when:

- the new session's cwd is inside a Git repository (`git rev-parse --show-toplevel` resolves);
- the repository has at least one commit;
- the cwd is not inside the pool and is not itself a linked worktree;
- the repository currently has fewer than `maxPerRepo` (default 32) plugin-managed worktrees.

Not created (skip reasons):

| Situation | Reason code |
| --- | --- |
| `enabled: false` | `disabled` |
| Agent source is `clear` / `compaction` | `source` |
| Subagent / non-root agent with `skipChildAgents: true` | `child-agent` |
| Session id matches `skipSessionIdPatterns` (default `^session-taskboard-`) | `session-pattern` |
| Session preset matches `skipPresets` | `preset` |
| The sidecar already has a record for the session (resumed session) | `recorded` |
| cwd already differs from the session's original project directory | `already-moved` |
| `disableMarker` (default `.dsh-codex-worktree-off`) exists at the repo root or in the cwd | `marker` |
| Not a Git repository | `not-git` |
| cwd is inside the pool directory | `pool-context` |
| `root` is outside the session workspace and the session is not `danger-full-access` | `root-outside-sandbox` |
| The session sandbox is `read-only` while a non-empty `root` is configured | `read-only-sandbox` |
| cwd is itself a linked worktree (no nesting) | `linked-worktree` |
| The repository has no commit yet | `no-commit` |
| The repository reached `maxPerRepo` | `limit` |
| Repeated name collisions | `name-collision` |
| git error / timeout | `error` |

Other behavior:

- **Root directory and sandbox**: with the default empty `root`, the pool is the in-repository `directory` and therefore inside the session workspace; a non-empty `root` puts checkouts under that absolute root instead. The DSH `workspace-write` file sandbox is bounded by the session's `header.cwd`, so an external root is only used by `danger-full-access` sessions — otherwise creation is skipped with the reason `root-outside-sandbox` (a `read-only` session with a non-empty `root` is skipped as `read-only-sandbox`; see section 5).
- **Fetch before create**: with `fetchBeforeCreate: true`, the plugin runs `git fetch --prune --quiet origin` in the repository before creating the checkout (updating remote-tracking refs and pruning deleted remote branches). A repository without an `origin` remote is skipped with a warning; a fetch failure only logs a warning and never blocks creation, and the command is bounded by `gitTimeoutMs`. The default `false` means no network access.
- **Automatic pruning (background)**: with `autoPrune: true` (the default), every successful creation schedules a background prune (~50 ms later, never blocking the session) that removes that repository's oldest checkouts beyond `autoPruneKeep` (default 15). Pruning is protected by `pruneGraceMs` (default 60000 ms): anything younger is left alone, and **a checkout with uncommitted changes (or unknown dirty state) is never pruned automatically**. A pruned detached commit gets a `refs/dsh-codex-worktree/<name>` snapshot first so it can be recovered. `maxPerRepo` remains a hard ceiling: once reached, new sessions are skipped with `limit` until the background prune (or Prune now in the settings page) frees room; with `autoPrune: false` the plugin only skips and never prunes automatically.
- **Self-ignoring pool**: with `poolGitignore: true`, the plugin writes a `.gitignore` containing `*` into the pool when it creates the pool, so worktree contents never show up in the main checkout's `git status`.
- **git timeout**: every git command is bounded by `gitTimeoutMs` (default 20000 ms); a timeout is treated as a failure and degrades, it never hangs the session.
- **No network by default**: `baseRef` is resolved locally (`<baseRef>^{commit}`); only an explicit `fetchBeforeCreate` triggers a fetch.
- **Creation notice**: with `noticeOnCreate: true`, one extra user-context message describing the new checkout is queued (the cwd context already conveys the location; off by default).
- **No automatic deletion of session checkouts**: `cleanupOnDispose` is still reserved (default `false`); checkouts survive the session and are reclaimed by you, `/wt-clean`, the settings-page delete button, or `autoPrune`.

## 3. Install

Prerequisites:

- DSH installed (compatible with `0.2.0-rc.2` / `0.2.1-rc.2`);
- `git` on PATH;
- **finish or stop any running tasks/sessions first** — DSH is restarted after installing, and running sessions do not migrate their old cwd state.

The recommended way is DSH's own plugin command against GitHub (`--profile` defaults to desktop):

```sh
dsh plugin --profile desktop add github:wplct/dsh-codex-worktree
```

Afterwards, **quit and reopen DSH completely** (desktop app restart, not a page refresh) so the new plugin row takes effect.

### Direct install (optional local/offline path)

The repository also ships a direct-install script that bypasses the package manager, for local development or offline use:

```sh
node install.mjs --dry-run   # print the plan only, write nothing
node install.mjs             # install into the default profile (desktop)
node install.mjs --profile web
DSH_HOME=/path/to/.dsh node install.mjs --profile desktop
```

What the script does:

1. validates the source package (`package.json`, `cordis.patch.yml`, `lib/**`, `client/**` must all be there; a missing half aborts with an absolute path in the error);
2. copies `package.json`, `cordis.patch.yml`, `README*.md`, `lib/**` and `client/**` (recursively) into `<profile>/node_modules/dsh-codex-worktree/` — staged first in a temporary directory on the same volume, never overwriting the live directory in place;
3. runs `node --check` on **every** `.js` file in the staged copy and publishes only if all of them pass; a failure rolls back, so the profile never keeps a half-written package;
4. backs up `<profile>/cordis.patch.yml` to `.bak-<ISO timestamp>` and appends the marked patch block (the package's `cordis.patch.yml` minus `#` comment lines; that file currently holds only the config-less `insert` row, defaults come from `lib/config.js`). If the file already contains `# >>> dsh-codex-worktree >>>`, the append is skipped;
5. prints target path, file count, backup paths and next steps.

The direct installer explicitly does **not**:

- modify the profile's `package.json`;
- run `pnpm` / `npm` or install any dependency;
- restart or hot-reload DSH (you restart it manually).

## 4. Uninstall and rollback

Uninstall with the symmetric DSH plugin command, then restart DSH:

```sh
dsh plugin --profile desktop remove dsh-codex-worktree
```

If the package was installed with the **direct-install** script from section 3, use the bundled `uninstall.mjs` instead:

```sh
node uninstall.mjs --dry-run   # print the plan only
node uninstall.mjs             # default profile
node uninstall.mjs --profile web
```

`uninstall.mjs` does:

1. removes the `# >>> dsh-codex-worktree >>>` … `# <<< dsh-codex-worktree <<<` block (markers and everything between them) from `<profile>/cordis.patch.yml`, **preserving every other line** (other plugins' entries are untouched); the file is backed up to `.bak-<ISO timestamp>` first;
2. removes `<profile>/node_modules/dsh-codex-worktree/` recursively;
3. prints every action and backup path; `--dry-run` writes nothing.

It is idempotent: a second run just reports "no marker / not installed". It also reports (without deleting) two kinds of leftovers: `.dsh-codex-worktree.previous-<timestamp>` snapshots created by installs, and the `$DSH_HOME/dsh-codex-worktree/` sidecar (the ledger of created worktrees; delete it manually once the worktrees are gone).

Three rollback paths:

| Goal | Action |
| --- | --- |
| Full uninstall | `dsh plugin --profile desktop remove dsh-codex-worktree` (direct install: `node uninstall.mjs`), then restart DSH |
| Revert the profile patch only | `cp <profile>/cordis.patch.yml.bak-<timestamp> <profile>/cordis.patch.yml`, delete `node_modules/dsh-codex-worktree/` manually, restart |
| Roll back to the previous package | rename the printed `.dsh-codex-worktree.previous-<timestamp>` directory back to `node_modules/dsh-codex-worktree`, restart |

Uninstall never deletes your worktrees or branches: check `/wt-status`, clean up with `/wt-clean`, or run `git worktree remove <path>` / `git branch -d <branch>` yourself.

## 5. Configuration

Configuration defaults live in [`lib/config.js`](./lib/config.js) (the schemastery schema in `lib/index.js` mirrors them). The package's [`cordis.patch.yml`](./cordis.patch.yml) only registers a config-less `insert` row (`id: codex-worktree`, `name: dsh-codex-worktree`) so dshmarket can hot-mount it; the direct installer appends that row (comments stripped) to the profile patch. To change behavior, add an `- id: codex-worktree` override to the profile patch (see below).

Package `cordis.patch.yml` (defaults are not here — they live in `lib/config.js`):

```yaml
- insert:
    - id: codex-worktree
      name: dsh-codex-worktree
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. With `false` the plugin behaves as if uninstalled (it never touches git). |
| `root` | `''` | Worktree root directory. The empty string (default) uses the in-repository `directory`; a non-empty value must be an absolute path and moves checkouts under that root (see the safety boundary below). |
| `directory` | `.agents/worktrees` | Worktree pool directory (relative to the repository root when `root` is empty); no absolute paths, no `.`/`..` segments. Keeping it inside the repository is what puts it inside the DSH workspace file sandbox. |
| `fetchBeforeCreate` | `false` | Run `git fetch --prune --quiet origin` in the repository before creating the checkout (updates remote-tracking refs and prunes deleted remote branches). A repository without an `origin` remote is skipped with a warning; a failure only logs a warning and never blocks creation; bounded by `gitTimeoutMs`. The default `false` means no network access. |
| `autoPrune` | `true` | After every successful creation, prune that repository's oldest plugin-managed checkouts beyond `autoPruneKeep` in the background (never blocking the session), keeping the newest `autoPruneKeep`. Protected by `pruneGraceMs`; **checkouts with uncommitted changes (or unknown dirty state) are never pruned automatically**. `maxPerRepo` remains a hard ceiling, so a new session at the ceiling is skipped with `limit`. |
| `autoPruneKeep` | `15` | Number of newest checkouts to keep per repository after automatic pruning (non-negative integer). The default 15 < `maxPerRepo` 32, so the first overflow frees room in one pass. |
| `pruneGraceMs` | `60000` | Cooldown for automatic pruning (non-negative integer, milliseconds): a checkout younger than this (by creation time) is never pruned automatically, so a fresh checkout cannot be reclaimed immediately. |
| `mode` | `detached` | `detached`: detached HEAD, the plugin creates no branch; `branch`: create `<branchPrefix><name>` up front. |
| `namePrefix` | `wt-` | Prefix of the generated checkout directory name (no `/`, no `\`, must not start with `-`). |
| `branchPrefix` | `wt/` | Branch prefix used with `mode: branch` (must not start with `-` or `/`). |
| `baseRef` | `HEAD` | Local starting revision for new checkouts (resolved locally; whether the network is used depends on `fetchBeforeCreate`). |
| `poolGitignore` | `true` | Write a `.gitignore` containing `*` when the pool is first created, keeping the main checkout's `git status` clean. |
| `gitTimeoutMs` | `20000` | Hard timeout per git command (positive integer, milliseconds); a timeout degrades like any other failure. |
| `skipChildAgents` | `true` | Subagents/child sessions never get a worktree, so one task cannot explode into several checkouts. |
| `skipSessionIdPatterns` | `["^session-taskboard-"]` | Session-id regular expressions to leave alone (taskboard sessions are skipped by default because the task board has its own worktree isolation). |
| `skipPresets` | `[]` | Additional agent preset ids (regular expressions) to leave alone. |
| `disableMarker` | `.dsh-codex-worktree-off` | A file with this name at the repository root or in the session cwd disables creation for that repository/session (quick temporary opt-out). |
| `maxPerRepo` | `32` | Upper bound of plugin-managed checkouts per repository; once reached, `autoPrune` decides what happens (`/wt-clean` and the settings-page delete button also reclaim). |
| `cleanupOnDispose` | `false` | **Still reserved**: whether to delete the checkout when the session ends/is disposed. Off by default, checkouts are kept (same as Codex). |
| `noticeOnCreate` | `false` | Whether to queue one extra user-context message describing the new checkout (the cwd context is usually enough). |

### `root` semantics and the safety boundary

The DSH `workspace-write` file sandbox is bounded by **the session's `header.cwd` (the session workspace root)**, not by the whole disk.

- `root: ''` (default): the pool is `<repo>/<directory>`, so checkouts always live inside the repository — that is, inside the session workspace → `workspace-write` can read and write them. This is the safest and recommended setup.
- `root: /some/absolute/path`: checkouts are created under that absolute root. If it lies **outside the session workspace**, writes from a `workspace-write` session would be rejected by the sandbox, so the plugin **skips creation** and records the reason `root-outside-sandbox` (better to stay in the original directory than to build a checkout it cannot write to). Only `danger-full-access` sessions create checkouts under an external root; a `read-only` session with a non-empty `root` is skipped as `read-only-sandbox`.
- Automatic pruning/deletion is subject to the same sandbox constraints: cleaning an external root requires the session to have the matching permissions; otherwise it fails loudly instead of force-deleting.

Two ways to change configuration:

1. **Edit the profile patch (recommended, package untouched)**: add an id-targeted override to `<profile>/cordis.patch.yml`. Profile patches apply after every bundle layer, so they win:

   ```yaml
   - id: codex-worktree
     config:
       mode: branch
       namePrefix: 'dev-'
   ```

   Note that an `- id:` `config` **replaces the whole config object** instead of merging field by field: fields you omit fall back to the schema defaults (the defaults in the table above), so restate every customization you want to keep.

2. **Edit the defaults in `lib/config.js` (development/release defaults)**: for shipping different defaults. Reinstall (`dsh plugin` or `node install.mjs`) and restart DSH afterwards. Note that `cordis.patch.yml` carries no config, so editing it does not change the defaults.

## 6. Usage

### Automatic path (default)

Open a new session in a Git repository → do nothing; the session is already working inside `.agents/worktrees/wt-YYMMDD-HHMMSS`. The cwd is switched before your first message.

### New Worktree button

The **New Worktree** button above the composer creates a detached checkout for the current blank session's Workspace and immediately opens a new session in it (session cwd = that checkout). It is the GUI entry point for the RPC `create` endpoint (section 7), shown only when the session is blank and its Workspace is not itself a worktree, for "I want to start right away instead of waiting for an ordinary session to be provisioned". Failures are reported inline next to the button (not a Git repository, no commit, plugin disabled, `maxPerRepo` reached, `root` not writable, …).

### Slash commands

| Command | Purpose |
| --- | --- |
| `/wt-status` | Show this session's automatic checkout: `path`, `repo`, `branch` (`detached` when unnamed), `base` (base commit), `dirty` (change count). |
| `/wt-clean [--force] [--branch]` | Remove this session's automatic checkout. It refuses when there is uncommitted work unless `--force` is given; `--branch` also deletes the branch (meaningful with `mode: branch`). |

Typical flow (Git owns naming):

```text
new session (automatic wt-251019-190932, detached)
  … edit files, run tests …
  git switch -c fix/cart-order   # create a branch with plain git when you want one
  git commit / git push          # commit as usual
/wt-clean --branch               # reclaim checkout and branch when done
```

## 7. GUI settings page and RPC endpoints

### Settings page (Codex style)

There is also a **chip in the session header**: it shows the current session's checkout state (managed / not managed, dirty count); clicking it opens path, repository, mode, base commit, changed files and creation time, with an inline cleanup action. The settings page provides the global view:

The plugin registers a **Codex-style Worktree** section in the Web GUI settings (`settings.section`):

- **Configuration (read-only)**: shows the effective `root` (when empty it renders "inside the repository: `<directory>`"), `fetchBeforeCreate`, and `autoPrune` (together with "keep N" — `autoPruneKeep`); changing them goes through the profile patch in section 5 — the settings page never writes configuration (`pruneGraceMs` is not displayed; change it through the profile patch as well).
- **Prune now**: runs one prune over every known repository using the same rules as `autoPrune` (including the `pruneGraceMs` cooldown and dirty-checkout skipping) and reports "pruned N worktrees and M snapshots" for that run.
- **Worktrees grouped by repository**: one collapsible block per repository, each row showing **path / mode / dirty / created**; row actions:
  - **New chat here**: registers/reuses a Workspace for that checkout and starts a new session in it (no manual Workspace picking);
  - **Open conversation**: jumps to an existing session occupying that checkout;
  - **Delete**: removes that checkout (uncommitted work requires confirmation or force delete).
- **Known conversations**: under every worktree, the sessions occupying it are listed, so it is obvious which checkouts are still in use and which can be reclaimed.

### RPC endpoints

The browser half calls these authenticated `/api` routes (`POST ${API_PREFIX}/<endpoint>`, JSON body):

| Endpoint | Request | Response |
| --- | --- | --- |
| `status` | `{ sessionId }` | The session's checkout state (path / repo / branch / base / dirty) |
| `clean` | `{ sessionId, force?, deleteBranch? }` | Cleanup result |
| `list` | `{ workspacePath? }` | `{ repos: [...], config: { ... } }` — checkouts grouped by repository plus the read-only config snapshot the settings page displays (`root`, `directory`, `mode`, `fetchBeforeCreate`, `autoPrune`, `autoPruneKeep`) |
| `prune` | `{ repoRoot? }` | `{ removed, snapshots }` — the entries that were removed and the new `refs/dsh-codex-worktree/<name>` snapshots; without `repoRoot` it runs over every known repository |
| `create` | `{ path }` (composer/session repository path) | The created checkout record (`path`, `repoRoot`, `mode`, `branch`, `baseCommit`, `createdAt`, …; `pending` means no session owns it yet) — used by the *New Worktree* button |

## 8. Verification checklist (12 acceptance criteria)

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Automatic creation | Open a new session in a Git repository and touch nothing: `.agents/worktrees/wt-<timestamp>` appears in the repo and shows up in `git worktree list`. |
| 2 | Zero input | No worktree name, branch name or button click is ever required. |
| 3 | cwd context | The session working directory is switched into the checkout: the cwd/relative paths the model sees resolve under `.agents/worktrees/wt-…` (matching the `path` from `/wt-status`). |
| 4 | Second session is independent | Opening another session in the same repository yields a **different** `wt-…` directory; the two sessions do not interfere and the pool count stacks up (bounded by `maxPerRepo`). |
| 5 | Pure detached, no plugin-created branch | With the default `mode: detached`, `/wt-status` reports `branch: detached` and `git symbolic-ref -q HEAD` fails inside the checkout; `git branch` shows no branch created by the plugin. Create one with plain `git switch -c` when needed. |
| 6 | Nothing gets created when it shouldn't | Non-Git directories, repositories without a commit, subagents under `skipChildAgents: true`, sessions whose id matches `^session-taskboard-`, and a plugin with `enabled: false` all produce no new directory (confirm with `/wt-status`: "not in an automatic worktree"). |
| 7 | Fault-injection degradation | Make git fail or time out (set `gitTimeoutMs` very low, or remove git from `PATH`): the session still starts in its original directory, one `automatic worktree … failed` warning is logged, and there is no unhandled exception. |
| 8 | Resume is stable | Resuming an existing session does not create a second worktree (the sidecar already has its record) and its cwd still points at the original checkout. |
| 9 | Clean uninstall | After `dsh plugin --profile desktop remove dsh-codex-worktree` (direct install: `node uninstall.mjs`): the marker block is gone from the profile patch with all other lines intact, `node_modules/dsh-codex-worktree/` no longer exists, a restarted DSH no longer loads the plugin, and no other plugin's configuration was changed. |
| 10 | `fetchBeforeCreate` works and a failure never blocks | With it enabled, `git fetch --prune --quiet origin` runs before creation (visible in remote-tracking ref changes or git invocation logs); point the remote at an unreachable address or go offline and open a new session: creation still succeeds with only a fetch-failure warning; a repository without an `origin` remote warns once and still creates. |
| 11 | `autoPrune` prunes only the oldest, never dirty checkouts, and snapshots detached commits | Set `maxPerRepo` low (e.g. 2) with `autoPruneKeep: 1` and `pruneGraceMs: 0`, then open several sessions: after every successful creation a background prune removes that repository's oldest **clean** checkouts while dirty ones survive; the removed detached commits appear in `git for-each-ref refs/dsh-codex-worktree` and can be recovered with `git branch <name> dsh-codex-worktree/<name>`; when pruning cannot free room fast enough the new session is skipped with `limit`, and Prune now in the settings page reclaims immediately. |
| 12 | External `root` + `workspace-write` is skipped with a reason | With `root` pointing outside the session workspace in a `workspace-write` session: no checkout is created and the reason code is `root-outside-sandbox` (visible in the log/status); a `read-only` session with a non-empty `root` reports `read-only-sandbox`; only after switching to `danger-full-access` is a checkout created under the external root. |

## 9. Limitations and risks

- **Creates only, never merges**: the plugin never commits, merges, pushes, rebases, or deletes your branches. Merging/pushing is up to you (or the model using ordinary git commands). On the default detached HEAD, uncommitted work has no branch protection — deleting the checkout loses it, which is why `cleanupOnDispose` defaults to `false` and checkouts survive the session.
- **Detached deletion risk**: `git worktree remove --force`, `rm -rf` on the checkout, or `git clean -fdx` (which walks into the pool) can destroy uncommitted work. Keep tasks short and commit early; when unsure, commit inside the checkout first so Git keeps a reference to the work.
- **Not a sandbox**: a worktree is a collaboration convention plus a separate working directory, not a security boundary. Same OS user, same filesystem, same repository object store, and the plugin does not stop you from using absolute paths elsewhere. The DSH file sandbox is bounded by the session's `header.cwd`: with the default empty `root` the pool lives inside the repository, so `workspace-write` can use it; pointing `root` outside the workspace requires a `danger-full-access` session, otherwise the plugin skips creation outright (`root-outside-sandbox`).
- **The pool lives inside the main checkout**: even with `poolGitignore`, repository-wide operations see it (IDE indexing, `git status --ignored`, `find`, bundlers). Never run a destructive `git clean -fdx` at the repository root.
- **Relationship with the task board**: `dsh-taskboard` has its own per-task worktree isolation (dedicated branches, merge evidence). The default `skipSessionIdPatterns: ["^session-taskboard-"]` keeps the two from stacking; if you remove that pattern, one taskboard task can get two checkouts and you own the conflicts and cleanup cost.
- **The base goes stale**: `baseRef` is resolved once at creation time (no fetch by default; enabling `fetchBeforeCreate` only updates remote-tracking refs, it never updates or rebases existing checkouts). Branch switches or rebases in the main checkout do not propagate to existing worktrees; be careful about the target branch when committing from an old detached checkout.
- **Ceiling, automatic pruning and reclamation**: `maxPerRepo` (default 32) is a hard ceiling — new sessions are skipped with `limit` once it is reached; with `autoPrune: true` (the default) every successful creation also prunes the oldest **clean** checkouts in the background, keeping the newest `autoPruneKeep` (default 15), while dirty checkouts and anything younger than `pruneGraceMs` (default 60000 ms) are left alone. A pruned detached commit is kept as a `refs/dsh-codex-worktree/<name>` snapshot and can be recovered with `git branch <name> dsh-codex-worktree/<name>` — but **uncommitted changes cannot be recovered**. Set `autoPrune: false` to disable automatic pruning entirely and reclaim via `/wt-clean`, the settings page's Prune now/Delete actions, or manual `git worktree remove`; the sidecar ledger is not removed by the uninstaller.

## 10. Troubleshooting

| Symptom | Action |
| --- | --- |
| Startup error `Cannot find package 'dsh-codex-worktree'` | Re-run `dsh plugin --profile desktop add github:wplct/dsh-codex-worktree` (direct install: `node install.mjs`), confirm `<profile>/node_modules/dsh-codex-worktree/lib/index.js` exists, restart DSH. |
| A new session did not get a worktree | Check in order: `enabled: true`; cwd inside a Git repository with a commit; no `.dsh-codex-worktree-off` at the repo root; not a subagent; session id does not match `skipSessionIdPatterns`; repository below `maxPerRepo`; look for the reason code in the log (section 2 table). |
| The *New Worktree* button fails | The inline error code names the cause: `not-git-repository` (not a Git repository), `no-commit` (repository has no commit yet), `disabled` (plugin off, or `.dsh-codex-worktree-off` at the repo root), `limit-reached` (`maxPerRepo` reached — prune or raise it), `root-unreachable` (`root` not writable or the sandbox refuses it). |
| `/wt-status` says `not in an automatic worktree` | The session is unmanaged (skipped, plugin disabled, or not git). Work through the reason codes in section 2. |
| Log shows `automatic worktree … failed` | A git error or timeout: check that `git` is on PATH and the repository is healthy; raise `gitTimeoutMs` if needed. The session itself is unaffected. |
| Expected detached, but a `wt/...` branch appeared | `mode` is `branch`: set it back to `detached` (a profile-patch override wins). |
| The pool contents show up in `git status` | The pool existed before it was version-controlled, or its `.gitignore` is missing: confirm `poolGitignore: true`, or place a `.gitignore` containing `*` in the pool manually. |
| Install fails with a `node --check` error | The source package (`lib/**`, `client/**`) has a syntax error; the install already rolled back and the profile is untouched. Fix the package and reinstall. |
| Install reports `missing source directory: …/client` | The source package is missing one half (host/client not complete). Add `client/` and reinstall. |
| A new session got no worktree, reason `root-outside-sandbox` / `read-only-sandbox` | `root` lies outside the session workspace, or the session sandbox is `read-only`: go back to the default empty `root` (pool inside the repository) or use a `danger-full-access` / writable session. |
| Expected a fetch before creation but nothing touched the network | `fetchBeforeCreate` defaults to `false`, enable it explicitly; the fetch targets `origin` only (a repository without that remote is skipped with a warning), and failures only warn — they never block. |
| Old checkouts disappeared | `autoPrune: true` and `maxPerRepo` reached: only clean checkouts beyond the newest `autoPruneKeep` and past the `pruneGraceMs` cooldown are removed. Detached commits live in `refs/dsh-codex-worktree/<name>` and can be recovered with `git branch <name> dsh-codex-worktree/<name>`; disable `autoPrune` or raise `autoPruneKeep` to stop automatic pruning. |
| The ceiling was reached but nothing was pruned | Background pruning runs after each successful creation, so rapid creation can outrun it and the new session is skipped with `limit`: use Prune now in the settings page or raise `maxPerRepo`. If everything beyond `autoPruneKeep` is dirty or still inside the `pruneGraceMs` cooldown, the plugin never force-deletes. |
| The plugin still loads after uninstalling | Restart DSH; then confirm the profile patch has no marker block and the directory is gone. |

## 11. Layout

```text
dsh-codex-worktree/
├── install.mjs          # direct install: copy into the profile + append the marked block (--dry-run / --profile)
├── uninstall.mjs        # direct uninstall: drop the marked block + remove the directory (idempotent, --dry-run)
├── package.json         # package name dsh-codex-worktree; exports "." (host) / "./client" (web); dsh.bundle.patch
├── cordis.patch.yml     # config-less insert row for id codex-worktree; config defaults live in lib/config.js
├── lib/                 # host half: config defaults/schema, agent/created hook, git wrapper, pool rules, automatic pruning (prune/snapshots), sidecar, commands/routes (incl. create)
├── client/              # browser half: session-header chip, settings page (read-only config + Prune now + worktrees grouped by repo/known conversations), New Worktree composer button, GUI presentation and localization for /wt-*
│   └── README.md        # client-half implementation notes
├── scripts/             # smoke tests: smoke-host.mjs (host mount/RPC), smoke-client.mjs (browser artifact)
├── README.zh.md         # Chinese primary README
├── README.md            # this English counterpart
└── LICENSE              # MIT
```

With `dsh plugin` the runtime resolves dependencies the same way as for any other profile plugin; the same holds after a direct `install.mjs` into `<profile>/node_modules/dsh-codex-worktree/` (no extra node_modules installation).
