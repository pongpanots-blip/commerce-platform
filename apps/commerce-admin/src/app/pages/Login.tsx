import { useState } from 'react';
import { Button, Field, FormPanel, Hint, Input, Icon } from '@cp/ui';
import { login } from '../../lib/api';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <FormPanel
        title="Commerce Platform"
        icon="hub"
        description="Admin console"
        cols={1}
        error={error}
        submitLabel="Sign in"
        busy={busy}
        onSubmit={handleSubmit}
      >
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Hint>No account? Ask an admin to run <code className="font-mono text-[11px]">npm run create-staff</code>.</Hint>
      </FormPanel>
    </div>
  );
}
