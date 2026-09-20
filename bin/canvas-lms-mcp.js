#!/usr/bin/env node

const sub = process.argv[2]

if (sub === 'init') {
  await import('../dist/init.js')
} else if (sub === 'serve') {
  await import('../dist/http.js')
} else if (sub === 'doctor' || (sub === 'auth' && process.argv[3] === 'status')) {
  await import('../dist/doctor.js')
} else {
  await import('../dist/stdio.js')
}
