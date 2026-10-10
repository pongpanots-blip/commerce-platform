import { TaskPageFrame } from '@cp/ui';
import { DynamicSegmentsPage } from './DynamicSegmentsPage';
import { EventsPage } from './EventsPage';

export function MarketingEvents() { return <TaskPageFrame><EventsPage /></TaskPageFrame>; }
export function DynamicSegments() { return <TaskPageFrame><DynamicSegmentsPage /></TaskPageFrame>; }
