import CompanySpecialPricingPanel from '../company/CompanySpecialPricingPanel';

type Props = {
  userId: string;
  companyId: string | null | undefined;
};

/** @deprecated Prefer CompanySpecialPricingPanel on the company edit page. */
export function UserSpecialPricingPanel({ companyId }: Props) {
  if (!companyId) {
    return (
      <p className="p-4 text-sm text-gray-500">
        ผู้ใช้รายนี้ยังไม่มี Company — ไม่สามารถกำหนดราคาพิเศษได้
      </p>
    );
  }

  return <CompanySpecialPricingPanel companyId={companyId} />;
}

export default UserSpecialPricingPanel;
