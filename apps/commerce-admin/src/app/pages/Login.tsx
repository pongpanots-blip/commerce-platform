import { homeForRole } from '../../lib/role-home';
import { useState } from 'react';
import { Button, Field, FormPanel, Hint, Input, Icon, LanguageSelector } from '@cp/ui';
import { login } from '../../lib/api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  __useUiLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      window.history.replaceState(null, '', homeForRole(result.role));
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <LanguageSelector className="absolute right-4 top-4" />
      <FormPanel
        title={__uiText("Commerce Platform")}
        icon="hub"
        description={__uiText("Admin console")}
        cols={1}
        error={error}
        submitLabel={__uiText("Sign in")}
        busy={busy}
        onSubmit={handleSubmit}
      >
        <Field label={__uiText("Email")}>
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={__uiText("admin@example.com")}
          />
        </Field>
        <Field label={__uiText("Password")}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Hint>{__uiText("ยังไม่มีบัญชี? ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เข้าใช้งาน")}</Hint>
      </FormPanel>
    </div>
  );
}
