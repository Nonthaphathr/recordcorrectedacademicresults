// ตัวส่งต่อแจ้งเตือนเข้ากลุ่ม LINE "ระบบแจ้งเตือนแก้ไขผลการเรียน"
// Script Properties: LINE_TOKEN, LINE_GROUP_ID, KEY
//   ไม่บังคับ: THRESHOLD (ค่าเริ่มต้น 0.7), DIGEST_HOUR (ค่าเริ่มต้น 17)
// โหมดแจ้งเตือน: ปกติ = ส่งทันทีทุกครั้ง · ถ้าโควตาเดือนนี้ใช้ถึง THRESHOLD -> เก็บเข้าคิวแล้วส่ง "สรุปรายวัน" วันละครั้ง
// ต้องรัน installTrigger() หนึ่งครั้ง (อนุญาตสิทธิ์) เพื่อตั้งเวลาส่งสรุปรายวัน

function props_() { return PropertiesService.getScriptProperties(); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function auth_() { return { Authorization: 'Bearer ' + props_().getProperty('LINE_TOKEN') }; }

function doPost(e) {
  var p = props_(), body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  if (body.events) {                                  // webhook จาก LINE (เก็บ groupId ล่าสุด)
    body.events.forEach(function (ev) { if (ev.source && ev.source.groupId) p.setProperty('LAST_GROUP_ID', ev.source.groupId); });
    return out_({ ok: true });
  }
  if (p.getProperty('KEY') && body.key !== p.getProperty('KEY')) return out_({ ok: false, error: 'bad key' });
  if (digestMode_()) {
    enqueue_(body.item || { line: String(body.text || '').split('\n')[0] });
    noticeSwitchOnce_();
    return out_({ ok: true, mode: 'digest' });
  }
  var code = push_([String(body.text || '').slice(0, 4900)]);
  return out_({ ok: code === 200, code: code, mode: 'instant' });
}

function doGet(e) {
  if (e && e.parameter && e.parameter.status) {
    var st = quota_(); return out_({ ok: true, mode: digestMode_() ? 'digest' : 'instant', used: st.used, limit: st.limit, type: st.type, queued: queueKeys_().length });
  }
  return out_({ ok: true });
}

// ── โควตา ──
function quota_() {
  var cache = CacheService.getScriptCache(), c = cache.get('q');
  if (c) return JSON.parse(c);
  var q = JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota', { headers: auth_(), muteHttpExceptions: true }).getContentText());
  var u = JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: auth_(), muteHttpExceptions: true }).getContentText());
  var st = { type: q.type, limit: q.value, used: u.totalUsage };
  cache.put('q', JSON.stringify(st), 300);
  return st;
}
function digestMode_() {
  try {
    var st = quota_();
    if (st.type !== 'limited' || !st.limit) return false;
    return st.used / st.limit >= parseFloat(props_().getProperty('THRESHOLD') || '0.7');
  } catch (err) { return false; }
}

// ── ส่ง ──
function push_(texts) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: auth_(),
    payload: JSON.stringify({ to: props_().getProperty('LINE_GROUP_ID'), messages: texts.map(function (t) { return { type: 'text', text: t }; }) })
  });
  CacheService.getScriptCache().remove('q');
  return res.getResponseCode();
}

// ── คิวสรุปรายวัน (1 รายการ = 1 property ขึ้นต้นด้วย Q_) ──
function enqueue_(item) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { props_().setProperty('Q_' + Date.now() + '_' + Math.floor(Math.random() * 1000), JSON.stringify(item)); } finally { lock.releaseLock(); }
}
function queueKeys_() { return Object.keys(props_().getProperties()).filter(function (k) { return k.indexOf('Q_') === 0; }).sort(); }
function noticeSwitchOnce_() {
  var m = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM'), p = props_();
  if (p.getProperty('SWITCH_NOTICE') === m) return;
  p.setProperty('SWITCH_NOTICE', m);
  var st = quota_();
  push_(['⚠️ โควตาข้อความ LINE เดือนนี้ใช้ไปแล้ว ' + st.used + '/' + st.limit + ' (ถึงเกณฑ์ ' + Math.round(parseFloat(p.getProperty('THRESHOLD') || '0.7') * 100) + '%)\nตั้งแต่นี้ถึงสิ้นเดือน ระบบจะสรุปการแก้ไขผลการเรียนส่งวันละ 1 ครั้ง']);
}

// ทำงานตามเวลาที่ตั้งไว้ (installTrigger)
function digestTick() {
  var keys = queueKeys_(); if (!keys.length) return;
  var p = props_(), items = keys.map(function (k) { try { return JSON.parse(p.getProperty(k)); } catch (e) { return null; } }).filter(Boolean);
  var d = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy');
  var lines = items.map(function (it, i) {
    if (it.line) return (i + 1) + '. ' + it.line;
    return (i + 1) + '. ' + it.student + (it.level ? ' (' + it.level + ')' : '') + ' · ' + it.code + ' ' + it.subject + ' · ' + it.oldResult + ' → ' + it.newResult + ' · ' + it.editor;
  });
  var head = '📋 สรุปการแก้ไขผลการเรียนประจำวัน ' + d + '\nรวม ' + items.length + ' รายการ\n';
  var chunks = [], cur = head;
  lines.forEach(function (l) { if ((cur + l + '\n').length > 4500) { chunks.push(cur); cur = ''; } cur += l + '\n'; });
  if (cur) chunks.push(cur);
  var code = push_(chunks.slice(0, 5));                // ส่งครั้งเดียวสูงสุด 5 ข้อความ นับโควตาเท่ากับ 1 ครั้ง
  if (code === 200) keys.forEach(function (k) { p.deleteProperty(k); });
}

// รันครั้งเดียวจากตัวแก้ไข เพื่อตั้งเวลาส่งสรุปรายวัน
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'digestTick') ScriptApp.deleteTrigger(t); });
  var h = parseInt(props_().getProperty('DIGEST_HOUR') || '17', 10);
  ScriptApp.newTrigger('digestTick').timeBased().everyDays(1).atHour(h).inTimezone('Asia/Bangkok').create();
}
