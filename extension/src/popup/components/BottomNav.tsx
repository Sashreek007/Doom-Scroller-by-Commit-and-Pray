const icons: Record<string, (props: { className?: string }) => JSX.Element> = {
  home: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l9-9 9 9" />
      <path d="M9 21V12h6v9" />
      <path d="M5 12v9h14v-9" />
    </svg>
  ),
  board: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
  pals: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  battle: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M14.5 6.5L18 3h3v3l-3.5 3.5" />
      <path d="M5 14l4 4" />
      <path d="M7 17l-3 3" />
    </svg>
  ),
  chat: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
      <path d="M8 16h8" />
    </svg>
  ),
};

interface NavItem {
  id: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'board', label: 'Board' },
  { id: 'pals', label: 'Pals' },
  { id: 'battle', label: 'Battle' },
  { id: 'chat', label: 'AI Chat' },
];

interface BottomNavProps {
  active: string;
  onNavigate: (id: string) => void;
  palsPendingCount?: number;
}

export default function BottomNav({ active, onNavigate, palsPendingCount = 0 }: BottomNavProps) {
  return (
    <nav className="flex items-center justify-around px-2 py-2 border-t border-doom-border bg-doom-bg">
      {NAV_ITEMS.map((item) => {
        const Icon = icons[item.id];
        const isActive = active === item.id;
        const hasPendingPals = item.id === 'pals' && palsPendingCount > 0;
        const textClass = hasPendingPals
          ? 'text-red-400'
          : isActive
            ? 'text-neon-green'
            : 'text-doom-muted hover:text-white';
        const labelClass = hasPendingPals
          ? 'text-red-400'
          : isActive
            ? 'neon-text-green'
            : '';
        const activeBarClass = hasPendingPals
          ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]'
          : 'bg-neon-green shadow-neon-green';

        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all duration-200 ${textClass}`}
          >
            <Icon className="w-5 h-5" />
            {hasPendingPals && (
              <span className="absolute top-0 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] leading-4 font-mono">
                {palsPendingCount > 99 ? '99+' : palsPendingCount}
              </span>
            )}
            <span
              className={`text-[10px] font-mono ${labelClass}`}
            >
              {item.label}
            </span>
            {isActive && (
              <div className={`w-4 h-0.5 rounded-full ${activeBarClass}`} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
