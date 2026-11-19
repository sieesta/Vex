import { AlertTriangle, ExternalLink, Sparkles, X } from 'lucide-react'

const PLATFORM_NAMES = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
  reddit: 'Reddit',
  google: 'Google',
  github: 'GitHub',
  spotify: 'Spotify',
  linkedin: 'LinkedIn',
  chatgpt: 'ChatGPT',
}

const TONES = {
  error: {
    icon: AlertTriangle,
    frame: 'border-[#ff5a45]/30 bg-[#ff5a45]/[0.06]',
    edge: '#ff5a45',
    text: 'text-[#ffd2c8]',
    iconColor: 'text-[#ff8a72]',
  },
  warning: {
    icon: AlertTriangle,
    frame: 'border-[#f6c177]/30 bg-[#f6c177]/[0.05]',
    edge: '#f6c177',
    text: 'text-[#ffe4b8]',
    iconColor: 'text-[#f6c177]',
  },
  info: {
    icon: Sparkles,
    frame: 'border-acid/25 bg-acid/[0.05]',
    edge: '#c8e06a',
    text: 'text-[#e7f2bd]',
    iconColor: 'text-acid',
  },
}

export function SearchLinkCard({ link, onDismiss }) {
  if (!link) return null
  const name = PLATFORM_NAMES[link.platform] || 'the page'

  return (
    <div className="animate-fade-in mt-3 flex w-full max-w-md items-center gap-3 rounded-[4px] border border-acid/25 border-l-2 border-l-acid bg-acid/[0.05] px-4 py-2.5">
      <ExternalLink size={14} className="shrink-0 text-acid" />
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-snug text-[#e7f2bd]">
          Popup blocked — open {name} here instead.
        </p>
        <p className="truncate font-mono text-[9px] text-acid/60">{link.url}</p>
      </div>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-full border border-acid/30 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-acid transition-colors hover:bg-acid/10"
      >
        open
      </a>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss link"
        className="grid size-5 shrink-0 place-items-center rounded-[2px] text-faint transition-colors hover:bg-cream/10 hover:text-cream"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function NoticeBanner({ notice, onDismiss }) {
  if (!notice) return null
  const tone = TONES[notice.tone] || TONES.info
  const Icon = tone.icon

  return (
    <div
      role="status"
      className={`animate-fade-in mt-3 flex items-start gap-3 rounded-[4px] border border-l-2 px-4 py-3 ${tone.frame}`}
      style={{ borderLeftColor: tone.edge }}
    >
      <Icon size={15} className={`mt-0.5 shrink-0 ${tone.iconColor}`} />
      <p className={`min-w-0 flex-1 text-[11.5px] leading-relaxed ${tone.text}`}>{notice.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="grid size-5 shrink-0 place-items-center rounded-[2px] text-faint transition-colors hover:bg-cream/10 hover:text-cream"
      >
        <X size={12} />
      </button>
    </div>
  )
}
