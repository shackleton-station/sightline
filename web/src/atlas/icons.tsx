import type { ReactNode } from 'react'

/**
 * The Atlas's icons: one 24 px grid, 1.6 px round strokes, drawn in the text color (currentColor),
 * so each look colors them with its own tokens. Decorative by default; pass `label` when the icon
 * is the only thing that says what it means.
 */
interface IconProps {
  size?: number
  label?: string
  className?: string
}

function Svg({ size = 20, label, className, children, fill = 'none' }: IconProps & { children: ReactNode; fill?: string }) {
  return (
    <svg
      className={className ? `atlas-icon ${className}` : 'atlas-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  )
}

const RAYS = 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'

/** The whole Sun in view. */
export const SunIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d={RAYS} />
  </Svg>
)

/** Part of the Sun's disk above the terrain. */
export const SunHorizonIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 17h18M7 17a5 5 0 0 1 10 0M12 7v2M6 10.5l1.3 1.3M18 10.5l-1.3 1.3" />
  </Svg>
)

/** The Sun hidden by terrain: the place is in shadow. */
export const MoonIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Svg>
)

/** Earth above the horizon. */
export const EarthIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Svg>
)

/** Earth below the horizon. */
export const EarthOffIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3zM4 4l16 16" />
  </Svg>
)

export const LayersIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
)

export const PlayIcon = (props: IconProps) => (
  <Svg {...props} fill="currentColor">
    <path d="M8 5l11 7-11 7z" strokeWidth={1} />
  </Svg>
)

export const PauseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 5v14M16 5v14" strokeWidth={2.4} />
  </Svg>
)

/** One hour on (or, flipped with the `back` class, one hour back). */
export const StepIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 6l8 6-8 6zM18 6v12" />
  </Svg>
)

export const ChevronIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 12l5 5 9-10" strokeWidth={2} />
  </Svg>
)

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

/** Scout, the AI guide. */
export const SparkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 16v4M17 18h4" />
  </Svg>
)

export const HelpIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17h.01" />
  </Svg>
)

export const TargetIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
)

export const ClockIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)
