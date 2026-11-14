/** The handlers' entry points, relative to web/. */
export const ENTRY_POINTS: string[]
/** Every file the co-pilot's handlers are built from, relative to web/, in a fixed order. */
export function copilotFiles(): Promise<string[]>
/** The first 16 hex digits of a SHA-256 over those files: their path, size and content. */
export function copilotVersion(): Promise<string>
