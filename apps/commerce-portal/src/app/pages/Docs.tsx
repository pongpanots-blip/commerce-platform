import { CodeBlock, Icon, Page, PageHeader, Panel, PanelHead, TBody, TD, TH, THead, TR, Table, UiSentence } from '@cp/ui';
import { api } from '../../lib/api';
import { Link } from 'react-router-dom';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ENDPOINTS: { method: string; path: string; description: string }[] = [
  { method: 'POST', path: '/v1/storefront/customers', description: 'Create/update customer (upsert by email or phone)' },
  { method: 'GET', path: '/v1/storefront/catalog/products', description: 'Product list (supports search, page, pageSize)' },
  { method: 'GET', path: '/v1/storefront/catalog/products/:id', description: 'Product details by id' },
  { method: 'POST', path: '/v1/storefront/checkout', description: 'Create order + reserve stock in one request (requires Idempotency-Key)' },
  { method: 'POST', path: '/v1/storefront/checkout/:orderId/payment-result', description: 'Report simulated payment result (paid/failed)' },
  { method: 'GET', path: '/v1/storefront/orders/:id', description: 'Order details + fulfillment status' },
  { method: 'GET', path: '/v1/storefront/orders', description: 'Order history for customer (requires customerId)' },
];

export function Docs() {
  __useUiLocale();
  const docsUrl = `${api.base}/docs`;
  const catalogUrl = new URL(`${api.base}/v1/storefront/catalog/products`, window.location.origin).href;

  return (
    <Page>
      <PageHeader
        title={__uiText("API Documentation")}
        subtitle={__uiText("Storefront endpoints for building against the Commerce Platform.")}
      />

      {/* Interactive Swagger */}
      <Panel className="mb-6">
        <PanelHead
          title={__uiText("Interactive API Explorer")}
          actions={
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-xs font-semibold hover:underline flex items-center gap-1"
            >
              {__uiText("Open Swagger ")}<Icon name="open_in_new" size={14} />
            </a>
          }
        />
        <div className="p-6 space-y-3">
          <p className="text-xs text-on-surface-variant">
            {__uiText("Try live requests at ")}<a href={docsUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono">{docsUrl}</a>
          </p>
          <p className="text-xs text-on-surface-variant">
            <UiSentence source="Before sending requests, add your API key from {0} to the {1} header." values={{
              '0': <Link to="/keys" className="text-primary hover:underline">{__uiText('API Keys')}</Link>,
              '1': <code className="font-mono bg-surface-container-low px-1.5 py-0.5 rounded text-[11px]">X-Api-Key</code>,
            }} />
          </p>
        </div>
      </Panel>

      {/* API Endpoints Reference */}
      <Panel>
        <PanelHead title={__uiText("Storefront Endpoints")} />
        <Table>
          <THead>
              <TH>{__uiText("Method")}</TH>
              <TH>{__uiText("Path")}</TH>
              <TH>{__uiText("Description")}</TH>
            </THead>
          <TBody>
            {ENDPOINTS.map((e) => (
              <TR key={`${e.method} ${e.path}`}>
                <TD>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-primary-container text-primary border border-outline-variant/30">
                    {e.method}
                  </span>
                </TD>
                <TD>
                  <code className="font-mono text-xs text-primary">{e.path}</code>
                </TD>
                <TD>
                  <span className="text-xs text-on-surface-variant">{__uiText(e.description)}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      {/* Authentication guide */}
      <div className="mt-6 space-y-6">
        <Panel>
          <PanelHead title={__uiText("Authentication")} />
          <div className="p-6 space-y-4">
            <div>
              <h3 className="font-headline font-semibold text-sm text-on-surface mb-2">{__uiText("X-Api-Key Header")}</h3>
              <p className="text-xs text-on-surface-variant mb-3">
                {__uiText("Include your API key in the X-Api-Key header of every request:")}</p>
              <CodeBlock
                title={__uiText("cURL example")}
                value={`curl -H "X-Api-Key: YOUR_API_KEY" "${catalogUrl}"`}
                maxHeight={180}
              />
            </div>
          </div>
        </Panel>

      </div>
    </Page>
  );
}
