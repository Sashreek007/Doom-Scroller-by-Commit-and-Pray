import { useEffect, useState } from 'react';

interface UserAvatarProps {
  avatarUrl?: string | null;
  displayName?: string;
  sizeClass?: string;
  className?: string;
  iconClassName?: string;
}

export default function UserAvatar({
  avatarUrl,
  displayName = 'User',
  sizeClass = 'w-8 h-8',
  className = '',
  iconClassName = 'text-lg',
}: UserAvatarProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [avatarUrl]);

  return (
    <div
      className={`${sizeClass} rounded-full overflow-hidden bg-doom-surface border border-doom-border flex items-center justify-center shrink-0 ${className}`.trim()}
    >
      {avatarUrl && !broken ? (
        <img
          src={avatarUrl}
          alt={`${displayName} profile picture`}
          className="w-full h-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={iconClassName}>💀</span>
      )}
    </div>
  );
}
