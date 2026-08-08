import { api } from '../../lib/api';

const ENDPOINTS: { method: string; path: string; description: string }[] = [
  { method: 'POST', path: '/v1/storefront/customers', description: 'สร้าง/อัปเดตลูกค้า (upsert ตาม email หรือ phone)' },
  { method: 'GET', path: '/v1/storefront/catalog/products', description: 'รายการสินค้า (รองรับ search, page, pageSize)' },
  { method: 'GET', path: '/v1/storefront/catalog/products/:id', description: 'รายละเอียดสินค้าตาม id' },
  { method: 'POST', path: '/v1/storefront/checkout', description: 'สร้าง order + จองสต๊อกในคำขอเดียว (ต้องมี Idempotency-Key)' },
  { method: 'POST', path: '/v1/storefront/checkout/:orderId/payment-result', description: 'แจ้งผลชำระเงินจำลอง (paid/failed) ของ order' },
  { method: 'GET', path: '/v1/storefront/orders/:id', description: 'ดูรายละเอียด order + สถานะการจัดส่งแต่ละบรรทัด' },
  { method: 'GET', path: '/v1/storefront/orders', description: 'ประวัติ order ของลูกค้า (ต้องระบุ customerId)' },
];

export function Docs() {
  const docsUrl = `${api.base}/docs`;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>API documentation</h1>
          <p>Storefront endpoints for building against the Commerce Platform.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          Interactive docs (Swagger)
          <a className="btn" href={docsUrl} target="_blank" rel="noreferrer">เปิด Swagger UI</a>
        </div>
        <div style={{ padding: 16 }}>
          <p className="hint">
            ทดลองยิง request ได้จริงที่ <a href={docsUrl} target="_blank" rel="noreferrer">{docsUrl}</a> —
            ให้ใส่ X-Api-Key จากหน้า <a href="/keys">API Keys</a> ก่อนกด Try it out
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">Storefront endpoints</div>
        <table>
          <thead>
            <tr><th>Method</th><th>Path</th><th>คำอธิบายสั้น</th></tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={`${e.method} ${e.path}`}>
                <td><span className="badge">{e.method}</span></td>
                <td className="mono">{e.path}</td>
                <td>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
