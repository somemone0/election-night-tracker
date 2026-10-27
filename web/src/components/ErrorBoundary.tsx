// Keeps one broken part of the page (a bad race row, a map error) from taking down the rest.
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ label: string; children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.label}]`, error); }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });   // try again on new data
  }
  render() {
    if (this.state.error) return <p className="empty">Something went wrong showing {this.props.label}. It will retry with the next update.</p>;
    return this.props.children;
  }
}
