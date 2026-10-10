import { z } from 'zod';
import { api, joshAdmin, productMastersApi, productPricesApi } from '../../../lib/api';
import { isRouteAllowed, normalizeInternalPath } from '../../../lib/landing';
import { normalizeRole } from '../../../lib/role-home';
import { commerceText as text } from '../../commerce-copy';
import { findingCopy, parseOrderReview } from '../planning/OrderReviewWorkspace';
import { draftPageSchema, uuid } from '../planning/promotion-contracts';

export const TODAY = '/today';
export const todayRoles = ['admin','marketing','merchandising','sale','sales_manager','business_analyst','cs','graphic'];
type Copy = [string,string];
export type TaskGroup = 'review' | 'pending' | 'gap';
export type TaskOwner = { state: 'account' | 'unassigned' | 'unknown'; label: Copy };
export interface TodayItem { id: string; group: TaskGroup; title: Copy; reason: Copy; to: string; source: string; evidence: string[]; sourceAsOf: string | null; freshness: 'unknown' | 'stale'; owner: TaskOwner }
export interface TodaySource { key: string; label: Copy; state: 'ready' | 'partial' | 'failed' | 'unavailable'; readAt: string | null; coverage: Copy }
export interface TodaySnapshot { role: string; items: TodayItem[]; sources: TodaySource[] }
const unknownOwner = (): TaskOwner => ({ state: 'unknown', label: ['ยังไม่มีข้อมูลผู้ดูแลที่ยืนยัน','Verified assignment unavailable'] });
const timestamp = z.iso.datetime({offset:true});
const sourceKeys = ['catalog','sales','orders','traffic','push'] as const;
const metricSchema = z.object({key:z.string(),value:z.number().finite().nullable(),unit:z.enum(['records','THB','percent','ratio']),availability:z.enum(['available','partial','unavailable']),definition:z.string(),source:z.string().nullable(),sourceAsOf:z.null(),reason:z.string().nullable()}).superRefine((m,c)=>{if((m.availability==='unavailable')!==(m.value===null)||m.unit==='records'&&m.value!==null&&(!Number.isSafeInteger(m.value)||m.value<0))c.addIssue({code:'custom',message:'Invalid metric evidence'});});
const homeSchema = z.object({schemaVersion:z.literal(1),role:z.string(),scope:z.enum(['assigned_companies','existing_team_report','existing_role_resources']),capturedAt:timestamp,period:z.object({label:z.string(),timezone:z.literal('Asia/Bangkok')}),metrics:z.array(metricSchema),failedSources:z.array(z.enum(sourceKeys)),operationalWrites:z.literal(false)});
type SourceResult = { items: TodayItem[]; partial: boolean; readAt: string; coverage: Copy };
type Reader = { key: string; label: Copy; load:()=>Promise<SourceResult> };
const scopeFor = (role: string) => role==='sale'?'assigned_companies':['admin','sales_manager','business_analyst'].includes(role)?'existing_team_report':'existing_role_resources';
export const groupLabel = (group: TaskGroup) => text(...({review:['มีประเด็นที่ต้องตรวจ','Observed findings'],pending:['รายการรอพิจารณา','Recorded pending items'],gap:['ข้อมูลที่ควรทบทวน','Evidence gaps']} as Record<TaskGroup,Copy>)[group]);
const summaryTasks: Record<string,{title:Copy;reason:Copy;to:string}> = {
  missing_images:{title:['ตรวจสินค้าที่รายงานว่าไม่มีรูป','Inspect reported missing images'],reason:['รายงานระบุว่ารูปสินค้ายังไม่ครบ เปิดแค็ตตาล็อกเพื่อตรวจรายการจริง','The report identifies missing images. Open the catalog to inspect records.'],to:'/j/allproducts'},
  missing_category:{title:['ตรวจสินค้าที่รายงานว่าไม่มีหมวด','Inspect reported missing categories'],reason:['จำนวนนี้นับเฉพาะหมวดสินค้า เปิดรายการเพื่อตรวจข้อมูล','This count covers the category attribute. Inspect the catalog records.'],to:'/j/allproducts'},
  stock_exceptions:{title:['ตรวจรายการสต็อกที่รายงานให้ทบทวน','Inspect reported stock exceptions'],reason:['รายงานรวมยอดที่ขาดหรือไม่มากกว่า 0 ตามนิยามของรายงาน ยังไม่ใช่สต็อกสด','The report includes missing or nonpositive quantity under its definition; live stock is unverified.'],to:'/erp/inventory-warehouse'},
  awaiting_payment:{title:['ตรวจออเดอร์ที่ยังรอชำระ','Inspect orders awaiting payment'],reason:['เป็นจำนวนทุกช่วงเวลาในขอบเขตที่มีสิทธิ์ ไม่ได้ระบุว่าถึงกำหนดหรือต้องติดตามวันนี้','This is an all-time count in the authorized scope. A due date or follow-up deadline is unavailable.'],to:'/reports/orders'},
};
export function summaryItems(raw:unknown, role:string): SourceResult {
  const value=homeSchema.parse(raw);
  if(value.role!==role||value.scope!==scopeFor(role)||new Set(value.metrics.map(m=>m.key)).size!==value.metrics.length)throw Error('Role summary scope mismatch');
  const permittedSources=role==='marketing'?['catalog','traffic','push']:['admin','merchandising'].includes(role)?role==='admin'?['catalog','sales','orders']:['catalog']:['sales','orders'];
  if(value.failedSources.some(s=>!permittedSources.includes(s)))throw Error('Unexpected summary scope');
  const allowedMetrics=role==='marketing'?['catalog_records','missing_images','missing_category','priced_records','sessions','campaign_records','recorded_sent','attributed_sales','roas']:role==='merchandising'?['catalog_records','missing_images','missing_category','priced_records','stock_exceptions']:role==='admin'?['catalog_records','missing_images','missing_category','priced_records','stock_exceptions','sales_inc_vat','paid_orders','average_order_inc_vat','awaiting_payment','gross_profit']:['sales_inc_vat','paid_orders','average_order_inc_vat','awaiting_payment','gross_profit'];
  if(value.metrics.some(m=>!allowedMetrics.includes(m.key))||allowedMetrics.some(key=>!value.metrics.some(m=>m.key===key)))throw Error('Unauthorized or missing summary metric');
  const moneyKeys=['sales_inc_vat','average_order_inc_vat','gross_profit','attributed_sales'];
  if(value.metrics.some(m=>m.unit!==(moneyKeys.includes(m.key)?'THB':m.key==='roas'?'ratio':'records')))throw Error('Metric unit mismatch');
  const items=value.metrics.flatMap(m=>{
    const rule=summaryTasks[m.key];if(!rule||m.value===null||m.value===0||m.availability==='unavailable'||!isRouteAllowed(role,rule.to))return [];
    return [{id:`summary:${m.key}`,group:'gap' as const,title:rule.title,reason:rule.reason,to:rule.to,source:'summary',evidence:[`${m.value}`],sourceAsOf:null,freshness:'unknown' as const,owner:unknownOwner()}];
  });
  return {items,partial:value.failedSources.length>0||value.metrics.some(m=>m.availability!=='available'),readAt:value.capturedAt,coverage:role==='sale'?['สรุปในขอบเขตบริษัทที่ระบบกำหนดให้ · ช่วงเวลาตามนิยามแต่ละค่า','Server-assigned companies; each metric retains its original time definition.']:['สรุปตามสิทธิ์เดิม · จำนวนรายงานไม่ใช่งานที่มอบหมาย','Existing report scope; report counts are not assigned tasks.']};
}
const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export function sampleItems(raw:unknown): SourceResult {
  let value=raw;
  for(let i=0;i<4&&!Array.isArray(value);i++){if(!value||typeof value!=='object')throw Error('Invalid sample source');const record=value as Record<string,unknown>;if(record.status===false||record.success===false)throw Error('Failed sample source');value=record.items??record.data;}
  const rows=z.array(z.object({id:safeId,status:z.enum(['pending','approved','rejected','fulfilled']),company_name:z.string().optional().nullable(),sku:z.string().optional().nullable(),created_at:z.string().optional().nullable()})).max(10000).parse(value);
  const unique=new Map<string,typeof rows[number]>();for(const row of rows){const previous=unique.get(row.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw Error('Conflicting sample records');unique.set(row.id,row);}
  const pending=[...unique.values()].filter(r=>r.status==='pending');
  return {items:pending.map(row=>({id:`sample:${row.id}`,group:'pending',title:['ทบทวนคำขอตัวอย่าง','Review a sample request'],reason:['แหล่งข้อมูลบันทึกว่ารอพิจารณา เปิดหน้าเพื่ออ่านคำขอก่อนตัดสินใจ','The source records a pending request. Read it before deciding.'],to:`/cs/samples/${row.id}/approved`,source:'samples',evidence:[row.company_name??row.sku??row.id,row.id],sourceAsOf:null,freshness:'unknown',owner:unknownOwner()})),partial:false,readAt:new Date().toISOString(),coverage:['เฉพาะคำขอที่ตอบกลับ · เวลาเกิดคำขอไม่ใช่ความสดของสถานะ','Returned requests only; creation time does not prove current status.']};
}
export function queueItems(raw:unknown,key:'prices'|'attributes'):SourceResult {
  const page=z.object({items:z.array(z.object({sku:z.string().min(1).max(100),received_at:timestamp,changed_at:timestamp.nullable()})).max(5),total:z.number().int().nonnegative(),page:z.literal(1),limit:z.literal(5)}).parse(raw);
  if(page.items.length>page.total||page.total>0&&!page.items.length||new Set(page.items.map(r=>r.sku)).size!==page.items.length)throw Error('Invalid change queue');
  const item:TodayItem={id:`queue:${key}`,group:'pending',title:key==='prices'?['ทบทวนราคาที่ ERP ส่งมา','Review incoming ERP prices']:['ทบทวนข้อมูลสินค้าที่ ERP ส่งมา','Review incoming ERP attributes'],reason:['รายการอยู่ในคิวรอพิจารณาของระบบ เปิดคิวเพื่อตรวจข้อมูลก่อนตัดสินใจ','These records are in the pending queue. Inspect changes before deciding.'],to:key==='prices'?'/product-prices':'/product-master-queue',source:key,evidence:[String(page.total),...page.items.map(r=>r.sku)],sourceAsOf:null,freshness:'unknown',owner:unknownOwner()};
  return {items:page.total>0?[item]:[],partial:page.total>page.items.length,readAt:new Date().toISOString(),coverage:['แสดงหลักฐานไม่เกิน 5 สินค้า · จำนวนคิวมาจากผลอ่านนี้','Evidence includes up to five SKUs; queue count comes from this read.']};
}
export function draftItems(raw:unknown):SourceResult {
  const page=draftPageSchema.parse(raw);
  return {items:page.items.map(d=>({id:`draft:${d.id}`,group:'gap',title:['ทบทวนหลักฐานของร่างโปรโมชัน','Review promotion draft evidence'],reason:['บันทึกร่างแล้ว แต่ต้นทุน สต็อก ความสด และสิทธิ์โปรโมชันยังไม่ครบ','The draft is saved; cost, stock, freshness and capacity remain incomplete.'],to:`/planning/promotions/drafts/${d.id}`,source:'drafts',evidence:[d.scenario.name,d.scenario.line.sku,`${d.revision}`],sourceAsOf:null,freshness:'unknown',owner:{state:'account',label:['บัญชีนี้เป็นเจ้าของร่าง · ไม่ใช่การมอบหมายงาน','This account owns the draft; this is not an assignment']}})),partial:page.next!==null,readAt:new Date().toISOString(),coverage:['ร่างส่วนตัวในหน้ารายการแรกไม่เกิน 20 รายการ · ไม่มีเส้นตายที่ยืนยัน','First page of up to 20 private drafts; no verified deadlines.']};
}
export function findingItems(raw:unknown,orderId:string):SourceResult {
  const review=parseOrderReview(raw,orderId);
  return {items:review.findings.map(f=>({id:`finding:${f.id}`,group:f.classification==='data_gap'?'gap':'review',title:findingCopy(f.code),reason:['เปิดหลักฐานของประเด็นนี้ให้คนตรวจ ผลอ่านไม่ได้มอบหมายงานหรืออนุมัติซ่อม','Open this finding for human review. The read is not an assignment or repair approval.'],to:`/review/orders/${orderId}/findings/${encodeURIComponent(f.id)}`,source:'order',evidence:[orderId,...[...new Set(f.evidence.map(e=>e.source))]],sourceAsOf:null,freshness:f.code==='snapshot_stale'?'stale':'unknown',owner:unknownOwner()})),partial:review.riskCoverage==='partial'||review.reconciliation==='incomplete',readAt:review.at,coverage:['เฉพาะออเดอร์ที่เลือก · ประเด็นต้องให้คนตรวจตามหลักฐานที่มี','Selected order only; findings require human review of available evidence.']};
}
export function todayReaders(roleRaw:string,orderId?:string):Reader[] {
  const role=normalizeRole(roleRaw);if(!todayRoles.includes(role))return [];
  const readers:Reader[]=[];
  if(!['cs','graphic'].includes(role))readers.push({key:'summary',label:['สรุปตามบทบาท','Role-authorized summary'],load:async()=>summaryItems(await api.get('/reports/home?period=today'),role)});
  if(['admin','merchandising'].includes(role))readers.push({key:'prices',label:['คิวราคาจาก ERP','ERP price queue'],load:async()=>queueItems(await productPricesApi.pending('',1,5),'prices')},{key:'attributes',label:['คิวข้อมูลสินค้าจาก ERP','ERP attribute queue'],load:async()=>queueItems(await productMastersApi.pending('',1,5),'attributes')});
  if(role==='cs')readers.push({key:'samples',label:['คำขอตัวอย่างที่รอพิจารณา','Pending sample requests'],load:async()=>sampleItems(await joshAdmin.get('/cs-admin/sample-requests',{status:'pending'}))});
  if(role==='admin'){
    readers.push({key:'drafts',label:['ร่างโปรโมชันส่วนตัว','Private promotion drafts'],load:async()=>draftItems(await api.get('/reports/promotion-planning/drafts'))});
    if(orderId) { const id=uuid.parse(orderId);readers.push({key:'order',label:['หลักฐานของออเดอร์ที่เลือก','Selected order evidence'],load:async()=>findingItems(await api.get(`/reports/commerce-previews/orders/${id}/review`),id)}); }
  }
  return readers;
}
/** Deduplicate the same entity/intent, retaining distinct scoped tasks. Conflicting copies are withheld. */
export function canonicalItems(items:TodayItem[],role:string) {
  const unique=new Map<string,TodayItem>(),conflicts=new Set<string>();let withheld=0;
  for(const item of items){if(!normalizeInternalPath(item.to)||!isRouteAllowed(role,item.to)){withheld++;continue;}const previous=unique.get(item.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(item)){conflicts.add(item.id);withheld++;}else unique.set(item.id,item);}
  const ranks={review:0,pending:1,gap:2};return {items:[...unique.values()].filter(i=>!conflicts.has(i.id)).sort((a,b)=>ranks[a.group]-ranks[b.group]||a.id.localeCompare(b.id)),withheld};
}
/** A stalled read cannot block independent sources forever. Late read results never replace the failed attempt. */
function boundedSource<T>(read:()=>Promise<T>):Promise<T> {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Source read timed out')),15000);
    Promise.resolve().then(read).then(resolve,reject).finally(()=>clearTimeout(timer));
  });
}
export async function readToday(roleRaw:string,orderId?:string):Promise<TodaySnapshot> {
  const role=normalizeRole(roleRaw),readers=todayReaders(role,role==='admin'?orderId:undefined);
  const replies=await Promise.allSettled(readers.map(r=>boundedSource(r.load)));const sources:TodaySource[]=[],items:TodayItem[]=[];
  replies.forEach((reply,i)=>{const r=readers[i];if(reply.status==='fulfilled'){items.push(...reply.value.items);sources.push({key:r.key,label:r.label,state:reply.value.partial?'partial':'ready',readAt:reply.value.readAt,coverage:reply.value.coverage});}else sources.push({key:r.key,label:r.label,state:'failed',readAt:null,coverage:['ยังอ่านแหล่งนี้ไม่ได้ ลองอ่านใหม่หรือเปิดรายการเดิม','This source could not be verified. Retry or open the existing records.']});});
  if(role==='graphic')sources.push({key:'assets',label:['คิวงานสื่อสินค้า','Asset work queue'],state:'unavailable',readAt:null,coverage:['สิทธิ์นี้ยังไม่มีสัญญาสรุปคิวที่อ่านได้ เปิดแค็ตตาล็อกหรือสื่อแบรนด์เพื่อตรวจ','An authorized queue aggregate is unavailable. Inspect catalog or brand assets.']});
  const canonical=canonicalItems(items,role);if(canonical.withheld)sources.push({key:'identity',label:['ข้อมูลที่ต้องตรวจรหัสหรือขอบเขต','Identity or scope verification'],state:'partial',readAt:null,coverage:['มีรายการที่ยังยืนยันรหัสหรือขอบเขตไม่ได้ จึงยังไม่แสดงเป็นงาน','Some records have unverified identity or scope and are withheld.']});
  return {role,items:canonical.items,sources};
}

export function todayQuery(params:URLSearchParams,role:string) {
  const group=params.get('group')??'all',owner=params.get('owner')??'all',order=params.get('orderId')??'',q=params.get('q')??'',limit=Number(params.get('limit')??6);
  const valid=['all','review','pending','gap'].includes(group)&&['all','account','unassigned','unknown'].includes(owner)&&Number.isSafeInteger(limit)&&limit>=6&&limit<=24&&(!order||uuid.safeParse(order).success);
  return {valid,group,owner,q,limit,orderId:role==='admin'&&uuid.safeParse(order).success?uuid.parse(order):undefined};
}
export function visibleToday(items:TodayItem[],query:ReturnType<typeof todayQuery>) {
  const term=query.q.trim().toLocaleLowerCase();return items.filter(i=>(query.group==='all'||i.group===query.group)&&(query.owner==='all'||i.owner.state===query.owner)&&(!term||`${text(...i.title)} ${text(...i.reason)} ${i.evidence.join(' ')}`.toLocaleLowerCase().includes(term)));
}
