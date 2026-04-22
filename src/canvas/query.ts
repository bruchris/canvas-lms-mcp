export type CanvasQueryPrimitive = string | number | boolean

export type CanvasQueryValue = CanvasQueryPrimitive | ReadonlyArray<CanvasQueryPrimitive>

export type CanvasQueryParams = Record<string, CanvasQueryValue | undefined | null>

export function appendCanvasQuery(target: URLSearchParams, params?: CanvasQueryParams): void {
  if (!params) return
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      const arrayKey = key.endsWith('[]') ? key : `${key}[]`
      for (const item of value) {
        if (item === undefined || item === null) continue
        target.append(arrayKey, String(item))
      }
    } else {
      target.set(key, String(value))
    }
  }
}

export function toCanvasQuery(params?: CanvasQueryParams): URLSearchParams {
  const search = new URLSearchParams()
  appendCanvasQuery(search, params)
  return search
}
