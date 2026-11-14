import { readFileSync } from 'node:fs'

/**
 * The hash of the site data a build carries, read from the small file its build wrote
 * (`{"dataVersion":"…"}`; see scripts/data-version.mjs). Null when there is no such file or it does
 * not hold a hash. Each service reports this in its status, so a deploy can tell that they all hold
 * the same data.
 */
export function readDataVersion(file: string): string | null {
  return readVersionFile(file, 'dataVersion')
}

/**
 * One hash from a small JSON file a build wrote: `dataVersion` (the site data) or `codeVersion` (the
 * co-pilot's code, scripts/copilot-version.mjs). Null when there is no such file or field.
 */
export function readVersionFile(file: string, field: 'dataVersion' | 'codeVersion'): string | null {
  try {
    const hash = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)[field]
    return typeof hash === 'string' ? hash : null
  } catch {
    return null
  }
}
