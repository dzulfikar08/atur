import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  name?: string;
}

interface State {
  error: Error | null;
  componentStack: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
    console.error(
      `[ErrorBoundary:${this.props.name ?? 'unknown'}]`,
      error,
      info.componentStack,
    );
  }

  handleReset = () => {
    this.setState({ error: null, componentStack: '' });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="m-1 flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-4 text-destructive"
        >
          <p className="text-sm font-semibold">
            Something went wrong{this.props.name ? ` in ${this.props.name}` : ''}.
          </p>
          <p className="text-sm">{this.state.error.message}</p>
          {import.meta.env.DEV && this.state.componentStack && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-tight text-muted-foreground">
              {this.state.componentStack}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-1 self-start rounded-md border border-destructive/50 px-3 py-1 text-xs font-medium hover:bg-destructive/10"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
