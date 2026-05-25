#!/usr/bin/env node
// init wizard entry — argv → wizard (prompts + Canvas validation) → config writer.

import prompts from 'prompts'
import { helpText, parseInitArgs } from './init/argv'
import { currentPathEnv } from './init/clients'
import { writeClientConfigs } from './init/config-writer'
import { nodeFileSystem } from './init/io'
import { pingUsersSelf } from './init/validate'
import { runWizard, type WizardDeps } from './init/wizard'

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'init') args.shift()
  const parsed = parseInitArgs(args)
  if (!parsed.ok) {
    console.error(`Error: ${parsed.message}`)
    process.exit(2)
  }
  if (parsed.config.showHelp) {
    console.log(helpText())
    process.exit(0)
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

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
