import { Alert, BarList, Button, Empty, ErrorText, Loading, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, fmt, uiText } from '@cp/ui';
import { inventoryOverviewApi, joshAdmin, joshProductApi, reportsApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { commerceText as text } from '../commerce-copy';
import { TaskLinks, WorkspaceLink, WorkspaceMetric } from '../WorkspaceParts';
import { MarketingHomeSummary } from './MarketingHomeSummary';
type Copy = [string, string];
const noSummary: Copy = ['ยังไม่มีข้อมูลสรุปที่ยืนยันได้ เปิดรายการที่เกี่ยวข้องด้านล่างเพื่อตรวจสอบ', 'A verified summary is unavailable. Open the related records below.'];
export const finiteValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export const countValue = (value: unknown) => { const n = finiteValue(value); return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined; };
export function catalogPriceCoverage(total: unknown, missing: unknown) {
  const t = countValue(total), m = countValue(missing);
  return t !== undefined && m !== undefined && m <= t ? { present: t - m, total: t } : undefined;
}
export function sampleHomeRows(answer: unknown): Record<string, unknown>[] {
  let value = answer;
  for (let depth = 0; depth < 3; depth++) {
    if (Array.isArray(value)) {
      if (!value.every(row => row && typeof row === 'object' && typeof row.id === 'string' && typeof row.status === 'string')) throw new Error('Invalid sample request rows');
      return value;
    }
    if (!value || typeof value !== 'object') break;
    const row = value as Record<string, unknown>;
    if (row.status === false || row.success === false) throw new Error('Sample requests unavailable');
    value = row.items ?? row.data;
  }
  throw new Error('Invalid sample request response');
}

export function RoleOverview({ role }: { role: string }) {
  if (role === 'merchandising') return <CatalogOverview />;
  if (['sale', 'sales_manager', 'business_analyst'].includes(role)) return <SalesOverview role={role} />;
  if (role === 'cs') return <CsOverview />;
  if (role === 'marketing' || role === 'graphic') return <UnavailableOverview role={role} />;
  return <Alert tone="muted">{text(...noSummary)}</Alert>;
}

function CatalogOverview() {
  const summary = useAsync(() => joshProductApi.summary());
  const list = useAsync(async () => {
    const value = await joshProductApi.list({ page: 1, limit: 12 });
    if (!Array.isArray(value?.items) || countValue(value.total) === undefined || !value.items.every(row => typeof row.product_inventory_id === 'string' && typeof row.product_inventory_sku === 'string' && (row.name_th == null || typeof row.name_th === 'string') && (row.name_en == null || typeof row.name_en === 'string') && typeof row.product_status === 'string')) throw new Error('Catalog records could not be verified.');
    return value;
  });
  const s = summary.error ? null : summary.data, coverage = catalogPriceCoverage(s?.total, s?.no_price);
  return <>
    <ErrorText error={summary.error} onRetry={summary.reload} />
    {summary.loading && !s ? <Loading variant="detail" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkspaceMetric label={text('สินค้าที่อยู่ในรายงาน', 'Catalog records')} value={countValue(s?.total)} reason={text(...noSummary)} note={text('จำนวนสินค้า ไม่ใช่จำนวนงานที่ทำเสร็จ', 'Product count, not completed work.')} />
      <WorkspaceMetric label={text('มีราคาขายภายใน', 'Internal selling price present')} value={coverage ? `${coverage.present} / ${coverage.total}` : undefined} reason={text(...noSummary)} note={text('ราคามากกว่า 0 ไม่ได้ยืนยันความถูกต้อง', 'Positive prices; correctness is not verified.')} />
      <WorkspaceMetric label={text('ไม่มีหมวดสินค้า', 'Category missing')} value={countValue(s?.no_category)} reason={text(...noSummary)} note={text('เฉพาะแอตทริบิวต์หมวดสินค้า', 'Category attribute only.')} />
      <WorkspaceMetric label={text('ข้อควรตรวจจากรายงานสต็อก', 'Reported stock exceptions')} value={countValue(s?.out_of_stock)} reason={text(...noSummary)} note={text('รายงานนับยอดที่ไม่มีข้อมูลหรือไม่มากกว่า 0 และไม่ใช่สินค้าสั่งล่วงหน้า ไม่ยืนยันสต็อกสด', 'Source report includes missing or nonpositive quantity, excluding order-taking products; not verified live availability.')} />
    </div>}
    <div className="commerce-inspector-grid"><Panel><PanelHead title={text('ทบทวนสินค้าและราคา', 'Review catalog and prices')} actions={<Button variant="secondary" onClick={list.reload} disabled={list.loading}>{uiText('Refresh')}</Button>} />
      <ErrorText error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading variant="table" /> : Array.isArray(list.data?.items) && list.data.items.length ? <Table><THead><TH>{text('สินค้า', 'Product')}</TH><TH>{text('รหัส / แพ็ก', 'Code / pack')}</TH><TH>{text('ราคาขาย', 'Selling price')}</TH><TH>{text('สถานะ', 'Status')}</TH></THead><TBody>{list.data.items.map(row => <TR key={row.product_inventory_id}><TD><WorkspaceLink to={`/reports/products/${encodeURIComponent(row.product_inventory_id)}`}>{row.name_th ?? row.name_en ?? row.product_inventory_sku}</WorkspaceLink></TD><TD>{row.product_inventory_sku}<p className="text-xs">{row.pack_size ?? '—'} / {row.selling_unit ?? '—'}</p></TD><TD>{finiteValue(row.selling_unit_price) !== undefined ? fmt.baht(row.selling_unit_price!) : '—'}</TD><TD>{row.product_status}</TD></TR>)}</TBody></Table> : !list.error && <Empty>{text('ยังไม่มีสินค้าในรายงาน', 'No catalog records yet.')}</Empty>}
      <p className="p-4 text-xs text-on-surface-variant">{text('ไม่เกิน 12 รายการแรก เปิดแค็ตตาล็อกเพื่อค้นหาและดูทั้งหมด', 'Up to 12 records. Open the catalog to search all records.')}</p>
    </Panel><TaskLinks title={text('ตรวจความครบถ้วน', 'Check completeness')}>
      <WorkspaceLink to="/product-master-queue">{text('ทบทวนข้อมูลสินค้าที่เปลี่ยน', 'Review changed attributes')}</WorkspaceLink><WorkspaceLink to="/product-prices">{text('ทบทวนราคาภายใน', 'Review internal prices')}</WorkspaceLink><WorkspaceLink to="/erp/inventory-warehouse">{text('ตรวจยอดตามคลัง', 'Inspect stock by warehouse')}</WorkspaceLink>
      <Alert tone="muted">{text('ยังไม่มีต้นทุนและสิทธิ์ราคาคู่แข่งที่ยืนยันสำหรับหน้านี้', 'Authoritative costs and competitor access are not established for this page.')}</Alert>
    </TaskLinks></div>
  </>;
}

function SalesOverview({ role }: { role: string }) {
  const sales = useAsync(() => reportsApi.sales({ period: 'this_month' }), [role]);
  const inventory = useAsync(() => role === 'sale' ? inventoryOverviewApi.get('', '', 1) : Promise.resolve(null), [role]);
  const t = sales.error ? undefined : sales.data?.totals, series = sales.error ? undefined : sales.data?.byDay ?? sales.data?.byMonth;
  return <>
    <Alert tone="muted">{text(role === 'sale' ? 'เดือนนี้ · เฉพาะบริษัทที่ฉันดูแล ระบบกำหนดขอบเขตให้' : 'เดือนนี้ · ตามสิทธิ์รายงานของคุณ', role === 'sale' ? 'This month · assigned companies only.' : 'This month · your authorized report scope.')}</Alert>
    <ErrorText error={sales.error} onRetry={sales.reload} />
    {sales.loading && !sales.data ? <Loading variant="detail" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkspaceMetric label={text('ยอดขายรวม VAT', 'Sales including VAT')} value={finiteValue(t?.revenue_inc_vat) !== undefined ? fmt.baht(t!.revenue_inc_vat) : undefined} reason={text(...noSummary)} note={text('ตามนิยามรายงาน ไม่ใช่ยอดขายสุทธิหรือกำไร', 'Report definition; not net sales or profit.')} />
      <WorkspaceMetric label={text('ออเดอร์ในรายงาน', 'Reported orders')} value={countValue(t?.orders)} reason={text(...noSummary)} />
      <WorkspaceMetric label={text('เฉลี่ยต่อออเดอร์รวม VAT', 'Average order including VAT')} value={finiteValue(t?.average_order_inc_vat) !== undefined ? fmt.baht(t!.average_order_inc_vat) : undefined} reason={text(...noSummary)} />
      <WorkspaceMetric label={text('กำไรขั้นต้น / อัตรากำไร', 'Gross profit / margin')} reason={text('ยังไม่มีต้นทุนขายที่ยืนยันและยอดขายสุทธิที่ใช้ฐานเดียวกัน', 'Authoritative COGS and compatible net sales are unavailable.')} />
    </div>}
    <div className="commerce-inspector-grid"><Panel><PanelHead title={text(role === 'sale' ? 'สต็อกที่ฉันดูได้' : 'แนวโน้มยอดขาย', role === 'sale' ? 'Inventory available to me' : 'Sales trend')} />
      {role === 'sale' ? <><ErrorText error={inventory.error} onRetry={inventory.reload} />{inventory.loading && !inventory.data ? <Loading variant="table" /> : Array.isArray(inventory.data?.items) && inventory.data.items.length ? <Table><THead><TH>{text('สินค้า / รหัส', 'Product / code')}</TH><TH>{text('คลัง', 'Warehouse')}</TH><TH>{text('คงเหลือ', 'On hand')}</TH><TH>{text('จอง', 'Reserved')}</TH><TH>{text('พร้อมขาย', 'Available')}</TH></THead><TBody>{inventory.data.items.map(row => <TR key={row.id}><TD>{row.name}<p className="text-xs">{row.sku}</p></TD><TD>{row.warehouseCode}</TD><TD>{row.quantity}</TD><TD>{row.reserved}</TD><TD>{row.available}</TD></TR>)}</TBody></Table> : !inventory.error && <Empty>{text('ยังไม่มีข้อมูลสต็อก', 'No stock records yet.')}</Empty>}</> : <div className="p-4">{Array.isArray(series) && series.length ? <BarList rows={series.filter(row => finiteValue(row.revenue_inc_vat) !== undefined && row.revenue_inc_vat >= 0).map(row => ({ label: row.bucket, value: row.revenue_inc_vat, text: fmt.baht(row.revenue_inc_vat) }))} /> : !sales.loading && !sales.error && <Empty>{text('ยังไม่มีแนวโน้มจากรายงาน', 'No trend data in this report.')}</Empty>}</div>}
    </Panel><TaskLinks title={text(role === 'sale' ? 'งานของฉัน' : role === 'sales_manager' ? 'ดูแลงานของทีม' : 'นิยามและคุณภาพข้อมูล', role === 'sale' ? 'My follow-up' : role === 'sales_manager' ? 'Team follow-up' : 'Definitions and data quality')}>
      <WorkspaceLink to="/reports/sales">{text('เปิดรายงานยอดขายและรายละเอียด', 'Open sales report and breakdown')}</WorkspaceLink><WorkspaceLink to="/reports/orders">{text('ตรวจออเดอร์ในขอบเขตของฉัน', 'Inspect orders in my scope')}</WorkspaceLink><WorkspaceLink to={role === 'sale' ? '/reports/winback/my' : '/reports/winback/opportunities'}>{text(role === 'sale' ? 'โอกาสและลีดของฉัน' : 'โอกาสและประวัติของทีม', role === 'sale' ? 'My opportunities and leads' : 'Team opportunities and history')}</WorkspaceLink>
      {role === 'sales_manager' && <WorkspaceLink to="/cs/sales-assignment">{text('ดูและมอบหมายผู้ดูแลลูกค้า', 'View and assign customer coverage')}</WorkspaceLink>}
      <Alert tone="muted">{text('ยังไม่มีข้อมูลครบพอที่จะสรุปความครบถ้วนของการดูแลลูกค้าและเขตขาย', 'Customer and territory coverage cannot yet be verified.')}</Alert>
    </TaskLinks></div>
    {role === 'business_analyst' && Array.isArray(sales.data?.topProducts) && <Panel><PanelHead title={text('ผลงานสินค้าในรายงานยอดขาย', 'Product performance in the sales report')} /><Table><THead><TH>{text('สินค้า', 'Product')}</TH><TH>{text('จำนวน', 'Quantity')}</TH><TH>{text('ยอดขายรวม VAT', 'Sales including VAT')}</TH></THead><TBody>{sales.data.topProducts.map(row => <TR key={row.sku}><TD>{row.name}<p className="text-xs">{row.sku}</p></TD><TD>{row.qty}</TD><TD>{finiteValue(row.revenue_inc_vat) !== undefined ? fmt.baht(row.revenue_inc_vat) : '—'}</TD></TR>)}</TBody></Table></Panel>}
  </>;
}

function CsOverview() {
  const samples = useAsync(async () => sampleHomeRows(await joshAdmin.get('/cs-admin/sample-requests', { status: 'pending' })));
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><WorkspaceMetric label={text('คำขอตัวอย่างที่โหลดและรอพิจารณา', 'Loaded pending sample requests')} value={!samples.error && samples.data ? samples.data.filter(row => row.status === 'pending').length : undefined} reason={text(...noSummary)} note={text('เฉพาะรายการที่ API ตอบกลับ ไม่ใช่ยอดงานบริการทั้งหมด', 'Returned records only; not total service workload.')} />{[['งานจัดส่ง', 'Delivery workload'], ['ออเดอร์ที่ต้องตรวจ', 'Order review workload'], ['สถานะเครดิต', 'Credit visibility']].map(([th, en]) => <WorkspaceMetric key={en} label={text(th, en)} reason={text(...noSummary)} />)}</div>
    <div className="commerce-inspector-grid"><TaskLinks title={text('คิวออเดอร์และการจัดส่ง', 'Orders and delivery queues')}><WorkspaceLink to="/j/shipments">{text('ตรวจการจัดส่ง', 'Inspect shipments')}</WorkspaceLink><WorkspaceLink to="/j/order">{text('ตรวจออเดอร์และรายการที่ต้องดูแล', 'Inspect orders and issues')}</WorkspaceLink><WorkspaceLink to="/j/cs/delivery-schedule">{text('ดูรอบส่ง', 'View delivery schedules')}</WorkspaceLink><WorkspaceLink to="/cs/orders/new">{text('สั่งของแทนลูกค้า', 'Place an order for a customer')}</WorkspaceLink></TaskLinks>
      <TaskLinks title={text('คำขอตัวอย่างและเครดิต', 'Samples and credit records')}><ErrorText error={samples.error} onRetry={samples.reload} />{samples.loading && !samples.data ? <Loading variant="detail" /> : !samples.error && samples.data && !samples.data.length ? <Empty>{text('ไม่มีคำขอตัวอย่างรอพิจารณาในผลลัพธ์นี้', 'No pending sample requests in this response.')}</Empty> : samples.data?.slice(0, 3).map(row => <p key={String(row.id)}>{String(row.company_name ?? row.sku ?? row.id)}</p>)}<WorkspaceLink to="/cs/samples">{text('เปิดคำขอตัวอย่าง', 'Open sample requests')}</WorkspaceLink><WorkspaceLink to="/j/credit-notes">{text('ดูใบลดหนี้', 'View credit notes')}</WorkspaceLink><WorkspaceLink to="/j/credit-backs">{text('ดูรายการคืนเครดิต', 'View credit-back records')}</WorkspaceLink></TaskLinks>
    </div>
  </>;
}

function UnavailableOverview({ role }: { role: string }) {
  const graphic = role === 'graphic';
  const labels = graphic ? [['รูปภาพสินค้า', 'Product images'], ['สินค้าที่ไม่มีรูป', 'Missing images'], ['สื่อแบรนด์', 'Brand assets'], ['ความครบถ้วนของสื่อ', 'Asset coverage']] : [['ยอดขายที่ระบุที่มา', 'Attributed sales'], ['ผลตอบแทนค่าโฆษณา', 'ROAS'], ['แคมเปญรอทบทวน', 'Campaign review queue'], ['คอนเทนต์รอทบทวน', 'Content review queue']];
  return <>{graphic ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{labels.map(([th, en]) => <WorkspaceMetric key={en} label={text(th, en)} reason={text(...noSummary)} />)}</div> : <MarketingHomeSummary />}<div className="commerce-inspector-grid">
    <TaskLinks title={text(graphic ? 'ตรวจสื่อและความครบถ้วน' : 'วางแผนและทบทวนแคมเปญ', graphic ? 'Review assets and coverage' : 'Plan and review campaigns')}><Alert tone="muted">{text(graphic ? 'เปิดแค็ตตาล็อกเพื่อตรวจรูปจริง ยังไม่มีสรุปความครบถ้วนสำหรับสิทธิ์นี้' : 'ยังไม่มีข้อมูลแนวโน้มยอดขายที่ระบุที่มาหรือคิวทบทวนร่วม', graphic ? 'Coverage summary is unavailable. Inspect images in the catalog.' : 'An attributed-sales trend and shared review queue are unavailable.')}</Alert>{graphic ? <><WorkspaceLink to="/j/allproducts">{text('ตรวจรูปบนแค็ตตาล็อก', 'Inspect catalog images')}</WorkspaceLink><WorkspaceLink to="/j/product/bulk-image-upload">{text('อัปโหลดรูปสินค้าหลายรายการ', 'Upload images in bulk')}</WorkspaceLink></> : <><WorkspaceLink to="/marketing/growth">{text('วางแผนจากข้อมูลที่ระบบมี', 'Plan with available data')}</WorkspaceLink><WorkspaceLink to="/j/promotions/campaigns">{text('ทบทวนแคมเปญ', 'Review campaigns')}</WorkspaceLink></>}</TaskLinks>
    <TaskLinks title={text(graphic ? 'แบรนด์และงานถัดไป' : 'กลุ่มลูกค้าและคอนเทนต์', graphic ? 'Brands and next tasks' : 'Segments and content')}>{graphic ? <WorkspaceLink to="/j/brands">{text('เปิดสื่อแบรนด์', 'Open brand assets')}</WorkspaceLink> : <><WorkspaceLink to="/j/segments">{text('ทบทวนกลุ่มลูกค้า', 'Review customer segments')}</WorkspaceLink><WorkspaceLink to="/j/promotion-pages">{text('ทบทวนหน้าโปรโมชัน', 'Review promotion content')}</WorkspaceLink><WorkspaceLink to="/marketing/growth/plans">{text('เปิดแผนและปฏิทิน', 'Open plans and calendar')}</WorkspaceLink></>}</TaskLinks>
  </div></>;
}
