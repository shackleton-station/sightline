// Where a service in the cloud should be counting its rate limits: Redis, or its own memory.
//
// The live project's settings are in infra/settings.auto.tfvars, and `shared_store = false` there
// means there is no Redis: every service is given no REDIS_HOST and reports "memory". A deploy's
// check must expect what the settings say, or it fails every deploy for a choice made on purpose.
// So the checks read the same file Terraform does. `--store redis` or `--store memory` on a check's
// command line says it outright, for an environment these settings do not describe.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SETTINGS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'infra', 'settings.auto.tfvars')

/** 'memory' when the settings switch the shared store off, 'redis' otherwise (the variable's default is true). */
export function storeIn(settingsText) {
  return /^[ \t]*shared_store[ \t]*=[ \t]*false\b/m.test(settingsText) ? 'memory' : 'redis'
}

/** What a check should expect: `--store` if given, else what the settings file says, else Redis. */
export function expectedStore(argv, read = () => readFileSync(SETTINGS_FILE, 'utf8')) {
  const at = argv.indexOf('--store')
  if (at > 0) {
    const asked = argv[at + 1]
    if (asked !== 'redis' && asked !== 'memory') throw new Error(`--store takes redis or memory, got ${asked ?? 'nothing'}`)
    return asked
  }
  try {
    return storeIn(read())
  } catch {
    return 'redis'
  }
}
