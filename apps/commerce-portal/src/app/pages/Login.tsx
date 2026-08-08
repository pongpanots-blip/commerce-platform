import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '../../lib/api';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await auth.login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Developer portal</h1>
        <p>Sign in to manage your API keys and webhooks.</p>
        <form onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" required value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} placeholder="dev@example.com" />
          </label>
          <label className="field">
            Password
            <input type="password" required value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="btn" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="auth-switch">
          No account yet? <Link to="/register">Register</Link>
        </div>
      </div>
    </div>
  );
}
