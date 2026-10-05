#!/usr/bin/env node
// `canvas-lms-mcp doctor` / `canvas-lms-mcp auth status` entry point (issue #302 §11).

import { diagnose, formatReport } from './auth/doctor'

/** Strip the subcommand words the bin dispatcher matched on. */
export function doctorArgv(argv: string[]): string[] {
  if (argv[0] === 'doctor') return argv.slice(1)
  if (argv[0] === 'auth' && argv[1] === 'status') return argv.slice(2)
  return argv
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const report = diagnose(doctorArgv(argv), process.env)
  console.log(formatReport(report))
  return report.ready ? 0 : 1
}

// Guarded so importing this module under vitest does not exit the worker —
// bin/canvas-lms-mcp.js still gets the auto-invoke it relies on.
if (!process.env.VITEST) {
  process.exit(main())
}
