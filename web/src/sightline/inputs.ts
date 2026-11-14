/**
 * Attributes for a free-text field that is not a login: they tell the browser and the common
 * password managers (1Password, LastPass, Bitwarden, Dashlane) to leave it alone, so no login
 * popup opens over a question or a coordinate. Give the field a `name` and `id` that say what it is.
 */
export const NOT_A_LOGIN = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const
