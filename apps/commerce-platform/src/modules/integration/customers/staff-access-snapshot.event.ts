import { DomainEvent } from '../../../shared-kernel/domain/domain-event';

export interface StaffAccessPayload {
  /** josh users.id */
  id: string;
  email: string | null;
  role: string;
  isActive: boolean;
  /** josh raises users.token_version to at least this (signs the account out everywhere); never lowers it. */
  minTokenVersion: number;
  /** When commerce changed it (ISO) — josh keeps the newest (applyIfNewer). */
  version: string;
}

/** `staff.access` (stage 6): a josh staff account's role / active / sign-out as commerce has them. Latest wins. */
export class StaffAccessSnapshot extends DomainEvent<StaffAccessPayload> {
  readonly type = 'staff.access';
  constructor(payload: StaffAccessPayload) { super(payload.id, payload, { snapshot: true }); }
}
