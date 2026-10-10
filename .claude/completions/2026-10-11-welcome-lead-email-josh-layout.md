# Welcome Lead Email — restore josh layout

- Page: `/j/marketing/welcome-lead-email` (`apps/commerce-admin/src/josh-admin/app/page/marketing/WelcomeLeadEmailPage.tsx`)
- Cause: UI redesign (#80) moved breakpoints `lg`→`2xl` / `md`→`xl`; `faa9d99` swapped the wrapper to `cp-management-page` (lost `p-6` + `max-w-[1500px]`).
- Fix: restored layout classes from `josh/apps/web-admin`; `uiText` i18n kept.
- PR: https://github.com/pongpanots-blip/commerce-platform/pull/135
- Not done: visual check in browser.
