import { useEffect, useRef, useState } from 'react';

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSwitchToSignUp: () => void;
  pendingVerificationEmail?: string | null;
}

function isNetworkErrorMsg(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed');
}

function toAuthErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || '';
    if (msg.toLowerCase().includes('email not verified')) {
      return 'Email not verified. Check inbox/spam for the verification email, open the link, then sign in.';
    }
    if (isNetworkErrorMsg(err)) {
      return 'Could not reach server. Office/school Wi-Fi may block required DNS. Connect to a personal hotspot and try again.';
    }
    return msg;
  }
  return 'Failed to sign in';
}

export default function Login({ onSignIn, onSwitchToSignUp, pendingVerificationEmail = null }: LoginProps) {
  const [email, setEmail] = useState(pendingVerificationEmail ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isNetworkErr, setIsNetworkErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const appliedPendingEmailRef = useRef<string | null>(pendingVerificationEmail ?? null);

  useEffect(() => {
    if (!pendingVerificationEmail) return;
    if (appliedPendingEmailRef.current === pendingVerificationEmail) return;
    setEmail(pendingVerificationEmail);
    appliedPendingEmailRef.current = pendingVerificationEmail;
  }, [pendingVerificationEmail]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    setIsNetworkErr(false);
    setLoading(true);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setIsNetworkErr(isNetworkErrorMsg(err));
      setError(toAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center pt-10 h-full px-8">
      <p className="text-5xl mb-2">💀</p>
      <h1 className="text-2xl font-bold font-mono neon-text-green mb-1">
        DoomScroller
      </h1>
      <p className="text-doom-muted text-xs mb-8">
        Track your shame in meters.
      </p>

      {pendingVerificationEmail && (
        <div
          className="w-full mb-4 bg-neon-green/10 border border-neon-green/30 rounded-lg px-3 py-2"
          role="status"
        >
          <p className="text-neon-green text-[11px] font-medium">
            Verification pending for {pendingVerificationEmail}
          </p>
          <p className="text-doom-muted text-[10px] mt-1">
            Open the email link, then sign in below with the same account.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div>
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
        </div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
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
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <p className="text-doom-muted text-xs mt-6">
        Don't have an account?{' '}
        <button
          onClick={onSwitchToSignUp}
          className="text-neon-cyan hover:underline"
        >
          Sign Up
        </button>
      </p>
    </div>
  );
}
