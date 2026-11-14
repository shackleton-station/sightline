import { Component, type ReactNode } from 'react'

interface State {
  message: string | null
}

/** Without this, any unexpected error while drawing leaves a completely blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: unknown): State {
    return { message: String(error) }
  }

  render() {
    if (this.state.message === null) return this.props.children
    return (
      <main className="app" role="alert">
        <h1>Something went wrong</h1>
        <p>The page hit an unexpected error. Reloading usually fixes it.</p>
        <p className="actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
        <p className="note">Details, if you're reporting this: {this.state.message}</p>
      </main>
    )
  }
}
