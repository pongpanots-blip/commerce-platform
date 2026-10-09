import { useState } from 'react';
import { Button, Field, FormPanel, Hint, Input, Icon, LanguageSelector } from '@cp/ui';
import { login, registerStaff } from '../../lib/api';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function Login({ onSignedIn }: { onSignedIn: (role: string) => void }) {
  __useUiLocale();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const registering = mode === 'register';

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      if (registering) {
        if (!email.trim().toLowerCase().endsWith('@jagota.co.th')) throw new Error(__uiText("ใช้อีเมล @jagota.co.th เท่านั้น"));
        await registerStaff(email, password);
        setPassword('');
        setMode('login');
        setNotice(__uiText("สมัครแล้ว — รอผู้ดูแลระบบเปิดบัญชีก่อนจึงจะเข้าสู่ระบบได้"));
      } else {
        const { role } = await login(email, password);
        onSignedIn(role);
      }
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
        description={registering ? __uiText("สมัครบัญชีทีมงาน") : __uiText("Admin console")}
        cols={1}
        error={error}
        submitLabel={registering ? __uiText("Register") : __uiText("Sign in")}
        busy={busy}
        onSubmit={handleSubmit}
      >
        {notice && <Hint><Icon name="check_circle" size={16} /> {notice}</Hint>}
        <Field label={__uiText("Email")}>
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={registering ? 'name@jagota.co.th' : __uiText("admin@example.com")}
          />
        </Field>
        <Field label={__uiText("Password")} hint={registering ? __uiText("อย่างน้อย 10 ตัวอักษร") : undefined}>
          <Input
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={registering ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Hint>
          {registering ? __uiText("มีบัญชีแล้ว?") : __uiText("No account yet?")}{' '}
          <Button type="button" size="sm" variant="ghost" onClick={() => switchMode(registering ? 'login' : 'register')}>
            {registering ? __uiText("Sign in") : __uiText("สมัครด้วยอีเมล @jagota.co.th")}
          </Button>
        </Hint>
      </FormPanel>
    </div>
  );
}
