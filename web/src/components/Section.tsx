import { type ReactNode, useState } from 'react'

interface Props {
  title: string
  /** One line saying what's inside, so nobody has to open it to find out. */
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A part of the page that opens on demand. What's inside isn't built, and its data isn't fetched,
 * until it's first opened.
 */
export function Section({ title, hint, defaultOpen = false, children }: Props) {
  const [opened, setOpened] = useState(defaultOpen)
  return (
    <details
      className="section"
      open={defaultOpen}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true)
      }}
    >
      <summary>
        <span className="section-title">{title}</span>
        {hint && <span className="section-hint">{hint}</span>}
      </summary>
      {opened && <div className="section-body">{children}</div>}
    </details>
  )
}
