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

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
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

function getRarityPalette(rarity: AchievementRarity): [string, string] {
  if (rarity === 'legendary') return ['#f59e0b', '#f97316'];
  if (rarity === 'epic') return ['#06b6d4', '#3b82f6'];
  if (rarity === 'rare') return ['#39ff14', '#22c55e'];
  return ['#64748b', '#334155'];
}

function getMotifPalette(motif: BadgeMotif): [string, string] {
  if (motif === 'sprint') return ['#fb7185', '#f43f5e'];
  if (motif === 'specialist') return ['#2dd4bf', '#14b8a6'];
  if (motif === 'diversity') return ['#f59e0b', '#f97316'];
  if (motif === 'marathon') return ['#38bdf8', '#60a5fa'];
  if (motif === 'distance') return ['#a78bfa', '#c084fc'];
  if (motif === 'streak') return ['#22c55e', '#84cc16'];
  if (motif === 'night') return ['#0ea5e9', '#6366f1'];
  return ['#f472b6', '#8b5cf6'];
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
  const [r1, r2] = getRarityPalette(rarity);
  const [m1, m2] = getMotifPalette(motif);
  const seed = hashString(`${achievement.id}:${achievement.event_key ?? achievement.title}`);
  const hueShift = seed % 20;
  const scale = size === 'lg' ? 76 : 58;
  const dotCount = 4 + (seed % 4);

  const dots = Array.from({ length: dotCount }).map((_, index) => {
    const step = index + 1;
    const x = 12 + ((seed * (step * 11)) % 76);
    const y = 10 + ((seed * (step * 17)) % 80);
    const r = 1.5 + (seed % (step + 3));
    return <circle key={`${achievement.id}-dot-${index}`} cx={x} cy={y} r={Math.min(r, 4)} />;
  });

  const background = `radial-gradient(circle at 20% 16%, ${m1}99 0%, ${m1}33 34%, transparent 60%), radial-gradient(circle at 82% 88%, ${m2}88 0%, ${m2}2a 36%, transparent 62%), radial-gradient(circle at 55% 18%, ${r1}66 0%, transparent 45%), linear-gradient(155deg, #080e17 0%, #111a2b 52%, #090f1a 100%)`;

  return (
    <div
      className={`relative rounded-xl border border-white/10 overflow-hidden ${className}`}
      style={{
        width: scale,
        height: scale,
        backgroundImage: background,
        boxShadow: `inset 0 0 0 1px ${r1}55, 0 8px 20px rgba(0,0,0,0.35), 0 0 20px ${m1}38, 0 0 12px ${r2}2e`,
      }}
    >
      <div
        className="absolute inset-[3px] rounded-[10px] border pointer-events-none"
        style={{ borderColor: `${r2}66` }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${110 + hueShift}deg, transparent 18%, ${m2}40 46%, ${r1}36 60%, transparent 82%)`,
        }}
      />
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full"
        style={{
          color: m1,
          filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.4))',
        }}
      >
        <g fill={`${m2}aa`}>{dots}</g>
        <g
          fill="currentColor"
          stroke={`${r1}dd`}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {motifShape(motif)}
        </g>
      </svg>
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_56%)]" />
    </div>
  );
}
