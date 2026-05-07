#!/usr/bin/env node

const sub = process.argv[2]

if (sub === 'init') {
  await import('../dist/init.js')
} else if (sub === 'serve') {
  await import('../dist/http.js')
} else {
  await import('../dist/stdio.js')
}
