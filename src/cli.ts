export interface CliConfig {
  token: string
  baseUrl: string
  mode: 'stdio' | 'http'
  port: number
  allowedOrigin: string
}

export function parseArgs(args: string[]): CliConfig {
  const config: CliConfig = {
    token: process.env.CANVAS_API_TOKEN ?? '',
    baseUrl: process.env.CANVAS_BASE_URL ?? '',
    mode: 'stdio',
    port: 3001,
    allowedOrigin: process.env.CANVAS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
        config.token = args[++i] ?? ''
        break
      case '--base-url':
        config.baseUrl = args[++i] ?? ''
        break
      case 'serve':
        config.mode = 'http'
        break
      case '--port': {
        const parsed = Number(args[++i])
        config.port = Number.isNaN(parsed) ? 3001 : parsed
        break
      }
      case '--allowed-origin':
        config.allowedOrigin = args[++i] ?? 'http://localhost:3000'
        break
    }
  }

  if (!config.token) {
    console.error('Error: Canvas API token required. Use --token or set CANVAS_API_TOKEN')
    process.exit(1)
  }
  if (!config.baseUrl) {
    console.error('Error: Canvas base URL required. Use --base-url or set CANVAS_BASE_URL')
    process.exit(1)
  }

  return config
}
