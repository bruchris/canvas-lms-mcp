import type { CanvasClient } from '../canvas'

/**
 * A stand-in `CanvasClient` for code that walks the tool registry without ever
 * calling a tool — manifest generation and prompt generation both do this.
 *
 * Every property access **throws**. Building a `ToolDefinition` must not touch
 * Canvas, so an access during registration is a bug, and a permissive proxy
 * that returned itself would hide it: generation would quietly derive from a
 * registry built against a fake client, and a staleness gate comparing one
 * generation to another would still pass because both sides would be wrong in
 * the same way. Failing loudly is the whole point.
 *
 * @param context Prefix for the error message, naming the caller.
 */
export function createRegistryProbeClient(context: string): CanvasClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `${context} accessed Canvas client during tool registration via "${String(property)}".`,
        )
      },
    },
  ) as CanvasClient
}
