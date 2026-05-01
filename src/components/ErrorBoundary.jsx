import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep it visible in DevTools, but render a friendly fallback.
    // eslint-disable-next-line no-console
    console.error("UI crashed:", error, info);
  }

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (typeof fallback === "function") return fallback(error);
      if (fallback) return fallback;

      return (
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(255,77,77,.35)",
            background: "rgba(30,10,10,.65)",
            color: "rgba(255,255,255,.9)",
            fontFamily:
              "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          }}
        >
          <div style={{ fontWeight: 900, letterSpacing: 2, fontSize: 12 }}>
            ERROR
          </div>
          <div style={{ marginTop: 8, color: "rgba(255,180,180,.9)" }}>
            {String(error?.message ?? error)}
          </div>
        </div>
      );
    }

    return children;
  }
}

