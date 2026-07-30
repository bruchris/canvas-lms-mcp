export const TRUTHY_ENV_VALUES = new Set(['true', '1', 'yes', 'on'])

export function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
}
