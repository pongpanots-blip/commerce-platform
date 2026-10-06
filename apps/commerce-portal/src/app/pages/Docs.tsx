import { CodeBlock, Icon, Page, PageHeader, Panel, PanelHead, TBody, TD, TH, THead, TR, Table } from '@cp/ui';
import { api } from '../../lib/api';

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
  const docsUrl = `${api.base}/docs`;

  return (
    <Page>
      <PageHeader
        title="API Documentation"
        subtitle="Storefront endpoints for building against the Commerce Platform."
      />

      {/* Interactive Swagger */}
      <Panel className="mb-6">
        <PanelHead
          title="Interactive API Explorer"
          actions={
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary text-xs font-semibold hover:underline flex items-center gap-1"
            >
              Open Swagger <Icon name="open_in_new" size={14} />
            </a>
          }
        />
        <div className="p-6 space-y-3">
          <p className="text-xs text-on-surface-variant">
            Try live requests at <a href={docsUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono">{docsUrl}</a>
          </p>
          <p className="text-xs text-on-surface-variant">
            Before sending requests, add your API key from the <a href="/keys" className="text-primary hover:underline">API Keys</a> page to the <code className="font-mono bg-surface-container-low px-1.5 py-0.5 rounded text-[11px]">X-Api-Key</code> header.
          </p>
        </div>
      </Panel>

      {/* API Endpoints Reference */}
      <Panel>
        <PanelHead title="Storefront Endpoints" />
        <Table>
          <THead>
            <TR>
              <TH>Method</TH>
              <TH>Path</TH>
              <TH>Description</TH>
            </TR>
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
                  <span className="text-xs text-on-surface-variant">{e.description}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      {/* Authentication guide */}
      <div className="mt-6 space-y-6">
        <Panel>
          <PanelHead title="Authentication" />
          <div className="p-6 space-y-4">
            <div>
              <h3 className="font-headline font-semibold text-sm text-on-surface mb-2">X-Api-Key Header</h3>
              <p className="text-xs text-on-surface-variant mb-3">
                Include your API key in the X-Api-Key header of every request:
              </p>
              <CodeBlock
                title="cURL example"
                value='curl -X GET "https://api.commerceplatform.io/v1/storefront/orders" \\\n  -H "X-Api-Key: cp_live_YOUR_KEY_HERE"'
                maxHeight={180}
              />
            </div>
          </div>
        </Panel>

      </div>
    </Page>
  );
}
