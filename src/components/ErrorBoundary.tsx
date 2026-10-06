import { Component, type ErrorInfo, type ReactNode } from 'react'
import Icon from './Icon'

interface ErrorBoundaryProps {
  /** Changing this value clears a previous error, e.g. when a new font loads. */
  resetKey: string
  /** What failed, used in the message, e.g. "The canvas". */
  label: string
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: string
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} failed to render`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="font-error" role="alert">
        <p className="font-error-kind">{this.props.label} could not be displayed</p>
        <p>{this.state.error.message}</p>
        <button type="button" className="button-small" onClick={() => this.setState({ error: null })}>
          <Icon name="retry" />
          Try again
        </button>
      </div>
    )
  }
}
