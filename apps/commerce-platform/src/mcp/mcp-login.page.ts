const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Staff sign-in shown when an AI app (Claude, ChatGPT …) asks to connect. Self-contained, no external assets. */
export function loginPage({ requestId, clientName, error, canWrite = false }: { requestId: string; clientName: string; error?: string; canWrite?: boolean }) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>เชื่อมต่อ AI กับ Commerce Platform</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--fg:#1d2330;--muted:#5d6675;--line:#e1e4ea;--accent:#2a5bd7;--danger:#c2333f}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--panel:#1d2128;--fg:#e8ebf0;--muted:#9aa3b2;--line:#2c323c;--accent:#7aa2ff;--danger:#ff7b86}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:18px;margin:0 0 6px}p{color:var(--muted);margin:0 0 16px;font-size:13px}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:12px 0 4px}
input{width:100%;font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)}
button{margin-top:18px;width:100%;padding:10px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--danger);font-size:13px;margin-top:10px}
.write{display:flex;gap:8px;align-items:flex-start;margin-top:14px;font-size:13px;color:var(--fg);font-weight:400}.write input{width:auto;margin-top:3px}ul{margin:0 0 4px;padding-left:18px;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>${esc(clientName || 'แอป AI')} ขอเชื่อมต่อ Commerce Platform</h1>
<p>เข้าสู่ระบบด้วยบัญชี staff ของ commerce เพื่ออนุญาต</p>
<ul><li>อ่านและสรุปข้อมูลตามสิทธิ์ของบัญชีคุณ</li><li>แก้ไขข้อมูลไม่ได้ เว้นแต่ติ๊กอนุญาตด้านล่าง</li><li>ยกเลิกได้ทุกเมื่อที่หน้า AI connectors ใน commerce-admin</li></ul>
<form method="post" action="/mcp/oauth/login">
<input type="hidden" name="request_id" value="${esc(requestId)}">
<label for="email">อีเมล</label><input id="email" name="email" type="email" autocomplete="username" required>
<label for="password">รหัสผ่าน</label><input id="password" name="password" type="password" autocomplete="current-password" required>
${canWrite ? `<label class="write"><input type="checkbox" name="allow_write" value="1"> <span>อนุญาตให้แก้ไขข้อมูลบางอย่างด้วย: สร้าง/สั่งรัน research, บันทึกราคาคู่แข่ง, ตั้งค่าเก็บข้อมูลเว็บ, ส่ง event ซ้ำและปรับสต็อกคลังของเรา (admin) — ทุกครั้ง AI ต้องแสดงสิ่งที่จะทำและได้รับการยืนยันจากคุณก่อน</span></label>` : ''}
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<button type="submit">อนุญาตและเชื่อมต่อ</button>
</form></main></body></html>`;
}
