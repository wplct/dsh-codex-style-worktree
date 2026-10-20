/**
 * Small shared helpers for dsh-codex-worktree.
 *
 * No dependencies beyond Node builtins: the plugin is installed by copying it
 * into a DSH profile, so anything it imports at runtime must already exist.
 */

/** Normalize a path for comparison (drop trailing separators except root). */
export function cleanPath(value) {
  const text = String(value ?? '')
  return text.length > 1 ? text.replace(/[\\/]+$/, '') : text
}

/** Compare two paths ignoring a trailing separator. */
export function samePath(left, right) {
  return cleanPath(left) === cleanPath(right)
}

/**
 * Whether `child` is `parent` itself or lives below it (lexical, separator-aware).
 * @param {string} parent container directory.
 * @param {string} child candidate path.
 */
export function isInsideDir(parent, child) {
  const base = cleanPath(parent)
  const target = cleanPath(child)
  if (base.length === 0) return false
  return target === base || target.startsWith(`${base}/`) || target.startsWith(`${base}\\`)
}

/**
 * One abort signal that fires when `signal` aborts or `ms` elapses.
 * @param {AbortSignal|undefined} signal caller cancellation.
 * @param {number} ms timeout in milliseconds.
 * @returns {{signal: AbortSignal, timeout: NodeJS.Timeout, dispose: () => void}}
 */
export function withTimeout(signal, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`dsh-codex-worktree: timed out after ${ms}ms`)), ms)
  if (timer.unref !== undefined) timer.unref()
  const onAbort = () => controller.abort(signal?.reason ?? new Error('dsh-codex-worktree: cancelled'))
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timeout: timer,
    dispose() {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Serialize async work by key. Each key runs its tasks in FIFO order; different
 * keys never block each other.
 * @returns {(key: string, task: () => Promise<any>) => Promise<any>}
 */
export function createKeyedMutex() {
  const tails = new Map()
  return function withKey(key, task) {
    const previous = tails.get(key) ?? Promise.resolve()
    const result = previous.then(task, task)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    tails.set(key, settled)
    settled.then(() => {
      if (tails.get(key) === settled) tails.delete(key)
    })
    return result
  }
}

/** Log through the plugin logger when present, never throwing. */
/**
 * Read one optional service without tripping Cordis' injected-service guard.
 *
 * A context property that names a service the plugin did not declare in
 * `inject` throws ("cannot get property \"sandbox\" without inject") instead of
 * returning undefined, so `ctx.sandbox` and `ctx.sandboxPolicy` must be read
 * defensively: both are optional (headless compositions may not mount them).
 * @param {object} ctx plugin context.
 * @param {string} name service name.
 * @returns the service, or undefined when absent or not injected.
 */
export function readService(ctx, name) {
  try {
    return ctx?.[name]
  } catch {
    return undefined
  }
}

export function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`dsh-codex-worktree: ${message}`)
  } catch {
    /* logging must never break the caller */
  }
}

/** Short one-line message from an unknown thrown value. */
export function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
