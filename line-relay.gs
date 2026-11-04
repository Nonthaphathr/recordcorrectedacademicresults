// ตัวส่งต่อแจ้งเตือนเข้ากลุ่ม LINE "ระบบแจ้งเตือนแก้ไขผลการเรียน"
// Script Properties ที่ต้องตั้ง: LINE_TOKEN (Channel access token), LINE_GROUP_ID, KEY (รหัสลับ ตรงกับในหน้าตั้งค่า)
// Deploy เป็น Web app (Execute as: Me, Who has access: Anyone) แล้วนำ URL /exec ไปใส่ในหน้าตั้งค่าของระบบ
// ใช้เป็น Webhook URL ของ LINE OA ได้ด้วย: เมื่อมีคนพิมพ์ในกลุ่ม สคริปต์จะบันทึก groupId ล่าสุดไว้ที่ LAST_GROUP_ID
function doPost(e) {
  var p = PropertiesService.getScriptProperties();
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  if (body.events) {                                  // webhook จาก LINE
    body.events.forEach(function (ev) { if (ev.source && ev.source.groupId) p.setProperty('LAST_GROUP_ID', ev.source.groupId); });
    return out({ ok: true });
  }
  if (p.getProperty('KEY') && body.key !== p.getProperty('KEY')) return out({ ok: false, error: 'bad key' });
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + p.getProperty('LINE_TOKEN') },
    payload: JSON.stringify({ to: p.getProperty('LINE_GROUP_ID'), messages: [{ type: 'text', text: String(body.text || '').slice(0, 4900) }] })
  });
  return out({ ok: res.getResponseCode() === 200, code: res.getResponseCode() });
}
function doGet() { return out({ ok: true }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
