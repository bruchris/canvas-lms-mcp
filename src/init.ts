#!/usr/bin/env node
// init wizard entry — Task 1 stub. Subsequent tasks (BRU-?) wire the wizard
// (prompts, Canvas /users/self validation) and config writers.

import { helpText, parseInitArgs } from './init/argv'

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'init') args.shift()
  const result = parseInitArgs(args)
  if (!result.ok) {
    console.error(`Error: ${result.message}`)
    process.exit(2)
  }
  if (result.config.showHelp) {
    console.log(helpText())
    process.exit(0)
  }
  console.log('canvas-lms-mcp init: setup wizard coming soon.')
  console.log(
    'For now, configure your MCP client manually — see https://github.com/bruchris/canvas-lms-mcp#setup',
  )
  process.exit(0)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
