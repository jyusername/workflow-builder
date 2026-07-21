import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Workflow UI error:', error, info)
  }

  render() {
    const { error } = this.state
    const { children, title = 'Something went wrong' } = this.props

    if (!error) return children

    return (
      <div className="error-boundary">
        <strong>{title}</strong>
        <p>{error?.message || 'The panel could not render. Refresh the app or try again.'}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
