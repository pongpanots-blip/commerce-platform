/** josh web-admin ADMIN_ROUTES the copied editor links to, mapped to commerce-admin pages. */
export const ADMIN_ROUTES = {
  marketingWorkflows: '/marketing/workflows',
  marketingWorkflowEdit: (id: string) => `/marketing/workflows/${id}/edit`,
  marketingWorkflowEnrollments: (id: string) => `/marketing/workflows/${id}/enrollments`,
  marketingWorkflowScheduledRuns: (id: string) => `/marketing/workflows/${id}/scheduled-runs`,
  userDetail: (id: string) => `/j/allusers/${id}`,
  couponCreate: '/j/coupon/create',
  marketingNotifyTemplates: '/j/marketing/notify-templates',
};
