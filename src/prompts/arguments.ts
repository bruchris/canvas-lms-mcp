/**
 * The closed set of prompt arguments a skill may declare. MCP prompt arguments
 * are strings on the wire, and every one of these is optional: a host that has
 * the ID in hand can prefill it, and a host that does not still gets a working
 * workflow, because every skill already knows how to ask.
 *
 * Generation fails on a name outside this table, so a frontmatter typo is a CI
 * failure rather than an undocumented argument.
 */
export const ARGUMENT_VOCABULARY: Readonly<Record<string, string>> = {
  course_id: 'Canvas course ID to run this workflow against. Omit to be asked.',
  assignment_id: 'Canvas assignment ID to scope to. Omit to be asked.',
  quiz_id: 'Canvas quiz ID to scope to. Omit to be asked.',
  account_id: 'Canvas account ID to scope to. Omit to start from the root account.',
  student_id: 'Canvas user ID of a single student to scope to. Omit for the whole class.',
}

export function isKnownArgument(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ARGUMENT_VOCABULARY, name)
}

export function describeArgument(name: string): string {
  const description = ARGUMENT_VOCABULARY[name]
  if (description === undefined) {
    throw new Error(`Unknown prompt argument "${name}".`)
  }
  return description
}
