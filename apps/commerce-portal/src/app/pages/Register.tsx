import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ErrorText, Field, Icon, Input, LanguageSelector } from '@cp/ui';
import { ApiError, auth } from '../../lib/api';
import { landingFor } from '../../lib/landing';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";

/** 403 = self-registration is off (PORTAL_SELF_REGISTER); a catalogue key, so ErrorText shows it in TH/EN. */
const SELF_REGISTER_DISABLED = 'Self-registration is disabled; contact the Commerce Platform team for a developer account';

export function Register() {
  __useUiLocale();
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
      const role = await auth.register(email, password); // registers then auto-logs-in
      navigate(landingFor(role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError(SELF_REGISTER_DISABLED);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <LanguageSelector className="absolute right-4 top-4" />
      <div className="w-full max-w-md">
        {/* Brand section */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-on-primary">
              <Icon name="polyline" size={24} />
            </div>
            <div className="text-left">
              <div className="font-headline text-lg font-semibold text-on-surface">{__uiText("Commerce Platform")}</div>
              <div className="text-xs text-on-surface-variant">{__uiText("Developer portal")}</div>
            </div>
          </div>
          <h1 className="font-headline text-2xl font-semibold text-on-surface">{__uiText("Create account")}</h1>
          <p className="text-sm text-on-surface-variant mt-1">{__uiText("Get API keys and subscribe to webhooks")}</p>
        </div>

        {/* Form card */}
        <form
          onSubmit={submit}
          className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 space-y-4"
        >
          <Field label={__uiText("Email")} hint={__uiText("Your account email")}>
            <Input
              type="email"
              required
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              placeholder={__uiText("dev@example.com")}
            />
          </Field>

          <Field label={__uiText("Password")} hint={__uiText("At least 8 characters")}>
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          {error && <ErrorText error={error} />}

          <Button
            variant="primary"
            className="w-full"
            disabled={submitting}
            type="submit"
          >
            {submitting ? __uiText("Creating account…") : __uiText("Register")}
          </Button>
        </form>

        {/* Sign in link */}
        <div className="text-center mt-4">
          <span className="text-sm text-on-surface-variant">
            {__uiText("Already have an account? ")}<Link to="/login" className="text-primary font-semibold hover:underline">{__uiText("Sign in")}</Link>
          </span>
        </div>
      </div>
    </div>
  );
}
