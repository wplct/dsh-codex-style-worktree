/**
 * Frozen shared contract for dsh-codex-style-worktree.
 *
 * Both halves of the plugin (host `lib/**` and client `client/client.js`) read
 * these names only; neither half redefines them. Change here, never there.
 */

/** Loader id / plugin name. Must match the `insert.id` row in cordis.patch.yml. */
export const PLUGIN_ID = 'dsh-codex-style-worktree'

/** Locale namespace used by the client half. */
export const LOCALE_NS = 'dsh-codex-style-worktree'

/** Base path of the authenticated host route carrier. */
export const API_PREFIX = '/api/dsh-codex-style-worktree'

/**
 * RPC endpoints. The browser calls `connection.rpc.call('<channel>', '<endpoint>', payload, signal)`
 * where the channel is ONE path segment (`/api`) and the endpoint is
 * `dsh-codex-style-worktree/<key>`; `dsh-client-connection` validates each separately
 * (`CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/`) and derives the HTTP path from both.
 * The host registers `${API_PREFIX}/${key}` and asserts
 * `message.method === `dsh-codex-style-worktree/${key}``.
 *
 * There is deliberately no `create` and no `cancel` endpoint: creation happens
 * only in `agent/created` (after the first prompt), and the progress card's
 * cancel is a client-only hide.
 */
export const ENDPOINTS = ['status', 'clean', 'list', 'prune', 'placement', 'settings', 'restore']

/** RPC method prefix the connection layer derives from API_PREFIX. */
export const RPC_NAMESPACE = 'dsh-codex-style-worktree'

/** Sidecar directory name under $DSH_HOME. */
export const STATE_DIR = 'dsh-codex-style-worktree'

/** Pre-rename sidecar directory; migrated to {@link STATE_DIR} on first boot. */
export const LEGACY_STATE_DIR = 'dsh-codex-worktree'

/** Pre-rename repository opt-out marker; still honored next to the new name. */
export const LEGACY_DISABLE_MARKER = '.dsh-codex-worktree-off'

/** Sidecar file name inside STATE_DIR. */
export const STATE_FILE = 'state.json'

/**
 * Sidecar schema version: v2 adds per-workspace placements, v3 adds the
 * `snapshots` map (refs saved before a checkout is removed, restorable).
 */
export const STATE_VERSION = 3

/** Worktree checkout modes. */
export const MODE_DETACHED = 'detached'
export const MODE_BRANCH = 'branch'

/** Where a new Session in one workspace runs. */
export const PLACEMENT_WORKTREE = 'worktree'
export const PLACEMENT_LOCAL = 'local'

/** The placement assumed for a workspace that has no stored preference yet. */
export const DEFAULT_PLACEMENT = PLACEMENT_WORKTREE

/** Stored placement rows older than this are dropped on the next read. */
export const PLACEMENT_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** Session-projection key carrying this plugin's per-session state. */
export const PROJECTION_KEY = 'codexWorktree'

/** Session event type whose `data.state` carries the complete post-change projection state. */
export const PROJECTION_EVENT = 'codex-worktree/state'

/** Projection state schema version (bump when fields/fold semantics change). */
export const PROJECTION_VERSION = 1

/**
 * Settings namespace. The Settings service addresses a plugin by its **profile
 * entry id**, so this must equal the `insert.id` row in cordis.patch.yml.
 */
export const SETTINGS_NS = 'codex-worktree'

/** Slash commands (management only; branch naming is left to Git). */
export const COMMAND_STATUS = 'wt-status'
export const COMMAND_CLEAN = 'wt-clean'
export const COMMAND_SNAPSHOTS = 'wt-snapshots'
export const COMMAND_RESTORE = 'wt-restore'

/** Agent sources skipped outright (before touching git). */
export const SKIPPED_SOURCES = ['clear', 'compaction', 'resume']
