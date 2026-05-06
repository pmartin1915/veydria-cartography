import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Map error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">⚠</div>
          <h2 className="error-boundary-title">Something went wrong</h2>
          <p className="error-boundary-desc">
            The map encountered an unexpected error.
          </p>
          <button
            className="error-boundary-btn"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
          {this.state.error && (
            <pre className="error-boundary-trace">{this.state.error.message}</pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
