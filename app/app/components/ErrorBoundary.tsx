import React from 'react';
import { reportClientError, showErrorToast } from '~/lib/clientError';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

// Root error boundary. When something crashes the render tree we can't keep
// rendering the children (React unmounts them), but we don't want a big
// dramatic error screen either. So we show a tiny inline notice + fire a
// persistent toast carrying the support code. Most app errors never hit this
// boundary  they get caught explicitly via reportClientError() from
// `~/lib/clientError` and just show the toast without ever unmounting.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private reported = false;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    if (this.reported) return;
    this.reported = true;
    // Fire and forget; the toast appears as soon as the ref comes back.
    void reportClientError({
      error,
      source: errorInfo?.componentStack?.slice(0, 200),
      title: 'The page hit a snag',
    }).catch(() => {
      // Worst case still show the toast so the user knows something happened.
      showErrorToast({ title: 'The page hit a snag' });
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // Minimal inline fallback. No big AI-style apology page; the toast
      // carries the user-visible message.
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="text-center space-y-4 max-w-xs">
            <p className="text-sm text-muted-foreground">Try refreshing.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
