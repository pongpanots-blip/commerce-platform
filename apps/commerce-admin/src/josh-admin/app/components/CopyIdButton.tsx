import { useState } from 'react';
import { AiOutlineCheck, AiOutlineCopy } from 'react-icons/ai';

/**
 * ปุ่มไอคอนคัดลอก id เต็ม — สลับเป็นเครื่องหมายถูกชั่วคราวเป็นฟีดแบ็ก
 * ใช้ในแถวลิสต์ (CategoryList / CuisineCardsPage) และกล่องข้อมูล id ของหน้าแก้ไข
 * (EditCategory / CuisineCardEdit)
 */
export function CopyIdButton({
  id,
  className = '',
  label,
}: {
  /** The text that gets copied (an id, or any value — e.g. a deeplink). */
  id: string;
  className?: string;
  /** Accessible name / tooltip; default `คัดลอก id <id>`. Set it when what is copied is not an id. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const name = label ?? `คัดลอก id ${id}`;

  return (
    <button
      type="button"
      title={copied ? 'คัดลอกแล้ว' : name}
      aria-label={copied ? 'คัดลอกแล้ว' : name}
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`rounded-lg p-1.5 hover:bg-primary-soft ${
        copied ? 'text-primary' : 'text-ink-muted hover:text-primary'
      } ${className}`}
    >
      {copied ? <AiOutlineCheck size={18} /> : <AiOutlineCopy size={18} />}
    </button>
  );
}

export default CopyIdButton;
