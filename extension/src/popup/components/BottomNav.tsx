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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01" />
      <path d="M12 10h.01" />
      <path d="M16 10h.01" />
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
  { id: 'chat', label: 'Chat' },
];

interface BottomNavProps {
  active: string;
  onNavigate: (id: string) => void;
}

export default function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="flex items-center justify-around px-2 py-2 border-t border-doom-border bg-doom-bg">
      {NAV_ITEMS.map((item) => {
        const Icon = icons[item.id];
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all duration-200
              ${isActive ? 'text-neon-green' : 'text-doom-muted hover:text-white'}`}
          >
            <Icon className="w-5 h-5" />
            <span
              className={`text-[10px] font-mono ${isActive ? 'neon-text-green' : ''}`}
            >
              {item.label}
            </span>
            {isActive && (
              <div className="w-4 h-0.5 bg-neon-green rounded-full shadow-neon-green" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
