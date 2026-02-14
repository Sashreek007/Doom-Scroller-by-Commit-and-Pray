interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'board', label: 'Board', icon: '🏆' },
  { id: 'pals', label: 'Pals', icon: '👥' },
  { id: 'battle', label: 'Battle', icon: '⚔️' },
  { id: 'chat', label: 'Chat', icon: '🤖' },
];

interface BottomNavProps {
  active: string;
  onNavigate: (id: string) => void;
}

export default function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="flex items-center justify-around px-2 py-2 border-t border-doom-border bg-doom-bg">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all duration-200
            ${
              active === item.id
                ? 'text-neon-green'
                : 'text-doom-muted hover:text-white'
            }`}
        >
          <span className="text-lg">{item.icon}</span>
          <span
            className={`text-[10px] font-mono ${
              active === item.id ? 'neon-text-green' : ''
            }`}
          >
            {item.label}
          </span>
          {active === item.id && (
            <div className="w-4 h-0.5 bg-neon-green rounded-full shadow-neon-green" />
          )}
        </button>
      ))}
    </nav>
  );
}
