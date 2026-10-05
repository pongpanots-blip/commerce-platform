/** josh web-admin ADMIN_ROUTES the copied editor links to, mapped to commerce-admin pages. */
export const ADMIN_ROUTES = {
  marketingWorkflows: '/marketing/workflows',
  marketingWorkflowEdit: (id: string) => `/marketing/workflows/${id}/edit`,
  marketingWorkflowEnrollments: (id: string) => `/marketing/workflows/${id}/enrollments`,
  marketingWorkflowScheduledRuns: (id: string) => `/marketing/workflows/${id}/scheduled-runs`,
  // josh's customer page → commerce's customers report (search by name there).
  userDetail: (_id: string) => '/reports/customers',
  couponCreate: '/josh-admin/coupons',
  // ponytail: josh's notify-template manager (creative editor) is not in commerce yet — links go to the list page.
  marketingNotifyTemplates: '/marketing/workflows',
};
