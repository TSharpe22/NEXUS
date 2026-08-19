import { Component, ReactNode } from 'react'
import { ErrorState } from './design/ErrorState'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Nexus crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 'var(--nx-space-6)', maxWidth: 480, margin: '10vh auto' }}>
          <ErrorState
            label="Something went wrong"
            detail={this.state.error.message}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      )
    }
    return this.props.children
  }
}
