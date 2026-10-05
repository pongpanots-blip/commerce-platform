export type PromotionRuleRow = {
  min_qty: number;
  promotion_price: number;
  unit_label?: string;
  badge_text?: string;
};

export type PromotionMechanicRowForm = {
  id: string;
  minQty: string;
  promotionPrice: string;
  badgeText: string;
};

export type PromotionMechanicForm = {
  unitLabel: string;
  rules: PromotionMechanicRowForm[];
};

function newRuleRow(
  minQty = '',
  promotionPrice = '',
  badgeText = '',
): PromotionMechanicRowForm {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    minQty,
    promotionPrice,
    badgeText,
  };
}

export const EMPTY_PROMOTION_MECHANIC_FORM: PromotionMechanicForm = {
  unitLabel: 'ชิ้น',
  rules: [newRuleRow('1', '')],
};

export function parsePromotionRows(raw: unknown): PromotionRuleRow[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((row): PromotionRuleRow | null => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const minQty = Number(item.min_qty ?? item.minQty ?? 0);
      const promotionPrice = Number(
        item.promotion_price ?? item.promotionPrice ?? item.price ?? 0,
      );
      if (!minQty || Number.isNaN(promotionPrice)) return null;
      return {
        min_qty: minQty,
        promotion_price: promotionPrice,
        unit_label:
          typeof item.unit_label === 'string' ? item.unit_label : undefined,
        badge_text:
          typeof item.badge_text === 'string' ? item.badge_text : undefined,
      };
    })
    .filter((row): row is PromotionRuleRow => row !== null)
    .sort((a, b) => a.min_qty - b.min_qty);
}

export function rulesToForm(
  promotionRules: unknown,
  sellingPrice?: number,
  sellingUnit?: string,
): PromotionMechanicForm {
  const rules = parsePromotionRows(promotionRules);
  const unitLabel = rules[0]?.unit_label ?? sellingUnit ?? 'ชิ้น';

  if (rules.length === 0) {
    return {
      unitLabel,
      rules: [
        newRuleRow(
          '1',
          sellingPrice && sellingPrice > 0 ? String(sellingPrice) : '',
        ),
      ],
    };
  }

  return {
    unitLabel,
    rules: rules.map((rule, index) => ({
      id: `rule-${rule.min_qty}-${index}`,
      minQty: String(rule.min_qty),
      promotionPrice: String(rule.promotion_price),
      badgeText: rule.badge_text ?? '',
    })),
  };
}

export function formToPromotionRules(form: PromotionMechanicForm): PromotionRuleRow[] {
  const unitLabel = form.unitLabel.trim() || 'ชิ้น';

  return form.rules
    .map((row) => ({
      min_qty: Number(row.minQty) || 0,
      promotion_price: Number(row.promotionPrice),
      unit_label: unitLabel,
      badge_text: row.badgeText.trim() || undefined,
    }))
    .filter(
      (rule) =>
        rule.min_qty > 0 &&
        !Number.isNaN(rule.promotion_price) &&
        rule.promotion_price >= 0,
    )
    .sort((a, b) => a.min_qty - b.min_qty);
}

export function validatePromotionMechanicForm(
  form: PromotionMechanicForm,
): string | null {
  const rules = formToPromotionRules(form);
  if (rules.length === 0) {
    return 'กรุณาระบุเงื่อนไขราคาตามจำนวนอย่างน้อย 1 รายการ';
  }

  for (let i = 1; i < rules.length; i += 1) {
    if (rules[i].min_qty <= rules[i - 1].min_qty) {
      return `จำนวนขั้นต่ำแถวที่ ${i + 1} ต้องมากกว่าแถวก่อนหน้า`;
    }
  }

  return null;
}

export function formatPromotionSummary(rules: PromotionRuleRow[]): string {
  if (!rules.length) return '-';
  return rules
    .map((rule) => {
      const unit = rule.unit_label ?? 'ชิ้น';
      return rule.min_qty === 1
        ? `1 ${unit} ฿${rule.promotion_price.toLocaleString()}`
        : `ซื้อ ${rule.min_qty}+ ${unit} ฿${rule.promotion_price.toLocaleString()}`;
    })
    .join(' · ');
}

export function createEmptyPromotionRow(
  form: PromotionMechanicForm,
): PromotionMechanicRowForm {
  const rules = formToPromotionRules(form);
  const lastMin = rules.length > 0 ? rules[rules.length - 1].min_qty : 0;
  const suggestedMin = lastMin > 0 ? String(lastMin + 1) : '';
  return newRuleRow(suggestedMin, '');
}
