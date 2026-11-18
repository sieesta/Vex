import { Component } from 'react'
import { RotateCcw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="studio-bg flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
        <div className="panel w-full max-w-sm rounded-[10px] px-7 py-8">
          <div className="brand-dial mx-auto size-12" aria-hidden="true">
            <span className="brand-dial__needle" />
            <span className="brand-dial__core" />
          </div>
          <p className="label-mono mt-5 text-ember">signal lost</p>
          <h1 className="mt-2 font-display text-[30px] leading-none text-cream">
            Vex lost the thread.
          </h1>
          <p className="mx-auto mt-3 max-w-[17rem] text-[12px] leading-relaxed text-muted">
            The console hit an unexpected error. Your conversation memory and mood are still saved
            in this browser.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-[3px] border border-cream/15 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-cream/85 transition-colors hover:border-ember/50 hover:text-ember"
          >
            <RotateCcw size={12} />
            Reopen the booth
          </button>
        </div>
      </div>
    )
  }
}
