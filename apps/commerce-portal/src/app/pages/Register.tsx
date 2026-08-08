import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '../../lib/api';

export function Register() {
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
      await auth.register(email, password); // registers then auto-logs-in
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
        <h1>Create developer account</h1>
        <p>Register to get API keys and subscribe webhooks to platform events.</p>
        <form onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" required value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} placeholder="dev@example.com" />
          </label>
          <label className="field">
            Password
            <input type="password" required minLength={8} value={password} autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="btn" disabled={submitting}>{submitting ? 'Creating account…' : 'Register'}</button>
        </form>
        <div className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
