import type { Mode } from '../lib/mode'

interface Props {
  mode: Mode
  onChange: (mode: Mode) => void
}

const CHOICES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'learn', label: 'Learn', hint: 'Plain words, for anyone curious' },
  { mode: 'plan', label: 'Plan', hint: 'Mission limits and every number' },
]

/** Switches between plain words and full detail. It never changes the numbers underneath. */
export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="Level of detail">
      {CHOICES.map((choice) => (
        <button
          key={choice.mode}
          type="button"
          title={choice.hint}
          aria-pressed={mode === choice.mode}
          onClick={() => onChange(choice.mode)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}
