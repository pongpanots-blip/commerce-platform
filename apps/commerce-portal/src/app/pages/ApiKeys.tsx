import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Chip, ErrorText, Field, FormPanel, Icon, Input, Loading, Modal, Page, PageHeader, Panel, PanelHead, TBody, TD, TH, THead, TR, Table, fmt } from '@cp/ui';
import { keys, CreateKeyResponse } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function ApiKeys() {
  __useUiLocale();
  const { data, loading, error, reload } = useAsync(() => keys.list());
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useSearchParams();
  const creating = search.get('create') === '1';
  function closeCreate() { const next = new URLSearchParams(search); next.delete('create'); setSearch(next, { replace: true }); }

  async function submit() {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await keys.create(name);
      setName('');
      setCreated(res); // shown once — never fetchable again after this render
      setCopied(false);
      closeCreate();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await keys.revoke(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
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
        title={__uiText("API Keys")}
        subtitle={__uiText("Keys authenticate your server with the X-Api-Key header. Keep them secret.")}
        actions={<Button variant="primary" icon="add" onClick={() => setSearch({ create: '1' })}>{__uiText("Create API key")}</Button>}
      />

      {/* Success banner (one-time only) */}
      {created && (
        <Alert
          tone="ok"
          title={__uiText("New API Key Created")}
          onClose={() => setCreated(null)}
          actions={
            <button
              className="text-xs font-medium text-on-surface-variant hover:text-on-surface"
              onClick={() => setCreated(null)}
            >
              {__uiText("Dismiss")}</button>
          }
        >
          <div className="mt-2 space-y-3">
            <p className="text-xs text-on-surface-variant">{__uiText("Copy this key now — you won't see it again.")}</p>
            <div className="flex items-center gap-2">
              <input
                aria-label={__uiText("New API key")}
                type="text"
                readOnly
                value={created.fullKey}
                className="min-w-0 flex-1 bg-surface-container-low text-on-surface border border-outline-variant/30 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary select-all cursor-text"
              />
              <Button
                variant="primary"
                size="sm"
                icon={copied ? undefined : 'content_copy'}
                onClick={copyKey}
              >
                {copied ? __uiText("Copied") : __uiText("Copy")}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {/* Create key form */}
      {creating && <Modal title={__uiText("Create API key")} onClose={() => { if (!submitting) closeCreate(); }}>
        <FormPanel
          title={__uiText("Create a new key")}
          icon="add_circle"
          description={__uiText("Generate an API key to authenticate your requests")}
          cols={1}
          error={formError}
          submitLabel={submitting ? __uiText("Creating…") : __uiText("Create key")}
          busy={submitting}
          onSubmit={submit}
          onCancel={closeCreate}
        >
        <Field label={__uiText("Key Name")} hint={__uiText("e.g., Production Backend")}>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={__uiText("e.g., Production Backend")}
          />
        </Field>
        </FormPanel>
      </Modal>}

      {/* Keys table */}
      <ErrorText error={actionError} />
      <Panel>
        <PanelHead title={__uiText("Your API Keys")} />
        {error ? (
          <ErrorText error={error} />
        ) : loading ? (
          <Loading />
        ) : !data?.length ? (
          <div className="p-6"><p className="text-xs text-on-surface-variant">{__uiText("No API keys yet. Create one to get started.")}</p></div>
        ) : (
          <Table>
            <THead>
                <TH>{__uiText("Name")}</TH>
                <TH>{__uiText("Key prefix")}</TH>
                <TH>{__uiText("Scopes")}</TH>
                <TH>{__uiText("Created")}</TH>
                <TH>{__uiText("Last used")}</TH>
                <TH>{__uiText("Status")}</TH>
                <TH className="text-right">{__uiText("Actions")}</TH>
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
                    {k.lastUsedAt ? fmt.ago(k.lastUsedAt) : __uiText("Never")}
                  </TD>
                  <TD>
                    <Chip tone={k.active ? 'ok' : 'muted'}>
                      {k.active ? __uiText("Active") : __uiText("Revoked")}
                    </Chip>
                  </TD>
                  <TD className="text-right">
                    {k.active && (
                      <button
                        className="text-error hover:text-error-dim text-xs font-medium transition-colors hover:underline"
                        disabled={busyId === k.id}
                        onClick={() => revoke(k.id)}
                      >
                        {busyId === k.id ? '…' : __uiText("Revoke")}
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
        <span>{__uiText("Revocation can take up to 30 seconds while validation caches expire.")}</span>
      </div>
    </Page>
  );
}
