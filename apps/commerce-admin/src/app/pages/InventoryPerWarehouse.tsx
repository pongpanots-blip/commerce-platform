import { useState } from 'react';
import { api, InventoryLevel, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

export function InventoryPerWarehouse() {
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, loading, error, reload } = useAsync<Paginated<InventoryLevel>>(
    () => {
      const qs = new URLSearchParams();
      if (selectedWarehouse) qs.set('warehouseId', selectedWarehouse);
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      return api.get<Paginated<InventoryLevel>>(`/inventory${qs.toString() ? '?' + qs.toString() : ''}`);
    },
    [selectedWarehouse, page],
  );

  // Extract unique warehouses from data
  const warehouses = Array.from(
    new Set(data?.items?.map((item: InventoryLevel) => item.warehouseId) || []),
  ).sort();

  const items = data?.items || [];
  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inventory per Warehouse</h1>
          <p>View inventory levels organized by warehouse.</p>
        </div>
        <button className="btn ghost" onClick={reload}>
          Refresh
        </button>
      </div>

      {error && <div style={{ padding: 16, background: '#fbe4e6', color: '#c2333f', borderRadius: 6, marginBottom: 16 }}>{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <div className="row">
            <label className="field">
              Warehouse
              <select value={selectedWarehouse} onChange={(e) => { setSelectedWarehouse(e.target.value); setPage(1); }}>
                <option value="">All warehouses</option>
                {warehouses.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span>
            <span>{total} items</span>{' '}
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </button>{' '}
            <span className="hint">
              {page} / {maxPage}
            </span>{' '}
            <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </span>
        </div>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : !items.length ? (
          <div className="empty">No inventory records found.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product ID</th>
                <th>Warehouse ID</th>
                <th>Available</th>
                <th>Reserved</th>
                <th>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: InventoryLevel) => {
                const qty = parseFloat(item.quantity) || 0;
                const res = parseFloat(item.reserved) || 0;
                const ratio = qty > 0 ? ((res / qty) * 100).toFixed(1) : '0';
                return (
                  <tr key={item.id}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {item.productId}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {item.warehouseId}
                    </td>
                    <td style={{ textAlign: 'right' }}>{qty}</td>
                    <td style={{ textAlign: 'right' }}>{res}</td>
                    <td style={{ textAlign: 'right' }}>{ratio}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {warehouses.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">Warehouses Summary</div>
          <table>
            <thead>
              <tr>
                <th>Warehouse</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((w) => {
                const count = data?.items?.filter((item: InventoryLevel) => item.warehouseId === w).length || 0;
                return (
                  <tr key={w}>
                    <td>{w}</td>
                    <td style={{ textAlign: 'right' }}>{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
