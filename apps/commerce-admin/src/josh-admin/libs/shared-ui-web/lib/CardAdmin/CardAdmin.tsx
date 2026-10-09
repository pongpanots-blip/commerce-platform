import { StatTile, uiText, useUiLocale } from '@cp/ui';

export function CardAdmin({ name = '', value = '' ,textColor=''}) {
  useUiLocale();
  return (
    <StatTile label={uiText(name)} value={<span className={textColor || 'text-on-surface'}>{value}</span>} className="min-w-0" />
  );
}
export default CardAdmin;
