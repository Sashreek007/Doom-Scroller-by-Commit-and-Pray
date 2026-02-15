import { useState } from 'react';
import {
  STRONG_PASSWORD_REQUIREMENTS,
  validateStrongPassword,
} from '@/shared/password-policy';

interface SignupProps {
  onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
  onSwitchToLogin: () => void;
}

function isNetworkErrorMsg(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
}

function toAuthErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || '';
    if (isNetworkErrorMsg(err)) {
      return 'Could not reach server. Office/school Wi-Fi may block required DNS. Connect to a personal hotspot and try again.';
    }
    return msg;
  }
  return 'Failed to sign up';
}

export default function Signup({ onSignUp, onSwitchToLogin }: SignupProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isNetworkErr, setIsNetworkErr] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    setIsNetworkErr(false);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordValidation = validateStrongPassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message);
      return;
    }

    if (displayName.length < 2) {
      setError('Display name must be at least 2 characters');
      return;
    }

    setLoading(true);
    try {
      await onSignUp(email, password, displayName);
    } catch (err) {
      setIsNetworkErr(isNetworkErrorMsg(err));
      setError(toAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center pt-8 h-full px-8">
      <p className="text-5xl mb-2">💀</p>
      <h1 className="text-2xl font-bold font-mono neon-text-green mb-1">
        Join the Doom
      </h1>
      <p className="text-doom-muted text-xs mb-6">
        Your scrolling shame starts here.
      </p>

      <form onSubmit={handleSubmit} className="w-full space-y-3">
        <input
          type="text"
          placeholder="Display Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3
                     text-white placeholder-doom-muted text-sm
                     focus:outline-none focus:border-neon-green/50 transition-colors"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3
                     text-white placeholder-doom-muted text-sm
                     focus:outline-none focus:border-neon-green/50 transition-colors"
        />
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3 pr-10
                       text-white placeholder-doom-muted text-sm
                       focus:outline-none focus:border-neon-green/50 transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-doom-muted hover:text-white text-xs transition-colors"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-[11px] text-doom-muted leading-relaxed -mt-1">
          {STRONG_PASSWORD_REQUIREMENTS}
        </p>
        <input
          type={showPassword ? 'text' : 'password'}
          placeholder="Confirm Password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3
                     text-white placeholder-doom-muted text-sm
                     focus:outline-none focus:border-neon-green/50 transition-colors"
        />

        {error && (
          <div className="text-center space-y-2">
            <p className="text-neon-pink text-xs">{error}</p>
            {isNetworkErr && (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={loading}
                className="text-neon-cyan text-xs hover:underline disabled:opacity-50"
              >
                Tap to retry
              </button>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full btn-primary py-3 font-bold text-sm disabled:opacity-50"
        >
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>

      <p className="text-doom-muted text-xs mt-4">
        Already have an account?{' '}
        <button
          onClick={onSwitchToLogin}
          className="text-neon-cyan hover:underline"
        >
          Sign In
        </button>
      </p>
    </div>
  );
}
