import { useState } from 'react';

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSwitchToSignUp: () => void;
}

export default function Login({ onSignIn, onSwitchToSignUp }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <p className="text-5xl mb-2">💀</p>
      <h1 className="text-2xl font-bold font-mono neon-text-green mb-1">
        DoomScroller
      </h1>
      <p className="text-doom-muted text-xs mb-8">
        Track your shame in meters.
      </p>

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
        <div>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3
                       text-white placeholder-doom-muted text-sm
                       focus:outline-none focus:border-neon-green/50 transition-colors"
          />
        </div>

        {error && (
          <p className="text-neon-pink text-xs text-center">{error}</p>
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
