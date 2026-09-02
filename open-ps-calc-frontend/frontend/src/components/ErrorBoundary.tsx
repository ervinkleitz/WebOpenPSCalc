import React from "react";

// Until this existed, any exception thrown during render unmounted the whole app
// and left a blank white page. That is how a small state bug — a saved build with
// a missing field, read inside a useMemo dependency array — reached players as
// "the Load button does nothing", with nothing on screen to say otherwise and no
// way for them to tell us what actually happened.
//
// So this is a diagnostic as much as a safety net: it keeps the page, names the
// error, and puts it on the clipboard in one click so a bug report carries the
// stack instead of a guess.
interface State { error: Error | null; info: string; copied: boolean; }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? "" });
    // Keep the console copy — the clipboard button is for the report, this is for
    // anyone already looking at devtools.
    console.error("Open PS Calc crashed:", error, info.componentStack);
  }

  private details() {
    const { error, info } = this.state;
    return [
      `Open PS Calc error: ${error?.name}: ${error?.message}`,
      `Page: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      "",
      error?.stack ?? "(no stack)",
      "",
      "Component stack:",
      info || "(none)",
    ].join("\n");
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-card" role="alert">
        <h2>Something in the calculator broke.</h2>
        <p>
          The page stopped rather than showing you a wrong number. Your saved builds are
          untouched — they live in this browser and nothing here has written to them.
        </p>
        <p className="crash-what-now">
          Reloading usually clears it. If it happens every time, copy the details and send
          them over — that's what makes it fixable.
        </p>
        <pre className="crash-message">{this.state.error.name}: {this.state.error.message}</pre>
        <div className="crash-actions">
          <button className="primary" onClick={() => window.location.reload()}>Reload the page</button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(this.details())
                .then(() => this.setState({ copied: true }))
                .catch(() => { /* clipboard blocked — the details are in the console too */ });
            }}
          >
            {this.state.copied ? "Copied ✓" : "Copy error details"}
          </button>
        </div>
      </div>
    );
  }
}
