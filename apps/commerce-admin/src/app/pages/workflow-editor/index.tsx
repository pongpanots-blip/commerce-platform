import './josh/josh-tailwind.css';
import JoshEditor from './josh/MarketingWorkflowEditor';
import JoshEnrollments from './josh/MarketingWorkflowEnrollments';
import JoshScheduledRuns from './josh/MarketingWorkflowScheduledRuns';
import { TaskPageFrame } from '@cp/ui';

/**
 * josh web-admin's marketing workflow pages, copied as they are (josh/…): the editor (canvas, step
 * panel, trigger builder, schedule, preview, stats, analytics, revisions), enrollments and scheduled
 * runs. Their API calls go to josh's own routes through commerce (josh/api-client.ts → admin-call).
 * Differences from josh: no Test button (it can send a real message); the notify-template manager
 * link stays on the workflow list. To update: copy josh's files again, keep the import rewrites.
 */
export function WorkflowEditor() { return <div className="josh-tw"><TaskPageFrame><JoshEditor /></TaskPageFrame></div>; }
export function WorkflowEnrollments() { return <div className="josh-tw"><TaskPageFrame><JoshEnrollments /></TaskPageFrame></div>; }
export function WorkflowScheduledRuns() { return <div className="josh-tw"><TaskPageFrame><JoshScheduledRuns /></TaskPageFrame></div>; }
