// ui-metadata-migration: static labels and UI notices only
import { useParams } from 'react-router-dom';
import type { GrowthResults as ResultsData, GrowthTimeline as TimelineData } from '@cp/growth';
import { Alert, ArrowLink, BarList, Button, ButtonLink, Chip, DetailSection, Empty, KeyValueGrid, Page, PageHeader, Panel, PanelHead, StatGrid, StatTile, Table, TBody, TD, TH, THead, TR, fmt } from '@cp/ui';
import { api } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { LoadState } from './shared';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function GrowthResults() {
  __useUiLocale();
  const { workflowId = '' } = useParams();
  return <Results key={workflowId} workflowId={workflowId} />;
}
function Results({ workflowId }: { workflowId: string }) {
  __useUiLocale();
  const state = useAsync(() => api.get<ResultsData>(`/growth/results/${encodeURIComponent(workflowId)}`), [workflowId]);
  const data = state.data;
  const confidence = { insufficient: __uiText('ข้อมูลยังไม่พอสรุป'), inconclusive: __uiText('ยังสรุปผลเพิ่มไม่ได้'), positive: __uiText('ผลทดลองเป็นบวก'), negative: __uiText('ผลทดลองเป็นลบ') };
  return <Page>
    <PageHeader back={{ to: '/marketing/growth/plans', label: 'แผนทั้งหมด' }} title={data?.name ?? __uiText("ผลลัพธ์ของ workflow")}
      subtitle={__uiText("ยอดที่ให้เครดิตแคมเปญ ผลทดลอง และงานของทีมต้องอ่านแยกกัน")}
      actions={<><Button onClick={state.reload} icon="refresh">{__uiText("โหลดใหม่")}</Button><ButtonLink to={`/marketing/workflows/${encodeURIComponent(workflowId)}/edit`} icon="account_tree">{__uiText("เปิด workflow")}</ButtonLink></>} />
    <LoadState state={state} />
    {!state.loading && !state.error && data && <>
      <div className="text-xs text-outline">{__uiText("อัปเดต ")}{fmt.when(data.generatedAt)} {__uiText(" · workflow ")}<span className="font-mono break-all">{data.workflowId}</span></div>
      <StatGrid cols={3}>
        <StatTile label={__uiText("ยอดที่ให้เครดิตแคมเปญ")} value={data.attributedRevenueThb === null ? __uiText('ยังไม่มีข้อมูล') : fmt.baht(data.attributedRevenueThb)} icon="payments" foot={__uiText("ยอด attributed ยังไม่ใช่ยอดขายเพิ่มจากการทดลอง")} />
        <StatTile label={__uiText("ส่วนที่เหลือหลังหักต้นทุน")} value={data.contributionThb === null ? __uiText('ยังคำนวณไม่ได้') : fmt.baht(data.contributionThb)} icon="account_balance_wallet" foot={data.missingCosts.length ? __uiText("ต้นทุนยังขาด {0} รายการ",{'0':data.missingCosts.length}) : __uiText("ไม่ใช่กำไรสุทธิของกิจการ")} />
        <StatTile label={__uiText("ส่วนต่างอัตราการซื้อ")} value={data.experiment.rateDifferencePoints === null ? __uiText('ยังสรุปไม่ได้') : `${data.experiment.rateDifferencePoints > 0 ? '+' : ''}${data.experiment.rateDifferencePoints.toFixed(2)} pp`} icon="science" foot={confidence[data.experiment.confidence]} />
      </StatGrid>
      {data.missingCosts.length > 0 && <Alert tone="warn" title={__uiText("ต้นทุนที่ยังขาด")}><ul className="list-disc pl-4">{data.missingCosts.map((item) => <li key={item}>{__uiText(item)}</li>)}</ul></Alert>}
      {data.limitations.length > 0 && <Alert tone="warn" title={__uiText("ข้อจำกัดในการอ่านผล")}><ul className="list-disc pl-4 space-y-1">{data.limitations.map((item) => <li key={item}>{__uiText(item)}</li>)}</ul></Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel><PanelHead title={__uiText("ลำดับขั้นของ workflow")} icon="filter_alt" /><div className="p-4">{data.funnel.length ? <BarList rows={data.funnel.map((item) => ({ label: item.label, value: item.count, text: fmt.num(item.count) }))} /> : <Empty>{__uiText("ยังไม่มีเหตุการณ์ของ workflow")}</Empty>}</div></Panel>
        <Panel><PanelHead title={__uiText("ผลของกลุ่มทดลอง")} icon="science" badge={<Chip tone={data.experiment.confidence === 'positive' ? 'ok' : data.experiment.confidence === 'negative' ? 'danger' : 'warn'}>{confidence[data.experiment.confidence]}</Chip>} />
          <Table><THead><TH>{__uiText("กลุ่ม")}</TH><TH kind="num">{__uiText("เข้าร่วม")}</TH><TH kind="num">{__uiText("ซื้อแล้ว")}</TH></THead><TBody>
            <TR><TD>{__uiText("กลุ่มส่ง")}</TD><TD kind="num">{fmt.num(data.experiment.sent.enrolled)}</TD><TD kind="num">{fmt.num(data.experiment.sent.converted)}</TD></TR>
            <TR><TD>{__uiText("กลุ่มควบคุม")}</TD><TD kind="num">{fmt.num(data.experiment.holdout.enrolled)}</TD><TD kind="num">{fmt.num(data.experiment.holdout.converted)}</TD></TR>
          </TBody></Table><div className="p-4"><Alert tone="info">{data.experiment.note}</Alert></div>
        </Panel>
      </div>
      <Panel><PanelHead title={__uiText("งานของทีมและการรัน")} icon="task_alt" actions={<ArrowLink to={`/marketing/workflows/${encodeURIComponent(workflowId)}/enrollments`}>{__uiText("เปิดบันทึกการรันและผู้เข้าร่วม")}</ArrowLink>} /><div className="p-4"><KeyValueGrid items={data.operations.map((item) => ({ label: item.label, value: fmt.num(item.count) }))} /></div></Panel>
      <Panel><PanelHead title={__uiText("สิ่งที่ควรทดสอบต่อ")} icon="lightbulb" /><div className="p-4 space-y-3">
        {!data.suggestions.length ? <Empty>{__uiText("ยังไม่มีข้อเสนอแนะที่มีข้อมูลรองรับ")}</Empty> : <ul className="list-disc pl-4 space-y-2 text-xs">{data.suggestions.map((item) => <li key={item}>{__uiText(item)}</li>)}</ul>}
        <ButtonLink to="/marketing/growth/plans/new" variant="primary" icon="edit_note">{__uiText("เตรียมแผนการทดลองถัดไป")}</ButtonLink>
      </div></Panel>
    </>}
  </Page>;
}

export function GrowthTimeline() {
  __useUiLocale();
  const { companyId = '' } = useParams();
  return <Timeline key={companyId} companyId={companyId} />;
}
function Timeline({ companyId }: { companyId: string }) {
  __useUiLocale();
  const state = useAsync(() => api.get<TimelineData>(`/growth/timeline/${encodeURIComponent(companyId)}`), [companyId]);
  const data = state.data;
  return <Page>
    <PageHeader back={{ to: '/marketing/growth', label: 'วางแผนการเติบโต' }} title={data ? __uiText("ประวัติ · {0}", {"0": data.name}) : __uiText("ประวัติของบริษัท")}
      subtitle={__uiText("ตรวจบริบทที่ระบบมี ก่อนมอบหมายงานหรือติดต่อบริษัท")}
      actions={<><Button onClick={state.reload} icon="refresh">{__uiText("โหลดใหม่")}</Button><ButtonLink to="/reports/winback" icon="support_agent">{__uiText("งานชวนลูกค้าเก่ากลับ")}</ButtonLink></>} />
    <LoadState state={state} />
    {!state.loading && !state.error && data && <>
      <Panel><PanelHead title={__uiText("ข้อมูลบริษัท")} icon="business" /><div className="p-4"><KeyValueGrid items={[{ label: __uiText("รหัสบริษัท"), value: data.companyId, mono: true }, { label: __uiText("ชื่อ"), value: data.name }, { label: __uiText("อัปเดต"), value: fmt.when(data.generatedAt) }]} /></div></Panel>
      {data.limitations.length > 0 && <Alert tone="warn" title={__uiText("ข้อมูลที่ยังไม่ครอบคลุม")}><ul className="list-disc pl-4 space-y-1">{data.limitations.map((item) => <li key={item}>{__uiText(item)}</li>)}</ul></Alert>}
      <Panel><PanelHead title={__uiText("เหตุการณ์ที่ตรวจได้")} icon="history" /><div className="p-4">
        {!data.events.length ? <Empty icon="history">{__uiText("ยังไม่มีเหตุการณ์ของบริษัทนี้")}</Empty> : <div className="space-y-4">{data.events.map((event) => <DetailSection key={event.id} title={fmt.when(event.at)} icon="schedule"><div className="flex flex-wrap items-center gap-2"><Chip>{eventKindLabel(event.kind)}</Chip><p className="text-xs">{event.title}</p>{event.href?.startsWith('/') && !event.href.startsWith('//') && <ArrowLink to={event.href}>{__uiText("เปิดรายการ")}</ArrowLink>}</div></DetailSection>)}</div>}
      </div></Panel>
    </>}
  </Page>;
}

function eventKindLabel(kind: string) {
  return ({ order: __uiText('คำสั่งซื้อ'), contact: __uiText('การติดต่อ'), workflow: __uiText('workflow การตลาด') } as Record<string, string>)[kind] ?? kind;
}
