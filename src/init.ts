#!/usr/bin/env node
// init wizard entry — argv → wizard (prompts + Canvas validation) → config writer.

import prompts from 'prompts'
import { helpText, parseInitArgs } from './init/argv'
import { currentPathEnv } from './init/clients'
import { writeClientConfigs } from './init/config-writer'
import { nodeFileSystem } from './init/io'
import { pingUsersSelf } from './init/validate'
import { runWizard, type WizardDeps } from './init/wizard'

async function runInit(argv: string[]): Promise<void> {
  const args = argv[0] === 'init' ? argv.slice(1) : argv
  const parsed = parseInitArgs(args)
  if (!parsed.ok) {
    console.error(`Error: ${parsed.message}`)
    process.exit(2)
    return
  }
  if (parsed.config.showHelp) {
    console.log(helpText())
    process.exit(0)
    return
  }

  const deps: WizardDeps = {
    fs: nodeFileSystem,
    env: currentPathEnv(),
    prompts: async (question) =>
      (await prompts(question as Parameters<typeof prompts>[0])) as Record<string, unknown>,
    pingUsersSelf,
    writeClientConfigs,
    log: (message) => console.log(message),
  }

  const result = await runWizard(deps, { initialConfig: parsed.config })
  process.exit(result.exitCode)
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await runInit(argv)
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

// Guarded so importing this module under vitest (see tests/init/entry.test.ts) doesn't
// trigger a real process.exit — bin/canvas-lms-mcp.js still gets the auto-invoke it relies on.
if (!process.env.VITEST) {
  void main()
}
