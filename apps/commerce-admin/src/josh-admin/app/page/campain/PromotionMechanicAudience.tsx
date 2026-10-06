import type { MechanicAudience } from '@josh/shared-api';
import { Input } from '@josh/shared-ui-web';
import { useId, useState } from 'react';
import { AiOutlineClose } from 'react-icons/ai';
import { useCompanySearch } from '../../components/useCompanySearch';
import type { AudienceCompany } from './promotion-mechanic-form.helpers';

type Props = {
  audience: MechanicAudience;
  companies: AudienceCompany[];
  onChange: (patch: { audience?: MechanicAudience; audienceCompanies?: AudienceCompany[] }) => void;
  error?: string;
  errorId?: string;
};

/**
 * Who a mechanic is for: everyone, or only the companies picked here. Companies are found with the
 * shared `useCompanySearch` hook (`GET /company?search=`, also used by the Push-campaign page); the picks show as chips.
 */
export default function PromotionMechanicAudience({ audience, companies, onChange, error, errorId }: Props) {
  const radioName = useId();
  const [query, setQuery] = useState('');
  const { hits, failed: searchFailed } = useCompanySearch(query);

  const picked = new Set(companies.map((company) => company.id));
  const choices = hits.filter((hit) => !picked.has(hit.id));

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="กลุ่มลูกค้า" className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={radioName}
            className="accent-primary"
            checked={audience === 'all'}
            onChange={() => onChange({ audience: 'all' })}
          />
          <span className="text-sm text-ink">ทุกคน (รวมลูกค้าที่ยังไม่ล็อกอิน)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={radioName}
            className="accent-primary"
            checked={audience === 'companies'}
            onChange={() => onChange({ audience: 'companies' })}
          />
          <span className="text-sm text-ink">เฉพาะบริษัทที่เลือก</span>
        </label>
      </div>

      {audience === 'companies' && (
        <div className="space-y-2">
          <div className="sm:w-1/2 sm:pr-2">
            <Input
              label="ค้นหาบริษัท"
              hint="ค้นจากชื่อบริษัทหรือเลขทะเบียน — คนที่ไม่ได้อยู่ในบริษัทเหล่านี้จะไม่เห็นโปรนี้เลย"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ชื่อบริษัท / เลขทะเบียน"
            />
          </div>

          {searchFailed && <p className="text-sm text-alert">ค้นหาบริษัทไม่สำเร็จ</p>}
          {choices.length > 0 && (
            <ul aria-label="ผลการค้นหาบริษัท" className="space-y-1 sm:w-1/2">
              {choices.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="block w-full rounded-lg border border-gray-100 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                    onClick={() => onChange({ audienceCompanies: [...companies, { id: hit.id, name: hit.name }] })}
                  >
                    + {hit.name}
                    {hit.registerNumber ? <span className="ml-2 text-xs text-ink-muted">{hit.registerNumber}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {companies.length > 0 ? (
            <ul aria-label="บริษัทที่เลือก" className="flex flex-wrap gap-2">
              {companies.map((company) => (
                <li
                  key={company.id}
                  className="flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-sm text-primary"
                >
                  {company.name}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-white"
                    aria-label={`เอา ${company.name} ออก`}
                    onClick={() =>
                      onChange({ audienceCompanies: companies.filter((item) => item.id !== company.id) })
                    }
                  >
                    <AiOutlineClose size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">ยังไม่ได้เลือกบริษัท</p>
          )}

          {error && (
            <p id={errorId} className="text-sm text-alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
