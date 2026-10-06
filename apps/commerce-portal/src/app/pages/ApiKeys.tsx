import { useState } from 'react';
import { Alert, Button, Chip, ErrorText, Field, FormPanel, Icon, Input, Loading, Page, PageHeader, Panel, PanelHead, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { keys, CreateKeyResponse } from '../../lib/api';
import { useAsync } from '../hooks';

export function ApiKeys() {
  const { data, loading, error, reload } = useAsync(() => keys.list());
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await keys.create(name);
      setName('');
      setCreated(res); // shown once — never fetchable again after this render
      setCopied(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await keys.revoke(id);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.fullKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Page>
      <PageHeader
        title="API Keys"
        subtitle="Keys authenticate your server with the X-Api-Key header. Keep them secret."
      />

      {/* Success banner (one-time only) */}
      {created && (
        <Alert
          tone="ok"
          title="New API Key Created"
          onClose={() => setCreated(null)}
          actions={
            <button
              className="text-xs font-medium text-on-surface-variant hover:text-on-surface"
              onClick={() => setCreated(null)}
            >
              Dismiss
            </button>
          }
        >
          <div className="mt-2 space-y-3">
            <p className="text-xs text-on-surface-variant">Copy this key now — you won't see it again.</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={created.fullKey}
                className="flex-1 bg-surface-container-low text-on-surface border border-outline-variant/30 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary select-all cursor-text"
              />
              <Button
                variant="primary"
                size="sm"
                icon={copied ? undefined : 'content_copy'}
                onClick={copyKey}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {/* Create key form */}
      <div className="mb-6">
        <FormPanel
          title="Create a new key"
          icon="add_circle"
          description="Generate an API key to authenticate your requests"
          cols={1}
          error={formError}
          submitLabel={submitting ? 'Creating…' : 'Create key'}
          busy={submitting}
          onSubmit={submit}
        >
        <Field label="Key Name" hint="e.g., Production Backend">
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Production Backend"
          />
        </Field>
        </FormPanel>
      </div>

      {/* Keys table */}
      <Panel>
        <PanelHead title="Your API Keys" />
        {error ? (
          <ErrorText error={error} />
        ) : loading ? (
          <Loading />
        ) : !data?.length ? (
          <div className="p-6"><p className="text-xs text-on-surface-variant">No API keys yet. Create one to get started.</p></div>
        ) : (
          <Table>
            <THead>
                <TH>Name</TH>
                <TH>Key prefix</TH>
                <TH>Scopes</TH>
                <TH>Created</TH>
                <TH>Last used</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </THead>
            <TBody>
              {data.map((k) => (
                <TR key={k.id} muted={!k.active}>
                  <TD>
                    <span className="font-medium text-on-surface">{k.name}</span>
                  </TD>
                  <TD>
                    <code className="font-mono text-xs text-on-surface-variant">{k.keyPrefix}…</code>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {k.scope.split(',').map((s) => (
                        <Chip key={s} tone="primary">{s.trim()}</Chip>
                      ))}
                    </div>
                  </TD>
                  <TD className="text-on-surface-variant text-xs whitespace-nowrap tabular-nums">
                    {fmt.date(k.createdAt)}
                  </TD>
                  <TD className="text-on-surface-variant text-xs whitespace-nowrap tabular-nums">
                    {k.lastUsedAt ? fmt.ago(k.lastUsedAt) : 'Never'}
                  </TD>
                  <TD>
                    <Chip tone={k.active ? 'ok' : 'muted'}>
                      {k.active ? 'Active' : 'Revoked'}
                    </Chip>
                  </TD>
                  <TD className="text-right">
                    {k.active && (
                      <button
                        className="text-error hover:text-error-dim text-xs font-medium transition-colors hover:underline"
                        disabled={busyId === k.id}
                        onClick={() => revoke(k.id)}
                      >
                        {busyId === k.id ? '…' : 'Revoke'}
                      </button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {/* Footer hint */}
      <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-4">
        <Icon name="info" size={16} />
        <span>Revoked keys stop working immediately.</span>
      </div>
    </Page>
  );
}
