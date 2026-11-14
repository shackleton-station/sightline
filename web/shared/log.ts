import { currentSpanId, currentTraceId } from './trace'

/** One line per thing worth knowing, as JSON, so Cloud Logging can filter on any field. */
export interface Log {
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

/**
 * A service's log. Every line carries the service's name and version, so lines from four services
 * in one project can be told apart, and, inside a trace, the trace's and the step's ids, so the log
 * line and the trace open each other in the console.
 */
export function serviceLog(service: string, version: string, project?: string, write: (line: string) => void = (line) => console.log(line)): Log {
  const line = (severity: string) => (message: string, fields: Record<string, unknown> = {}) => {
    const traceId = currentTraceId()
    const trace = traceId && project ? { 'logging.googleapis.com/trace': `projects/${project}/traces/${traceId}`, 'logging.googleapis.com/spanId': currentSpanId() } : {}
    write(JSON.stringify({ severity, message, service, version, ...fields, ...trace }))
  }
  return { info: line('INFO'), warn: line('WARNING'), error: line('ERROR') }
}
