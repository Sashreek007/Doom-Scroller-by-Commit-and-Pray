import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DoomScroller] Render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[500px] flex items-center justify-center bg-doom-bg p-6">
          <div className="text-center space-y-3">
            <p className="text-neon-pink text-lg font-bold">Something went wrong</p>
            <p className="text-doom-muted text-xs">
              Try closing and reopening the extension.
            </p>
            <button
              className="btn-primary text-xs px-4 py-2"
              onClick={() => this.setState({ hasError: false })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
