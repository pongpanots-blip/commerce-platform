# ขั้น 4e — สลับรูปสินค้าให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage4e-product-images.md` · spec §4.2 แถว 4 (กลุ่มสุดท้าย: รูปภาพ)

ทำโดย ops · ที่ย้าย: แกลเลอรีของสินค้า (รูปไหน เรียงยังไง) — อัปโหลด/ลบ/เรียงในหน้าสินค้า, อัปโหลดหลาย SKU ตามชื่อไฟล์ (`SKU_<n>.jpg`),
และ ERP `PUT /erp/products/image` · **ไฟล์ยังอยู่ S3 bucket เดิมของ josh** และ josh ยังสร้างรูปย่อ (thumbnail) ให้ ·
**ยังอยู่ josh:** ประวัติการอัปโหลดหลาย SKU (logs) / กู้คืน / ลบรูปเก่า ของรูปที่อัปโหลดที่ josh ก่อนสลับ

ต้องทำขั้น 4d ก่อน (branch นี้ต่อจาก 4d) · commerce prod ต้องมี env S3 ชุดเดียวกับ josh (`S3_MEDIA_BUCKET`, `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `MEDIA_BASE_URL` — ชุดที่ winback ใช้อัปโหลดรูปกิจกรรมอยู่แล้ว)

## ก่อน shadow

1. merge + deploy commerce (migration `1795100000000-ProductImages`) และ josh (`feat/commerce-owns-images`) — flag ปิดทั้งหมด
2. `JOSH_DATABASE_URL=<josh prod read-only> npm run import-from-josh -- images` แล้ว `npm run image-parity` → `different: 0`

## Shadow ~1 สัปดาห์

3. ทุกวัน: import `images` อีกรอบแล้ว `npm run image-parity` — ต้องตรง (ยังแก้รูปที่ josh ตามปกติ)

## วันสลับ

4. แจ้งทีมที่แก้รูปให้หยุด ~15 นาที
5. `npm run import-from-josh -- images` รอบสุดท้าย แล้ว `npm run image-parity` = ตรง
6. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `product.images.snapshot`
7. josh: `COMMERCE_OWNS_PRODUCT_IMAGES=true` แล้ว restart — แก้รูปในฟอร์มสินค้า / อัปโหลดหลาย SKU / กู้คืน → 403,
   ERP image call ที่เข้า josh ตรง → ข้าม (ส่งต่อให้ commerce)
8. commerce: `COMMERCE_OWNS_PRODUCT_IMAGES=true` แล้ว restart
9. ทดสอบ: หน้าสินค้า SKU ทดสอบ → เพิ่มรูป 1 รูป แล้วสลับลำดับ/ลบ → josh `product_media` ตามลำดับเดียวกัน, หน้าร้านเห็น,
   มี `*_thumb.webp` ใน bucket · อัปโหลดหลาย SKU ด้วยไฟล์ `SKU_1.jpg` (โหมดแทนที่) → รูปที่ 1 เปลี่ยน
10. `npm run image-parity` อีกครั้ง → ตรง

## Rollback

- ปิด `COMMERCE_OWNS_PRODUCT_IMAGES` ทั้งสองฝั่ง → josh แก้รูปเองตามเดิม · subscription: เอา `product.images.snapshot` ออก
- รูปที่แก้ใน commerce อยู่ใน josh แล้ว (ไฟล์อยู่ bucket เดียวกัน) · เปิดกลับ: import `images` ใหม่ก่อน

## ข้อจำกัด

- อัปโหลดหลาย SKU ที่ commerce ไม่มีประวัติ/กู้คืน — รูปที่ถูกแทนที่หลุดจากแกลเลอรีเฉยๆ (ไฟล์ยังอยู่ใน bucket)
- หน้าสินค้ารับได้ 3 รูป (กติกาเดิมของ josh) · ERP ส่งกี่รูปก็ได้
- รูปย่อสร้างตอน josh รับ snapshot — ถ้าล้มเหลว หน้าร้านใช้รูปเต็มแทน (josh ตกกลับให้เอง)
