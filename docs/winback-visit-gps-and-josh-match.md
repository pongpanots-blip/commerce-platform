# GPS การเข้าเยี่ยม และการเช็คลูกค้าจาก enrich กับ user ใน Josh: คู่มือสำหรับทีม mobile app

> อัปเดต 2026-10-08 · ฝั่ง API: `apps/commerce-platform` (winback module)
> Base path: `/api/winback/...` · ใช้ token เดิมของแอปขาย (Bearer)

## สรุปสั้น ๆ: แอปต้องทำอะไร

| # | งานฝั่งแอป | จำเป็นไหม |
|---|---|---|
| 1 | ตอน **check-in** ส่ง `lat`, `lng`, `accuracy_m` | ควรทำ (ไม่ส่งก็ยังใช้ได้ แต่ระบบจะติดสถานะ `no_gps`) |
| 2 | ตอน **check-out** ส่ง `lat`, `lng`, `accuracy_m` เพิ่ม (ฟิลด์ใหม่) | ควรทำ |
| 3 | หน้าร้าน/lead: เรียก `GET /api/winback/account/:id/josh-match` แล้วแสดงผลว่า "ตรงกับลูกค้าใน Josh หรือไม่" | แนะนำ |
| 4 | หลังกด "ยืนยันสมัครแอปแล้ว" (promote) อ่าน `joshMatch.status` ใน response แล้วแสดงคำเตือนถ้าไม่ใช่ `matched` | แนะนำ |
| 5 | (manager) หน้า GPS การเข้าเยี่ยม: `GET /api/winback/visit-gps` | ทางเลือก |

ฟิลด์ใหม่ทั้งหมดเป็น **optional** แอปเวอร์ชันเก่าที่ไม่ส่งยังใช้งานได้เหมือนเดิม

### ⚠️ ต้องรู้ก่อน: ตอนนี้ใครรับข้อมูล check-in

- ตอนนี้ winback ยังให้ **Josh เป็นเจ้าของ** (`WINBACK_OWNER=josh`) แอปเขียน check-in/check-out ไปที่ backend ของ Josh แล้ว commerce mirror ข้อมูลมาทุก 5 นาที
- ระหว่างนี้ ถ้าเรียก endpoint เขียนของ commerce จะได้ `409` ("winback is still run by josh …")
- **ฟิลด์ใหม่ (`accuracy_m`, GPS ตอน check-out) จะถูกเก็บก็ต่อเมื่อ request ถึง commerce** คือหลัง switch เป็น `WINBACK_OWNER=commerce` แล้ว หรือฝั่ง Josh เพิ่มฟิลด์เดียวกันให้ด้วย การ mirror ซิงก์เฉพาะคอลัมน์ที่มีทั้งสองฝั่ง
- **สิ่งที่ใช้ได้ตั้งแต่วันนี้:** รายงาน GPS คำนวณจาก `lat`/`lng` ตอน check-in ที่ Josh เก็บอยู่แล้ว แอปเก่าที่ส่งพิกัดตอน check-in จะเห็นผล `on_site`/`off_site` ทันทีที่ deploy
- ก่อนเริ่มส่งฟิลด์ใหม่ไป Josh ให้เช็คกับทีม backend Josh ว่า validation ฝั่งนั้นไม่ปฏิเสธฟิลด์ที่ไม่รู้จัก (ฝั่ง commerce ตัดฟิลด์ที่ไม่รู้จักทิ้งเฉย ๆ ไม่ error)

### รูปแบบข้อมูล

- **Request body ใช้ snake_case** (`accuracy_m`, `planned_activity_id`)
- **Response ห่อใน `{ "data": ... }` และ key เป็น camelCase** (`accuracyM`, `distanceM`)
- ค่าตัวเลขพิกัดใน response อาจมาเป็น string (คอลัมน์ numeric) ให้ parse เป็น number ก่อนใช้

---

## 1. Check-in (ฟิลด์ GPS)

`POST /api/winback/account/:accountId/checkin`

```json
{
  "type": "store_visit",
  "lat": 13.7460123,
  "lng": 100.5350456,
  "accuracy_m": 12.5,
  "note": "เข้าพบเจ้าของร้าน",
  "planned_activity_id": "optional-uuid-ของนัดที่วางไว้"
}
```

| ฟิลด์ | ชนิด | กติกา |
|---|---|---|
| `lat` | number | -90 ถึง 90 |
| `lng` | number | -180 ถึง 180 |
| `accuracy_m` | number | **ใหม่** ความแม่นยำของพิกัด (เมตร) ค่า 0 ถึง 100000 |

ถ้ามี check-in ที่ยังเปิดอยู่ (`in_progress`) ของร้านนี้ ระบบจะอัปเดตพิกัดและ accuracy ลง activity เดิม ไม่สร้างใหม่ (เหมือนเดิม)

## 2. Check-out (ฟิลด์ใหม่)

`PATCH /api/winback/activities/:activityId/checkout`

```json
{
  "outcome": "interested",
  "types": ["store_visit", "call"],
  "note": "ส่งใบเสนอราคาแล้ว",
  "photo_urls": ["https://..."],
  "lat": 13.7461001,
  "lng": 100.5349002,
  "accuracy_m": 9
}
```

- `lat`, `lng`, `accuracy_m` เป็นฟิลด์ **ใหม่ทั้งหมด** กติกาเดียวกับ check-in
- ต้องส่ง `lat` และ `lng` **คู่กัน** ถ้าส่งมาตัวเดียว ระบบจะไม่บันทึกพิกัด check-out

## 3. วิธีอ่าน GPS บนมือถือ (แนะนำ)

- ขอความแม่นยำสูง (iOS: `kCLLocationAccuracyBest`, Android: `Priority.PRIORITY_HIGH_ACCURACY`, web: `enableHighAccuracy: true`)
- ใช้ fix ที่สด: `maximumAge` ไม่เกิน 30 วินาที และ timeout ประมาณ 10 วินาที
- ส่ง `accuracy_m` จากค่าที่ OS ให้มา (iOS `horizontalAccuracy`, Android `Location.getAccuracy()`, web `coords.accuracy`)
- **ถ้าไม่ได้สิทธิ์หรือหา GPS ไม่ได้ ให้ไม่ส่ง `lat`/`lng` เลย ห้ามส่ง `0,0`** (ระบบถือว่า `0,0` คือไม่มีพิกัด) แล้วยัง check-in ต่อได้ตามปกติ
- ถ้า accuracy แย่มาก (เช่น เกิน 100 ม.) แอปอาจแจ้งให้รอสักครู่หรือออกไปที่โล่ง แต่ไม่จำเป็นต้องบล็อก

## 4. วิธีที่ระบบตัดสินว่า "อยู่ที่ร้านจริง"

ระบบเทียบพิกัดพนักงานกับพิกัดร้าน (`lat`/`lng` ของ account ซึ่ง lead จาก Market Explorer ได้มาจากข้อมูล enrich)

| สถานะ | ความหมาย |
|---|---|
| `on_site` | ห่างจากร้านไม่เกินรัศมี (ค่าเริ่มต้น **200 ม.** ตั้งได้ด้วย `WINBACK_VISIT_RADIUS_M`) |
| `off_site` | อยู่นอกรัศมี |
| `no_gps` | แอปไม่ได้ส่งพิกัด |
| `no_customer_location` | ร้านยังไม่มีพิกัด (ให้เซลล์ปักหมุดร้านใน account) |

- ค่า `accuracy_m` ช่วยขยายรัศมีได้ แต่ไม่เกินขนาดรัศมีเอง ตัวอย่าง: fix ที่แม่นยำ 60 ม. ห่างร้าน 230 ม. ยังนับว่า on_site
- ระบบคำนวณตอนดูรายงาน ถ้าแก้หมุดร้านทีหลัง ผลจะเปลี่ยนตาม

## 5. ดูรายงาน GPS การเข้าเยี่ยม

`GET /api/winback/visit-gps?from=2026-10-01&to=2026-10-08&sales_user_id=<uuid>`

- sale เห็นเฉพาะของตัวเอง ส่วน manager เห็นทั้งทีม และกรองรายคนได้ด้วย `sales_user_id`
- ไม่ส่ง `from`/`to` จะได้ข้อมูลของ **วันนี้**

```json
{
  "data": {
    "radiusM": 200,
    "summary": [
      { "salesUserId": "…", "name": "Ada Sale", "visits": 12, "onSite": 9, "offSite": 1,
        "noGps": 2, "noCustomerLocation": 0, "onSiteRate": 90 }
    ],
    "visits": [
      {
        "activityId": "…", "salesUserId": "…", "name": "Ada Sale",
        "accountId": "…", "accountName": "ร้านส้มตำนัว", "fromEnrichedPlace": true,
        "type": "store_visit", "status": "done",
        "activityAt": "2026-10-08T03:00:00.000Z",
        "checkinAt": "2026-10-08T03:00:00.000Z", "checkoutAt": "2026-10-08T03:40:00.000Z",
        "customerLat": 13.746, "customerLng": 100.535,
        "checkin":  { "lat": 13.747, "lng": 100.535, "accuracyM": 10, "status": "on_site", "distanceM": 111 },
        "checkout": { "lat": null, "lng": null, "accuracyM": null, "status": "no_gps", "distanceM": null }
      }
    ]
  }
}
```

- `onSiteRate` คิดเฉพาะการเยี่ยมที่ตัดสินได้ (`on_site` + `off_site`) และเป็น `null` ถ้าไม่มีเลย
- ถ้าใน check-out เดียวเลือกหลายประเภท ระบบจะสร้างหลาย activity แต่รายงานนับเป็น 1 การเยี่ยม

---

## 6. เช็คว่าลูกค้า (จาก enrich) ตรงกับ user ใน Josh

`GET /api/winback/account/:accountId/josh-match`

endpoint นี้อ่านอย่างเดียว ไม่ผูกหรือแก้ข้อมูลให้เอง ระบบเทียบหลักฐาน 4 อย่างกับลูกค้าใน Josh:

| หลักฐาน (`key`) | เทียบอะไร | น้ำหนัก |
|---|---|---|
| `customer_code` | รหัสลูกค้า กับ custcode / legacy custcode | แข็ง |
| `register_number` | เลขทะเบียนบริษัท / เลขผู้เสียภาษี / เลขบัตรประชาชน (เทียบเฉพาะตัวเลข) | แข็ง |
| `email` | อีเมลร้าน + อีเมลผู้ติดต่อทุกคน (ไม่สนตัวพิมพ์เล็กใหญ่) | แข็ง |
| `company_name` | ชื่อบริษัท / ชื่อร้าน กับชื่อบริษัทใน Josh (ตัด "บริษัท … จำกัด", "Co., Ltd.", ช่องว่าง, เครื่องหมาย) | อ่อน: ได้แค่ "ผู้ต้องสงสัย" |

```json
{
  "data": {
    "accountId": "…", "customerCode": "TMP-…", "displayName": "ส้มตำนัว",
    "restaurantPlaceId": "…", "lifecycle": "tmp", "assignedSalesUserId": "…",
    "status": "found_not_linked",
    "linked": { "joshUserId": null, "joshCompanyId": null },
    "candidate": { "joshUserId": "…", "joshCompanyId": "…" },
    "conflicts": [],
    "signals": [
      { "key": "customer_code",   "value": "TMP-…",              "userIds": [],      "companyIds": [] },
      { "key": "register_number", "value": "010******5678",      "userIds": ["…"],  "companyIds": ["…"] },
      { "key": "email",           "value": "ow***@somtum.co.th", "userIds": ["…"],  "companyIds": ["…"] },
      { "key": "company_name",    "value": "ส้มตำนัว",            "userIds": [],      "companyIds": [] }
    ],
    "companyNames": { "<companyId>": "บริษัท ร้านส้มตำนัว จำกัด" }
  }
}
```

ใน `signals[].value` เลขภาษี/บัตรประชาชนและอีเมลจะถูก mask เสมอ (PDPA)

### สถานะ และข้อความที่แนะนำให้แสดง

| `status` | ความหมาย | ข้อความแนะนำในแอป | สี |
|---|---|---|---|
| `matched` | ผูกกับ user ใน Josh แล้ว และหลักฐานยืนยันตรงกัน | ✅ ตรงกับลูกค้าใน Josh | เขียว |
| `found_not_linked` | เจอลูกค้าใน Josh คนเดียวชัดเจน แต่ lead นี้ยังไม่ได้ผูก | 🔗 พบลูกค้านี้ใน Josh: {companyNames[candidate.joshCompanyId]} | ฟ้า |
| `mismatch` | ผูกอยู่กับคนหนึ่ง แต่หลักฐานใน `conflicts` ชี้ไปอีกคน | ⚠️ ข้อมูลไม่ตรงกับลูกค้าที่ผูกไว้ (ตรวจ: {conflicts}) | แดง |
| `ambiguous` | หลักฐานชี้ไปหลายลูกค้า | ⚠️ พบลูกค้าใน Josh มากกว่า 1 ราย ต้องตรวจ | ส้ม |
| `name_only` | ตรงแค่ชื่อ | ❔ ชื่อคล้ายลูกค้าใน Josh: {ชื่อ} ต้องยืนยันด้วยเลขภาษี/อีเมล | เหลือง |
| `linked_unverified` | ผูกแล้ว แต่ในข้อมูลร้านไม่มีอะไรยืนยัน (ยังไม่กรอกเลขภาษี/อีเมล) | ℹ️ ผูกแล้ว แต่ยังยืนยันไม่ได้ กรอกเลขภาษีหรืออีเมลเพิ่ม | เทา |
| `no_match` | ไม่พบใน Josh | ✖️ ยังไม่พบลูกค้านี้ใน Josh (ยังไม่สมัครแอป?) | เทา |

ทำให้ผลแม่นขึ้นได้ด้วยการให้เซลล์กรอก **เลขทะเบียนบริษัท/เลขบัตรประชาชน** และ **อีเมล** (ร้านหรือผู้ติดต่อ) ให้ตรงกับที่ลูกค้าใช้สมัครแอป Josh

## 7. Promote ("ยืนยันสมัครแอปแล้ว"): มีคำเตือนเพิ่ม

`PATCH /api/winback/account/:accountId/promote` ทำงานเหมือนเดิม และ **ไม่บล็อก** แต่ response มี field ใหม่ `joshMatch`:

```json
{
  "data": {
    "id": "…", "lifecycle": "lead", "…": "…",
    "joshMatch": { "status": "no_match", "conflicts": [], "candidate": null }
  }
}
```

ถ้า `joshMatch.status` ไม่ใช่ `matched` ให้แสดงคำเตือนตามตารางข้อ 6 เช่น "promote แล้ว แต่ยังไม่พบลูกค้านี้ใน Josh"
ถ้า `joshMatch` เป็น `null` แปลว่า promote สำเร็จ แต่ตรวจกับ Josh ไม่ได้ในตอนนั้น ให้เรียกข้อ 6 ซ้ำภายหลัง

---

## 8. สำหรับหน้า admin (manager / business analyst): ไม่ใช่งาน mobile

ใช้ token staff ของ commerce-admin:

- `GET /api/reports/winback/gps-visits?from&to&sales_user_id` ข้อมูลเดียวกับข้อ 5 แต่ครอบคลุมทั้งทีม
- `GET /api/reports/winback/enrich-match?status=&limit=50&offset=0` ไล่ทุก lead ที่สร้างจากร้านใน Market Explorer
  - คืน `meta.counts` นับตามสถานะ เช่น `{ matched, foundNotLinked, mismatch, … }` พร้อมรายการทีละหน้า (`limit` สูงสุด 200)
  - กรองด้วย `status=mismatch` เพื่อดูเฉพาะที่ต้องแก้

## Error ที่อาจเจอ

| HTTP | เมื่อไร |
|---|---|
| 400 | `lat`/`lng`/`accuracy_m` อยู่นอกช่วง หรือ `from`/`to` ผิดรูปแบบ |
| 404 | ไม่พบ account |
| 409 | เรียก endpoint เขียนของ commerce ขณะที่ `WINBACK_OWNER` ยังเป็น josh |
