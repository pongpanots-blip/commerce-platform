import { TaskPageFrame } from '@cp/ui';
import { FlowEditorPage } from './FlowEditorPage';

/** Commerce-run marketing workflow editor (spec 2026-10-10). josh's own workflows keep the copied editor in ../workflow-editor. */
export function FlowEditor() { return <TaskPageFrame><FlowEditorPage /></TaskPageFrame>; }
