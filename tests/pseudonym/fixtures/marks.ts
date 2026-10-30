/**
 * The marked-name mechanism of BRU-3146 §2.1.
 *
 * A fixture writes every string that is a *real person's name* as
 * `REAL_NAME_<n>`, and nothing else in the fixture may match that pattern. The
 * oracle is then two assertions with no per-tool configuration at all:
 *
 *   flag OFF -> at least one mark reaches the handler's return value (control)
 *   flag ON  -> no mark reaches the handler's return value      (assertion)
 *
 * The walk below is deliberately a cycle-safe graph traversal rather than
 * `JSON.stringify` + regex: it reports the *path* of each surviving mark, which
 * is what turns a red run into an actionable finding, and it cannot be defeated
 * by a payload that `JSON.stringify` refuses (a cycle) or silently drops.
 */

/** One `REAL_NAME_<n>` occurrence, with the path it was found at. */
export interface MarkSite {
  /** JSON-ish path of the string that carried the mark, e.g. `[0].leader.display_name`. */
  path: string
  /** The mark itself, e.g. `REAL_NAME_<n>`. */
  mark: string
}

/**
 * Matches one mark. Kept as a factory rather than a shared `/g` constant: a
 * module-level global regex carries `lastIndex` between calls, which would make
 * the sweep's result depend on how many times it had been run before.
 */
export function markPattern(): RegExp {
  return /REAL_NAME_\d+/g
}

type Container = Record<string, unknown> | unknown[]

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null
}

function walk(
  node: unknown,
  path: string,
  seen: Set<object>,
  onString: (value: string, path: string) => void,
  onKey: (key: string, path: string) => void,
): void {
  if (typeof node === 'string') {
    onString(node, path)
    return
  }
  if (!isContainer(node)) return
  if (seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, `${path}[${index}]`, seen, onString, onKey))
    return
  }
  for (const [key, child] of Object.entries(node)) {
    const childPath = path === '' ? key : `${path}.${key}`
    onKey(key, childPath)
    walk(child, childPath, seen, onString, onKey)
  }
}

/** Every mark in a *value* position, anywhere in `value`. */
export function findMarks(value: unknown): MarkSite[] {
  const out: MarkSite[] = []
  walk(
    value,
    '',
    new Set(),
    (text, path) => {
      for (const mark of text.match(markPattern()) ?? []) out.push({ path, mark })
    },
    () => {},
  )
  return out
}

/**
 * Every mark in a *key* position (§5.4). Always expected to be empty: a mark on
 * a key is not a person's name, and smuggling one there would make the flag-on
 * assertion fail for a correct implementation — which is how a guard gets
 * relaxed rather than fixed.
 */
export function findMarkedKeys(value: unknown): MarkSite[] {
  const out: MarkSite[] = []
  walk(
    value,
    '',
    new Set(),
    () => {},
    (key, path) => {
      for (const mark of key.match(markPattern()) ?? []) out.push({ path, mark })
    },
  )
  return out
}

/** Marks that appear more than once within one payload (§5.4: indices are unique). */
export function duplicateMarks(sites: ReadonlyArray<MarkSite>): string[] {
  const counts = new Map<string, number>()
  for (const site of sites) counts.set(site.mark, (counts.get(site.mark) ?? 0) + 1)
  return [...counts.entries()].filter(([, n]) => n > 1).map(([mark]) => mark)
}
