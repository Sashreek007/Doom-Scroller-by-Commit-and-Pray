import type { Achievement, AchievementRarity } from '@/shared/types';

type BadgeMotif =
  | 'sprint'
  | 'specialist'
  | 'diversity'
  | 'marathon'
  | 'distance'
  | 'streak'
  | 'night'
  | 'focus';

interface AchievementBadgeArtProps {
  achievement: Achievement;
  rarity: AchievementRarity;
  size?: 'sm' | 'lg';
  className?: string;
}

function getMetaTags(meta: Achievement['meta']): string[] {
  if (!meta || typeof meta !== 'object') return [];
  const tags = (meta as Record<string, unknown>).tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => String(tag).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 12);
}

function detectMotif(achievement: Achievement): BadgeMotif {
  const tags = getMetaTags(achievement.meta);
  const text = [
    achievement.event_key ?? '',
    achievement.trigger_type ?? '',
    achievement.title ?? '',
    achievement.description ?? '',
    achievement.app_scope ?? '',
    tags.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  if (/\bburst|sprint|speed|rapid|lightning|quick\b/.test(text)) return 'sprint';
  if (/\bspecialist|loyal|focus|single|mono\b/.test(text)) return 'specialist';
  if (/\bdiversity|multi|tourist|variety|mix\b/.test(text)) return 'diversity';
  if (/\bmarathon|session|endurance|long\b/.test(text)) return 'marathon';
  if (/\bstreak|consecutive|daily|days\b/.test(text)) return 'streak';
  if (/\bnight|late|midnight|owl\b/.test(text)) return 'night';
  if (/\bdistance|meter|meters|scroll|regret\b/.test(text)) return 'distance';
  return 'focus';
}

function getRarityBorderColor(rarity: AchievementRarity): string {
  if (rarity === 'legendary') return '#f59e0b';
  if (rarity === 'epic') return '#22d3ee';
  if (rarity === 'rare') return '#39ff14';
  return '#475569';
}

function getMotifPalette(motif: BadgeMotif): [string, string, string] {
  if (motif === 'sprint') return ['#f43f5e', '#fb7185', '#120d14'];
  if (motif === 'specialist') return ['#14b8a6', '#5eead4', '#0c1414'];
  if (motif === 'diversity') return ['#f59e0b', '#facc15', '#16120c'];
  if (motif === 'marathon') return ['#38bdf8', '#7dd3fc', '#0b1218'];
  if (motif === 'distance') return ['#a78bfa', '#c4b5fd', '#120f18'];
  if (motif === 'streak') return ['#22c55e', '#86efac', '#0d1510'];
  if (motif === 'night') return ['#6366f1', '#818cf8', '#0f1020'];
  return ['#e879f9', '#f0abfc', '#150f19'];
}

function motifShape(motif: BadgeMotif): JSX.Element {
  if (motif === 'sprint') {
    return <path d="M56 14L32 52h22l-8 34 30-46H54l2-26z" />;
  }
  if (motif === 'specialist') {
    return (
      <>
        <circle cx="50" cy="50" r="26" fill="none" strokeWidth="6" />
        <circle cx="50" cy="50" r="12" fill="none" strokeWidth="6" />
        <circle cx="50" cy="50" r="4" />
      </>
    );
  }
  if (motif === 'diversity') {
    return (
      <>
        <circle cx="28" cy="32" r="7" />
        <circle cx="72" cy="28" r="7" />
        <circle cx="24" cy="70" r="7" />
        <circle cx="66" cy="68" r="7" />
        <path d="M28 32l44-4M28 32l-4 38M72 28L66 68M24 70l42-2" fill="none" strokeWidth="5" />
      </>
    );
  }
  if (motif === 'marathon') {
    return (
      <>
        <path d="M18 50c0-14 10-24 24-24s24 10 24 24-10 24-24 24S18 64 18 50z" fill="none" strokeWidth="5" />
        <path d="M58 50c0-14 10-24 24-24" fill="none" strokeWidth="5" />
        <path d="M58 50c0 14 10 24 24 24" fill="none" strokeWidth="5" />
      </>
    );
  }
  if (motif === 'streak') {
    return (
      <>
        <rect x="22" y="54" width="12" height="24" rx="3" />
        <rect x="40" y="42" width="12" height="36" rx="3" />
        <rect x="58" y="28" width="12" height="50" rx="3" />
        <path d="M20 30h10l6-10 8 16 8-12 8 6h10" fill="none" strokeWidth="5" />
      </>
    );
  }
  if (motif === 'night') {
    return (
      <>
        <path d="M60 18a28 28 0 1 0 22 44A22 22 0 1 1 60 18z" />
        <path d="M26 22l4 8 8 4-8 4-4 8-4-8-8-4 8-4z" />
      </>
    );
  }
  if (motif === 'distance') {
    return (
      <>
        <path d="M14 74l18-24 12 14 16-22 26 32H14z" />
        <path d="M18 78h64" fill="none" strokeWidth="5" />
        <circle cx="78" cy="30" r="7" />
      </>
    );
  }

  return (
    <>
      <path d="M50 14L88 50 50 86 12 50 50 14z" fill="none" strokeWidth="6" />
      <circle cx="50" cy="50" r="12" />
      <path d="M34 50h32M50 34v32" fill="none" strokeWidth="5" />
    </>
  );
}

export default function AchievementBadgeArt({
  achievement,
  rarity,
  size = 'sm',
  className = '',
}: AchievementBadgeArtProps) {
  const motif = detectMotif(achievement);
  const rarityBorder = getRarityBorderColor(rarity);
  const [motifPrimary, motifSecondary, motifBg] = getMotifPalette(motif);
  const scale = size === 'lg' ? 76 : 58;
  const background = `linear-gradient(180deg, ${motifBg} 0%, #0a0f15 100%)`;

  return (
    <div
      className={`relative rounded-xl border overflow-hidden ${className}`}
      style={{
        width: scale,
        height: scale,
        backgroundImage: background,
        borderColor: `${rarityBorder}88`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 6px 14px rgba(0,0,0,0.35)',
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      />
      <div
        className="absolute inset-[2px] rounded-[10px] border pointer-events-none"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full"
        style={{
          color: motifPrimary,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))',
        }}
      >
        <g
          fill={`${motifSecondary}aa`}
          stroke={motifPrimary}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeWidth={5}
        >
          {motifShape(motif)}
        </g>
      </svg>
      <div
        className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
        style={{ backgroundColor: rarityBorder }}
      />
    </div>
  );
}
