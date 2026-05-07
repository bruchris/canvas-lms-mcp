import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    stdio: 'src/stdio.ts',
    http: 'src/http.ts',
    init: 'src/init.ts',
    cli: 'src/cli.ts',
    'canvas/index': 'src/canvas/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  splitting: true,
  sourcemap: true,
  target: 'node22',
})
