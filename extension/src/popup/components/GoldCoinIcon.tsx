interface GoldCoinIconProps {
  className?: string;
}

export default function GoldCoinIcon({ className = 'w-4 h-4' }: GoldCoinIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="doomscroller-coin-grad" cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff2a8" />
          <stop offset="48%" stopColor="#ffd84f" />
          <stop offset="100%" stopColor="#d89c00" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#doomscroller-coin-grad)" stroke="#f5c542" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="#f8e18a" strokeWidth="1.2" opacity="0.9" />
      <ellipse cx="8.2" cy="7.6" rx="2.1" ry="1.3" fill="#fff6c7" opacity="0.85" />
    </svg>
  );
}
