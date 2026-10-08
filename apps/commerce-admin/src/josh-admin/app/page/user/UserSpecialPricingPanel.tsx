import CompanySpecialPricingPanel from '../company/CompanySpecialPricingPanel';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  userId: string;
  companyId: string | null | undefined;
};

/** @deprecated Prefer CompanySpecialPricingPanel on the company edit page. */
export function UserSpecialPricingPanel({ companyId }: Props) {
  __useUiLocale();
  if (!companyId) {
    return (
      <p className="p-4 text-sm text-gray-500">
        {__uiText("ผู้ใช้รายนี้ยังไม่มี Company — ไม่สามารถกำหนดราคาพิเศษได้")}</p>
    );
  }

  return <CompanySpecialPricingPanel companyId={companyId} />;
}

export default UserSpecialPricingPanel;
