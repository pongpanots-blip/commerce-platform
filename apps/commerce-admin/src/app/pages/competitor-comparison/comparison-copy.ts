import { commerceText as text } from "../../commerce-copy";
export const comparisonReason = (reason: string) =>
  text(
    ...((
      {
        observation_identity_changed: [
          "หลักฐานราคาเป็นชื่อหรือเงื่อนไขเดิม บันทึกราคาใหม่สำหรับข้อมูลที่แก้แล้ว",
          "Price evidence belongs to the previous identity or context. Record a new observation for the edited identity.",
        ],
        mapping_unverified: [
          "ยังไม่ยืนยันว่าเป็นสินค้าเดียวกัน",
          "Product match has not been verified",
        ],
        match_uncertain: [
          "การจับคู่ยังไม่แน่นอน",
          "Product match is uncertain",
        ],
        substitute: [
          "เป็นสินค้าทดแทน แยกจากการเทียบสินค้าเดียวกัน",
          "Substitute product; excluded from same-product comparison",
        ],
        pack_unavailable: [
          "ยังไม่มีขนาดแพ็กที่ใช้เทียบได้",
          "Pack quantity is unavailable or invalid",
        ],
        pack_range: [
          "ขนาดเป็นช่วง จึงไม่ใช้ค่ากลางเทียบ",
          "Variable pack; no midpoint comparison",
        ],
        unit_mismatch: [
          "หน่วยต่างกัน ไม่แปลงน้ำหนักเป็นปริมาตร",
          "Units differ; weight and volume are not converted",
        ],
        price_unavailable: [
          "ยังไม่มีราคาที่ใช้เทียบได้",
          "Comparable price is unavailable",
        ],
        currency_unavailable: ["ยังไม่ทราบสกุลเงิน", "Currency is unknown"],
        currency_fx_unsupported: [
          "สกุลเงินต่างกัน ยังไม่มีอัตราแลกเปลี่ยนที่ยืนยัน",
          "Different currency; verified FX is unavailable",
        ],
        tax_unverified: [
          "ฐาน VAT ไม่ตรงหรือยังไม่ยืนยัน",
          "VAT basis differs or is unverified",
        ],
        source_date_unavailable: [
          "ยังไม่มีวันที่และอายุข้อมูลที่ยืนยัน",
          "Observation date or validity is unavailable",
        ],
        source_date_future: [
          "วันที่พบราคาอยู่ในอนาคต",
          "Observation is future dated",
        ],
        observation_stale: [
          "ราคาเกินอายุข้อมูล ให้บันทึกราคาใหม่",
          "Price is stale; record a new observation",
        ],
        source_changed: [
          "แหล่งข้อมูลเปลี่ยน ต้องตรวจหลักฐานใหม่",
          "Source configuration changed; review evidence",
        ],
        source_failed: [
          "อ่านแหล่งข้อมูลครั้งล่าสุดไม่สำเร็จ",
          "Latest source read failed",
        ],
        product_basis_unavailable: [
          "หน่วยขายของเรายังไม่ชัดเจน",
          "Our selling-unit basis is unavailable",
        ],
        product_tax_unavailable: [
          "ฐาน VAT ของเรายังไม่ชัดเจน",
          "Our VAT basis is unavailable",
        ],
        observation_pack_changed: [
          "ขนาดแพ็กเปลี่ยน ราคานี้เป็นของแพ็กเดิม",
          "Pack changed; this price belongs to the previous pack",
        ],
        member_eligibility_unverified: [
          "ราคาสมาชิก แยกไว้จนยืนยันสิทธิ์สมาชิก",
          "Member price kept separate until eligibility is verified",
        ],
        price_basis_mismatch: [
          "ฐานราคาสาธารณะและสมาชิกไม่ตรงกับแหล่งที่มา",
          "Public/member price basis does not match its source",
        ],
      } as Record<string, [string, string]>
    )[reason] ?? ["ยังต้องตรวจฐานข้อมูล", "Additional evidence needs review"]),
  );
export const comparisonDate = (s: unknown) =>
  typeof s === "string" && Number.isFinite(Date.parse(s))
    ? `${new Date(s).toISOString()} (UTC)`
    : text("ยังไม่ทราบ", "Unknown");
