import React from "react";

/**
 * Top-level React ErrorBoundary so a thrown render error in any page does not
 * blank the whole app. Shows a small fallback with a recovery action.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Unhandled UI error:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== "undefined") window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== "undefined") window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        data-testid="error-boundary-fallback"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "#f5f5f5",
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 28,
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1a2332", marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#4b5563", fontSize: 14, marginBottom: 16 }}>
            The page hit an unexpected error. Your session is still active — try reloading the page or returning to the dashboard.
          </p>
          {this.state.error?.message && (
            <pre
              style={{
                background: "#f3f4f6",
                padding: 10,
                borderRadius: 6,
                fontSize: 12,
                color: "#374151",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                marginBottom: 16,
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {String(this.state.error.message)}
            </pre>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              data-testid="error-boundary-reload-btn"
              onClick={this.handleReload}
              style={{
                background: "#1a2332",
                color: "#fff",
                padding: "8px 14px",
                borderRadius: 6,
                border: 0,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Reload
            </button>
            <button
              data-testid="error-boundary-home-btn"
              onClick={this.handleGoHome}
              style={{
                background: "#f5a623",
                color: "#fff",
                padding: "8px 14px",
                borderRadius: 6,
                border: 0,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Go to login
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
