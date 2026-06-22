import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { ACCOUNT_NOTIFICATIONS_HTML } from '../ui/account-notifications.html'

const RESOURCE_URI = 'ui://canvas-lms-mcp/account-notifications.html'

export function registerAccountNotificationsUI(server: McpServer): void {
  registerAppResource(
    server,
    'Institution Announcements',
    RESOURCE_URI,
    { description: 'Interactive institution announcements panel' },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: ACCOUNT_NOTIFICATIONS_HTML,
        },
      ],
    }),
  )
}
