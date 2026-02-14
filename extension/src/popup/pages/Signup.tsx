import { useState } from 'react';

interface SignupProps {
  onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
  onSwitchToLogin: () => void;
}

export default function Signup({ onSignUp, onSwitchToLogin }: SignupProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (displayName.length < 2) {
      setError('Display name must be at least 2 characters');
      return;
    }

    setLoading(true);
    try {
      await onSignUp(email, password, displayName);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8">
        <p className="text-5xl mb-4">✅</p>
        <h2 className="text-lg font-bold font-mono neon-text-green mb-2">
          Almost there!
        </h2>
        <p className="text-doom-muted text-xs text-center mb-6">
          Check your email to confirm your account, then sign in.
        </p>
        <button onClick={onSwitchToLogin} className="btn-primary text-sm">
          Go to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
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
        <input
          type="password"
          placeholder="Password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3
                     text-white placeholder-doom-muted text-sm
                     focus:outline-none focus:border-neon-green/50 transition-colors"
        />
        <input
          type="password"
          placeholder="Confirm Password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="w-full bg-doom-surface border border-doom-border rounded-lg px-4 py-3
                     text-white placeholder-doom-muted text-sm
                     focus:outline-none focus:border-neon-green/50 transition-colors"
        />

        {error && (
          <p className="text-neon-pink text-xs text-center">{error}</p>
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
