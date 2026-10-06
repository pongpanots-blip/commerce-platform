import { useParams } from 'react-router-dom';
import type { GrowthResults as ResultsData, GrowthTimeline as TimelineData } from '@cp/growth';
import { Alert, ArrowLink, BarList, Button, ButtonLink, Chip, DetailSection, Empty, KeyValueGrid, Page, PageHeader, Panel, PanelHead, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { LoadState } from './shared';

export function GrowthResults() {
  const { workflowId = '' } = useParams();
  return <Results key={workflowId} workflowId={workflowId} />;
}
function Results({ workflowId }: { workflowId: string }) {
  const state = useAsync(() => api.get<ResultsData>(`/growth/results/${encodeURIComponent(workflowId)}`), [workflowId]);
  const data = state.data;
  const confidence = { insufficient: 'ข้อมูลยังไม่พอสรุป', inconclusive: 'ยังสรุปผลเพิ่มไม่ได้', positive: 'ผลทดลองเป็นบวก', negative: 'ผลทดลองเป็นลบ' };
  return <Page>
    <PageHeader crumbs={['Marketing', 'Growth', 'ผลลัพธ์']} back={{ to: '/marketing/growth/plans', label: 'แผนทั้งหมด' }} title={data?.name ?? 'ผลลัพธ์ของ workflow'}
      subtitle="ยอดที่ให้เครดิตแคมเปญ ผลทดลอง และงานของทีมต้องอ่านแยกกัน"
      actions={<><Button onClick={state.reload} icon="refresh">Refresh</Button><ButtonLink to={`/marketing/workflows/${encodeURIComponent(workflowId)}/edit`} icon="account_tree">เปิด workflow</ButtonLink></>} />
    <LoadState state={state} />
    {!state.loading && !state.error && data && <>
      <div className="text-xs text-outline">อัปเดต {fmt.when(data.generatedAt)} · workflow <span className="font-mono break-all">{data.workflowId}</span></div>
      <StatGrid cols={3}>
        <StatTile label="ยอดที่ให้เครดิตแคมเปญ" value={data.attributedRevenueThb === null ? 'ยังไม่มีข้อมูล' : fmt.baht(data.attributedRevenueThb)} icon="payments" foot="ยอด attributed ยังไม่ใช่ยอดขายเพิ่มจากการทดลอง" />
        <StatTile label="Contribution หลังต้นทุน" value={data.contributionThb === null ? 'ยังคำนวณไม่ได้' : fmt.baht(data.contributionThb)} icon="account_balance_wallet" foot={data.missingCosts.length ? `ต้นทุนยังขาด ${data.missingCosts.length} รายการ` : 'ไม่ใช่กำไรสุทธิของกิจการ'} />
        <StatTile label="ส่วนต่าง conversion" value={data.experiment.rateDifferencePoints === null ? 'ยังสรุปไม่ได้' : `${data.experiment.rateDifferencePoints > 0 ? '+' : ''}${data.experiment.rateDifferencePoints.toFixed(2)} pp`} icon="science" foot={confidence[data.experiment.confidence]} />
      </StatGrid>
      {data.missingCosts.length > 0 && <Alert tone="warn" title="ต้นทุนที่ยังขาด"><ul className="list-disc pl-4">{data.missingCosts.map((item) => <li key={item}>{item}</li>)}</ul></Alert>}
      {data.limitations.length > 0 && <Alert tone="warn" title="ข้อจำกัดในการอ่านผล"><ul className="list-disc pl-4 space-y-1">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel><PanelHead title="Funnel ของ workflow" icon="filter_alt" /><div className="p-4">{data.funnel.length ? <BarList rows={data.funnel.map((item) => ({ label: item.label, value: item.count, text: fmt.num(item.count) }))} /> : <Empty>ยังไม่มีเหตุการณ์ของ workflow</Empty>}</div></Panel>
        <Panel><PanelHead title="ผลของกลุ่มทดลอง" icon="science" badge={<Chip tone={data.experiment.confidence === 'positive' ? 'ok' : data.experiment.confidence === 'negative' ? 'danger' : 'warn'}>{confidence[data.experiment.confidence]}</Chip>} />
          <Table><THead><TH>กลุ่ม</TH><TH kind="num">เข้าร่วม</TH><TH kind="num">Converted</TH></THead><TBody>
            <TR><TD>กลุ่มส่ง</TD><TD kind="num">{fmt.num(data.experiment.sent.enrolled)}</TD><TD kind="num">{fmt.num(data.experiment.sent.converted)}</TD></TR>
            <TR><TD>กลุ่มควบคุม</TD><TD kind="num">{fmt.num(data.experiment.holdout.enrolled)}</TD><TD kind="num">{fmt.num(data.experiment.holdout.converted)}</TD></TR>
          </TBody></Table><div className="p-4"><Alert tone="info">{data.experiment.note}</Alert></div>
        </Panel>
      </div>
      <Panel><PanelHead title="งานของทีมและการรัน" icon="task_alt" actions={<ArrowLink to={`/marketing/workflows/${encodeURIComponent(workflowId)}/enrollments`}>เปิด step logs / enrollments</ArrowLink>} /><div className="p-4"><KeyValueGrid items={data.operations.map((item) => ({ label: item.label, value: fmt.num(item.count) }))} /></div></Panel>
      <Panel><PanelHead title="สิ่งที่ควรทดสอบต่อ" icon="lightbulb" /><div className="p-4 space-y-3">
        {!data.suggestions.length ? <Empty>ยังไม่มีข้อเสนอแนะที่มีข้อมูลรองรับ</Empty> : <ul className="list-disc pl-4 space-y-2 text-xs">{data.suggestions.map((item) => <li key={item}>{item}</li>)}</ul>}
        <ButtonLink to="/marketing/growth/plans/new" variant="primary" icon="edit_note">เตรียมแผนการทดลองถัดไป</ButtonLink>
      </div></Panel>
    </>}
  </Page>;
}

export function GrowthTimeline() {
  const { companyId = '' } = useParams();
  return <Timeline key={companyId} companyId={companyId} />;
}
function Timeline({ companyId }: { companyId: string }) {
  const state = useAsync(() => api.get<TimelineData>(`/growth/timeline/${encodeURIComponent(companyId)}`), [companyId]);
  const data = state.data;
  return <Page>
    <PageHeader crumbs={['Marketing', 'Growth', 'ประวัติบริษัท']} back={{ to: '/marketing/growth', label: 'Growth Workspace' }} title={data ? `ประวัติ · ${data.name}` : 'ประวัติของบริษัท'}
      subtitle="ตรวจบริบทที่ระบบมี ก่อนมอบหมายงานหรือติดต่อบริษัท"
      actions={<><Button onClick={state.reload} icon="refresh">Refresh</Button><ButtonLink to="/reports/winback" icon="support_agent">งาน Winback</ButtonLink></>} />
    <LoadState state={state} />
    {!state.loading && !state.error && data && <>
      <Panel><PanelHead title="ข้อมูลบริษัท" icon="business" /><div className="p-4"><KeyValueGrid items={[{ label: 'Company ID', value: data.companyId, mono: true }, { label: 'ชื่อ', value: data.name }, { label: 'อัปเดต', value: fmt.when(data.generatedAt) }]} /></div></Panel>
      {data.limitations.length > 0 && <Alert tone="warn" title="ข้อมูลที่ยังไม่ครอบคลุม"><ul className="list-disc pl-4 space-y-1">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></Alert>}
      <Panel><PanelHead title="เหตุการณ์ที่ตรวจได้" icon="history" /><div className="p-4">
        {!data.events.length ? <Empty icon="history">ยังไม่มีเหตุการณ์ของบริษัทนี้</Empty> : <div className="space-y-4">{data.events.map((event) => <DetailSection key={event.id} title={fmt.when(event.at)} icon="schedule"><div className="flex flex-wrap items-center gap-2"><Chip>{event.kind}</Chip><p className="text-xs">{event.title}</p>{event.href?.startsWith('/') && !event.href.startsWith('//') && <ArrowLink to={event.href}>เปิดรายการ</ArrowLink>}</div></DetailSection>)}</div>}
      </div></Panel>
    </>}
  </Page>;
}
