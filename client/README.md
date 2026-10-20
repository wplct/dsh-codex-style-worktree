# dsh-codex-worktree — client half (`client/client.js`)

Browser artifact for the DSH Web GUI. Plain CommonJS-shaped source, no build step, no
JSX; `require('react')` is the only module it loads.

## How it loads

DSH evaluates the browser artifact as a lazy factory whose **id equals the package
name**:

```js
window.__ModuleLoader__.load({
  id: 'dsh-codex-worktree',
  factory: function (require) { /* ... */ return plugin },
})
```

`cordis.patch.yml` inserts the row `{ id: codex-worktree, name: dsh-codex-worktree }`, so
the loader id is `dsh-codex-worktree`. The factory is side-effect free; every resource
(stylesheet, locale dictionaries, slot entries) is installed from `apply(ctx)` through
`ctx.effect(...)`.

## Plugin object

```js
{
  name: 'dsh-codex-worktree',
  inject: ['slots', 'connection', 'locale', 'workspaces', 'sessions'],
  apply(ctx),
}
```

- `workspaces` resolves the hero row's `WorkspaceChip.selectedId` to a path (the placement
  selector needs it);
- `sessions` exposes the `sessions.list` snapshot used to read `projectionValues`
  (progress card, sidebar marker, chip base state).

`apply` installs (registration order is an implementation detail; each entry is one `ctx.effect`-managed registration):

1. one scoped `<style data-dsh-codex-worktree-style>` element (`ctx.effect`, disposed with
   the fiber);
2. the locale dictionaries (`ctx.locale.register(LOCALE_NS, { zh, en })` + `bind`, with a
   local dictionary fallback when the service is missing);
3. the shared Session-projection store (`installProjectionStore`, fed only by the sessions-list event);
4. the placement selector on `conversation.hero.options`
   (`id: dsh-codex-worktree-placement`, `order: 10`) — the official compact-options seat of
   the New Session row, right-aligned after the workspace and preset controls;
5. the progress card on `conversation.input.dock`
   (`id: dsh-codex-worktree-progress`, `order: 30`);
6. the read-only sidebar marker on `sidebar.session.row.leading`
   (`id: dsh-codex-worktree-marker`, `order: 20`);
7. the session header chip on `conversation.session.header.utilities`
   (`id: dsh-codex-worktree-chip`, `order: -20`, `locale: dsh-codex-worktree`);
8. the management page on `settings.section`
   (`id: dsh-codex-worktree`, `order: 40`, `locale: dsh-codex-worktree`).

> `sidebar.session.row.hover` is deliberately **not** registered: the marker is read-only.

## Slots and their contracts

| Slot | id | Renders when | Props used |
| --- | --- | --- | --- |
| `conversation.hero.options` | `dsh-codex-worktree-placement` | blank new session whose workspace is a Git repository (session-scoped seat: rendered only once the Session exists) | selected workspace (resolved through `workspaces`), `t`, `inject()` → `{ api, ctx }` |
| `conversation.input.dock` | `dsh-codex-worktree-progress` | the current session's projection has `phase === 'creating'` | `sessionId`, `t`, `inject()` → `{ api, ctx }` |
| `sidebar.session.row.leading` | `dsh-codex-worktree-marker` | the row's session projection has `phase === 'ready'` | `sessionId` (the row's title is not needed) |
| `settings.section` | `dsh-codex-worktree` | always | `close`, `t`, `inject()` → `{ api, ctx }` |
| `conversation.session.header.utilities` | `dsh-codex-worktree-chip` | always | `sessionId`, `t`, `inject()` → `{ api, ctx }` |

The client resolves cross-cutting services defensively (`ctx.get(name)` plus the property
fallback), so a composition that does not expose `workspaces` / `sessions` degrades to a
hidden or read-only control instead of throwing.

## Zero-polling state model

All UI state is derived from DSH's native **session projection** `codexWorktree` and from
plain `sessions.list` snapshots. There is **no `setInterval`, no timer-driven refresh and
no polling RPC** anywhere in this artifact.

```js
// what every surface reads
const value = sessions.list.getSnapshot()
  .byId[sessionId]?.projectionValues?.codexWorktree
const unsubscribe = sessions.list.subscribe(() => { /* re-render from the new snapshot */ })
```

`useSyncExternalStore(subscribe, getSnapshot)` wraps that access as `useCodexWorktree(sessionId)`;
the progress card, sidebar marker and header chip all share it.

Projection shape (`null` when the session is unmanaged):

```ts
{
  phase: 'creating' | 'ready' | 'error',
  step?: 'prepare' | 'checkout' | 'finalize',   // during 'creating'
  path?: string,
  repoRoot?: string,
  workspaceRoot?: string,
  mode?: string,
  branch?: string | null,
  baseCommit?: string,
  error?: string,
  updatedAt: string,
}
```

The host appends `codex-worktree/state` with the **complete post-change state**, so the
client never reconstructs state from deltas. Host-side cleanup of a live session appends
`null`, so the marker disappears immediately; a non-live session's stale marker is cleared
by the host's next `agent/created` consistency repair (see the known limitation below).

## Placement selector (`conversation.hero.options`)

Seat choice: the pill is registered in the official **`conversation.hero.options`** list seat
(compact options, right-aligned in the New Session row after the workspace and preset
controls; session-scoped, so it appears once the blank Session exists). The plugin
deliberately never registers `conversation.hero.workspace` — that seat is `kind: "single"`,
owned by the shipped WorkspacePicker, with `replaceRisk: "shadows-shipped-ui"` — so the
shipped workspace switcher is never shadowed.

- Data source: module-level `Map<workspacePath, 'worktree' | 'local'>` plus subscribers.
  Reads go through the `placement` RPC: `{ workspacePath }` → `{ workspacePath, mode,
  defaultMode, isGit }`; writes are `{ workspacePath, mode }`.
- Visible only on a blank new session and only when `isGit === true`; hidden for existing
  sessions and non-Git workspaces.
- Options: `本地` / `Local` and `新建本地工作树` / `New local worktree` (default), with the
  grey hint that a new local worktree does **not** add a Workspace.
- Writes are optimistic: the pill updates immediately, and a failed `placement` call
  reverts it and shows a message. A failed read degrades to a read-only display of
  `defaultMode` and never blocks sending.

## Progress card (`conversation.input.dock`)

- Shown while `useCodexWorktree(sessionId)` returns `{ phase: 'creating', step }`, mapping
  `prepare` / `checkout` / `finalize` to the three rows `Prepare workspace` / `Check out
  files` / `Set up environment`.
- The card is held for at least **1000 ms** even though creation usually finishes faster;
  on `ready` the steps are ticked and a done label fades out after ~400 ms.
- `Cancel` only hides the card locally (`setHidden(true)`); creation keeps running. There
  is no rollback and no "don't use a worktree" action.
- `phase === 'error'` renders the host message; the session continues in its original
  directory.

## Sidebar marker (`sidebar.session.row.leading`)

- Renders a 14 px worktree SVG (`currentColor`, muted) when the session projection is
  `phase === 'ready'`; the `title`/`aria-label` is the `marker.tooltip` locale template,
  i.e. `Codex 风格 Worktree · <checkout path>`.
- Seat choice: `sidebar.session.row.leading` is the official ambient-marker seat (a
  persistent leading icon area); the row's action strip is a hover-only button strip and is
  not used. The seat is unrelated to the shipped workspace picker and never shadows
  shipped UI.
- Not clickable: no handler, no hover card, no navigation — clicks fall through to the
  session row. There is no `sidebar.session.row.hover` registration.

## Session header chip (`conversation.session.header.utilities`)

- Base state comes from the projection (managed / not managed / error).
- Opening the popover makes **one** `status` RPC (`{ sessionId }`) to refresh live details
  (dirty count etc.); it is not a polling loop.
- Popover: path, repository, base commit, mode, dirty count, plus a cleanup action
  (`clean` with `force: false`). A `worktree-dirty` error offers the force retry; a
  `worktree-in-use` refusal renders `error.worktreeInUse` ("the working directory of an
  active session; force cleanup will leave that session without a working directory") plus
  an `error.forceCleanupAction` button that retries with `force: true`. Cleaning the
  current session's **own** checkout is not refused: the host moves its cwd back to the
  workspace (`movedTo`) before deleting.
- No naming and no "don't use a worktree" action — branch naming belongs to Git at commit
  time.

## Settings page (`settings.section`)

Two blocks:

1. **Configuration form** (`settings` RPC):
   - `get` → `{ ns, revision, writable, values, defaults, fields }`, where `fields` carry
     key, type, control hints and constraints, `values` the current values and
     `defaults` the schema defaults;
   - `set` → `{ action: 'set', patch, revision }`; a stale revision yields
     `error.code === 'conflict'`, after which the client refreshes the form and shows
     "configuration changed elsewhere";
   - `reset` ("Restore defaults") writes the 21 user-visible defaults back (including `cleanupOnArchive`, which defaults to `false`);
   - `invalid-config` errors keep the previous values and show the violated constraint;
   - `settings-unavailable` degrades the block to read-only with the original hint.
   - Save is volatile: the host writes the active profile's `cordis.patch.yml` through the
     DSH settings service and applies it live (no restart).
   - The official "Plugins" settings page gets an equivalent auto-generated form from the
     same schema/revision.
2. **Worktree management** (existing UI): `list` → checkouts grouped by repository with
   live dirty counts, plus a **top-level `snapshots` array** (each row carries `repoRoot`,
   newest first) that the page groups per repository; `prune` (all or one repository)
   reports removed entries and snapshot refs; per-row cleanup via `clean`.
   - The recoverable-snapshots block renders one row per snapshot (`ref`, `commit`,
     `createdAt`, `restoredAt`/`restoredPath` when already restored) with a *Restore*
     button that calls `restore({ ref })`, shows `settings.snapshots.restored` with the
     returned path, and then refreshes the management list. The restored checkout is a
     plain git worktree (`wt-restored-…`) and is **not written to sidecar records**, so it
     does not appear as a managed row and does not take over the original session's cwd.
   - Per-row delete uses `clean` with `force: false` and escalates to a force confirmation
     for `worktree-dirty`; a `worktree-in-use` refusal opens the force confirmation with
     `error.worktreeInUse`, and force deletes through `clean` with `force: true`.

## Host RPC surface

All calls go through the authenticated `/api` carrier:

```js
connection.rpc.call('/api', 'dsh-codex-worktree/<endpoint>', payload, signal)
```

The channel must be a **single segment** (`/api`); the endpoint carries the namespace and
is addressable at `/api/dsh-codex-worktree/<endpoint>`, with
`message.method === 'dsh-codex-worktree/<endpoint>'`.

| Endpoint | Request | Success value |
| --- | --- | --- |
| `status` | `{ sessionId }` | `{ managed, path?, workspaceRoot?, repoRoot?, mode?, branch?, baseCommit?, createdAt?, dirty? }` |
| `list` | `{ workspacePath? }` | `{ repos: [{ repoRoot, records: [...] }], snapshots: [...], config }` (top-level snapshots, each row carrying `repoRoot`) |
| `clean` | `{ sessionId, force?, deleteBranch? }` | `{ removed, path, branchDeleted, snapshots, movedTo? }` (`alreadyGone: true` when the directory was already missing) |
| `prune` | `{ repoRoot? }` | `{ removed, snapshots }` |
| `placement` | read `{ workspacePath }`; write `{ workspacePath, mode }` | `{ workspacePath, mode, defaultMode, isGit }` |
| `settings` | `{action:'get'}` / `{action:'set', patch, revision}` / `{action:'reset'}` | `{ ns, revision, writable, values, defaults, fields }` |
| `restore` | `{ ref }` (required) | `{ ref, path, commit, repoRoot }` — a new detached checkout, not bound to the original session, with no cwd switch and no sidecar record |

There is **no `create` and no `cancel`** endpoint: creation is triggered only by the host's
`agent/created`, and the progress card's cancel is a client-side hide.

Failures arrive as `{ ok: false, error: { code, message, details: { issues } } }` and are
rendered inline; `details.issues` is appended to the message. Public codes:
`bad-request`, `worktree-dirty`, **`worktree-in-use`**, `not-managed`, `not-git-repository`,
`no-commit`, `disabled`, `root-unreachable`, `limit-reached`, `settings-unavailable`,
`conflict`, `invalid-config`, `snapshot-not-found`; other failures surface as
`operation-failed`. `worktree-in-use` carries `details.sessionIds` for the sessions using
the checkout.

## Controllers used

| Action | API | Notes |
| --- | --- | --- |
| Resolve the hero workspace | `workspaces.list.getSnapshot().items` (`{ workspaceId, path, title, sessionIds }`) | the selector maps `selectedId` → path; also accepts `byId` snapshots. |
| Read a session projection | `sessions.list.getSnapshot().byId[sessionId].projectionValues.codexWorktree` + `sessions.list.subscribe` | progress / marker / chip base state; event-driven only. |
| Resolve a conversation title | `sessions.list.getSnapshot()` | accepts `items`, `ids` and `byId`; title field is `displayTitle`, falling back to `title`/`name` (used by the management UI when it lists conversations). |
| Clean / prune / list / restore | `connection.rpc.call('/api', 'dsh-codex-worktree/<endpoint>', …)` | see the RPC table; `restore` creates an unmanaged detached checkout and the page then refreshes `list`. |

The client never creates a Workspace and never creates a Session as part of worktree
creation.

## Locale keys

`placement.title`, `placement.worktree`, `placement.local`, `placement.hint`,
`placement.failed`; `progress.title`, `progress.prepare`, `progress.checkout`,
`progress.finalize`, `progress.done`, `progress.cancel`, `progress.failed`;
`marker.title`, `marker.tooltip`, `progress.reason`; `settings.edit.*`, `settings.save`,
`settings.reset`, `settings.saved`, `settings.dirty`, `settings.conflict`,
`settings.invalid`, `settings.unavailable`; `settings.snapshots.*` (`title`, `count`,
`commit`, `created`, `restore`, `restoring`, `restored`, `restoreBadge`, `restoredAt`,
`restoreFailed`); `error.worktreeInUse`, `error.forceCleanupAction`; plus the existing
chip/popover/management strings. The new `cleanupOnArchive` field gets its label and
description through the generic `settings.edit.<key>` lookup.

## Styling and failure isolation

- One plugin-scoped `<style>` element (`data attribute` selectors), plugin-prefixed class
  names, and only `--dsw-alias-*` / `--dsw-specific-*` / `--dsw-shadow-*` tokens, so light
  and dark themes both come from the host.
- Each slot entry is wrapped in a small error boundary so a render error degrades to an
  inline label instead of blanking the slot entry; async effects abort on unmount.

## Known limitation

Cleaning a **non-live** session's checkout from the settings page cannot append a
projection event for that session (no live session to write to), so its sidebar marker
disappears only on that session's next `agent/created` consistency repair. Live sessions
are cleaned immediately via the projection push.

Seat choices are deliberate: the placement pill lives in the official
`conversation.hero.options` list seat and never registers the shipped WorkspacePicker's
single-value `conversation.hero.workspace` seat (`kind: "single"`,
`replaceRisk: "shadows-shipped-ui"`), so the workspace switcher is never shadowed; the
marker lives in the official ambient-marker seat `sidebar.session.row.leading`, not in the
hover-only row action strip.

Cleaning a checkout that is **another live session's current working directory** is refused
with `worktree-in-use` (Codex-compatible); cleaning your own session's checkout moves its
cwd back to the workspace instead. Force-cleaning overrides the guard and permanently
takes the other session's working directory away; uncommitted changes are lost. Snapshots
only cover the pre-delete committed `HEAD`, and a restored checkout is a plain git worktree
that is not bound to the original session and not tracked as a managed record (remove it
with `git worktree remove`). `cleanupOnArchive` is a lazy sweep (not a watcher), so the
clean-up happens at the host's sweep triggers (after a successful creation, on `list`,
on `prune`, and ~1 s after `workspace/session-stop`) rather than exactly at archive time;
prune and the sweep skip an entry when its snapshot cannot be written.

## Verification hooks

`scripts/smoke-client.mjs` evaluates this artifact under a `window.__ModuleLoader__`
stub with a hook-capable React stub, then asserts: the loader id, the plugin name and
inject list, the five slot registrations and their ids, the placement selector's two states
and non-Git hiding, the progress-card state machine (steps / done / cancel / error with a
fake clock for the 1000 ms floor), the read-only marker (visible only on `ready`, not
clickable), the settings form's save payload and conflict copy, the recoverable-snapshots
block and the `restore` call, the `worktree-in-use` force confirmation, the RPC namespace,
and that the source contains no `setInterval` or polling.
