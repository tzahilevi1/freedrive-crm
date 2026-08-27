/* ============================================================
   פרי דרייב — CRM module: clean leads table, full-page lead view
   (prev/next, clickable status, quick actions, car picker, timeline),
   manager dashboard, and a status menu reusable anywhere. window.C2B.
   ============================================================ */
(function () {
  'use strict';
  var C = window.C2B;
  if (!C) return;
  var db = C.db, esc = C.esc, fmt = C.fmt, nis = C.nis, view = C.view, loading = C.loading, errBox = C.errBox;
  // single delegated auto-save handler for the deal form — points at the CURRENT form only
  // (prevents old listeners from stacking on the persistent #view and overwriting other deals).
  var _activeAutoSave = null, _autoSaveWired = false;

  var STATUSES = [
    { k: 'new', label: 'חדש', icon: '🆕', color: '#3b82f6', flow: true },
    { k: 'in_progress', label: 'בטיפול', icon: '📞', color: '#6366f1', flow: true },
    { k: 'meeting_set', label: 'פגישה נקבעה', icon: '📅', color: '#8b5cf6', flow: true },
    { k: 'quote_sent', label: 'הצעת מחיר', icon: '💰', color: '#6E8B10', flow: true },
    { k: 'underwriting', label: 'בתהליך חיתום', icon: '📝', color: '#eab308', flow: true },
    { k: 'won', label: 'עסקה נסגרה', icon: '✅', color: '#16a34a', flow: true, terminal: true },
    { k: 'lost', label: 'לא רלוונטי', icon: '❌', color: '#e2555a', terminal: true },
    { k: 'no_answer', label: 'אין מענה', icon: '🚫', color: '#f59e0b' }
  ];
  var FLOW = STATUSES.filter(function (s) { return s.flow; });
  function stDef(k) { for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].k === k) return STATUSES[i]; return STATUSES[0]; }
  var CLOSE_REASONS = ['רכש במקום אחר', 'לא מעוניין', 'מחיר גבוה', 'לא עומד בתנאים', 'טעות בפרטים', 'כפילות ליד', 'סיבה אחרת'];
  var DEAL_STAGES = [
    { k: 'awaiting', label: 'ממתין לחתימה', color: '#f59e0b' },
    { k: 'initial', label: 'עסקה ראשונית', color: '#3b82f6' },
    { k: 'screening', label: 'שיחת שיקוף', color: '#6366f1' },
    { k: 'submitted', label: 'הוגש למימון', color: '#8b5cf6' },
    { k: 'approved', label: 'אושר מימון', color: '#0ea5e9' },
    { k: 'signed', label: 'נחתם מימון', color: '#f5691e' },
    { k: 'collection', label: 'שיחת גבייה', color: '#eab308' },
    { k: 'ordered', label: 'הזמנת רכב', color: '#14b8a6' },
    { k: 'delivered', label: 'רכב נמסר', color: '#16a34a' },
    { k: 'cancelled', label: 'בוטל', color: '#ef4444' }
  ];
  // סיבות ביטול עסקה (מנהלת תיקי לקוחות)
  var CANCEL_REASONS = ['לא אושר מימון', 'הלקוח חזר בו', 'מצא רכב/עסקה במקום אחר', 'מחיר גבוה מדי / חוסר תקציב', 'בעיה בזמינות/אספקת הרכב', 'שינוי נסיבות אישיות', 'לא ניתן ליצירת קשר', 'כפילות רשומה', 'אחר'];
  function stageDef(k) { for (var i = 0; i < DEAL_STAGES.length; i++) if (DEAL_STAGES[i].k === k) return DEAL_STAGES[i]; return DEAL_STAGES[0]; }
  // sync ONLY the closing of the deal to the sales lead status — intermediate
  // file-manager stages do NOT auto-change the sales agent's status.
  var STAGE_TO_STATUS = { delivered: 'won', cancelled: 'lost' };
  function syncLeadFromStage(lead, stage) {
    var target = STAGE_TO_STATUS[stage];
    if (!target || lead.status === target) return;
    var from = lead.status;
    changeStatus(lead.id, target, { status: from }, function () {
      if (stage === 'delivered') logActivity(lead.id, 'system', '🎉 העסקה נסגרה — הרכב נמסר ללקוח');
    });
    lead.status = target;
  }
  // צ'קליסט איסוף מסמכים מהלקוח — זהה לסוכן המכירות ולמנהלת תיקי הלקוחות
  var CHECKLIST_ITEMS = ['תעודת זהות – צילום שני הצדדים כולל ספח פתוח', 'רישיון נהיגה', 'כתובת אימייל', 'אישור ניהול חשבון בנק', 'כרטיס אשראי – צילום שני הצדדים'];
  var FILE_CHECKLIST_ITEMS = CHECKLIST_ITEMS;
  function stageBar(cur) {
    var steps = DEAL_STAGES.filter(function (s) { return s.k !== 'cancelled'; });
    var cancelled = cur === 'cancelled';
    var idx = steps.map(function (s) { return s.k; }).indexOf(cur);
    var html = steps.map(function (s, i) {
      var state = cancelled ? 'gray' : (i < idx ? 'green' : i === idx ? 'cur' : 'gray');
      var bg = { gray: 'var(--surface-2)', cur: s.color, green: '#16a34a' }[state];
      return '<div class="st" data-stage="' + s.k + '" style="cursor:pointer;background:' + bg + ';color:' + (state === 'gray' ? 'var(--muted)' : '#fff') + '">' + esc(s.label) + '</div>';
    }).join('');
    // כפתור ביטול נפרד (אדום) — לא חלק מהפרוגרס הליניארי
    html += '<div class="st" data-stage="cancelled" style="cursor:pointer;font-weight:700;background:' + (cancelled ? '#ef4444' : 'var(--surface-2)') + ';color:' + (cancelled ? '#fff' : '#ef4444') + '">✕ ' + (cancelled ? 'בוטל' : 'בטל עסקה') + '</div>';
    return html;
  }
  // מודל בחירת סיבת ביטול — cb(reason) לאישור, cb(null) לביטול הפעולה
  function pickCancelReason(current, cb) {
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    var opts = CANCEL_REASONS.map(function (r) { return '<option value="' + esc(r) + '"' + (current === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('');
    host.innerHTML = '<div style="background:var(--surface);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.4);max-width:430px;width:100%;padding:20px" onclick="event.stopPropagation()">' +
      '<h3 style="margin:0 0 4px;color:#ef4444">✕ ביטול עסקה</h3><p class="muted" style="font-size:12.5px;margin:0 0 14px">בחרו סיבה — הליד יעבור לסטטוס "אבוד".</p>' +
      '<label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">סיבת הביטול</label><select class="inp" id="crSel" style="width:100%">' + opts + '</select>' +
      '<input class="inp" id="crOther" placeholder="פירוט (חובה עבור \'אחר\', אחרת אופציונלי)" style="width:100%;margin-top:10px">' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn btn-ghost btn-sm" id="crBack">חזרה</button><button class="btn btn-sm" id="crOk" style="background:#ef4444">אשר ביטול</button></div></div>';
    document.body.appendChild(host);
    function close() { host.remove(); }
    host.addEventListener('click', function (e) { if (e.target === host) { close(); cb(null); } });
    document.getElementById('crBack').addEventListener('click', function () { close(); cb(null); });
    document.getElementById('crOk').addEventListener('click', function () {
      var sel = document.getElementById('crSel').value, other = document.getElementById('crOther').value.trim();
      if (sel === 'אחר' && !other) { alert('נא לפרט את סיבת הביטול.'); return; }
      var reason = sel === 'אחר' ? other : (other ? sel + ' — ' + other : sel);
      close(); cb(reason);
    });
  }
  // התראה למנהלת חשבונות על ביטול עסקה — משימה בפעמון + פעילות בציר הזמן.
  // (מנהלת חשבונות רואה את המשימה דרך can_see_lead — כלומר עבור עסקאות חתומות עם השלכה כספית.)
  function notifyAccountingCancel(leadId, dealObj, reason) {
    var title = '❌ עסקה בוטלה — ' + (dealObj.client_name || 'לקוח') + (dealObj.order_no ? ' #' + dealObj.order_no : '') + ' · סיבה: ' + (reason || '—') + ' (לבדיקת החזר/חשבונית)';
    var due = new Date().toISOString();
    db.from('profiles').select('user_id').eq('role', 'accounting').eq('active', true).then(function (r) {
      var accs = (r.data || []).map(function (p) { return p.user_id; });
      var rows = accs.length ? accs.map(function (uid) { return { lead_id: leadId, title: title, assigned_to: uid, due_at: due }; })
        : [{ lead_id: leadId, title: title, due_at: due }];
      db.from('tasks').insert(rows).then(function () {});
    });
    logActivity(leadId, 'system', 'התראה להנהלת חשבונות: עסקה בוטלה — ' + (reason || ''));
  }
  function stageBadge(k) { var s = stageDef(k); return '<span class="stage-pill" style="border-color:' + s.color + ';color:' + s.color + ';background:' + s.color + '14"><span class="sd" style="background:' + s.color + '"></span>' + esc(s.label) + '</span>'; }
  var ACT_ICON = { note: '🗒️', call: '📞', whatsapp: '💬', email: '📧', sms: '✉️', status_change: '🔄', task: '✔️', meeting: '📅', document: '📎', quote: '📄', contract: '✍️', car: '🚗', system: '⚙️' };

  function badge(k, clickable, leadId) { var s = stDef(k); return '<span class="tag' + (clickable ? ' click" data-st-lead="' + leadId + '" data-cur="' + k : '') + '" style="border-color:' + s.color + ';color:' + s.color + ';background:' + s.color + '18">' + s.icon + ' ' + esc(s.label) + (clickable ? ' ▾' : '') + '</span>'; }
  function initials(name) { return String(name || '?').trim().split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('') || '?'; }
  function waIntl(phone) { var p = String(phone || '').replace(/\D/g, ''); if (p.charAt(0) === '0') p = '972' + p.slice(1); return p; }
  function waLink(phone) { var p = waIntl(phone); return p ? 'https://wa.me/' + p : null; }
  function logActivity(id, type, body, meta) { return db.from('activities').insert({ lead_id: id, type: type, body: body || null, meta: meta || null, created_by: C.userId || null }); }

  // ---- reusable status menu (status changeable from anywhere) ----
  function closeStMenu() { var m = document.getElementById('stmenu'); if (m) m.remove(); }
  function openStatusMenu(anchor, current, onPick) {
    closeStMenu();
    var m = document.createElement('div'); m.className = 'stmenu'; m.id = 'stmenu';
    m.innerHTML = STATUSES.map(function (s) { return '<div class="si" data-k="' + s.k + '" style="color:' + s.color + '">' + s.icon + ' ' + esc(s.label) + (s.k === current ? ' ✓' : '') + '</div>'; }).join('');
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = (r.bottom + window.scrollY + 4) + 'px';
    m.style.left = Math.max(8, r.left + window.scrollX - 60) + 'px';
    m.querySelectorAll('.si').forEach(function (si) { si.addEventListener('click', function (e) { e.stopPropagation(); onPick(si.dataset.k); closeStMenu(); }); });
    setTimeout(function () { document.addEventListener('click', closeStMenu, { once: true }); }, 0);
  }
  // ---- quick-assign a lead to a salesperson (from the leads table) ----
  function closeAssignMenu() { var m = document.getElementById('assignmenu'); if (m) m.remove(); }
  function closeStageMenu() { var m = document.getElementById('stagemenu'); if (m) m.remove(); }
  // pop-up to change a deal's file stage from anywhere (e.g. the files table)
  function openStageMenu(anchor, dealObj, after) {
    closeStageMenu();
    var m = document.createElement('div'); m.className = 'stmenu'; m.id = 'stagemenu'; m.style.minWidth = '190px';
    m.innerHTML = DEAL_STAGES.map(function (s) { return '<div class="si" data-stg="' + s.k + '"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + s.color + ';margin-inline-end:7px;vertical-align:middle"></span>' + esc(s.label) + ((dealObj.stage || 'initial') === s.k ? ' ✓' : '') + '</div>'; }).join('');
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = (r.bottom + window.scrollY + 4) + 'px'; m.style.left = (r.left + window.scrollX) + 'px';
    m.addEventListener('click', function (e) {
      var it = e.target.closest('[data-stg]'); if (!it) return; var stg = it.dataset.stg; closeStageMenu();
      if ((dealObj.stage || 'initial') === stg) return;
      function doUpdate(upd) {
        dealObj.stage = stg; if ('cancel_reason' in upd) dealObj.cancel_reason = upd.cancel_reason;
        db.from('deals').update(upd).eq('id', dealObj.id).then(function (rr) {
          if (rr.error) return alert('שגיאה: ' + rr.error.message);
          logActivity(dealObj.lead_id, 'system', 'שלב תיק: ' + stageDef(stg).label + (upd.cancel_reason ? ' — ' + upd.cancel_reason : ''));
          if (upd.cancel_reason) notifyAccountingCancel(dealObj.lead_id, dealObj, upd.cancel_reason);
          db.from('leads').select('status').eq('id', dealObj.lead_id).single().then(function (lr) { if (lr.data) syncLeadFromStage({ id: dealObj.lead_id, status: lr.data.status }, stg); });
          if (after) after();
        });
      }
      if (stg === 'cancelled') { pickCancelReason(dealObj.cancel_reason, function (reason) { if (reason == null) return; doUpdate({ stage: stg, cancel_reason: reason }); }); }
      else doUpdate({ stage: stg, cancel_reason: null });
    });
    setTimeout(function () { document.addEventListener('click', closeStageMenu, { once: true }); }, 0);
  }
  function openAssignMenu(anchor, leadId, current, onPick) {
    closeAssignMenu();
    var m = document.createElement('div'); m.className = 'stmenu'; m.id = 'assignmenu'; m.style.minWidth = '190px';
    var uids = Object.keys(profiles);
    m.innerHTML = '<div class="si" data-uid="" style="color:var(--muted)">— בטל שיוך —</div>' +
      (uids.length ? uids.map(function (uid) { return '<div class="si" data-uid="' + uid + '"><span class="avatar" style="width:22px;height:22px;font-size:11px;margin-inline-end:7px">' + esc(initials(profiles[uid])) + '</span>' + esc(profiles[uid]) + (uid === current ? ' ✓' : '') + '</div>'; }).join('') : '<div class="si muted">אין סוכנים זמינים</div>');
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = (r.bottom + window.scrollY + 4) + 'px';
    m.style.left = Math.max(8, r.left + window.scrollX - 40) + 'px';
    m.querySelectorAll('.si[data-uid]').forEach(function (si) { si.addEventListener('click', function (e) { e.stopPropagation(); onPick(si.dataset.uid); closeAssignMenu(); }); });
    setTimeout(function () { document.addEventListener('click', closeAssignMenu, { once: true }); }, 0);
  }
  // ליד ללא שיוך מוצג כברירת מחדל כשייך למנהל הראשי (המשתמש admin המחובר)
  function mainManagerUid() { return (C.role === 'admin' && profiles[C.userId]) ? C.userId : ''; }
  function assignChip(l) {
    var eff = l.assigned_to || mainManagerUid();
    var name = profiles[eff];
    var inner = name ? '<span class="avatar">' + esc(initials(name)) + '</span> ' + esc(name) + (!l.assigned_to ? ' <span class="muted" style="font-size:10px">(מנהל)</span>' : '') : '<span class="muted">🔗 שייך לסוכן</span>';
    return '<span class="assign-chip" data-assign="' + l.id + '" data-cur="' + (l.assigned_to || '') + '" title="שיוך לסוכן מכירות">' + inner + ' <span class="muted">▾</span></span>';
  }
  function assignLead(leadId, uid) {
    // דרך RPC (security definer) — מאפשר העברה גם כשהמעביר מאבד גישה לליד; הטריגר מתעד אוטומטית
    db.rpc('transfer_leads', { p_leads: [leadId], p_to: uid || null }).then(function (r) {
      if (r.error) return alert('שגיאה בשיוך: ' + r.error.message);
      window.C2B_renderLeads(curFilter);
    });
  }
  // ---- automation engine: run active rules whose trigger status matches the new status ----
  function fillMsg(t, lead) { return String(t || '').replace(/\{name\}/g, (lead && lead.name) || '').replace(/\{firstname\}/g, (((lead && lead.name) || '').split(' ')[0])).replace(/\{car\}/g, (lead && lead.car) || ''); }
  // real customer send via the "send-message" Edge Function (email = Resend, whatsapp = Meta)
  function sendCustomerMsg(channel, lead, p) {
    var to = channel === 'email' ? (lead && lead.email) : (lead && lead.phone);
    if (!to) return Promise.resolve(false);
    var payload = { channel: channel, to: to, text: fillMsg(p.text || '', lead) };
    if (channel === 'email') { payload.subject = p.subject || 'עדכון מ-פרי דרייב'; payload.fromName = (lead && (lead.marketing_company || lead.brand)) || 'פרי דרייב'; }
    if (channel === 'whatsapp') { payload.name = (lead && lead.name) || ''; if (p.template) payload.template = p.template; }
    return db.functions.invoke('send-message', { body: payload }).then(function (r) { return !(r.error || (r.data && r.data.error)); }, function () { return false; });
  }
  // מנוע האוטומציות עבר לרמת המסד (hardening-5-automations.sql) כדי שירוץ גם
  // בעדכון מרוכז, אחרי חתימת לקוח, ועל ליד שנקלט מפייסבוק או מ-API.
  // כאן נשארת רק המתנה קצרה כדי שהטריגר יספיק לכתוב לפני שהמסך מצויר מחדש.
  function runAutomations(leadId, newStatus, lead, done) {
    return new Promise(function (res) {
      setTimeout(function () { if (C.refreshBadges) C.refreshBadges(); if (done) done(); res(); }, 450);
    });
  }
  C.runAutomations = runAutomations;   // reusable from other status-change paths

  function changeStatus(leadId, to, lead, after) {
    var from = lead && lead.status;
    if (from === to) { if (after) after(); return; }   // no-op: don't log/patch a status that didn't change
    var patch = { status: to, status_changed_at: new Date().toISOString() };
    if (to === 'in_progress' && (!lead || !lead.first_response_at)) patch.first_response_at = new Date().toISOString();
    db.from('leads').update(patch).eq('id', leadId).then(function (u) {
      if (u.error) return alert('שגיאה: ' + u.error.message);
      logActivity(leadId, 'status_change', from ? ('סטטוס: ' + stDef(from).label + ' → ' + stDef(to).label) : ('סטטוס שונה ל: ' + stDef(to).label)).then(function () {
        runAutomations(leadId, to, lead, after);   // fire rules, THEN re-render so the timeline shows them
      });
    });
  }

  // admin-managed dropdown options for a field (or null → free-text filter)
  // ---- ולידציית קלט ----
  // הבדיקות רצות גם בדפדפן (הודעה ידידותית מיד) וגם במסד (CHECK constraint),
  // כי טופס ציבורי, ייבוא CSV ו-API עוקפים את הדפדפן לגמרי.
  var MAX_LEN = { name: 120, email: 160, car: 160, city: 80, id_num: 20, phone: 25 };
  function normPhone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
  function validPhone(v) {
    var d = normPhone(v);
    if (d.indexOf('972') === 0) d = '0' + d.slice(3);
    return /^0(5[0-9]|[2-4,8-9]|7[0-9])[0-9]{7}$/.test(d);
  }
  function validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(v || '').trim()); }
  function validIdNum(v) { var d = normPhone(v); return d.length >= 8 && d.length <= 9; }
  // מחזיר הודעת שגיאה ראשונה, או null אם הכל תקין
  function validateLead(f) {
    if (!String(f.name || '').trim() && !String(f.phone || '').trim()) return 'נא למלא לפחות שם או טלפון';
    if (f.phone && !validPhone(f.phone)) return 'מספר טלפון לא תקין — צריך להיות מספר ישראלי, למשל 050-1234567';
    if (f.email && !validEmail(f.email)) return 'כתובת מייל לא תקינה';
    if (f.id_num && !validIdNum(f.id_num)) return 'ת.ז / ח.פ צריך להיות 8 או 9 ספרות';
    for (var k in MAX_LEN) {
      if (f[k] && String(f[k]).length > MAX_LEN[k]) return 'השדה "' + k + '" ארוך מדי (מקסימום ' + MAX_LEN[k] + ' תווים)';
    }
    return null;
  }
  // מחפש ליד קיים לפי טלפון/מייל כדי להזהיר לפני יצירת כפילות
  function findExistingLead(phone, email) {
    var d = normPhone(phone);
    var ors = [];
    if (d.length >= 9) ors.push('phone.ilike.%' + d.slice(-9) + '%');
    if (email) ors.push('email.eq.' + String(email).trim().toLowerCase());
    if (!ors.length) return Promise.resolve(null);
    return db.from('leads').select('id,name,phone,status,created_at,assigned_to').is('deleted_at', null).or(ors.join(',')).limit(1)
      .then(function (r) { return (r.data && r.data[0]) || null; }, function () { return null; });
  }
  C.validateLead = validateLead; C.findExistingLead = findExistingLead; C.validPhone = validPhone; C.validEmail = validEmail;

  function listOpts(field) { var vs = (C.lists && C.lists[field]) || []; return vs.length ? [{ v: '', l: '— הכל —' }].concat(vs.map(function (v) { return { v: v, l: v }; })) : null; }

  // ---- שם תצוגה נקי לרכב ----
  // המלאי בעברית מגיע מבולגן מהגיליון ("ב.י.ד סיל יו", "ב.י.ד סיליון"), אבל לכל שורה
  // יש שם אנגלי תקין ב-extra.name_en ("BYD Seal U"). מעדיפים אותו ומנרמלים אותיות.
  var CAR_ACR = { byd:'BYD', bmw:'BMW', mg:'MG', kia:'KIA', gac:'GAC', gwm:'GWM', ev:'EV', dm:'DM',
                  suv:'SUV', gt:'GT', phev:'PHEV', hev:'HEV', bev:'BEV', fl:'FL', vw:'VW', ds:'DS',
                  seat:'SEAT', amg:'AMG', tfsi:'TFSI', tdi:'TDI', rwd:'RWD', awd:'AWD', fwd:'FWD', tt:'TT' };
  // מילים קצרות שהן מילים אמיתיות — לא ראשי תיבות, ולכן לא באותיות גדולות
  var CAR_TITLE = { pro:'Pro', box:'Box', max:'Max', eco:'Eco', air:'Air', top:'Top', neo:'Neo', one:'One', duo:'Duo', sky:'Sky' };
  function prettyCarWord(w) {
    var core = String(w).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (!core) return w;
    if (CAR_ACR[core]) return w.replace(/[A-Za-z]+/, CAR_ACR[core]);
    if (CAR_TITLE[core]) return w.replace(/[A-Za-z]+/, CAR_TITLE[core]);
    if (/^\d+x\d+$/i.test(w)) return w.toLowerCase();               // 4x4
    if (/^\d+[a-z]$/.test(w)) return w;                             // 20i, 30d, 530e — קוד מנוע
    if (/\d/.test(w)) return w.toUpperCase();                       // 8WT, DM-i, 320i
    if (core.length <= 3) return w.toUpperCase();                   // ZS, HS, X3, C-HR
    if (w !== w.toUpperCase() && /[A-Z]/.test(w.slice(1))) return w; // InStyle — כתיב מכוון, לא נוגעים
    return w.split('-').map(function (part) {                       // M-SPORT ➜ M-Sport
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('-');
  }
  function prettyCarText(t) {
    return String(t || '').trim().split(/\s+/).map(prettyCarWord).join(' ');
  }
  function carName(c) {
    var en = (c && c.extra && (c.extra.name_en || c.extra.nameEn)) || '';
    return en ? prettyCarText(en) : (((c && c.brand) || '') + ' ' + ((c && c.name) || '')).trim();
  }
  function carLabel(c) {
    if (!c) return '';
    var en = (c.extra && (c.extra.name_en || c.extra.nameEn)) || '';
    var base = en ? prettyCarText(en) : ((c.brand || '') + ' ' + (c.name || '')).trim();
    var t = (c.trim || '').trim();
    return (base + (t ? ' · ' + prettyCarText(t) : '')).trim();
  }
  // מותגים ששמם שתי מילים — כדי לא לפצל אותם בטעות ליצרן/דגם
  var CAR_2W = ['land rover', 'alfa romeo', 'great wall', 'aston martin', 'rolls royce', 'mercedes benz'];
  function carMakeModel(c) {
    // מנקים סיומות שהוקלדו בגיליון ואינן חלק מהדגם: "(רישוי 26)", "(2025)", "-2025"
    var en = ((c && c.extra && (c.extra.name_en || c.extra.nameEn)) || '')
      .replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*-\s*20\d\d\s*$/, '').trim();
    if (!en) return { make: prettyCarText((c && c.brand) || ''), model: prettyCarText((c && c.name) || '') };
    var parts = prettyCarText(en).split(' ');
    var make, model;
    if (parts.length < 2) {                                          // name_en במילה אחת — הדגם מגיע מהעברית
      make = parts[0];
      model = prettyCarText(String((c && c.name) || '').replace(/\s*\([^)]*\)\s*$/, '').trim());
    } else {
      var n = CAR_2W.indexOf(parts.slice(0, 2).join(' ').toLowerCase()) > -1 ? 2 : 1;
      make = parts.slice(0, n).join(' '); model = parts.slice(n).join(' ');
    }
    if (model.toLowerCase() === make.toLowerCase()) model = '';       // "GMC / GMC" — לא לשכפל
    return { make: make, model: model };
  }
  // ---- car catalog cache (for the deal / car picker) ----
  var carsCache = null;
  // פיקרים לבחירת רכב — רק רכבים חדשים (יד 2 מוצג רק בתצוגת הרכבים, לא בבחירת "באיזה רכב התעניין")
  function loadCars(cb) {
    if (carsCache) return cb(carsCache);
    var map = (window.C2B && window.C2B.mapCar) || function (c) { return c; };
    db.from('cars').select('*').order('brand', { ascending: true }).then(function (r) {
      carsCache = (r.data || []).map(map).filter(function (c) { return c.condition !== 'יד 2'; });
      cb(carsCache);
    }, function () { cb([]); });
  }
  // חיפוש רכב סלחני: מנרמל (הסרת נקודות/רווחים/גרשיים) + אליאסים אנגלית↔עברית — כי המלאי מבולגן
  // ("ב.י.ד"/"בי ווי די" ל-BYD, "ב מ וו"/"במוו" ל-BMW וכו') והמשתמש מקליד באנגלית.
  function normCar(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s.\-_'"`’׳״/(),]/g, ''); }
  var CAR_ALIAS_GROUPS = [
    ['byd', 'ביד', 'בי ווי די', 'ב.י.ד'], ['bmw', 'במוו', 'ב.מ.וו', 'ב מ וו', 'בי אם וו'], ['audi', 'אאודי', 'אוודי'],
    ['mg', 'אם ג׳י', 'אמ ג׳י', 'אמגי'], ['jac', 'ג׳יי איי סי', 'גאק'], ['gmc', 'ג׳י אם סי'], ['chery', 'צ׳רי', 'צ\'רי'],
    ['tesla', 'טסלה'], ['toyota', 'טויוטה'], ['hyundai', 'יונדאי'], ['kia', 'קיה'], ['mercedes', 'מרצדס', 'מרסדס'],
    ['skoda', 'סקודה'], ['volkswagen', 'vw', 'פולקסווגן', 'פולסווגן'], ['seat', 'סיאט'], ['citroen', 'סיטרואן'],
    ['peugeot', 'פיג׳ו', 'פיגו'], ['mazda', 'מאזדה', 'מזדה'], ['mitsubishi', 'מיצובישי'], ['nissan', 'ניסאן'],
    ['subaru', 'סובארו'], ['volvo', 'וולוו'], ['smart', 'סמארט'], ['isuzu', 'איסוזו'], ['hummer', 'האמר'],
    ['zeekr', 'זיקר'], ['avatr', 'אווטר', 'אוואטר'], ['omoda', 'אומודה'], ['voyah', 'וויה'], ['leapmotor', 'ליפמוטור', 'ליפ מוטור'],
    ['dongfeng', 'דונפנג'], ['skywell', 'סקיוואל'], ['jaecoo', 'ג׳אקו', 'גאקו'], ['geely', 'ג׳ילי', 'גילי'],
    ['honda', 'הונדה'], ['ford', 'פורד'], ['renault', 'רנו'], ['opel', 'אופל'], ['suzuki', 'סוזוקי'], ['lexus', 'לקסוס'],
    ['porsche', 'פורשה'], ['jaguar', 'יגואר', 'ג׳גואר'], ['land rover', 'landrover', 'לנד רובר', 'ריינג׳ רובר', 'range rover'],
    ['chevrolet', 'שברולט'], ['jeep', 'ג׳יפ', 'גיפ'], ['fiat', 'פיאט'], ['cupra', 'קופרה'], ['xpeng', 'אקספנג'], ['nio', 'ניו']
  ];
  var CAR_ALIAS_NORM = CAR_ALIAS_GROUPS.map(function (g) { return g.map(normCar); });
  function carHaystack(c) {
    var base = '|' + normCar(c.brand) + '|' + normCar(c.name) + '|' + normCar(c.trim) + '|';
    for (var i = 0; i < CAR_ALIAS_NORM.length; i++) {
      var g = CAR_ALIAS_NORM[i];
      for (var j = 0; j < g.length; j++) { if (g[j] && base.indexOf(g[j]) >= 0) { base += g.join('|') + '|'; break; } }
    }
    return base;
  }
  function carMatch(c, q) {
    var hay = carHaystack(c), toks = String(q == null ? '' : q).toLowerCase().split(/\s+/).map(normCar).filter(Boolean);
    if (!toks.length) return false;
    for (var i = 0; i < toks.length; i++) { if (hay.indexOf(toks[i]) < 0) return false; }
    return true;
  }

  // ---------- LEADS TABLE ----------
  var cache = [], profiles = {}, orderIds = [], curFilter = null, curDeals = [], leadFilter = null, selectedLeads = {};
  // configurable columns for the leads table (show/hide/reorder via the column chooser)
  var LEAD_COLS = [
    { key: 'name', label: 'שם לקוח', fixed: true, cell: function (l) { return '<td style="cursor:pointer" data-open="1"><span class="avatar" style="margin-inline-end:8px">' + esc(initials(l.name)) + '</span><b>' + esc(l.name) + '</b></td>'; } },
    { key: 'phone', label: 'טלפון ראשי', cell: function (l) { return '<td>' + (l.phone ? '<a class="call-ic" data-call="' + esc(l.phone) + '" data-lead="' + l.id + '" title="חייג" style="cursor:pointer;margin-inline-end:6px;text-decoration:none">📞</a>' + esc(l.phone) : '—') + '</td>'; } },
    { key: 'whatsapp', label: 'וואטסאפ', sortable: false, cell: function (l) { var wa = waLink(l.phone); return '<td>' + (wa ? '<a class="wa-ic" href="' + wa + '" target="_blank" rel="noopener" title="פתח וואטסאפ" onclick="event.stopPropagation()">💬</a>' : '—') + '</td>'; } },
    { key: 'assigned', label: 'מנהל מכירות', sort: function (l) { return profiles[l.assigned_to] || ''; }, cell: function (l) { return '<td>' + assignChip(l) + '</td>'; } },
    { key: 'status', label: 'סטטוס לקוח', cell: function (l) { return '<td>' + badge(l.status || 'new', true, l.id) + '</td>'; } },
    { key: 'source', label: 'מקור הגעה', cell: function (l) { return '<td>' + (l.source ? '<span class="tag">' + esc(l.source) + '</span>' : '—') + '</td>'; } },
    { key: 'car', label: 'רכב', cell: function (l) { return '<td>' + esc(l.car || '—') + '</td>'; } },
    { key: 'updated', label: 'עדכון אחרון', sort: function (l) { return l.updated_at || l.status_changed_at || l.created_at || ''; }, cell: function (l) { return '<td class="muted">' + fmt(l.updated_at || l.status_changed_at || l.created_at) + '</td>'; } },
    { key: 'brand', label: 'מותג', def: false, cell: function (l) { return '<td>' + esc(l.brand || '—') + '</td>'; } },
    { key: 'city', label: 'עיר', def: false, cell: function (l) { return '<td>' + esc(l.city || '—') + '</td>'; } },
    { key: 'email', label: 'אימייל', def: false, cell: function (l) { return '<td class="muted">' + esc(l.email || '—') + '</td>'; } },
    { key: 'id_num', label: 'ת.ז / ח.פ', def: false, cell: function (l) { return '<td class="muted">' + esc(l.id_num || '—') + '</td>'; } },
    { key: 'utm_campaign', label: 'utm_campaign', def: false, cell: function (l) { return '<td class="muted">' + esc(l.utm_campaign || '—') + '</td>'; } },
    { key: 'utm_source', label: 'utm_source', def: false, cell: function (l) { return '<td class="muted">' + esc(l.utm_source || '—') + '</td>'; } },
    { key: 'marketing_company', label: 'חברת שיווק', def: false, cell: function (l) { return '<td class="muted">' + esc(l.marketing_company || '—') + '</td>'; } },
    { key: 'message', label: 'תיאור / הודעה', def: false, cell: function (l) { return '<td class="muted" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.message || '—') + '</td>'; } },
    { key: 'lead_no', label: 'מספר לקוח', def: false, sort: function (l) { return l.lead_no || l.id || ''; }, cell: function (l) { return '<td class="muted">' + esc(l.lead_no || l.id || '—') + '</td>'; } },
    { key: 'created', label: 'נוצר בתאריך', def: false, sort: function (l) { return l.created_at || ''; }, cell: function (l) { return '<td class="muted">' + fmt(l.created_at) + '</td>'; } }
  ];
  // שדות שניתן לעדכן קבוצתית ב"שדה נוסף" (מעבר ל-4 המהירים) — כל שדה רוחבי ב-CRM
  var BULK_FIELDS = [
    { key: 'marketing_company', label: 'חברת שיווק' }, { key: 'car', label: 'רכב' }, { key: 'city', label: 'עיר' },
    { key: 'email', label: 'אימייל' }, { key: 'id_num', label: 'ת.ז / ח.פ' },
    { key: 'utm_source', label: 'utm_source' }, { key: 'utm_campaign', label: 'utm_campaign' },
    { key: 'utm_medium', label: 'utm_medium' }, { key: 'utm_content', label: 'utm_content' },
    { key: 'utm_term', label: 'utm_term' }, { key: 'ad_group', label: 'ad_group' },
    { key: 'campaign', label: 'שם קמפיין' }, { key: 'medium', label: 'medium' },
    { key: 'message', label: 'תיאור / הודעה' }, { key: 'name', label: 'שם לקוח' }, { key: 'phone', label: 'טלפון' }
  ];
  var BULK_FIELD_LABEL = {}; BULK_FIELDS.forEach(function (f) { BULK_FIELD_LABEL[f.key] = f.label; });
  var leadCols = null;
  window.C2B_renderLeads = function (statusFilter) {
    curFilter = statusFilter || null; selectedLeads = {};
    loading();
    Promise.all([
      db.from('leads').select('id,name,phone,email,car,city,source,status,brand,marketing_company,assigned_to,created_at,updated_at,status_changed_at,first_response_at,close_reason,id_num,utm_source,utm_campaign,utm_medium,utm_content,utm_term,ad_group,adset_name,ad_name,campaign,medium,ad_id,form_id,external_id,message,page_url').is('deleted_at', null).order('created_at', { ascending: false }).limit(3000),
      db.from('profiles').select('user_id,full_name')
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      cache = res[0].data || [];
      profiles = {}; (res[1].data || []).forEach(function (p) { profiles[p.user_id] = p.full_name; });
      leadFilter = C.makeFilter([
        { key: 'name', label: 'שם לקוח' }, { key: 'phone', label: 'טלפון' }, { key: 'email', label: 'אימייל' },
        { key: 'car', label: 'רכב' }, { key: 'brand', label: 'מותג', options: listOpts('brand') },
        { key: 'status', label: 'סטטוס', options: STATUSES.map(function (s) { return { v: s.k, l: s.label }; }) },
        { key: 'source', label: 'מקור הגעה', options: listOpts('source') }, { key: 'marketing_company', label: 'חברת שיווק', options: listOpts('marketing_company') },
        { key: 'utm_source', label: 'utm_source', options: listOpts('utm_source') }, { key: 'utm_campaign', label: 'utm_campaign' }, { key: 'utm_medium', label: 'utm_medium' },
        { key: 'ad_group', label: 'ad_group' }, { key: 'city', label: 'עיר' },
        { key: 'assigned', label: 'איש מכירות', get: function (l) { return profiles[l.assigned_to] || ''; } }
      ], draw);
      if (!leadCols) leadCols = C.colPicker('leads', LEAD_COLS, draw, { resizable: true, sortable: true });
      var title = statusFilter ? stDef(statusFilter).label : 'כל הלידים';
      view('<div class="card"><div class="row-between"><h3>' + esc(title) + ' <span class="muted" id="lcount"></span></h3>' +
        '<div><input class="inp" id="lq" placeholder="חיפוש חופשי…" style="width:170px"> <button class="btn btn-sm" id="lnew">+ ליד חדש</button> ' + (C.role === 'admin' ? '<button class="btn btn-ghost btn-sm" id="limport">⬆️ ייבוא</button> ' : '') + '<button class="btn btn-ghost btn-sm" id="lcsv">CSV</button> ' + leadCols.button() + '</div></div>' +
        '<div id="leadsBody"></div></div>');
      C.$('lnew').addEventListener('click', newLeadForm);
      if (C.$('limport')) C.$('limport').addEventListener('click', leadImportForm);
      C.$('lq').addEventListener('input', draw);
      C.$('lcsv').addEventListener('click', function () { C.exportCsv(listRows(), ['created_at', 'name', 'phone', 'email', 'car', 'source', 'status', 'city', 'brand', 'marketing_company', 'utm_source', 'utm_campaign', 'message'], 'car2buy-leads'); });
      leadCols.bind();
      draw();
    });
  };
  function listRows() {
    var q = (C.$('lq') && C.$('lq').value || '').trim().toLowerCase();
    return cache.filter(function (l) {
      if (curFilter && (l.status || 'new') !== curFilter) return false;
      if (q && !((l.name || '') + ' ' + (l.phone || '') + ' ' + (l.car || '')).toLowerCase().includes(q)) return false;
      if (leadFilter && !leadFilter.match(l)) return false;
      return true;
    });
  }
  function draw() {
    var rows = leadCols ? leadCols.sortRows(listRows()) : listRows();
    orderIds = rows.map(function (l) { return l.id; });
    if (C.$('lcount')) C.$('lcount').textContent = '(' + rows.length + ')';
    var body = rows.map(function (l) {
      return '<tr data-lead="' + l.id + '"><td style="width:30px;text-align:center"><input type="checkbox" data-sel="' + l.id + '"' + (selectedLeads[l.id] ? ' checked' : '') + '></td>' +
        leadCols.cells(l) + '</tr>';
    }).join('') || '<tr><td colspan="' + (leadCols.colCount() + 1) + '" class="empty">אין לידים</td></tr>';
    var agentOpts = Object.keys(profiles).map(function (uid) { return '<option value="' + uid + '">' + esc(profiles[uid]) + '</option>'; }).join('');
    var srcList = ((C.lists && C.lists.source) || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    var brandList = ((C.lists && C.lists.brand) || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    var bulkBar = '<div id="bulkBar" class="filterbar" style="display:none;background:var(--brand-soft);align-items:center">' +
      '<b id="bulkCount" style="color:var(--brand)">נבחרו 0</b>' +
      '<select id="bulkAgent"><option value="">👤 שייך לסוכן…</option>' + agentOpts + '</select>' +
      '<select id="bulkStatus"><option value="">🏷️ שנה סטטוס…</option>' + STATUSES.map(function (s) { return '<option value="' + s.k + '">' + esc(s.label) + '</option>'; }).join('') + '</select>' +
      '<select id="bulkSource" style="width:150px">' + C.selOpts((C.lists && C.lists.source) || [], '', '📍 מקור הגעה') + '</select>' +
      '<select id="bulkBrand" style="width:140px">' + C.selOpts((window.C2B.marketingBrands && window.C2B.marketingBrands.length ? window.C2B.marketingBrands : (C.lists && C.lists.brand) || []), '', '🚗 מותג') + '</select>' +
      '<span style="color:var(--line)">|</span>' +
      '<select id="bulkField"><option value="">➕ שדה נוסף…</option>' + BULK_FIELDS.map(function (f) { return '<option value="' + f.key + '">' + esc(f.label) + '</option>'; }).join('') + '</select>' +
      '<input id="bulkFieldVal" list="bulkFieldValL" placeholder="ערך…" style="width:130px"><datalist id="bulkFieldValL"></datalist>' +
      '<button class="btn btn-sm" id="bulkApply">החל</button><button class="btn btn-ghost btn-sm" id="bulkDel" style="color:var(--danger);border-color:var(--danger)">🗑️ מחק</button><button class="btn btn-ghost btn-sm" id="bulkClear">בטל בחירה</button></div>';
    C.$('leadsBody').innerHTML = (leadFilter ? leadFilter.render() : '') + bulkBar +
      '<div class="table-scroll"><table class="rz"><thead><tr><th style="width:30px;text-align:center"><input type="checkbox" id="selAll" title="בחר הכל"></th>' + leadCols.thead() + '</tr></thead><tbody id="ltbl">' + body + '</tbody></table></div>';
    if (leadCols.resize) leadCols.resize();
    if (leadFilter) leadFilter.bind();
    bindBulk();
    C.$('ltbl').querySelectorAll('td[data-open]').forEach(function (td) { td.addEventListener('click', function () { window.C2B_openLeadCard(td.parentNode.dataset.lead); }); });
    C.$('ltbl').querySelectorAll('.tag.click').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); openStatusMenu(el, el.dataset.cur, function (to) { changeStatus(el.dataset.stLead, to, { status: el.dataset.cur }, function () { window.C2B_renderLeads(curFilter); }); }); });
    });
    C.$('ltbl').querySelectorAll('.assign-chip').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); openAssignMenu(el, el.dataset.assign, el.dataset.cur, function (uid) { assignLead(el.dataset.assign, uid); }); });
    });
  }
  // ---- bulk selection + actions (assign / status / source / brand) ----
  function bindBulk() {
    var $ = C.$;
    function ids() { return Object.keys(selectedLeads).filter(function (k) { return selectedLeads[k]; }); }
    function update() {
      var n = ids().length, bar = $('bulkBar'); if (!bar) return;
      bar.style.display = n ? 'flex' : 'none';
      if ($('bulkCount')) $('bulkCount').textContent = 'נבחרו ' + n;
      var sa = $('selAll'); if (sa) { var boxes = $('ltbl').querySelectorAll('input[data-sel]'), checked = $('ltbl').querySelectorAll('input[data-sel]:checked'); sa.checked = boxes.length && checked.length === boxes.length; sa.indeterminate = checked.length > 0 && checked.length < boxes.length; }
    }
    $('ltbl').querySelectorAll('input[data-sel]').forEach(function (cb) { cb.addEventListener('change', function () { if (cb.checked) selectedLeads[cb.dataset.sel] = true; else delete selectedLeads[cb.dataset.sel]; update(); }); });
    if ($('selAll')) $('selAll').addEventListener('change', function () { var on = this.checked; $('ltbl').querySelectorAll('input[data-sel]').forEach(function (cb) { cb.checked = on; if (on) selectedLeads[cb.dataset.sel] = true; else delete selectedLeads[cb.dataset.sel]; }); update(); });
    if ($('bulkClear')) $('bulkClear').addEventListener('click', function () { selectedLeads = {}; $('ltbl').querySelectorAll('input[data-sel]').forEach(function (cb) { cb.checked = false; }); update(); });
    if ($('bulkField')) $('bulkField').addEventListener('change', function () {
      var dl = $('bulkFieldValL'); if (!dl) return;   // השלמה-אוטומטית לפי רשימות המערכת (חברת שיווק / utm_source וכו')
      var opts = (C.lists && C.lists[this.value]) || [];
      dl.innerHTML = opts.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    });
    if ($('bulkDel')) $('bulkDel').addEventListener('click', function () {
      var list = ids(); if (!list.length) return;
      if (!confirm('להעביר ' + list.length + ' לידים לסל המיחזור?\n\nההיסטוריה, המסמכים והעסקאות נשמרים. מנהל יכול לשחזר בכל רגע.')) return;
      var btn = this; btn.disabled = true;
      // סל מיחזור במקום מחיקה: trash_lead מסמן deleted_at, מסתיר מכל המסכים ומתעד בציר הזמן.
      // מחיקה סופית קיימת רק למנהל, ורק מתוך מסך הסל.
      Promise.all(list.map(function (id) { return db.rpc('trash_lead', { p_lead: id }); })).then(function (res) {
        btn.disabled = false;
        var bad = res.filter(function (r) { return r.error || (r.data && r.data.ok === false); });
        if (bad.length) alert('לא הועברו ' + bad.length + ' לידים: ' + (bad[0].error ? bad[0].error.message : bad[0].data.error));
        selectedLeads = {}; C.refreshBadges && C.refreshBadges(); window.C2B_renderLeads(curFilter);
      });
    });
    if ($('bulkApply')) $('bulkApply').addEventListener('click', function () {
      var list = ids(); if (!list.length) return;
      var agent = $('bulkAgent').value;               // שיוך → דרך RPC transfer_leads (עוקף RLS + מתועד בטריגר)
      var patch = {};
      if ($('bulkStatus').value) { patch.status = $('bulkStatus').value; patch.status_changed_at = new Date().toISOString(); }
      if ($('bulkSource').value.trim()) patch.source = $('bulkSource').value.trim();
      if ($('bulkBrand').value.trim()) patch.brand = $('bulkBrand').value.trim();
      var bf = $('bulkField') ? $('bulkField').value : '', bv = $('bulkFieldVal') ? $('bulkFieldVal').value.trim() : '';
      if (bf) patch[bf] = bv || null;                 // שדה גנרי — ערך ריק מנקה את השדה
      var hasFields = Object.keys(patch).length > 0;
      if (!agent && !hasFields) { alert('בחרו פעולה: סוכן / סטטוס / מקור / מותג / שדה נוסף'); return; }
      if (!confirm('להחיל את השינוי על ' + list.length + ' לידים?')) return;
      var btn = $('bulkApply'); btn.disabled = true;
      function logFields() {
        var summ = []; if (patch.status) summ.push('סטטוס: ' + stDef(patch.status).label); if (patch.source) summ.push('מקור: ' + patch.source); if (patch.brand) summ.push('מותג: ' + patch.brand);
        if (bf) summ.push((BULK_FIELD_LABEL[bf] || bf) + ': ' + (bv || '(רוקן)'));
        if (summ.length) db.from('activities').insert(list.map(function (id) { return { lead_id: id, type: 'system', body: 'עדכון קבוצתי — ' + summ.join(', '), created_by: C.userId || null }; }));
      }
      function done() { logFields(); selectedLeads = {}; window.C2B_renderLeads(curFilter); }
      function doAgent() {
        if (!agent) return done();
        db.rpc('transfer_leads', { p_leads: list, p_to: agent }).then(function (r2) {
          if (r2.error) { btn.disabled = false; alert('שגיאה בשיוך: ' + r2.error.message); return; }
          done();                                     // הטריגר מתעד את ההעברות אוטומטית
        });
      }
      if (hasFields) {
        db.from('leads').update(patch).in('id', list).then(function (r) {
          if (r.error) { btn.disabled = false; alert('שגיאה: ' + r.error.message); return; }
          doAgent();
        });
      } else doAgent();
    });
    update();
  }

  // ---------- NEW LEAD (create from scratch) ----------
  function newLeadForm() {
    var lists = (C.lists || {});
    function dl(id, arr) { return '<datalist id="' + id + '">' + (arr || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>'; }
    function fld(label, id, type, list) { return '<div class="field"><label>' + label + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '"' + (list ? ' list="' + list + '"' : '') + ' style="width:100%">' + (list ? dl(list, lists[id.replace('nl_', '')]) : '') + '</div>'; }
    function sfld(label, id, values, cur, ph) { return '<div class="field"><label>' + label + '</label><select class="inp" id="' + id + '" style="width:100%">' + C.selOpts(values, cur, ph) + '</select></div>'; }
    var mkBrands = (window.C2B.marketingBrands && window.C2B.marketingBrands.length) ? window.C2B.marketingBrands : (lists.brand || []);
    view('<div class="lead-top"><button class="btn btn-ghost btn-sm" id="nlBack">→ לרשימה</button><h3 style="margin:0">➕ ליד חדש</h3></div>' +
      '<div class="card" style="max-width:640px"><div class="grid2">' +
        fld('שם לקוח', 'nl_name') + fld('טלפון ראשי', 'nl_phone', 'tel') + fld('דואר אלקטרוני', 'nl_email', 'email') + fld('באיזה רכב מתעניין', 'nl_car') +
        sfld('מותג', 'nl_brand', mkBrands, '', '— מותג —') + sfld('מקור הגעה', 'nl_source', lists.source || [], 'ידני', '— מקור —') + fld('כתובת - עיר', 'nl_city') +
      '</div><div style="margin-top:14px"><button class="btn" id="nlSave">צור ליד ופתח כרטיס</button> <span id="nlMsg" class="muted" style="font-size:13px;margin-inline-start:8px"></span></div></div>');
    C.$('nlBack').addEventListener('click', function () { window.C2B_renderLeads(curFilter); });
    C.$('nlSave').addEventListener('click', function () {
      var btn = this, msg = C.$('nlMsg');
      if (btn.disabled) return;                        // לחיצה כפולה יצרה שני לידים זהים
      var payload = {
        name: C.$('nl_name').value.trim() || null, phone: C.$('nl_phone').value.trim() || null,
        email: C.$('nl_email').value.trim() || null, car: C.$('nl_car').value.trim() || null,
        brand: C.$('nl_brand').value.trim() || null, source: C.$('nl_source').value.trim() || 'ידני',
        city: C.$('nl_city').value.trim() || null, status: 'new', assigned_to: C.userId || null
      };
      var bad = validateLead(payload);
      if (bad) { msg.style.color = 'var(--danger)'; msg.textContent = bad; return; }

      btn.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'בודק כפילויות…';
      // כפילות מזהירה ולא חוסמת: לפעמים אותו לקוח באמת פונה שוב על רכב אחר.
      findExistingLead(payload.phone, payload.email).then(function (ex) {
        if (ex) {
          var who = (ex.name || 'ללא שם') + (ex.phone ? ' · ' + ex.phone : '');
          var when = ex.created_at ? new Date(ex.created_at).toLocaleDateString('he-IL') : '';
          var go = confirm('כבר קיים ליד עם הפרטים האלה:' + '\n\n' + who + (when ? '  (נוצר ' + when + ')' : '') +
                           '\n\nלחצו אישור כדי לפתוח את הכרטיס הקיים, או ביטול כדי ליצור ליד חדש בכל זאת.');
          if (go) { btn.disabled = false; return window.C2B_openLeadCard(ex.id); }
        }
        msg.textContent = 'יוצר…';
        db.from('leads').insert(payload).select('id').single().then(function (r) {
          btn.disabled = false;
          if (r.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + r.error.message; return; }
          C.refreshBadges && C.refreshBadges();
          window.C2B_openLeadCard(r.data.id);
        });
      });
    });
  }

  // ---------- BULK LEAD IMPORT (CSV / Excel paste) ----------
  var IMPORT_FIELDS = [
    ['name', 'שם'], ['phone', 'טלפון'], ['email', 'אימייל'], ['car', 'רכב'], ['brand', 'מותג'],
    ['source', 'מקור הגעה'], ['city', 'עיר'], ['marketing_company', 'חברת שיווק'],
    ['utm_source', 'utm_source'], ['utm_campaign', 'utm_campaign'], ['id_num', 'ת.ז / ח.פ'], ['message', 'הערה / תיאור']
  ];
  // guess which lead field a CSV header maps to (Hebrew + English + Arabic)
  function guessField(header) {
    var h = String(header || '').toLowerCase().trim();
    var R = [
      ['name', /name|שם|full|الاسم/], ['phone', /phone|tel|טלפון|נייד|מספר|هاتف|جوال/], ['email', /e-?mail|מייל|דוא|بريد/],
      ['car', /car|vehicle|רכב|דגם|سيارة|موديل/], ['brand', /brand|מותג|יצרן|manufacturer/],
      ['source', /source|מקור|utm_?source|قناة/], ['city', /city|עיר|יישוב|ישוב|بلد|مدينة/],
      ['marketing_company', /marketing|חברת ?שיווק|חברה/], ['utm_campaign', /campaign|קמפיין|utm_?campaign/],
      ['id_num', /id|ת\.?ז|ח\.?פ|תעודת|هوية/], ['message', /message|note|הערה|תיאור|body|رسالة/]
    ];
    for (var i = 0; i < R.length; i++) if (R[i][1].test(h)) return R[i][0];
    return '';
  }
  function parseDelimited(text) {
    text = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var first = text.split('\n')[0] || '';
    var delim = (first.split('\t').length > first.split(',').length) ? '\t' : ',';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function leadImportForm() {
    var parsed = null, agents = {};
    db.from('profiles').select('user_id,full_name,active').then(function (r) { (r.data || []).forEach(function (p) { if (p.active !== false) agents[p.user_id] = p.full_name; }); });
    view('<div class="lead-top"><button class="btn btn-ghost btn-sm" id="impBack">→ לרשימה</button><h3 style="margin:0">⬆️ ייבוא לידים בכמות</h3></div>' +
      '<div class="card" style="max-width:820px">' +
        '<p class="muted" style="font-size:13px;margin:0 0 10px">העלו קובץ <b>.csv</b> או הדביקו טבלה מ-Excel/Sheets (עם שורת כותרות). המערכת תזהה את השדות אוטומטית — תוכלו לתקן ידנית.</p>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input type="file" id="impFile" accept=".csv,.txt,text/csv"><span class="muted">או הדביקו למטה ↓</span></div>' +
        '<textarea id="impText" placeholder="שם,טלפון,אימייל,רכב,מקור&#10;דנה כהן,0501234567,dana@x.com,מאזדה CX-5,פייסבוק" style="width:100%;height:130px;margin-top:10px;font-family:monospace;font-size:13px;direction:ltr"></textarea>' +
        '<div style="margin-top:10px"><button class="btn btn-sm" id="impParse">🔍 נתח נתונים</button></div>' +
        '<div id="impResult" style="margin-top:14px"></div>' +
      '</div>');
    C.$('impBack').addEventListener('click', function () { window.C2B_renderLeads(curFilter); });
    C.$('impFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var rd = new FileReader(); rd.onload = function () { C.$('impText').value = rd.result; }; rd.readAsText(f, 'UTF-8');
    });
    C.$('impParse').addEventListener('click', function () {
      var rows = parseDelimited(C.$('impText').value);
      if (rows.length < 2) { C.$('impResult').innerHTML = '<p style="color:var(--danger)">צריך לפחות שורת כותרות + שורת נתונים אחת.</p>'; return; }
      parsed = rows;
      var headers = rows[0], dataRows = rows.slice(1);
      var mapSel = headers.map(function (h, i) {
        var g = guessField(h);
        return '<tr><td style="padding:4px 8px"><b>' + esc(h || ('עמודה ' + (i + 1))) + '</b><div class="muted" style="font-size:11px;direction:ltr">' + esc((dataRows[0] && dataRows[0][i]) || '') + '</div></td>' +
          '<td style="padding:4px 8px"><select class="inp imp-map" data-col="' + i + '"><option value="">— התעלם —</option>' +
          IMPORT_FIELDS.map(function (f) { return '<option value="' + f[0] + '"' + (g === f[0] ? ' selected' : '') + '>' + esc(f[1]) + '</option>'; }).join('') + '</select></td></tr>';
      }).join('');
      var agentOpts = Object.keys(agents).map(function (uid) { return '<option value="' + uid + '">' + esc(agents[uid]) + '</option>'; }).join('');
      C.$('impResult').innerHTML =
        '<div class="row-between" style="margin-bottom:8px"><b>מיפוי עמודות</b><span class="muted" style="font-size:12.5px">' + dataRows.length + ' שורות נתונים</span></div>' +
        '<div class="table-scroll"><table><thead><tr><th>עמודה בקובץ (דוגמה)</th><th>שדה ב-CRM</th></tr></thead><tbody>' + mapSel + '</tbody></table></div>' +
        '<div class="grid2" style="margin-top:14px">' +
          '<div class="field" style="margin:0"><label>מקור הגעה (ברירת מחדל אם ריק)</label><input class="inp" id="impSrc" list="impSrcL" value="ייבוא"><datalist id="impSrcL">' + (((C.lists && C.lists.source) || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('')) + '</datalist></div>' +
          '<div class="field" style="margin:0"><label>שיוך לסוכן (אופציונלי)</label><select class="inp" id="impAgent"><option value="">— לא משויך —</option>' + agentOpts + '</select></div>' +
        '</div>' +
        '<div style="margin-top:14px"><button class="btn" id="impRun">✅ ייבא ' + dataRows.length + ' לידים</button> <span id="impMsg" class="muted" style="font-size:13px;margin-inline-start:10px"></span></div>';
      C.$('impRun').addEventListener('click', runImport);
    });
    function runImport() {
      var headers = parsed[0], dataRows = parsed.slice(1);
      var map = {}; C.$('impResult').querySelectorAll('.imp-map').forEach(function (s) { if (s.value) map[s.dataset.col] = s.value; });
      if (!Object.keys(map).length) { C.$('impMsg').style.color = 'var(--danger)'; C.$('impMsg').textContent = 'מפו לפחות שדה אחד'; return; }
      var hasContact = Object.keys(map).some(function (c) { return map[c] === 'phone' || map[c] === 'email' || map[c] === 'name'; });
      if (!hasContact) { C.$('impMsg').style.color = 'var(--danger)'; C.$('impMsg').textContent = 'חובה למפות לפחות שם / טלפון / אימייל'; return; }
      var defSrc = (C.$('impSrc').value || 'ייבוא').trim(), agent = C.$('impAgent').value || null;
      var rows = dataRows.map(function (dr) {
        var o = { source: defSrc, status: 'new', assigned_to: agent, meta: { imported: true } };   // meta.imported → אין מייל-פתיחה אוטומטי
        Object.keys(map).forEach(function (c) { var v = String(dr[c] == null ? '' : dr[c]).trim(); if (v) o[map[c]] = v; });
        if (!o.source) o.source = defSrc;
        return o;
      }).filter(function (o) { return o.name || o.phone || o.email; });
      if (!rows.length) { C.$('impMsg').style.color = 'var(--danger)'; C.$('impMsg').textContent = 'אין שורות תקינות לייבוא'; return; }
      var btn = C.$('impRun'); btn.disabled = true; var msg = C.$('impMsg'); msg.style.color = 'var(--muted)';
      var CH = 400, done = 0, failed = 0, i = 0;
      function next() {
        if (i >= rows.length) {
          msg.style.color = failed ? 'var(--warn)' : 'var(--ok)';
          msg.textContent = '✔ יובאו ' + done + ' לידים' + (failed ? ' · ' + failed + ' נכשלו' : '');
          C.refreshBadges && C.refreshBadges();
          setTimeout(function () { window.C2B_renderLeads(curFilter); }, 1200);
          return;
        }
        var batch = rows.slice(i, i + CH); i += CH;
        msg.textContent = 'מייבא… ' + Math.min(i, rows.length) + '/' + rows.length;
        db.from('leads').insert(batch).then(function (r) {
          if (r.error) { failed += batch.length; } else { done += batch.length; }
          next();
        }, function () { failed += batch.length; next(); });
      }
      next();
    }
  }

  // ---------- FULL LEAD PAGE ----------
  // ---- consolidated, role-tailored action set (all actions in ONE bar) ----
  var LEAD_ACTIONS = [
    { k: 'call', icon: '📞', label: 'התקשר', roles: ['admin', 'sales', 'files'] },
    { k: 'wa', icon: '💬', label: 'WhatsApp', roles: ['admin', 'sales', 'files'] },
    { k: 'mail', icon: '📧', label: 'מייל', roles: ['admin', 'sales', 'files', 'accounting'] },
    { k: 'auto', icon: '⚡', label: 'הודעות מהירות', roles: ['admin', 'sales', 'files'] },
    { k: 'note', icon: '📝', label: 'הערה', roles: ['admin', 'sales', 'files', 'accounting'] },
    { k: 'task', icon: '✅', label: 'משימה', roles: ['admin', 'sales', 'files', 'accounting'] },
    { k: 'doc', icon: '📎', label: 'מסמך', roles: ['admin', 'sales', 'files', 'accounting'] },
    { k: 'meeting', icon: '📅', label: 'קבע פגישה', roles: ['admin', 'sales', 'files'] },
    { k: 'car', icon: '🚗', label: 'בחר רכב', roles: ['admin', 'sales'] },
    { k: 'deal', icon: '💰', label: 'סגירת עסקה', roles: ['admin', 'sales', 'files'] },
    { k: 'contract', icon: '✍', label: 'הסכם', roles: ['admin', 'sales', 'files'] }
  ];
  function roleShort(role) { return { sales: 'מכירות', files: 'תיקי לקוחות', accounting: 'הנה״ח' }[role] || ''; }
  // customizable action bar (order / labels / visibility) — stored per browser
  function getActionCfg() {
    var def = LEAD_ACTIONS.map(function (a) { return { k: a.k, label: a.label, on: true }; });
    try {
      var saved = JSON.parse(localStorage.getItem('c2b_lead_actions') || 'null');
      if (!saved || !saved.length) return def;
      var byK = {}; saved.forEach(function (s) { byK[s.k] = s; });
      var merged = saved.filter(function (s) { return LEAD_ACTIONS.some(function (a) { return a.k === s.k; }); });
      def.forEach(function (d) { if (!byK[d.k]) merged.push(d); });   // append newly-added actions
      return merged;
    } catch (e) { return def; }
  }
  C.leadActionsMeta = LEAD_ACTIONS.map(function (a) { return { k: a.k, icon: a.icon, label: a.label }; });
  C.getActionCfg = getActionCfg;
  C.saveActionCfg = function (cfg) { try { localStorage.setItem('c2b_lead_actions', JSON.stringify(cfg)); } catch (e) {} };
  C.resetActionCfg = function () { try { localStorage.removeItem('c2b_lead_actions'); } catch (e) {} };
  function docIsImage(name) { return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || ''); }
  // Supabase storage keys must be ASCII-safe — sanitize the filename (Hebrew/spaces → _)
  function safeStoragePath(leadId, name) {
    var safe = String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'file';
    return leadId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + safe;
  }
  // only allow http(s) links — page_url comes from anon lead inserts (untrusted),
  // so reject javascript:/data:/vbscript: before it reaches an href sink.
  function safeHttpUrl(u) { try { var p = new URL(u); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; } catch (e) { return ''; } }

  // מנהלת תיקי לקוחות נכנסת ישר לתצוגת התיק (הלשוניות), לא לכרטיס הסוכן
  function openFileView(id) {
    loading();
    Promise.all([
      db.from('leads').select('*').eq('id', id).single(),
      db.from('deals').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      db.from('profiles').select('user_id,full_name')
    ]).then(function (r) {
      if (r[0].error) return errBox(r[0].error.message);
      var lead = r[0].data, deals = (r[1] && r[1].data) || [];
      if (r[2] && r[2].data) { profiles = {}; r[2].data.forEach(function (p) { profiles[p.user_id] = p.full_name; }); }
      curDeals = deals;
      dealForm(lead, deals[0] || null, true);   // אם אין עסקה — טופס תיק חדש למילוי
      deals.forEach(function (dd) { if (dd.signature) ensureSignedDoc(lead, dd, function () { openFileView(id); }); });   // עסקה חתומה → עותק HTML לתיק + ציר זמן
    });
  }
  // open a specific deal's file view (used from the file-manager list)
  window.C2B_openDeal = function (dealId) {
    loading();
    db.from('deals').select('*').eq('id', dealId).single().then(function (r) {
      if (r.error || !r.data) return errBox((r.error && r.error.message) || 'עסקה לא נמצאה');
      var deal = r.data;
      Promise.all([
        db.from('leads').select('*').eq('id', deal.lead_id).single(),
        db.from('deals').select('*').eq('lead_id', deal.lead_id).order('created_at', { ascending: false }),
        db.from('profiles').select('user_id,full_name')
      ]).then(function (rr) {
        if (rr[2] && rr[2].data) { profiles = {}; rr[2].data.forEach(function (p) { profiles[p.user_id] = p.full_name; }); }
        curDeals = (rr[1] && rr[1].data) || [deal];
        dealForm((rr[0] && rr[0].data) || { id: deal.lead_id }, deal, true);
      });
    });
  };

  window.C2B_openLeadCard = function (id) {
    if ((C.role || '') === 'files') return openFileView(id);        // file manager → file view
    if ((C.role || '') === 'accounting') return openAcctLeadView(id); // accountant → accounting file
    loading();
    Promise.all([
      db.from('leads').select('*').eq('id', id).single(),
      db.from('activities').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      db.from('tasks').select('*').eq('lead_id', id).order('due_at', { ascending: true }),
      db.from('lead_documents').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      db.from('deals').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      db.from('profiles').select('user_id,full_name'),
      db.from('payments').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      // יומן הפעולות של הליד — נכשל בשקט לתפקידים שאין להם הרשאה, ואז פשוט לא מוצג
      db.from('audit_log').select('at,actor_name,entity,action,changes').eq('lead_id', id).order('at', { ascending: false }).limit(60)
    ]).then(function (r) {
      if (r[0].error) return errBox(r[0].error.message);
      var lead = r[0].data, acts = r[1].data || [], tasks = r[2].data || [], docs = r[3].data || [], deals = (r[4] && r[4].data) || [], pays = (r[6] && r[6].data) || [];
      var audits = (r[7] && !r[7].error && r[7].data) || [];
      if (r[5] && r[5].data) { profiles = {}; r[5].data.forEach(function (p) { profiles[p.user_id] = p.full_name; }); }
      curDeals = deals;
      // signed URLs → inline preview of uploaded documents/images inside the timeline
      var paths = docs.map(function (d) { return d.storage_path; });
      var st = db.storage.from('lead-docs');
      var signer = (paths.length && st.createSignedUrls) ? st.createSignedUrls(paths, 3600) : Promise.resolve({ data: [] });
      signer.then(function (sres) {
        var urls = {};
        ((sres && sres.data) || []).forEach(function (s) { if (s && s.signedUrl) urls[s.path] = s.signedUrl; });
        renderLeadCard(lead, acts, tasks, docs, deals, pays, urls, audits);
      });
    });
  };
  function renderLeadCard(lead, acts, tasks, docs, deals, pays, urls, audits) {
    var role = C.role || 'admin';
    var wa = waLink(lead.phone);
    var idx = orderIds.indexOf(lead.id);
    var prev = idx > 0 ? orderIds[idx - 1] : null, next = idx >= 0 && idx < orderIds.length - 1 ? orderIds[idx + 1] : null;
    var feed = buildFeed(acts, tasks, docs, deals, pays, urls, audits || []);
    var metaByK = {}; LEAD_ACTIONS.forEach(function (a) { metaByK[a.k] = a; });
    var actBtns = getActionCfg().filter(function (c) { var a = metaByK[c.k]; return c.on !== false && a && a.roles.indexOf(role) >= 0; }).map(function (c) {
      var a = metaByK[c.k], lbl = esc(c.label || a.label);
      if (a.k === 'call') return lead.phone ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(lead.phone) + '">' + a.icon + ' ' + lbl + '</a>' : '';
      if (a.k === 'wa') return wa ? '<a class="btn btn-ghost btn-sm" href="' + wa + '" target="_blank" rel="noopener">' + a.icon + ' ' + lbl + '</a>' : '';
      if (a.k === 'mail') return lead.email ? '<a class="btn btn-ghost btn-sm" href="mailto:' + esc(lead.email) + '">' + a.icon + ' ' + lbl + '</a>' : '';
      return '<button class="btn btn-ghost btn-sm" data-act2="' + a.k + '">' + a.icon + ' ' + lbl + '</button>';
    }).join('');
    view(
      '<div class="lead-top">' +
        '<div style="display:flex;align-items:center;gap:8px"><button class="btn btn-ghost btn-sm" id="lpBack">→ לרשימה</button>' +
        '<div class="lead-nav"><button class="btn btn-ghost btn-sm" id="lpPrev"' + (prev ? '' : ' disabled') + '>‹ הקודם</button><button class="btn btn-ghost btn-sm" id="lpNext"' + (next ? '' : ' disabled') + '>הבא ›</button></div>' +
        (idx >= 0 ? '<span class="muted" style="font-size:13px">' + (idx + 1) + ' / ' + orderIds.length + '</span>' : '') + '</div>' +
        '<div style="display:flex;align-items:center;gap:12px"><span class="avatar" style="width:44px;height:44px;font-size:17px">' + esc(initials(lead.name)) + '</span><div><h3 style="margin:0">' + esc(lead.name || 'ליד') + '</h3><div class="muted" style="font-size:13px">' + (lead.phone ? '<a class="call-ic" data-call="' + esc(lead.phone) + '" data-lead="' + lead.id + '" title="חייג" style="cursor:pointer;margin-inline-end:5px;text-decoration:none">📞</a>' + esc(lead.phone) : '') + (lead.car ? ' · ' + esc(lead.car) : '') + '</div></div><span id="lpStatus">' + badge(lead.status || 'new', true, lead.id) + '</span></div>' +
      '</div>' +
      '<div class="card" style="padding:14px"><div class="flow" id="leadFlow">' + flowBar(lead.status || 'new') + '</div></div>' +
      '<div class="lead-grid">' +
        '<div><div class="card"><div class="row-between" style="margin-bottom:12px"><h3 style="margin:0">פרטי לקוח' + (role !== 'admin' && roleShort(role) ? ' · ' + roleShort(role) : '') + '</h3></div>' +
          '<div class="tabs2" id="ldTabs"><button class="active" data-ld="info">📋 פרטים</button><button data-ld="mkt">📣 שיווק ומקורות</button></div>' +
          '<div id="ldInfo">' + leadInfo(lead, deals, pays, feed.length ? feed[0].ts : null) +
            (lead.message ? '<div style="margin-top:10px;font-size:14px">🗒️ ' + esc(lead.message) + '</div>' : '') + '</div>' +
          '<div id="ldMkt" class="hidden">' + leadMkt(lead) + '</div>' + '</div>' +
          '<div class="card"><div class="row-between"><h3 style="margin:0">הצעות / הסכמים לחתימה</h3>' + (role !== 'accounting' ? '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="lpBrandDeals">📄 הצעות לפי מותג</button><button class="btn btn-sm" id="lpNewDeal">+ הצעה</button></div>' : '') + '</div><div id="lpBrandPick"></div><div id="lpDeals">' + dealList(deals) + '</div></div>' +
        '</div>' +
        '<div>' +
          '<div class="card">' +
            '<div class="qa2">' + actBtns + '</div><div id="lpForm" style="margin-top:10px"></div>' +
            '<h3 style="margin:18px 0 4px">ציר זמן — הכל במקום אחד</h3><p class="muted" style="font-size:12px;margin:0 0 10px">הערות · שיחות · WhatsApp · מיילים · משימות · מסמכים · עסקאות · תשלומים</p>' +
            '<div class="tl" id="lpTimeline">' + feedHtml(feed) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    bindLead(lead, prev, next);
    deals.forEach(function (dd) { if (dd.signature) ensureSignedDoc(lead, dd, function () { window.C2B_openLeadCard(lead.id); }); });   // עסקה חתומה → עותק HTML לתיק + ציר זמן
  }
  // ---- lead details in two tabs: business info + marketing/attribution ----
  function lf(k, v) { return '<div class="lf"><span class="k">' + k + '</span><span class="v">' + (v == null || v === '' ? '—' : v) + '</span></div>'; }
  // TAB 1 — customer + car + owner (business fields are edited inline, no button)
  function leadInfo(lead, deals, pays, lastTs) {
    var role = C.role || 'admin', deal = deals[0];
    var brandOpts = ((C.lists && C.lists.brand) || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    var effOwner = lead.assigned_to || mainManagerUid();
    var staff = '<option value="">— לא שויך —</option>' + Object.keys(profiles).map(function (uid) { return '<option value="' + uid + '"' + (effOwner === uid ? ' selected' : '') + '>' + esc(profiles[uid]) + '</option>'; }).join('');
    function ei(label, field, val, type) { return '<div class="lf"><span class="k">' + label + '</span><input class="lf-edit" type="' + (type || 'text') + '" data-field="' + field + '" data-label="' + esc(label) + '" value="' + esc(val == null ? '' : val) + '"></div>'; }
    var html = '<div class="lead-fields">';
    html += '<div class="lf"><span class="k">סטטוס לקוח</span><span class="v" id="lpStatusInline">' + badge(lead.status || 'new', true, lead.id) + '</span></div>';
    html += '</div>';                                  // close the top field group
    if (lead.status === 'lost') html += reasonSelect(lead);   // reason opens right under the status
    html += '<div class="lead-fields">';
    html += lf('עודכן בתאריך', fmt(lastTs || lead.updated_at || lead.status_changed_at || lead.created_at));
    html += ei('שם לקוח', 'name', lead.name);
    html += ei('טלפון ראשי', 'phone', lead.phone, 'tel');
    html += ei('ת.ז / ח.פ', 'id_num', lead.id_num);
    html += ei('דואר אלקטרוני', 'email', lead.email, 'email');
    html += '<div class="lf"><span class="k">באיזה רכב מתעניין</span><div id="carPick" style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-start;max-width:64%"><span class="muted" style="font-size:12px">טוען מלאי…</span></div></div>';
    html += '<div class="lf"><span class="k">מותג</span><select class="lf-edit" data-field="brand" data-label="מותג">' + C.selOpts((window.C2B.marketingBrands && window.C2B.marketingBrands.length ? window.C2B.marketingBrands : (C.lists && C.lists.brand) || []), lead.brand, '— מותג —') + '</select></div>';
    html += ei('כתובת - עיר', 'city', lead.city);
    html += '<div class="lf"><span class="k">איש מכירות</span><select class="lf-edit" data-field="assigned_to" data-label="איש מכירות">' + staff + '</select></div>';
    if (role === 'accounting') {
      var total = deals.reduce(function (s, d) { return s + (Number(d.total) || 0); }, 0);
      var paid = pays.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
      html += lf('שווי עסקאות', nis(total)) + lf('נגבה בפועל', nis(paid)) + lf('יתרה פתוחה', nis(total - paid));
    } else if (role === 'files') {
      html += lf('שלב תיק', deal ? stageBadge(deal.stage || 'initial') : '—');
      if (deal) { var cl = deal.checklist || {}; var done = CHECKLIST_ITEMS.filter(function (i) { return cl[i]; }).length; html += lf('צ׳קליסט תיק', done + '/' + CHECKLIST_ITEMS.length); }
      if (deal && deal.commission) html += lf('עמלת סוכן', nis(deal.commission));
    }
    html += lf('נוצר', fmt(lead.created_at));
    return html + '</div>';
  }
  // TAB 2 — marketing / source attribution (opens on the "שיווק" tab)
  function leadMkt(lead) {
    var pageUrl = safeHttpUrl(lead.page_url);
    // מקור הגעה נערך מתוך רשימת "מקור הגעה" שבהגדרות ורשימות (field_options.source)
    return '<div class="lead-fields">' +
      '<div class="lf"><span class="k">מקור הגעה</span><select class="lf-edit" data-field="source" data-label="מקור הגעה">' + C.selOpts((C.lists && C.lists.source) || [], lead.source, '— מקור —') + '</select></div>' +
      lf('חברת שיווק', esc(lead.marketing_company)) +
      lf('utm_source', esc(lead.utm_source)) +
      lf('utm_campaign', esc(lead.utm_campaign)) +
      lf('utm_medium', esc(lead.utm_medium)) +
      lf('utm_content', esc(lead.utm_content)) +
      lf('utm_term', esc(lead.utm_term)) +
      lf('ad_group · מזהה קבוצת מודעות', esc(lead.ad_group)) +
      lf('שם קמפיין', esc(lead.campaign)) +
      lf('סדרת מודעות (שם)', esc(lead.adset_name)) +
      lf('שם מודעה', esc(lead.ad_name)) +
      lf('IP', esc(lead.ip)) +
      lf('קישור למודעה / עמוד', pageUrl ? '<a href="' + esc(pageUrl) + '" target="_blank" rel="noopener noreferrer" title="' + esc(pageUrl) + '">' + (/ads\/library/.test(pageUrl) ? '📢 צפה במודעה »' : 'פתח »') + '</a>' : '') +
      lf('lead_id', '<span class="muted" style="font-size:10.5px">' + esc(lead.id) + '</span>') +
      '</div>';
  }
  // single car search from inventory → fills the car + the existing מותג field
  function setupCarPicker(lead) {
    var box = C.$('carPick'); if (!box) return;
    loadCars(function (cars) {
      if (!C.$('carPick')) return;
      box.innerHTML = '<div class="ac-box" style="position:relative;width:100%"><input class="lf-edit" id="carSearch2" value="' + esc(lead.car || '') + '" placeholder="🔎 חפש רכב מהמלאי…" style="max-width:none;width:100%"><div class="ac-res hidden" id="carRes2"></div></div>';
      var inp = C.$('carSearch2'), res = C.$('carRes2');
      inp.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase(); if (!q) { res.classList.add('hidden'); return; }
        var m = cars.filter(function (c) { return carMatch(c, q); }).slice(0, 12);
        res.innerHTML = m.map(function (c) { return '<div class="ai" data-i="' + cars.indexOf(c) + '">' + (c.img ? '<img src="' + esc((C.carImg||function(x){return x})(c.img)) + '" style="width:40px;height:26px;object-fit:cover;border-radius:5px">' : '') + '<span><b>' + esc(carName(c)) + '</b>' + (c.trim ? ' <span style="color:var(--muted)">' + esc(prettyCarText(c.trim)) + '</span>' : '') + (c.monthly ? ' <span style="color:var(--brand);font-weight:600">₪' + Number(c.monthly).toLocaleString('he-IL') + '/חודש</span>' : '') + '</span></div>'; }).join('') || '<div class="ai muted">אין תוצאות</div>';
        res.classList.remove('hidden');
        res.querySelectorAll('.ai[data-i]').forEach(function (el) {
          el.addEventListener('mousedown', function () {   // mousedown fires before blur
            var c = cars[+el.dataset.i], label = carLabel(c);
            inp.value = label; res.classList.add('hidden');
            var bf = C.$('view').querySelector('[data-field="brand"]'); if (bf) bf.value = c.brand || '';
            db.from('leads').update({ car: label, brand: c.brand || null }).eq('id', lead.id).then(function (r) { if (r.error) { alert('שגיאה: ' + r.error.message); return; } lead.car = label; lead.brand = c.brand; logActivity(lead.id, 'system', 'רכב מבוקש: ' + label); });
          });
        });
      });
      inp.addEventListener('blur', function () { setTimeout(function () { res.classList.add('hidden'); }, 150); });
    });
  }
  // ---- unified timeline feed (everything, newest first) ----
  var FEED_TAG = { note: 'הערה', call: 'שיחה', whatsapp: 'WhatsApp', email: 'מייל', status: 'סטטוס', task: 'משימה', document: 'מסמך', meeting: 'פגישה', deal: 'עסקה', contract: 'הסכם' };
  function buildFeed(acts, tasks, docs, deals, pays, urls, audits) {
    var items = [];
    // שינויי שדות מהיומן — "מי שינה את המחיר" מופיע בציר הזמן ולא רק במסך נפרד
    (audits || []).forEach(function (e) {
      var ch = e.changes || {};
      if (ch._created || ch._deleted) return;                 // יצירה כבר מופיעה כאירוע נפרד
      var txt = C.auditLine ? C.auditLine(e) : '';
      if (!txt) return;
      items.push({ ts: e.at, icon: '✏️', who: e.actor_name, tag: 'שינוי', cls: 'audit',
                   html: '<span class="muted" style="font-size:12.5px">' + esc(txt) + '</span>' });
    });
    acts.forEach(function (a) { items.push({ ts: a.created_at, icon: ACT_ICON[a.type] || '•', who: profiles[a.created_by], html: a.body ? esc(a.body) : '', tag: FEED_TAG[a.type] || a.type }); });
    docs.forEach(function (d) {
      var u = urls[d.storage_path], body, isPdf = /\.pdf$/i.test(d.name || '') || /\.pdf$/i.test(d.storage_path || '');
      if (u && docIsImage(d.name)) body = '<div style="margin:2px 0 4px">' + esc(d.name) + '</div><a href="' + u + '" target="_blank" rel="noopener"><img src="' + u + '" alt="' + esc(d.name) + '" style="max-width:100%;max-height:280px;border-radius:10px;border:1px solid var(--line);display:block"></a>';
      else if (u && isPdf) body = '<div style="margin:2px 0 6px">📄 ' + esc(d.name) + ' · <a href="' + u + '" target="_blank" rel="noopener noreferrer">פתח במסך מלא »</a></div><iframe src="' + u + '" title="' + esc(d.name) + '" style="width:100%;height:360px;border:1px solid var(--line);border-radius:10px"></iframe>';
      else if (u) body = '<a href="' + u + '" target="_blank" rel="noopener">📎 ' + esc(d.name) + '</a>';
      else body = '<a href="#" data-doc="' + esc(d.storage_path) + '" data-docname="' + esc(d.name || '') + '">📎 ' + esc(d.name) + '</a>';
      items.push({ ts: d.created_at, icon: isPdf ? '📄' : '📎', who: profiles[d.created_by], html: body, tag: isPdf ? 'PDF' : 'מסמך' });
    });
    tasks.forEach(function (t) {
      var over = !t.done && t.due_at && new Date(t.due_at) < new Date();
      var due = t.due_at ? '<span style="font-size:12px;color:' + (over ? 'var(--danger)' : 'var(--muted)') + '"> · יעד ' + fmt(t.due_at) + '</span>' : '';
      var created = t.created_at ? '<span class="muted" style="font-size:11px"> · נוצרה ' + fmt(t.created_at) + '</span>' : '';
      var flag = t.done ? '<span class="done-badge">✓ בוצע</span>' : '<span class="task-open">● פתוחה</span>';
      var title = '<span' + (t.done ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' + esc(t.title) + '</span>';
      items.push({ ts: t.created_at || t.due_at, icon: t.done ? '✅' : '🔲', who: profiles[t.created_by], cls: t.done ? 'done' : '', tag: 'משימה',
        html: '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-wrap:wrap"><input type="checkbox" data-task="' + t.id + '"' + (t.done ? ' checked' : '') + '>' + title + ' ' + flag + due + created + '</label>' + (t.notes ? '<div class="muted" style="font-size:12.5px;margin-top:3px">🗒️ ' + esc(t.notes) + '</div>' : '') });
    });
    deals.forEach(function (d) { items.push({ ts: d.created_at, icon: '💰', who: profiles[d.created_by], html: 'עסקה #' + esc(d.order_no || String(d.id).slice(0, 6)) + (d.car_make ? ' · ' + esc(d.car_make + ' ' + (d.car_model || '')) : '') + (d.total ? ' · ' + nis(d.total) : '') + ' — <a href="#" data-open-deal="' + d.id + '">פתח</a>', tag: 'עסקה' }); });
    pays.forEach(function (p) { items.push({ ts: p.created_at, icon: '🧾', who: profiles[p.created_by], html: ({ invoice: 'חשבונית', receipt: 'קבלה', payment: 'תשלום' }[p.kind] || 'תשלום') + ' · ' + nis(p.amount) + (p.method ? ' · ' + esc(p.method) : '') + (p.ref_no ? ' · ' + esc(p.ref_no) : ''), tag: 'כספים' }); });
    items.sort(function (a, b) { return new Date(b.ts || 0) - new Date(a.ts || 0); });
    return items;
  }
  function feedHtml(items) {
    return items.length ? items.map(function (a) {
      return '<div class="ev' + (a.cls ? ' ' + a.cls : '') + '"><div class="dot">' + a.icon + '</div><div style="flex:1"><div class="tm">' + fmt(a.ts) + (a.tag ? ' · ' + esc(a.tag) : '') + (a.who ? ' · ' + esc(a.who) : '') + '</div>' + (a.html ? '<div>' + a.html + '</div>' : '') + '</div></div>';
    }).join('') : '<p class="empty">אין עדיין פעילות</p>';
  }
  function row(k, v) { return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span class="muted" style="font-size:13px">' + k + '</span><span>' + v + '</span></div>'; }
  function flowBar(cur) {
    var idx = FLOW.map(function (s) { return s.k; }).indexOf(cur), lost = cur === 'lost' || cur === 'no_answer';
    var html = FLOW.map(function (s, i) {
      var state = lost ? 'gray' : (i < idx ? 'green' : i === idx ? 'cur' : 'gray');
      var bg = { gray: 'var(--surface-2)', cur: s.color, green: '#16a34a' }[state];
      return '<div class="st clk" data-status="' + s.k + '" title="לחצו כדי לעדכן סטטוס" style="background:' + bg + ';color:' + (state === 'gray' ? 'var(--muted)' : '#fff') + '">' + s.icon + '<br>' + esc(s.label) + '</div>';
    }).join('');
    // "לא רלוונטי" always visible at the end of the funnel (red when active)
    var ls = stDef('lost');
    html += '<div class="st clk" data-status="lost" title="סמן כלא רלוונטי" style="background:' + (cur === 'lost' ? '#e2555a' : 'var(--surface-2)') + ';color:' + (cur === 'lost' ? '#fff' : 'var(--muted)') + '">' + ls.icon + '<br>' + esc(ls.label) + '</div>';
    return html;
  }
  function reasonSelect(lead) {
    var need = !lead.close_reason;
    return '<div id="lpReasonWrap" style="margin:4px 0 10px;padding:10px;border-radius:10px;background:' + (need ? 'rgba(226,85,90,.08)' : 'var(--surface-2)') + ';border:1px solid ' + (need ? 'var(--danger)' : 'var(--line)') + '">' +
      '<label class="muted" style="font-size:12px;font-weight:700;color:' + (need ? 'var(--danger)' : 'var(--muted)') + '">סיבת "לא רלוונטי" ' + (need ? '· חובה לבחור' : '') + '</label>' +
      '<select class="inp" id="lpReason" style="width:100%;margin-top:4px"><option value="">בחר סיבה…</option>' +
      CLOSE_REASONS.map(function (x) { return '<option' + (lead.close_reason === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>';
  }
  // ---------- ACTIVITY (global feed: who did what) ----------
  // ---------- סל מיחזור ----------
  // לידים שהועברו לסל מוסתרים מכל המסכים אבל שומרים את כל ההיסטוריה.
  // רק מנהל רואה את המסך הזה, ורק ממנו אפשר לשחזר או למחוק סופית.
  window.C2B_renderTrash = function () {
    C.loading();
    db.from('leads').select('id,name,phone,car,status,source,created_at,deleted_at,deleted_by')
      .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500)
      .then(function (r) {
        if (r.error) return C.errBox('שגיאה בטעינת הסל: ' + r.error.message);
        var rows = r.data || [];
        var body = rows.length ? rows.map(function (l) {
          return '<tr><td><b>' + esc(l.name || 'ללא שם') + '</b></td><td class="muted">' + esc(l.phone || '—') + '</td>' +
            '<td class="muted">' + esc(l.car || '—') + '</td><td class="muted">' + esc(l.source || '—') + '</td>' +
            '<td class="muted">' + fmt(l.deleted_at) + '</td>' +
            '<td class="muted">' + esc(profiles[l.deleted_by] || '—') + '</td>' +
            '<td style="white-space:nowrap"><button class="btn btn-sm" data-restore="' + l.id + '">↩ שחזר</button> ' +
            '<button class="btn btn-ghost btn-sm" data-purge="' + l.id + '">מחק סופית</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty">הסל ריק</td></tr>';
        C.view('<h2 style="margin:0 0 4px">🗑️ סל מיחזור</h2>' +
          '<p class="muted" style="font-size:13px;margin:0 0 14px">לידים שהוסרו מהמסכים. ההיסטוריה, המסמכים והעסקאות נשמרו במלואם. מחיקה סופית היא בלתי הפיכה.</p>' +
          '<div class="card"><div class="table-scroll"><table><thead><tr><th>שם</th><th>טלפון</th><th>רכב</th><th>מקור</th><th>הועבר לסל</th><th>על ידי</th><th></th></tr></thead><tbody>' +
          body + '</tbody></table></div></div>');
        C.$('view').querySelectorAll('[data-restore]').forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true;
            db.rpc('restore_lead', { p_lead: b.dataset.restore }).then(function (rr) {
              if (rr.error) { b.disabled = false; return alert('שגיאה: ' + rr.error.message); }
              C.refreshBadges && C.refreshBadges(); window.C2B_renderTrash();
            });
          });
        });
        C.$('view').querySelectorAll('[data-purge]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('למחוק את הליד לצמיתות?\n\nכל הפעילות, המסמכים והעסקאות שלו יימחקו ולא ניתן יהיה לשחזר אותם.')) return;
            b.disabled = true;
            db.rpc('purge_lead', { p_lead: b.dataset.purge }).then(function (rr) {
              if (rr.error) { b.disabled = false; return alert('שגיאה: ' + rr.error.message); }
              window.C2B_renderTrash();
            });
          });
        });
      });
  };

  // ---------- יומן פעולות ----------
  // עונה על "מי שינה את זה?" — כל שינוי בשדה במעקב נרשם עם ערך לפני/אחרי.
  var AUDIT_LABEL = {
    status: 'סטטוס', assigned_to: 'איש מכירות', phone: 'טלפון', email: 'מייל', name: 'שם',
    id_num: 'ת.ז / ח.פ', source: 'מקור הגעה', brand: 'מותג', close_reason: 'סיבת סגירה',
    deleted_at: 'סל מיחזור', stage: 'שלב תיק', car_price: 'מחיר רכב', monthly: 'החזר חודשי',
    commission: 'עמלה', down_total: 'מקדמה', total: 'סה"כ', discount_amt: 'הנחה',
    salesperson: 'נציג', client_name: 'שם לקוח', client_id: 'ת.ז לקוח', signed_at: 'חתימה',
    cancel_reason: 'סיבת ביטול', amount: 'סכום', kind: 'סוג', method: 'אמצעי תשלום',
    ref_no: 'אסמכתא', role: 'תפקיד', active: 'פעיל', views: 'הרשאות תצוגה', full_name: 'שם מלא'
  };
  var ENTITY_LABEL = { leads: 'ליד', deals: 'עסקה', payments: 'תשלום', profiles: 'משתמש' };
  function auditVal(field, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'assigned_to') return profiles[v] || String(v).slice(0, 8);
    if (field === 'status') return (stDef(v) || {}).label || v;
    if (field === 'active') return v === 'true' ? 'כן' : 'לא';
    return String(v).slice(0, 60);
  }
  function auditLine(e) {
    var ch = e.changes || {};
    if (ch._created) return 'נוצר';
    if (ch._deleted) return 'נמחק לצמיתות';
    return Object.keys(ch).map(function (k) {
      return (AUDIT_LABEL[k] || k) + ': ' + auditVal(k, ch[k].from) + ' ← ' + auditVal(k, ch[k].to);
    }).join(' · ');
  }
  C.auditLine = auditLine;
  window.C2B_renderAudit = function () {
    C.loading();
    db.from('audit_log').select('at,actor_name,entity,entity_id,action,changes,lead_id')
      .order('at', { ascending: false }).limit(300)
      .then(function (r) {
        if (r.error) return C.errBox('שגיאה בטעינת היומן: ' + r.error.message);
        var rows = r.data || [];
        var body = rows.length ? rows.map(function (e) {
          return '<tr><td class="muted" style="white-space:nowrap">' + fmt(e.at) + '</td>' +
            '<td>' + esc(e.actor_name || 'מערכת') + '</td>' +
            '<td>' + esc(ENTITY_LABEL[e.entity] || e.entity) + '</td>' +
            '<td>' + esc(auditLine(e)) + '</td>' +
            '<td>' + (e.lead_id ? '<button class="btn btn-ghost btn-sm" data-goLead="' + e.lead_id + '">לכרטיס →</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="empty">אין עדיין רשומות</td></tr>';
        C.view('<h2 style="margin:0 0 4px">📜 יומן פעולות</h2>' +
          '<p class="muted" style="font-size:13px;margin:0 0 14px">כל שינוי בשדה חשוב — מי, מה, מתי, ומה היה הערך לפני. היומן נכתב על ידי המסד ואינו ניתן לעריכה.</p>' +
          '<div class="card"><div class="table-scroll"><table><thead><tr><th>מתי</th><th>מי</th><th>מה</th><th>שינוי</th><th></th></tr></thead><tbody>' +
          body + '</tbody></table></div></div>');
        C.$('view').querySelectorAll('[data-goLead]').forEach(function (b) {
          b.addEventListener('click', function () { window.C2B_openLeadCard(b.dataset.golead); });
        });
      });
  };

  window.C2B_renderActivity = function () {
    loading();
    Promise.all([
      db.from('activities').select('*').order('created_at', { ascending: false }).limit(300),
      db.from('leads').select('id,name').is('deleted_at', null),
      db.from('profiles').select('user_id,full_name')
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var acts = res[0].data || [], lmap = {}, pmap = {};
      (res[1].data || []).forEach(function (l) { lmap[l.id] = l.name; });
      (res[2].data || []).forEach(function (p) { pmap[p.user_id] = p.full_name; });
      var rows = acts.map(function (a) {
        var who = pmap[a.created_by] || 'מערכת';
        var leadLink = a.lead_id ? ' · <a href="#" data-lead="' + a.lead_id + '">' + esc(lmap[a.lead_id] || 'ליד') + '</a>' : '';
        return '<div class="ev"><div class="dot">' + (ACT_ICON[a.type] || '•') + '</div><div style="flex:1"><div class="tm">' + fmt(a.created_at) + ' · <b>' + esc(who) + '</b>' + leadLink + '</div>' + (a.body ? '<div>' + esc(a.body) + '</div>' : '') + '</div></div>';
      }).join('');
      view('<div class="card"><h3>מסך פעילות — כל הפעולות במערכת</h3><p class="muted" style="font-size:13px">מי ביצע · מתי · מה השתנה (300 האחרונות)</p><div class="tl">' + (rows || '<p class="empty">אין פעילות עדיין</p>') + '</div></div>');
      C.$('view').querySelectorAll('a[data-lead]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); window.C2B_openLeadCard(a.dataset.lead); }); });
    });
  };
  function bindLead(lead, prev, next) {
    var $ = C.$;
    $('lpBack').addEventListener('click', function () { window.C2B_renderLeads(curFilter); });
    if (prev) $('lpPrev').addEventListener('click', function () { window.C2B_openLeadCard(prev); });
    if (next) $('lpNext').addEventListener('click', function () { window.C2B_openLeadCard(next); });
    // clickable status — both the header badge and the inline "סטטוס לקוח" row
    $('view').querySelectorAll('.tag.click').forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); openStatusMenu(el, el.dataset.cur || lead.status || 'new', function (to) { changeStatus(lead.id, to, lead, function () { window.C2B_openLeadCard(lead.id); }); }); });
    });
    // clickable funnel — move the lead through statuses straight from the flow bar
    var lfb = $('leadFlow');
    if (lfb) lfb.addEventListener('click', function (e) { var st = e.target.closest('[data-status]'); if (!st) return; changeStatus(lead.id, st.dataset.status, lead, function () { window.C2B_openLeadCard(lead.id); }); });
    var rs = $('lpReason'); if (rs) { if (!lead.close_reason) rs.focus(); rs.addEventListener('change', function () { db.from('leads').update({ close_reason: rs.value }).eq('id', lead.id).then(function () { logActivity(lead.id, 'system', 'סיבת אי-רלוונטיות: ' + rs.value); window.C2B_openLeadCard(lead.id); }); }); }
    // inline field editing — save each business field on change (no edit button)
    var ldInfoEl = $('ldInfo');
    if (ldInfoEl) ldInfoEl.addEventListener('change', function (e) {
      var el = e.target.closest('[data-field]'); if (!el) return;
      var field = el.dataset.field, val = (el.value || '').trim(), patch = {};
      patch[field] = val || null;
      // אותה ולידציה כמו בטופס הליד החדש — שדה שנערך ישירות בכרטיס עקף אותה עד עכשיו
      var bad = val ? validateLead(Object.assign({ name: lead.name, phone: lead.phone }, patch)) : null;
      if (bad) {
        el.style.borderColor = 'var(--danger)';
        alert(bad);
        el.value = lead[field] == null ? '' : lead[field];
        setTimeout(function () { el.style.borderColor = ''; }, 1200);
        return;
      }
      db.from('leads').update(patch).eq('id', lead.id).then(function (r) {
        if (r.error) { alert('שגיאה בשמירה: ' + r.error.message); return; }
        lead[field] = patch[field];
        var shown = field === 'assigned_to' ? (profiles[val] || '—') : val;
        logActivity(lead.id, 'system', 'עודכן ' + (el.dataset.label || field) + (shown ? ': ' + shown : ''));
        el.style.borderColor = 'var(--ok)'; setTimeout(function () { el.style.borderColor = ''; }, 900);
      });
    });
    setupCarPicker(lead);   // cascading brand→model→trim from inventory
    // details tabs: פרטים ⇄ שיווק ומקורות
    var ldt = $('ldTabs');
    if (ldt) ldt.addEventListener('click', function (e) { var b = e.target.closest('[data-ld]'); if (!b) return; ldt.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); }); $('ldInfo').classList.toggle('hidden', b.dataset.ld !== 'info'); $('ldMkt').classList.toggle('hidden', b.dataset.ld !== 'mkt'); });
    // deals list
    if ($('lpNewDeal')) $('lpNewDeal').addEventListener('click', function () { dealForm(lead, null); });
    // create one price-offer form per brand (from the managed brand list), each tagged with the brand name
    if ($('lpBrandDeals')) $('lpBrandDeals').addEventListener('click', function () {
      var brands = (C.lists && C.lists.brand) || [], pick = $('lpBrandPick');
      if (!brands.length) { pick.innerHTML = '<p class="muted" style="font-size:12px;margin:8px 0">לא הוגדרו מותגים. הוסיפו אותם ב"הגדרות → רשימות שדות → מותג".</p>'; return; }
      if (pick.dataset.open === '1') { pick.innerHTML = ''; pick.dataset.open = '0'; return; }
      pick.dataset.open = '1';
      pick.innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:8px 0"><p class="muted" style="font-size:12px;margin:0 0 8px">בחרו מותגים — לכל מותג ייווצר טופס הצעת מחיר נפרד עם שם המותג:</p><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + brands.map(function (b) { return '<label class="tag" style="cursor:pointer;display:inline-flex;gap:5px;align-items:center"><input type="checkbox" class="lpBrandCb" value="' + esc(b) + '"' + (lead.brand === b ? ' checked' : '') + '> ' + esc(b) + '</label>'; }).join('') + '</div><button class="btn btn-sm" id="lpBrandCreate">✍ צור הצעות לנבחרים</button></div>';
      $('lpBrandCreate').addEventListener('click', function () {
        var sel = Array.prototype.slice.call(pick.querySelectorAll('.lpBrandCb:checked')).map(function (c) { return c.value; });
        if (!sel.length) { alert('בחרו לפחות מותג אחד'); return; }
        this.disabled = true; this.textContent = 'יוצר…';
        // מיפוי מותג → סוג ההסכם שיופק: "Car 2 Buy" → car2buy, אחרת קליק אנד דרייב
        function brandCtype(b) { return 'car2buy'; }   // מותג אחד → הסכם אחד
        var rows = sel.map(function (b) { return { lead_id: lead.id, status: 'quote', brand: b, contract_type: brandCtype(b), form_type: 'הצעת מחיר — ' + b, salesperson: '', client_name: lead.name || null, client_phone: lead.phone || null, client_email: lead.email || null, client_address: lead.city || null }; });
        db.from('deals').insert(rows).then(function (r) {
          if (r.error) { alert('שגיאה: ' + r.error.message); return; }
          logActivity(lead.id, 'quote', 'נוצרו ' + sel.length + ' הצעות מחיר לפי מותג: ' + sel.join(', ')).then(function () { window.C2B_openLeadCard(lead.id); });
        });
      });
    });
    $('lpDeals').querySelectorAll('[data-deal-id]').forEach(function (el) { el.addEventListener('click', function () { var dd = curDeals.filter(function (x) { return x.id === el.dataset.dealId; })[0]; dealForm(lead, dd); }); });
    // timeline interactions: task toggle, open deal, fallback doc link
    var tl = $('lpTimeline');
    tl.querySelectorAll('input[data-task]').forEach(function (cb) { cb.addEventListener('change', function () { db.from('tasks').update({ done: cb.checked }).eq('id', cb.dataset.task).then(function () { C.refreshBadges && C.refreshBadges(); }); }); });
    tl.querySelectorAll('a[data-open-deal]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); var dd = curDeals.filter(function (x) { return x.id === a.dataset.openDeal; })[0]; if (dd) dealForm(lead, dd); }); });
    tl.querySelectorAll('a[data-doc]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); C.viewDoc(a.dataset.doc, a.dataset.docname); }); });
    // consolidated action bar (role-tailored)
    $('view').querySelectorAll('button[data-act2]').forEach(function (b) { b.addEventListener('click', function () { leadAction(lead, b.dataset.act2); }); });
  }
  function leadAction(lead, k) {
    var $ = C.$;
    if (k === 'deal') return dealForm(lead, null);
    if (k === 'meeting') return meetingForm(lead);
    if (k === 'car') return carPicker(lead);
    if (k === 'contract') { var dd = curDeals[0]; if (!dd) { alert('אין עדיין עסקה. צרו עסקה תחילה, ואז אפשר לשלוח/לחתום על ההסכם.'); return; } return contractView(lead, dd); }
    var box = $('lpForm');
    if (k === 'doc') {
      box.innerHTML = '<label class="muted" style="font-size:12px">העלה מסמך / תמונה — תוצג מיד פתוחה בציר הזמן</label><input type="file" id="lpUp" style="margin-top:6px;display:block">';
      $('lpUp').addEventListener('change', function () {
        var file = this.files[0]; if (!file) return; var path = safeStoragePath(lead.id, file.name);
        box.innerHTML = '<p class="muted">מעלה…</p>';
        db.storage.from('lead-docs').upload(path, file).then(function (u) { if (u.error) { box.innerHTML = ''; return alert('העלאה נכשלה: ' + u.error.message); } db.from('lead_documents').insert({ lead_id: lead.id, name: file.name, storage_path: path }).then(function () { logActivity(lead.id, 'document', 'הועלה מסמך: ' + file.name); window.C2B_openLeadCard(lead.id); }); });
      });
      return;
    }
    if (k === 'task') {
      box.innerHTML = '<form id="lpTaskForm"><input class="inp" name="title" placeholder="משימה חדשה…" style="width:100%;margin-bottom:6px"><textarea class="inp" name="notes" rows="2" placeholder="הערות למשימה (אופציונלי)…" style="width:100%;margin-bottom:6px"></textarea><div style="display:flex;gap:6px"><input class="inp" name="due" type="datetime-local" style="flex:1"><button class="btn btn-sm">הוסף</button></div></form>';
      $('lpTaskForm').addEventListener('submit', function (e) {
        e.preventDefault(); var title = this.title.value.trim(); if (!title) return;
        var due = this.due.value ? new Date(this.due.value).toISOString() : null, notes = this.notes.value.trim() || null;
        db.from('tasks').insert({ lead_id: lead.id, title: title, due_at: due, notes: notes }).then(function () { logActivity(lead.id, 'task', 'נפתחה משימה: ' + title); C.refreshBadges && C.refreshBadges(); window.C2B_openLeadCard(lead.id); });
      });
      $('lpTaskForm').querySelector('[name=title]').focus();
      return;
    }
    if (k === 'auto') {
      // בנק הודעות מהירות — וואטסאפ נפתח מהמכשיר של הנציג (wa.me) + מייל אוטומטי
      box.innerHTML = '<div class="card" style="box-shadow:none;margin:6px 0 0;border:1px solid var(--line)"><div class="row-between"><h3 style="margin:0">⚡ הודעות מהירות <span class="muted" style="font-size:11.5px;font-weight:400">· וואטסאפ שלך + מייל</span></h3><button class="btn btn-ghost btn-sm" id="qmClose">✕ סגור</button></div><p class="muted" style="font-size:11.5px;margin:6px 0 0">💬 הוואטסאפ נפתח מהמכשיר שלך עם ההודעה מוכנה — הקישו "שלח". כך זה יוצא מהמספר שלכם.</p><div id="qmList" style="margin-top:8px"><p class="muted">טוען…</p></div></div>';
      $('qmClose').addEventListener('click', function () { box.innerHTML = ''; });
      db.from('quick_messages').select('*').eq('active', true).order('sort', { ascending: true }).then(function (r) {
        var list = r.data || [];
        if (r.error) { $('qmList').innerHTML = '<p class="muted" style="color:var(--warn)">הריצו quick_messages.sql</p>'; return; }
        if (!list.length) { $('qmList').innerHTML = '<p class="muted" style="font-size:13px">אין הודעות. הוסיפו בהגדרות → ⚡ הודעות מהירות.</p>'; return; }
        $('qmList').innerHTML = list.map(function (m) {
          return '<div class="qm-item" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)">' +
            '<button class="btn btn-sm qm-send" data-qm="' + m.id + '">שלח »</button>' +
            '<div style="flex:1;min-width:0"><b style="font-size:13.5px">' + esc(m.title) + '</b><div class="muted" style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc((m.wa_text || m.email_body || '').replace(/\n/g, ' ')) + '</div></div>' +
            '<span class="qm-msg" style="font-size:11.5px;min-width:64px"></span></div>';
        }).join('');
        $('qmList').querySelectorAll('.qm-send').forEach(function (b) {
          b.addEventListener('click', function () {
            var m = list.filter(function (x) { return x.id === b.dataset.qm; })[0]; if (!m) return;
            var row = b.closest('.qm-item'), msg = row.querySelector('.qm-msg');
            // וואטסאפ נשלח מהמכשיר האישי של הנציג (wa.me) — נפתח עם ההודעה מוכנה, הנציג מקיש "שלח".
            // חייב window.open סינכרוני בתוך אירוע הלחיצה (מחווה משתמש) כדי שחוסם-החלונות לא יחסום.
            var first = String(lead.name || '').trim().split(/\s+/)[0] || '';
            function fill(t) {
              return String(t || '')
                .replace(/\{\s*(firstname|first_name)\s*\}/gi, first)
                .replace(/\{\s*(name|fullname|full_name|שם)\s*\}/gi, lead.name || '')
                .replace(/\{\s*(car|רכב)\s*\}/gi, lead.car || '')
                .replace(/\{\s*(phone|טלפון)\s*\}/gi, lead.phone || '');
            }
            var waText = fill(m.wa_text);
            var waNum = lead.phone ? waIntl(lead.phone) : '';
            var opened = false;
            if (waNum && waText) { window.open('https://wa.me/' + waNum + '?text=' + encodeURIComponent(waText), '_blank'); opened = true; }
            // מייל נשלח אוטומטית (אין מגבלת וואטסאפ)
            var emailText = fill(m.email_body || waText);
            var emailOp = (lead.email && emailText) ? sendCustomerMsg('email', lead, { text: emailText, subject: fill(m.email_subject || 'הודעה מ-פרי דרייב') }) : null;
            if (!opened && !emailOp) { msg.style.color = 'var(--danger)'; msg.textContent = (lead.phone ? 'אין טקסט וואטסאפ' : 'אין טלפון/מייל'); return; }
            function finish(emailOk) {
              b.disabled = false; msg.style.color = (opened || emailOk) ? 'var(--ok)' : 'var(--danger)';
              msg.textContent = (opened ? '💬 נפתח בוואטסאפ ' : '') + (emailOp ? (emailOk ? '✔ מייל' : '✖ מייל') : '');
              logActivity(lead.id, 'note', '⚡ הודעה מהירה "' + m.title + '"' + (opened ? ' — נפתחה בוואטסאפ שלך' : '') + (emailOp ? (emailOk ? ' + מייל נשלח ✓' : ' | מייל נכשל') : ''));
            }
            if (emailOp) { b.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'שולח מייל…'; emailOp.then(finish); }
            else finish(false);
          });
        });
      });
      return;
    }
    // note / call_log → activity entry in the timeline
    var type = k === 'call_log' ? 'call' : 'note';
    var ph = k === 'call_log' ? 'סיכום השיחה…' : 'הערה…';
    box.innerHTML = '<form id="lpActForm"><textarea class="inp" name="body" rows="2" style="width:100%" placeholder="' + ph + '"></textarea><div style="margin-top:6px"><button class="btn btn-sm">שמור</button></div></form>';
    $('lpActForm').addEventListener('submit', function (e) { e.preventDefault(); var body = this.body.value.trim(); if (!body) return; logActivity(lead.id, type, body).then(function () { window.C2B_openLeadCard(lead.id); }); });
    $('lpActForm').querySelector('[name=body]').focus();
  }

  // ---- appointment: date + time only ----
  function meetingForm(lead) {
    C.$('lpForm').innerHTML = '<div class="card" style="box-shadow:none;margin:6px 0 0;border:1px solid var(--line)"><h3>קביעת פגישה</h3><form id="mForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">' +
      '<div class="field" style="margin:0"><label>תאריך</label><input class="inp" type="date" name="date" required></div>' +
      '<div class="field" style="margin:0"><label>שעה</label><input class="inp" type="time" name="time" required></div>' +
      '<div class="field" style="margin:0"><label>אופן</label><select class="inp" name="mode"><option>פרונטלי</option><option>טלפוני</option><option>וידאו</option><option>בסניף</option></select></div>' +
      '<div class="field" style="margin:0"><label>סניף</label><select class="inp" name="branch">' + C.selOpts((C.lists && C.lists.branch) || [], '', '— בחר סניף —') + '</select></div>' +
      '<div class="field" style="margin:0;flex-basis:100%"><label>הערות לפגישה</label><textarea class="inp" name="note" rows="2" placeholder="הערות (מיקום, נושא, מה להכין…)…" style="width:100%"></textarea></div>' +
      '<button class="btn btn-sm">קבע ושלח אישור</button><button type="button" class="btn btn-ghost btn-sm" id="mCancel">ביטול</button></form></div>';
    C.$('mCancel').addEventListener('click', function () { C.$('lpForm').innerHTML = ''; });
    C.$('mForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var d = this.date.value, t = this.time.value; if (!d || !t) return;
      var appt_at = new Date(d + 'T' + t).toISOString();
      var disp = new Date(d + 'T' + t).toLocaleDateString('he-IL');
      var full = { lead_id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, type: lead.car || 'פגישה', brand: lead.brand || null, appt_mode: this.mode.value, branch: (this.branch.value || ''), note: this.note.value.trim() || null, appt_date: disp, appt_time: t, appt_at: appt_at, status: 'new' };
      var core = { lead_id: lead.id, name: lead.name, phone: lead.phone, appt_date: disp, appt_time: t, appt_at: appt_at, status: 'new' };
      var branchTxt = (this.branch.value || '').trim();
      function afterSave() {
        logActivity(lead.id, 'meeting', 'נקבעה פגישה: ' + disp + ' ' + t + (branchTxt ? ' · סניף: ' + branchTxt : ''));
        changeStatus(lead.id, 'meeting_set', lead, function () { window.C2B_openLeadCard(lead.id); });
      }
      db.from('appointments').insert(full).then(function (r) {
        if (!r.error) return afterSave();
        // some deployments miss optional columns — retry with the core set so the meeting still lands in the calendar
        db.from('appointments').insert(core).then(function (r2) {
          if (r2.error) return alert('שמירת הפגישה נכשלה: ' + r2.error.message);
          afterSave();
        });
      });
    });
  }

  // ---- deal / car picker (autocomplete over cars.json, HE + EN) ----
  function carPicker(lead) {
    C.$('lpForm').innerHTML = '<div class="card" style="box-shadow:none;margin:6px 0 0;border:1px solid var(--line)"><h3>בחירת רכב לעסקה</h3><div class="ac-box"><input class="inp" id="carSearch" placeholder="הקלד מותג / דגם (עברית או אנגלית)…" style="width:100%"><div class="ac-res hidden" id="carRes"></div></div></div>';
    loadCars(function (cars) {
      var inp = C.$('carSearch'), res = C.$('carRes');
      inp.focus();
      inp.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase(); if (q.length < 1) { res.classList.add('hidden'); return; }
        var m = cars.filter(function (c) { return carMatch(c, q); }).slice(0, 12);
        res.innerHTML = m.map(function (c, i) { return '<div class="ai" data-i="' + cars.indexOf(c) + '">' + (c.img ? '<img src="' + esc((C.carImg||function(x){return x})(c.img)) + '" style="width:40px;height:26px;object-fit:cover;border-radius:5px">' : '') + '<span><b>' + esc(carName(c)) + '</b> ' + esc(c.trim || '') + ' · ' + nis(c.m) + '/ח\'</span></div>'; }).join('') || '<div class="ai muted">אין תוצאות</div>';
        res.classList.remove('hidden');
        res.querySelectorAll('.ai[data-i]').forEach(function (el) {
          el.addEventListener('click', function () {
            var c = cars[+el.dataset.i]; var label = carLabel(c);
            db.from('leads').update({ car: label }).eq('id', lead.id).then(function () { logActivity(lead.id, 'car', 'נבחר רכב לעסקה: ' + label); window.C2B_openLeadCard(lead.id); });
          });
        });
      });
    });
  }

  // ---------- DEALS (order / quote form) ----------
  function dealStatusLabel(s) { return { quote: 'הצעת מחיר', ordered: 'הזמנה', cancelled: 'בוטל' }[s] || s; }
  function dealList(deals) {
    if (!deals.length) return '<p class="muted" style="margin:6px 0">אין עסקאות</p>';
    return deals.map(function (d) { return '<div data-deal-id="' + d.id + '" style="padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer"><b>#' + esc(d.order_no) + '</b>' + (d.brand ? ' <span class="tag" style="font-size:10px">' + esc(d.brand) + '</span>' : '') + ' · ' + esc(dealStatusLabel(d.status)) + ' · ' + esc(((d.car_make || '') + ' ' + (d.car_model || '')).trim()) + ' · ' + nis(d.total) + (d.signature ? '<div style="margin-top:6px;display:flex;align-items:center;gap:8px"><span style="color:var(--ok);font-weight:700">✅ נחתם</span><img src="' + d.signature + '" alt="חתימה" style="height:40px;background:#fff;border:1px solid var(--line);border-radius:6px;padding:2px"></div>' : '') + '</div>'; }).join('');
  }
  // Ministry of Transport open vehicle registry (data.gov.il, CORS-enabled) — lookup by plate number
  function normalizeVehicle(r) {
    return {
      plate: r.mispar_rechev, make: String(r.tozeret_nm || '').replace(/\s+/g, ' ').trim(),
      model: r.kinuy_mishari || r.degem_nm || '', trim: r.ramat_gimur || '', year: r.shnat_yitzur || '',
      color: r.tzeva_rechev || '', fuel: r.sug_delek_nm || '', vin: r.misgeret || '', engine: r.degem_manoa || ''
    };
  }
  var PLATE_DATASETS = [
    '053cea08-09bc-40ec-8f7a-156f0677aff3', // רכב פרטי ומסחרי
    '0866573c-40cd-4ca8-91d2-9dd2d7a492e5', // רכב שהוסר מהכביש (deregistered)
    'bf9df4e2-d90d-4c0a-a400-19e15af8e95f'  // דו-גלגלי / אחר
  ];
  function plateLookup(plate, cb) {
    var base = 'https://data.gov.il/api/3/action/datastore_search', i = 0;
    (function tryOne() {
      if (i >= PLATE_DATASETS.length) { cb(null, 'לא נמצא רכב עם מספר זה'); return; }
      var url = base + '?resource_id=' + PLATE_DATASETS[i] + '&filters=' + encodeURIComponent(JSON.stringify({ mispar_rechev: +plate }));
      fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        var recs = (j && j.result && j.result.records) || [];
        if (recs.length) { cb(normalizeVehicle(recs[0])); return; }
        i++; tryOne();
      }).catch(function () { i++; tryOne(); });
    })();
  }
  window.C2B_plateLookup = plateLookup;

  function dealForm(lead, deal, fileMode) {
    deal = deal || {}; var ad = deal.addons || {};
    var curStage = deal.stage || 'awaiting';
    var checklist = {}; CHECKLIST_ITEMS.forEach(function (it) { checklist[it] = !!(deal.checklist || {})[it]; });
    if (deal.checklist && deal.checklist._ownership) checklist._ownership = deal.checklist._ownership;
    var G = function (label, name, val, type) { return '<div class="field" style="margin:0"><label>' + label + '</label><input class="inp" id="dl_' + name + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" style="width:100%"></div>'; };
    var grid = function (inner) { return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' + inner + '</div>'; };
    var statusSel = '<div class="field" style="margin:0"><label>סטטוס הזמנה</label><select class="inp" id="dl_status" style="width:100%">' + [['quote', 'הצעת מחיר'], ['ordered', 'הזמנה'], ['cancelled', 'בוטל']].map(function (s) { return '<option value="' + s[0] + '"' + ((deal.status || 'quote') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div>';
    var fin = deal.financing || {}, ti = deal.tradein || {};
    function gearboxSel(v) { return '<div class="field" style="margin:0"><label>תיבת הילוכים</label><select class="inp" id="dl_car_gearbox" style="width:100%"><option value="">— בחר —</option>' + ['אוטומט', 'ידני', 'רובוטית', 'טיפטרוניק'].map(function (g) { return '<option' + (v === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></div>'; }
    // --- cards (grouped into tabs matching the reference layout) ---
    var clientCard = '<div class="card"><h3>👤 פרטי הלקוח</h3>' + grid(G('שם לקוח', 'client_name', deal.client_name || lead.name) + G('טלפון נייד', 'client_phone', deal.client_phone || lead.phone) + G('דוא"ל', 'client_email', deal.client_email || lead.email) + G('כתובת', 'client_address', deal.client_address || lead.city) + G('ת.ז / ח.פ', 'client_id', deal.client_id || lead.id_num) + G('שם לחשבונית', 'invoice_name', deal.invoice_name || lead.name)) + '</div>';
    var brandDl = ((C.lists && C.lists.brand) || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    var brandField = '<div class="field" style="margin:0"><label>מותג</label><input class="inp" id="dl_brand" list="dl_brandOpts" value="' + esc(deal.brand || lead.brand || '') + '" placeholder="שם המותג" style="width:100%"><datalist id="dl_brandOpts">' + brandDl + '</datalist></div>';
    var ownVal = checklist._ownership || '01';
    var ownSel = '<div class="field" style="margin:0"><label>סוג הסכם (בעלות)</label><select class="inp" id="dl_ownership" style="width:100%"><option value="01"' + (ownVal === '01' ? ' selected' : '') + '>בעלים 01 (הרכב על שם הלקוח)</option><option value="00"' + (ownVal === '00' ? ' selected' : '') + '>בעלים 00 (בעלות קודמת)</option></select></div>';
    var autoBrand = deal.brand || lead.brand || '';
    var defFormType = deal.form_type || (autoBrand ? 'חוזה ' + autoBrand : 'חוזה');
    // מנהל מכירות מתמלא אוטומטית מהסוכן שהליד משויך אליו (או המנהל הראשי אם לא שויך)
    var defSalesperson = deal.salesperson || profiles[lead.assigned_to || mainManagerUid()] || '';
    var formCard = '<div class="card"><h3>בחירת טופס</h3>' + grid(G('סוג טופס', 'form_type', defFormType) + statusSel + brandField + ownSel + G('מנהל מכירות / נציג משוייך', 'salesperson', defSalesperson)) + '</div>';
    var carCard = '<div class="card"><h3>🚗 פרטי הרכב המוזמן</h3>' +
      '<div class="ac-box" style="margin-bottom:10px"><input class="inp" id="dl_carSearch" placeholder="🔎 חפש רכב מהקטלוג (עברית/אנגלית) — ימלא אוטומטית" style="width:100%"><div class="ac-res hidden" id="dl_carRes"></div></div>' +
      grid(G('יצרן', 'car_make', deal.car_make) + G('דגם', 'car_model', deal.car_model) + G('שנת ייצור', 'car_year', deal.car_year || 2026, 'number') + G('רמת גימור', 'car_trim', deal.car_trim) + G('נפח מנוע', 'car_engine', deal.car_engine) + G('מחיר הרכב ₪', 'car_price', deal.car_price, 'number') + G('החזר חודשי משוער ₪', 'monthly', deal.monthly, 'number') + '<div class="field" style="margin:0"><label>עמלת סוכן ₪ (אוטומטי · קריאה בלבד)</label><input class="inp" id="dl_commission" type="number" value="' + esc(deal.commission == null ? '' : deal.commission) + '" readonly tabindex="-1" style="width:100%;background:var(--surface-2);cursor:not-allowed;color:var(--muted)"></div>') +
      '<div style="border-top:1px dashed var(--line);margin:14px 0 10px;padding-top:12px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">✍ למילוי הסוכן</div>' +
      grid(G('צבע מבוקש', 'car_color', deal.car_color) + gearboxSel(deal.car_gearbox)) + '</div>' + '</div>';
    var specCard = '<div class="card"><h3>מפרט / הערות</h3><textarea class="inp" id="dl_spec" rows="5" style="width:100%" placeholder="מפרט / הערות לחוזה…">' + esc(deal.spec || '') + '</textarea></div>';
    var pricingCard = '<div class="card"><h3>תמחור ומקדמה</h3>' + grid(G('סכום מקדמה כולל ₪', 'down_total', deal.down_total, 'number') + G('מקדמה ראשונית ₪', 'down_initial', deal.down_initial, 'number') + G('זמן אספקה (ימים)', 'delivery_days', deal.delivery_days, 'number')) + '</div>';
    var addonsCard = '<div class="card"><h3>תוספות</h3>' +
      '<label style="display:flex;gap:8px;align-items:center;padding:5px 0"><input type="checkbox" id="dl_armor"' + (ad.armor !== false ? ' checked' : '') + '> מיגון לפי דרישת ביטוח</label>' +
      '<label style="display:flex;gap:8px;align-items:center;padding:5px 0"><input type="checkbox" id="dl_accessories"' + (ad.accessories !== false ? ' checked' : '') + '> אביזרים נלווים</label>' +
      '<label style="display:flex;gap:8px;align-items:center;padding:5px 0"><input type="checkbox" id="dl_charging"' + (ad.charging ? ' checked' : '') + '> עמדת טעינה</label>' +
      '<label style="display:flex;gap:8px;align-items:center;padding:5px 0"><input type="checkbox" id="dl_insurance"' + (ad.insurance ? ' checked' : '') + '> 40% הנחה על ביטוח חובה (חברת הכשרה)</label>' +
      '<div class="field" style="margin-top:6px"><label>סכום תוספות ₪</label><input class="inp" id="dl_addons_amount" type="number" value="' + esc(ad.addons_amount == null ? '' : ad.addons_amount) + '" style="width:100%"></div></div>';
    var summaryCard = '<div class="card"><h3>סיכום הזמנה ורווחיות</h3>' + grid(G('הנחה (%)', 'discount_pct', deal.discount_pct, 'number') + G('הנחה (סכום) ₪', 'discount_amt', deal.discount_amt, 'number') + G('שולם ₪', 'paid', deal.paid, 'number')) +
      '<label style="display:flex;gap:8px;align-items:center;padding:8px 0"><input type="checkbox" id="dl_vat"' + (deal.vat_included !== false ? ' checked' : '') + '> כולל מע"מ</label><div id="dlSummary" style="margin-top:8px"></div></div>';
    var finCard = '<div class="card"><h3>🏦 מקטע מימון</h3>' + grid(G('גובה מימון מבוקש ₪', 'fin_amount', fin.amount, 'number') + G('מימון מאושר ₪', 'fin_approved', fin.approved, 'number') + G('מספר תשלומים', 'fin_payments', fin.payments, 'number') + G('החזר חודשי ₪', 'fin_monthly', fin.monthly, 'number') + G('מסלול / סוג עסקת מימון', 'fin_track', fin.track) + G('מספר הצעה', 'fin_offer', fin.offer) + G('יתרת בלון ₪', 'fin_balloon', fin.balloon, 'number') + G('סטטוס מימון', 'fin_status', fin.status)) +
      '<label style="display:flex;gap:8px;align-items:center;padding:8px 0"><input type="checkbox" id="dl_fin_transferred"' + (fin.transferred ? ' checked' : '') + '> עברו כספים מגוף המימון</label></div>';
    var tradeCard = '<div class="card"><h3>🔁 מקטע טרייד-אין</h3>' +
      '<div class="ac-box" style="box-shadow:none;border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:14px;background:var(--brand-soft)">' +
        '<label style="font-size:12px;font-weight:700;color:var(--brand);display:block;margin-bottom:6px">🔎 שליפת פרטי רכב לפי מספר רישוי (משרד התחבורה)</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="inp" id="dl_ti_plate" value="' + esc(ti.plate || '') + '" placeholder="מספר רכב (ספרות בלבד)" inputmode="numeric" style="max-width:200px"><button type="button" class="btn btn-sm" id="dlPlateLookup">שלוף פרטים</button><span id="dlPlateMsg" style="font-size:12.5px"></span></div>' +
      '</div>' +
      grid(G('יצרן טרייד-אין', 'ti_make', ti.make) + G('דגם', 'ti_model', ti.model) + G('רמת גימור', 'ti_trim', ti.trim) + G('שנת דגם', 'ti_year', ti.year, 'number') + G('יד', 'ti_hand', ti.hand) + G('צבע', 'ti_color', ti.color) + G('סוג דלק', 'ti_fuel', ti.fuel) + G('מספר שלדה (VIN)', 'ti_vin', ti.vin) + G('מחיר מחירון ₪', 'ti_list', ti.list, 'number') + G('מחיר קנייה ₪', 'ti_buy', ti.buy, 'number') + G('סכום שעבוד ₪', 'ti_lien', ti.lien, 'number') + G('גורם משעבד', 'ti_holder', ti.holder) + G('תאריך מסירה בפועל', 'ti_delivery', ti.delivery, 'date')) +
      '<label style="display:flex;gap:8px;align-items:center;padding:8px 0"><input type="checkbox" id="dl_ti_liened"' + (ti.liened ? ' checked' : '') + '> הרכב משועבד</label></div>';
    // צ'קליסט התיק = איסוף מסמכים (6 סעיפים רלוונטיים) — זהה לסוכן המכירות ולמנהלת תיקי הלקוחות
    var chkItems = FILE_CHECKLIST_ITEMS;
    var checklistCard = '<div class="card"><h3>צ\'קליסט תיק</h3><div id="dlChecklist">' + chkItems.map(function (it) { return '<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" data-chk="' + esc(it) + '"' + (checklist[it] ? ' checked' : '') + '> ' + esc(it) + '</label>'; }).join('') + '</div></div>';
    var recordCard = '<div class="card"><h3>🗂️ סיכום עסקה והעלאת מסמכים</h3>' + grid(row('מספר הזמנה', esc(deal.order_no || '—')) + row('נוצר', deal.created_at ? fmt(deal.created_at) : '—') + row('שלב תיק', '<span id="dlRecStage">' + stageBadge(curStage) + '</span>') + row('מזהה עסקה', '<span class="muted" style="font-size:11px">' + esc(deal.id || '—') + '</span>')) +
      '<div id="dlCancelRow" style="margin-top:8px;font-size:12.5px">' + (deal.cancel_reason ? '<b style="color:#ef4444">סיבת ביטול:</b> ' + esc(deal.cancel_reason) : '') + '</div>' +
      '<hr style="border:none;border-top:1px solid var(--line);margin:16px 0">' +
      '<div class="row-between"><h3 style="margin:0">📁 מסמכי הלקוח</h3>' + (lead.id ? '<label class="btn btn-sm" style="cursor:pointer">⬆ העלה מסמכים<input type="file" id="dlDocUp" multiple style="display:none"></label>' : '') + '</div><p class="muted" style="font-size:12px;margin:4px 0 10px">ת"ז (שני צדדים + ספח) · רישיון נהיגה · אישור ניהול חשבון בנק · כרטיס אשראי (שני צדדים) · כל פורמט</p><div id="dlDocs">' + (lead.id ? 'טוען…' : 'שמרו את התיק תחילה כדי לצרף מסמכים') + '</div></div>';
    var paymentsCard = '<div class="card"><h3>תשלומים / קבלות / חשבוניות</h3><div id="dlPayList">' + (deal.id ? 'טוען…' : '<p class="muted">שמרו את העסקה כדי לנהל תשלומים</p>') + '</div>' +
      (deal.id ? '<form id="dlPayForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px"><select class="inp" name="kind"><option value="payment">תשלום</option><option value="receipt">קבלה</option><option value="invoice">חשבונית</option></select><input class="inp" name="amount" type="number" placeholder="סכום ₪" style="width:120px"><select class="inp" name="method" style="width:160px"><option value="">אמצעי תשלום…</option><option>אשראי</option><option>העברה בנקאית</option><option>מזומן</option><option>צ׳ק</option><option>הוראת קבע</option><option>ביט</option><option>אחר</option></select><input class="inp" name="ref" placeholder="אסמכתא" style="width:130px"><button class="btn btn-sm">+ הוסף</button></form>' : '') + '</div>';
    // notes area for the file manager — write client notes to help manage leads from here
    var fileNotesCard = fileMode ? '<div class="card"><h3>📝 הערות על הלקוח</h3><textarea class="inp" id="dlClientNote" rows="3" placeholder="כתבי הערה על הלקוח / התיק (מתועדת עם תאריך)…" style="width:100%"></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-sm" id="dlAddNote">➕ הוסף הערה</button></div><div id="dlNotesList" style="margin-top:12px">טוען הערות…</div></div>' : '';
    function dTab(k, label, active) { return '<button data-dtab="' + k + '"' + (active ? ' class="active"' : '') + '>' + label + '</button>'; }
    function dPanel(k, active, inner) { return '<div class="dl-panel' + (active ? '' : ' hidden') + '" data-dpanel="' + k + '">' + inner + '</div>'; }
    view(
      '<div class="lead-top"><div style="display:flex;align-items:center;gap:8px"><button class="btn btn-ghost btn-sm" id="dlBack">' + ((C.role || '') === 'files' ? '→ לרשימת התיקים' : '→ לכרטיס') + '</button><h3 style="margin:0">' + (deal.id ? 'עסקה #' + esc(deal.order_no) : 'עסקה חדשה') + '</h3></div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button class="btn btn-sm" id="dlContract">' + (deal.signature ? '📄 צפה בהסכם החתום' : (deal.contract_html ? '📤 שלח לחתימה' : '✍ יצירת הסכם לחתימה')) + '</button><span id="dlSaveState" style="display:none"></span></div></div>' +
      (fileMode ? '<div class="card" style="padding:12px"><h3 style="margin:0 0 8px;font-size:13px">שלב התיק (מנהלת תיקי לקוחות)</h3><div class="flow" id="dlStageBar">' + stageBar(curStage) + '</div></div>' : '') +
      '<nav class="tabs" id="dlTabs" style="margin-bottom:14px;flex-wrap:wrap">' +
        dTab('client', '👤 פרטי הלקוח', true) + dTab('deal', '📋 פרטי העסקה') + dTab('car', '🚗 פרטי הרכב המוזמן') + dTab('fin', '🏦 מקטע מימון') + dTab('trade', '🔁 מקטע טרייד-אין') + dTab('record', '🗂️ סיכום ומסמכים') +
      '</nav>' +
      dPanel('client', true, '<div class="grid2">' + clientCard + formCard + '</div>') +
      dPanel('deal', false, '<div class="grid2">' + pricingCard + addonsCard + '</div>' + summaryCard) +
      dPanel('car', false, carCard + specCard) +
      dPanel('fin', false, finCard) +
      dPanel('trade', false, tradeCard) +
      dPanel('record', false, '<div class="grid2">' + checklistCard + recordCard + '</div>' + (fileMode ? '' : paymentsCard)) +
      fileNotesCard   // הערות על הלקוח — הכי למטה, מתחת להכל (מנהלת תיקי לקוחות)
    );
    var $ = C.$;
    $('dlBack').addEventListener('click', function () { if ((C.role || '') === 'files') return window.C2B_renderFiles(); window.C2B_openLeadCard(lead.id); });
    $('dlTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-dtab]'); if (!b) return; $('dlTabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); }); C.$('view').querySelectorAll('[data-dpanel]').forEach(function (p) { p.classList.toggle('hidden', p.dataset.dpanel !== b.dataset.dtab); }); });
    // stage bar (shown to file manager / admin only) — persist first, re-render only on success so it never silently drifts
    if ($('dlStageBar')) $('dlStageBar').addEventListener('click', function (e) {
      var st = e.target.closest('[data-stage]'); if (!st) return;
      var stg = st.dataset.stage; if ((deal.stage || 'initial') === stg) return;
      if (!deal.id) { alert('שמרו את התיק תחילה (הזינו פרט כלשהו) לפני שינוי השלב.'); return; }
      function applyStage(upd) {
        db.from('deals').update(upd).eq('id', deal.id).then(function (r) {
          if (r.error) { alert('שמירת השלב נכשלה: ' + r.error.message); return; }
          curStage = stg; deal.stage = stg; if ('cancel_reason' in upd) deal.cancel_reason = upd.cancel_reason;
          $('dlStageBar').innerHTML = stageBar(curStage);
          if ($('dlRecStage')) $('dlRecStage').innerHTML = stageBadge(curStage);
          if ($('dlCancelRow')) $('dlCancelRow').innerHTML = deal.cancel_reason ? '<b style="color:#ef4444">סיבת ביטול:</b> ' + esc(deal.cancel_reason) : '';
          logActivity(lead.id, 'system', 'שלב תיק: ' + stageDef(stg).label + (upd.cancel_reason ? ' — ' + upd.cancel_reason : ''));
          if (upd.cancel_reason) notifyAccountingCancel(lead.id, deal, upd.cancel_reason);
          syncLeadFromStage(lead, stg);
        });
      }
      if (stg === 'cancelled') { pickCancelReason(deal.cancel_reason, function (reason) { if (reason == null) return; applyStage({ stage: stg, cancel_reason: reason }); }); }
      else applyStage({ stage: stg, cancel_reason: null });   // חזרה משלב מבוטל מנקה את הסיבה
    });
    // client notes (file manager) — timestamped, saved as note activities
    if ($('dlAddNote')) {
      var loadNotes = function () {
        db.from('activities').select('body,created_at').eq('lead_id', lead.id).eq('type', 'note').order('created_at', { ascending: false }).limit(30).then(function (r) {
          var list = r.data || [];
          $('dlNotesList').innerHTML = list.length ? list.map(function (a) { return '<div style="border-inline-start:3px solid var(--brand);padding:7px 11px;margin-bottom:8px;background:var(--surface-2);border-radius:8px"><div style="font-size:13px;white-space:pre-wrap">' + esc(a.body || '') + '</div><div class="muted" style="font-size:11px;margin-top:3px">' + (a.created_at ? fmt(a.created_at) : '') + '</div></div>'; }).join('') : '<div class="muted" style="font-size:12.5px">אין הערות עדיין.</div>';
        });
      };
      loadNotes();
      $('dlAddNote').addEventListener('click', function () {
        var t = $('dlClientNote').value.trim(); if (!t) return;
        $('dlAddNote').disabled = true;
        logActivity(lead.id, 'note', t).then(function () { $('dlClientNote').value = ''; $('dlAddNote').disabled = false; loadNotes(); });
      });
    }
    // client documents in the record tab: view / upload (any format) / delete
    if (lead.id) {
      var loadDocs = function () {
        db.from('lead_documents').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }).then(function (dr) {
          var docs = (dr && dr.data) || [];
          if (!$('dlDocs')) return;
          var cRow = '';
          if (deal && deal.contract_html) {
            cRow = '<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line)">' +
              '<div style="flex:1;min-width:0">✍️ <b>הסכם' + (deal.order_no ? ' #' + esc(deal.order_no) : '') + '</b>' +
                (deal.signature ? ' <span style="color:var(--ok);font-size:12px">✅ נחתם</span>'
                                : ' <span class="muted" style="font-size:12px">לא נחתם</span>') + '</div>' +
              '<button class="btn btn-ghost btn-sm" id="docOpenContract">👁️ פתח</button>' +
              (deal.signature ? '' : '<button class="btn btn-sm" id="docSendContract">📤 שלח ללקוח</button>') +
            '</div>';
          }
          function wireContractRow() {
            if ($('docOpenContract')) $('docOpenContract').addEventListener('click', function () { contractView(lead, deal); });
            if ($('docSendContract')) $('docSendContract').addEventListener('click', function () { contractView(lead, deal); });
          }
          if (!docs.length) { $('dlDocs').innerHTML = cRow || '<p class="muted">אין מסמכים עדיין — לחצו "העלה מסמכים".</p>'; wireContractRow(); return; }
          var paths = docs.map(function (x) { return x.storage_path; }), sf = db.storage.from('lead-docs');
          (sf.createSignedUrls ? sf.createSignedUrls(paths, 3600) : Promise.resolve({ data: [] })).then(function (sr) {
            var urls = {}; ((sr && sr.data) || []).forEach(function (s) { if (s && s.signedUrl) urls[s.path] = s.signedUrl; });
            if (!$('dlDocs')) return;
            $('dlDocs').innerHTML = cRow + docs.map(function (x) {
              var u = urls[x.storage_path], ic = /\.pdf$/i.test(x.name || '') ? '📄' : (/\.(png|jpe?g|gif|webp)$/i.test(x.name || '') ? '🖼️' : '📎');
              return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)"><div style="flex:1;min-width:0">' + ic + ' <a href="#" data-opendoc="' + esc(x.storage_path) + '" data-docname="' + esc(x.name || '') + '" style="cursor:pointer">' + esc(x.name) + '</a> <span class="muted" style="font-size:11px">· ' + fmt(x.created_at) + '</span></div><button class="btn btn-ghost btn-sm" data-opendoc="' + esc(x.storage_path) + '" data-docname="' + esc(x.name || '') + '" title="פתח לצפייה בלי להוריד">👁 פתח</button><button class="btn btn-ghost btn-sm" data-deldoc="' + x.id + '" data-delpath="' + esc(x.storage_path) + '" title="מחק">🗑️</button></div>';
            }).join('');
            wireContractRow();
            $('dlDocs').querySelectorAll('[data-opendoc]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); C.viewDoc(b.dataset.opendoc, b.dataset.docname); }); });
            $('dlDocs').querySelectorAll('[data-deldoc]').forEach(function (b) {
              b.addEventListener('click', function () {
                if (!confirm('למחוק את המסמך?')) return;
                db.storage.from('lead-docs').remove([b.dataset.delpath]).then(function () {
                  db.from('lead_documents').delete().eq('id', b.dataset.deldoc).then(function () { logActivity(lead.id, 'document', 'נמחק מסמך'); loadDocs(); });
                });
              });
            });
          });
        });
      };
      loadDocs();
      if ($('dlDocUp')) $('dlDocUp').addEventListener('change', function () {
        var files = Array.prototype.slice.call(this.files); if (!files.length) return;
        $('dlDocs').innerHTML = '<p class="muted">מעלה ' + files.length + ' קבצים…</p>';
        var done = 0, ok = 0, errs = [];
        function finish() { if (++done === files.length) { if (ok) logActivity(lead.id, 'document', 'הועלו ' + ok + ' מסמכים'); if (errs.length) alert('חלק מהקבצים נכשלו:\n• ' + errs.join('\n• ')); loadDocs(); } }
        files.forEach(function (file) {
          var path = safeStoragePath(lead.id, file.name);
          db.storage.from('lead-docs').upload(path, file, { contentType: file.type || undefined, upsert: false }).then(function (u) {
            if (u.error) { errs.push(file.name + ': ' + u.error.message); finish(); return; }
            db.from('lead_documents').insert({ lead_id: lead.id, name: file.name, storage_path: path }).then(function (ir) {
              if (ir.error) errs.push(file.name + ' (רשומה): ' + ir.error.message); else ok++;
              finish();
            });
          }).catch(function (e) { errs.push(file.name + ': ' + (e.message || e)); finish(); });
        });
        this.value = '';
      });
    }
    // checklist
    if ($('dlChecklist')) $('dlChecklist').addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-chk]'); if (!cb) return;
      checklist[cb.dataset.chk] = cb.checked; if (!deal.id) return;
      var ss = $('dlSaveState'); if (ss) ss.textContent = '💾 שומר…';
      db.from('deals').update({ checklist: checklist }).eq('id', deal.id).then(function (r) {
        if (r && r.error) { if (ss) ss.textContent = '⚠️ שמירה נכשלה'; alert('שמירת צ׳קליסט נכשלה: ' + r.error.message); }
        else if (ss) ss.textContent = '💾 נשמר אוטומטית';
      });
    });
    // submit to financing (validation)
    if ($('dlSubmitFin')) $('dlSubmitFin').addEventListener('click', function () {
      var miss = [];
      if (!$('dl_client_id').value.trim()) miss.push('ת.ז לקוח');
      if (!$('dl_car_make').value.trim()) miss.push('רכב');
      if (!num('dl_car_price')) miss.push('מחיר רכב');
      if (!deal.signature) miss.push('הסכם חתום');
      if (!checklist['תעודת זהות – צילום שני הצדדים כולל ספח פתוח']) miss.push('צילום ת"ז');
      if (miss.length) { alert('לא ניתן להגיש למימון — חסר:\n• ' + miss.join('\n• ')); return; }
      curStage = 'submitted'; if ($('dlStageBar')) $('dlStageBar').innerHTML = stageBar(curStage); if ($('dlRecStage')) $('dlRecStage').innerHTML = stageBadge(curStage);
      logActivity(lead.id, 'system', 'התיק הוגש למימון');
      doSave();
    });
    function num(id) { var v = parseFloat(($(id) && $(id).value) || ''); return isNaN(v) ? 0 : v; }
    function compute() {
      var price = num('dl_car_price'), addons = num('dl_addons_amount');
      var subtotal = price + addons;
      var disc = num('dl_discount_amt') || (subtotal * num('dl_discount_pct') / 100);
      var total = Math.max(0, subtotal - disc);
      var downBal = num('dl_down_total') - num('dl_down_initial');
      var balPay = total - num('dl_down_total');
      $('dlSummary').innerHTML = row2('סכום מוצרים', nis(price)) + row2('תוספות', nis(addons)) + row2('הנחה', nis(disc)) + row2('יתרת מקדמה', nis(downBal)) +
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid var(--brand);margin-top:6px;font-weight:800;font-size:17px"><span>סכום כולל</span><span style="color:var(--brand)">' + nis(total) + '</span></div>' + row2('יתרה לתשלום', nis(balPay));
      return { subtotal: subtotal, disc: disc, total: total, downBal: downBal, balPay: balPay };
    }
    function row2(k, v) { return '<div style="display:flex;justify-content:space-between;padding:5px 0"><span class="muted">' + k + '</span><span>' + v + '</span></div>'; }
    ['dl_car_price', 'dl_addons_amount', 'dl_discount_amt', 'dl_discount_pct', 'dl_down_total', 'dl_down_initial'].forEach(function (id) { if ($(id)) $(id).addEventListener('input', compute); });
    compute();
    // car search fills fields
    loadCars(function (cars) {
      var inp = $('dl_carSearch'), res = $('dl_carRes');
      inp.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase(); if (!q) { res.classList.add('hidden'); return; }
        var m = cars.filter(function (c) { return carMatch(c, q); }).slice(0, 12);
        res.innerHTML = m.map(function (c) { return '<div class="ai" data-i="' + cars.indexOf(c) + '">' + (c.img ? '<img src="' + esc((C.carImg||function(x){return x})(c.img)) + '" style="width:40px;height:26px;object-fit:cover;border-radius:5px">' : '') + '<span><b>' + esc(carName(c)) + '</b> ' + esc(prettyCarText(c.trim || '')) + ' · ' + nis(c.p) + '</span></div>'; }).join('') || '<div class="ai muted">אין תוצאות</div>';
        res.classList.remove('hidden');
        res.querySelectorAll('.ai[data-i]').forEach(function (el) { el.addEventListener('click', function () { var c = cars[+el.dataset.i]; var mm = carMakeModel(c); $('dl_car_make').value = mm.make; $('dl_car_model').value = mm.model; $('dl_car_trim').value = prettyCarText(c.trim || ''); $('dl_car_engine').value = c.engine || ''; $('dl_car_price').value = c.p || ''; $('dl_monthly').value = c.m || ''; if ($('dl_commission')) $('dl_commission').value = c.commission || ''; if ($('dl_car_gearbox') && !$('dl_car_gearbox').value && /חשמלי|electric|\bEV\b/i.test(c.engine || '')) $('dl_car_gearbox').value = 'אוטומט'; res.classList.add('hidden'); inp.value = ''; compute(); autoSave(); }); });
      });
    });
    // read the current form into a deal object (reused by save + contract)
    function readForm() {
      var c = compute();
      return {
        lead_id: lead.id, form_type: $('dl_form_type').value, status: $('dl_status').value, salesperson: $('dl_salesperson').value, brand: $('dl_brand') ? $('dl_brand').value : null,
        client_name: $('dl_client_name').value, client_phone: $('dl_client_phone').value, client_email: $('dl_client_email').value, client_address: $('dl_client_address').value, client_id: $('dl_client_id').value, invoice_name: $('dl_invoice_name').value,
        car_make: $('dl_car_make').value, car_model: $('dl_car_model').value, car_year: num('dl_car_year') || null, car_trim: $('dl_car_trim').value, car_engine: $('dl_car_engine').value, car_gearbox: $('dl_car_gearbox').value, car_color: $('dl_car_color').value,
        car_price: num('dl_car_price'), commission: num('dl_commission') || null, down_total: num('dl_down_total'), down_initial: num('dl_down_initial'), down_balance: c.downBal, monthly: num('dl_monthly'), delivery_days: num('dl_delivery_days') || null, balance_to_pay: c.balPay,
        addons: { charging: $('dl_charging').checked, armor: $('dl_armor').checked, accessories: $('dl_accessories').checked, insurance: $('dl_insurance').checked, addons_amount: num('dl_addons_amount') },
        vat_included: $('dl_vat').checked, discount_pct: num('dl_discount_pct') || null, discount_amt: c.disc, total: c.total, paid: num('dl_paid') || null, spec: $('dl_spec').value,
        stage: curStage, checklist: checklist, cancel_reason: (curStage === 'cancelled' ? (deal.cancel_reason || null) : null), contract_type: deal.contract_type || 'car2buy',
        financing: { amount: num('dl_fin_amount') || null, approved: num('dl_fin_approved') || null, payments: num('dl_fin_payments') || null, monthly: num('dl_fin_monthly') || null, track: $('dl_fin_track').value, offer: $('dl_fin_offer').value, balloon: num('dl_fin_balloon') || null, status: $('dl_fin_status').value, transferred: $('dl_fin_transferred').checked },
        tradein: { plate: $('dl_ti_plate') ? $('dl_ti_plate').value : null, make: $('dl_ti_make').value, model: $('dl_ti_model').value, trim: $('dl_ti_trim').value, year: num('dl_ti_year') || null, hand: $('dl_ti_hand').value, color: $('dl_ti_color') ? $('dl_ti_color').value : null, fuel: $('dl_ti_fuel') ? $('dl_ti_fuel').value : null, vin: $('dl_ti_vin') ? $('dl_ti_vin').value : null, list: num('dl_ti_list') || null, buy: num('dl_ti_buy') || null, lien: num('dl_ti_lien') || null, holder: $('dl_ti_holder').value, delivery: $('dl_ti_delivery').value || null, liened: $('dl_ti_liened').checked }
      };
    }
    // ---- auto-save: persist every change (debounced), no button, no page refresh ----
    var saveTimer = null, inFlight = false, dirtyAgain = false, dealLogged = !!deal.id, lastStatus = deal.status || 'quote';
    function setState(txt) { var ind = $('dlSaveState'); if (ind) ind.textContent = txt; }
    function doSave() {
      if (inFlight) { dirtyAgain = true; return; }
      inFlight = true; setState('💾 שומר…');
      var payload = readForm();
      // נעילה אופטימית: מעדכנים רק אם updated_at לא השתנה מאז שטענו.
      // אם עמית שמר בינתיים — נקבל 0 שורות ונזהיר, במקום לדרוס לו את השינוי בשקט.
      var q = deal.id
        ? (deal.updated_at
            ? db.from('deals').update(payload).eq('id', deal.id).eq('updated_at', deal.updated_at).select('id,order_no,updated_at')
            : db.from('deals').update(payload).eq('id', deal.id).select('id,order_no,updated_at'))
        : db.from('deals').insert(payload).select('id,order_no,updated_at').single();
      q.then(function (r) {
        inFlight = false;
        if (r.error) { setState('⚠ שגיאת שמירה'); console.warn('[deal auto-save]', r.error); return; }
        if (deal.id && Array.isArray(r.data) && r.data.length === 0) {
          setState('⚠ נחסם');
          alert('משתמש אחר שמר את העסקה הזאת בזמן שערכת.\n\nכדי לא לדרוס את השינוי שלו, השמירה שלך לא בוצעה.\nהמסך ייטען מחדש עם הגרסה העדכנית.');
          return window.C2B_openLeadCard(lead.id);
        }
        if (Array.isArray(r.data) && r.data[0]) { deal.updated_at = r.data[0].updated_at; r.data = r.data[0]; }
        else if (r.data && r.data.updated_at) deal.updated_at = r.data.updated_at;
        if (!deal.id && r.data) {
          deal.id = r.data.id; deal.order_no = r.data.order_no;
          var h = C.$('view') && C.$('view').querySelector('.lead-top h3'); if (h) h.textContent = 'עסקה #' + (deal.order_no || '');
        }
        if (!dealLogged) { dealLogged = true; logActivity(lead.id, 'quote', 'נוצרה עסקה: ' + (payload.car_make + ' ' + payload.car_model)); }
        // keep the lead status in sync when the order status changes — silently, no re-render
        if (payload.status !== lastStatus) {
          var prevLeadStatus = lead.status; lastStatus = payload.status;
          var ns = payload.status === 'ordered' ? 'won' : (payload.status === 'cancelled' ? 'lost' : 'quote_sent');
          if (ns !== prevLeadStatus) db.from('leads').update({ status: ns }).eq('id', lead.id).then(function () { lead.status = ns; if (C.refreshBadges) C.refreshBadges(); runAutomations(lead.id, ns, lead); });
        }
        setState('✓ נשמר');
        if (dirtyAgain) { dirtyAgain = false; doSave(); }
      });
    }
    function autoSave() { clearTimeout(saveTimer); setState('…'); saveTimer = setTimeout(doSave, 700); }
    _activeAutoSave = autoSave;   // this form is now the active one
    // סוג הטופס עוקב אחרי המותג שנבחר; בעלות 00/01 נשמרת ל-checklist
    (function () {
      var be = $('dl_brand'), fe = $('dl_form_type'), oe = $('dl_ownership');
      if (be && fe) be.addEventListener('input', function () { fe.value = be.value ? 'חוזה ' + be.value : 'חוזה'; });
      if (oe) oe.addEventListener('change', function () { checklist._ownership = oe.value; });
    })();
    if (!_autoSaveWired) {
      _autoSaveWired = true;
      var onFieldEdit = function (e) { if (_activeAutoSave && e.target.id && e.target.id.indexOf('dl_') === 0) _activeAutoSave(); };
      C.$('view').addEventListener('input', onFieldEdit);
      C.$('view').addEventListener('change', onFieldEdit);
    }
    $('dlContract').addEventListener('click', function () { contractView(lead, Object.assign({ id: deal.id, order_no: deal.order_no }, readForm())); });
    // trade-in: pull vehicle details by plate number from the Ministry of Transport open dataset
    if ($('dlPlateLookup')) $('dlPlateLookup').addEventListener('click', function () {
      var plate = ($('dl_ti_plate').value || '').replace(/\D/g, ''); var msg = $('dlPlateMsg');
      if (!plate) { msg.style.color = 'var(--danger)'; msg.textContent = 'הזינו מספר רכב'; return; }
      msg.style.color = 'var(--muted)'; msg.textContent = 'מחפש…'; this.disabled = true;
      var btn = this;
      plateLookup(plate, function (v, err) {
        btn.disabled = false;
        if (err || !v) { msg.style.color = 'var(--danger)'; msg.textContent = err || 'לא נמצא רכב עם מספר זה'; return; }
        if (v.make && $('dl_ti_make')) $('dl_ti_make').value = v.make;
        if (v.model && $('dl_ti_model')) $('dl_ti_model').value = v.model;
        if (v.trim && $('dl_ti_trim')) $('dl_ti_trim').value = v.trim;
        if (v.year && $('dl_ti_year')) $('dl_ti_year').value = v.year;
        if (v.color && $('dl_ti_color')) $('dl_ti_color').value = v.color;
        if (v.fuel && $('dl_ti_fuel')) $('dl_ti_fuel').value = v.fuel;
        if (v.vin && $('dl_ti_vin')) $('dl_ti_vin').value = v.vin;
        msg.style.color = 'var(--ok)'; msg.textContent = '✅ ' + [v.make, v.model, v.year].filter(Boolean).join(' · ');
      });
    });
    // payments ledger
    if (deal.id) {
      var KIND = { payment: 'תשלום', receipt: 'קבלה', invoice: 'חשבונית' };
      var loadPayments = function () {
        db.from('payments').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }).then(function (r) {
          var ps = r.data || [];
          var paid = ps.filter(function (p) { return p.kind !== 'invoice'; }).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
          $('dlPayList').innerHTML = (ps.length ? ps.map(function (p) { return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)"><span>' + (KIND[p.kind] || p.kind) + (p.method ? ' · ' + esc(p.method) : '') + (p.ref_no ? ' · ' + esc(p.ref_no) : '') + '</span><b>' + nis(p.amount) + '</b></div>'; }).join('') : '<p class="muted">אין תשלומים</p>') +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:800"><span>סה"כ שולם</span><span style="color:var(--ok)">' + nis(paid) + '</span></div>';
        });
      };
      loadPayments();
      $('dlPayForm').addEventListener('submit', function (e) {
        e.preventDefault(); var amt = parseFloat(this.amount.value) || 0; if (!amt) return; var kind = this.kind.value;
        db.from('payments').insert({ deal_id: deal.id, lead_id: lead.id, kind: kind, amount: amt, method: this.method.value, ref_no: this.ref.value, paid_at: new Date().toISOString().slice(0, 10) }).then(function (r) {
          if (r.error) return alert('שגיאה: ' + r.error.message);
          logActivity(lead.id, 'system', 'נרשם ' + (KIND[kind] || 'תשלום') + ': ' + nis(amt)); loadPayments();
        });
        this.reset();
      });
    }
  }

  // ---------- ACCOUNTING WORKSPACE (מנהלת חשבונות) ----------
  var ACCT_STATUSES = [
    { k: 'pending', label: 'ממתין לטיפול', color: '#6b7280' },
    { k: 'receipt', label: 'הופקה קבלה', color: '#16a34a' },
    { k: 'invoice', label: 'הופקה חשבונית', color: '#0ea5e9' },
    { k: 'partial', label: 'תשלום חלקי', color: '#eab308' },
    { k: 'paid', label: 'שולם ונסגר', color: '#16a34a' }
  ];
  var acctTab = 'deals', selectedAcct = {};
  var ACCT_COLS = [
    { key: 'order', label: '#', fixed: true, cell: function (d) { return '<td><b>#' + esc(d.order_no) + '</b></td>'; } },
    { key: 'client', label: 'לקוח', fixed: true, cell: function (d) { return '<td>' + esc(d.client_name) + (d.has_signature ? ' <span style="color:var(--ok)" title="נחתם">✅</span>' : '') + '</td>'; } },
    { key: 'invoice', label: 'קבלה על שם', cell: function (d) { return '<td>' + esc(d.invoice_name || d.client_name || '—') + '</td>'; } },
    { key: 'car', label: 'מה נקנה', cell: function (d) { return '<td>' + esc(((d.car_make || '') + ' ' + (d.car_model || '')).trim() || '—') + '</td>'; } },
    { key: 'total', label: 'סכום', cell: function (d) { return '<td>' + nis(d._tot) + '</td>'; } },
    { key: 'paid', label: 'שולם', cell: function (d) { return '<td>' + nis(d._paid) + '</td>'; } },
    { key: 'balance', label: 'יתרה', cell: function (d) { return '<td style="color:' + (d._bal > 0 ? 'var(--danger)' : 'var(--ok)') + '">' + nis(d._bal) + '</td>'; } },
    { key: 'salesperson', label: 'סוכן', cell: function (d) { return '<td>' + esc(d.salesperson || '—') + '</td>'; } },
    { key: 'commission', label: 'עמלה', cell: function (d) { return '<td style="color:var(--ok);font-weight:700">' + nis(d.commission) + '</td>'; } },
    { key: 'acct_status', label: 'סטטוס', cell: function (d) { return '<td>' + acctStatusSel(d.id, d.acct_status) + '</td>'; } },
    { key: 'brand', label: 'מותג', def: false, cell: function (d) { return '<td>' + esc(d.brand || '—') + '</td>'; } },
    { key: 'phone', label: 'טלפון', def: false, cell: function (d) { return '<td>' + esc(d.client_phone || '—') + '</td>'; } }
  ];
  var acctCols = null;
  window.C2B_renderAccounting = function () {
    selectedAcct = {};
    loading();
    Promise.all([
      db.from('deals').select('id,lead_id,order_no,brand,stage,status,client_name,client_phone,car_make,car_model,total,commission,salesperson,created_at,updated_at,checklist,cancel_reason,acct_status,has_contract,has_signature').eq('has_signature', true).order('created_at', { ascending: false }).limit(2000),   // הנהלת חשבונות רק עסקאות חתומות
      db.from('payments').select('*'),
      db.from('profiles').select('user_id,full_name'),
      db.from('lead_documents').select('*').order('created_at', { ascending: false }).limit(500),
      db.from('leads').select('id,name').is('deleted_at', null)
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var deals = res[0].data || [], pays = (res[1] && res[1].data) || [], docs = (res[3] && res[3].data) || [];
      var prof = {}; ((res[2] && res[2].data) || []).forEach(function (p) { prof[p.user_id] = p.full_name; });
      var lname = {}; ((res[4] && res[4].data) || []).forEach(function (l) { lname[l.id] = l.name; });
      var paths = docs.map(function (d) { return d.storage_path; }), sf = db.storage.from('lead-docs');
      (paths.length && sf.createSignedUrls ? sf.createSignedUrls(paths, 3600) : Promise.resolve({ data: [] })).then(function (sr) {
        var urls = {}; ((sr && sr.data) || []).forEach(function (s) { if (s && s.signedUrl) urls[s.path] = s.signedUrl; });
        acctWorkspace(deals, pays, prof, lname, docs, urls);
      });
    }).catch(function (e) { errBox(e.message || e); });
  };
  function acctStatusSel(id, cur) { return '<select class="inp acct-st" data-acct="' + id + '" style="width:auto;font-size:12.5px">' + ACCT_STATUSES.map(function (s) { return '<option value="' + s.k + '"' + ((cur || 'pending') === s.k ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select>'; }
  function acctWorkspace(deals, pays, prof, lname, docs, urls) {
    var paidByDeal = {}; pays.forEach(function (p) { if (p.kind !== 'invoice') paidByDeal[p.deal_id] = (paidByDeal[p.deal_id] || 0) + (+p.amount || 0); });
    var revenue = 0, collected = 0, open = 0, commTotal = 0;
    deals.forEach(function (d) { var tot = +d.total || 0, paid = paidByDeal[d.id] || 0; revenue += tot; collected += paid; open += Math.max(0, tot - paid); commTotal += (+d.commission || 0); });

    // TAB 1 — deals + receipts (what bought, invoice name, balance, commission, status, issue)
    if (!acctCols) acctCols = C.colPicker('accounting', ACCT_COLS, function () { window.C2B_renderAccounting(); }, { sortable: true });
    deals.forEach(function (d) { var tot = +d.total || 0, paid = paidByDeal[d.id] || 0; d._tot = tot; d._paid = paid; d._bal = tot - paid; });
    var dealRows = acctCols.sortRows(deals).map(function (d) {
      return '<tr data-lead="' + (d.lead_id || '') + '"><td style="width:28px;text-align:center"><input type="checkbox" data-asel="' + d.id + '"' + (selectedAcct[d.id] ? ' checked' : '') + '></td>' + acctCols.cells(d) + '</tr>';
    }).join('');
    var aBulk = '<div id="aBulk" class="filterbar" style="display:none;background:var(--brand-soft);align-items:center"><b id="aBulkCount" style="color:var(--brand)">נבחרו 0</b><select id="aBulkStatus"><option value="">🏷️ שנה סטטוס…</option>' + ACCT_STATUSES.map(function (s) { return '<option value="' + s.k + '">' + esc(s.label) + '</option>'; }).join('') + '</select><button class="btn btn-sm" id="aBulkApply">החל על הנבחרים</button><button class="btn btn-ghost btn-sm" id="aBulkClear">בטל בחירה</button></div>';
    var dealsPanel = '<div class="card"><div class="row-between"><h3 style="margin:0">עסקאות · קבלות · חשבוניות <span class="muted" style="font-size:12px">(סמנו לפעולה גורפת · לחצו על שורה לפתיחת תיק החשבונות)</span></h3>' + acctCols.button() + '</div>' + aBulk + '<div class="table-scroll"><table><thead><tr><th style="width:28px;text-align:center"><input type="checkbox" id="aSelAll"></th>' + acctCols.thead() + '</tr></thead><tbody>' + (dealRows || '<tr><td colspan="' + (acctCols.colCount() + 1) + '" class="empty">אין עסקאות</td></tr>') + '</tbody></table></div></div>';

    // TAB 2 — commission per agent (frozen values)
    var byAgent = {}; deals.forEach(function (d) { var a = d.salesperson || 'לא שויך'; byAgent[a] = byAgent[a] || { n: 0, comm: 0, total: 0 }; byAgent[a].n++; byAgent[a].comm += (+d.commission || 0); byAgent[a].total += (+d.total || 0); });
    var agents = Object.keys(byAgent).sort(function (a, b) { return byAgent[b].comm - byAgent[a].comm; });
    var commPanel = '<div class="cards">' + C.stat('סה"כ עמלות לתשלום', nis(commTotal), true) + C.stat('מספר סוכנים', agents.length) + '</div>' +
      '<div class="card"><h3>💸 עמלות סוכנים <span class="muted" style="font-size:12px">(לחצו על סוכן לפירוט העסקאות · אפשר לעדכן עמלה חסרה)</span></h3>' +
        (agents.length ? agents.map(function (a) {
          var o = byAgent[a], aDeals = deals.filter(function (d) { return (d.salesperson || 'לא שויך') === a; });
          var noComm = aDeals.filter(function (d) { return !(+d.commission); }).length;
          return '<details style="border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:6px 0">' +
            '<summary style="cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><b>' + esc(a) + '</b><span class="muted" style="font-size:12.5px">' + o.n + ' עסקאות · ' + nis(o.total) + ' · <b style="color:var(--ok)">עמלה ' + nis(o.comm) + '</b>' + (noComm ? ' · <span style="color:var(--warn)">' + noComm + ' ללא עמלה</span>' : '') + '</span></summary>' +
            '<div class="table-scroll" style="margin-top:8px"><table><thead><tr><th>#</th><th>לקוח</th><th>רכב</th><th>סכום</th><th>עמלה ₪</th></tr></thead><tbody>' +
              aDeals.map(function (d) { return '<tr><td><b>#' + esc(d.order_no || '—') + '</b></td><td>' + esc(d.client_name || '—') + '</td><td>' + esc(((d.car_make || '') + ' ' + (d.car_model || '')).trim() || '—') + '</td><td>' + nis(d.total) + '</td><td><input class="inp comm-edit" data-comm="' + d.id + '" type="number" value="' + (d.commission == null ? '' : d.commission) + '" placeholder="0" style="width:110px;font-weight:700' + (!(+d.commission) ? ';border-color:var(--warn)' : '') + '"></td></tr>'; }).join('') +
            '</tbody></table></div></details>';
        }).join('') : '<p class="empty">אין נתונים</p>') +
      '</div>';

    // TAB 3 — documents (signed contracts + uploads)
    var docRows = docs.map(function (x) {
      var u = urls[x.storage_path], ic = /\.pdf$/i.test(x.name || '') ? '📄' : (/\.(png|jpe?g|gif|webp)$/i.test(x.name || '') ? '🖼️' : '📎');
      return '<tr><td>' + esc(lname[x.lead_id] || '—') + '</td><td><a href="#" data-doc="' + esc(x.storage_path) + '" data-docname="' + esc(x.name || '') + '">' + ic + ' ' + esc(x.name) + '</a></td><td class="muted">' + fmt(x.created_at) + '</td></tr>';
    }).join('');
    var docsPanel = '<div class="card"><h3>📁 כל המסמכים (הסכמים חתומים ומסמכי לקוח)</h3><div class="table-scroll"><table><thead><tr><th>לקוח</th><th>מסמך</th><th>תאריך</th></tr></thead><tbody>' + (docRows || '<tr><td colspan="3" class="empty">אין מסמכים</td></tr>') + '</tbody></table></div></div>';

    var panels = { deals: dealsPanel, commissions: commPanel, documents: docsPanel };
    function tab(k, l) { return '<button data-atab="' + k + '"' + (acctTab === k ? ' class="active"' : '') + '>' + l + '</button>'; }
    view('<h2 style="margin:0 0 12px">🧮 מרכז הנהלת חשבונות</h2>' +
      '<div class="cards">' + C.stat('שווי עסקאות', nis(revenue), true) + C.stat('נגבה בפועל', nis(collected)) + C.stat('יתרה פתוחה', nis(open)) + C.stat('סה"כ עמלות סוכנים', nis(commTotal)) + '</div>' +
      '<nav class="tabs" id="acctTabs" style="margin-bottom:14px;flex-wrap:wrap">' + tab('deals', '🧾 עסקאות וקבלות') + tab('commissions', '💸 עמלות סוכנים') + tab('documents', '📁 מסמכים') + '</nav><div id="acctPanel">' + panels[acctTab] + '</div>');

    function bindPanel() {
      var P = C.$('acctPanel');
      if (acctCols) acctCols.bind();   // column chooser (present only on the deals panel)
      P.querySelectorAll('tr[data-lead]').forEach(function (tr) { tr.addEventListener('click', function (e) { if (e.target.closest('select,button,a,input')) return; if (tr.dataset.lead) openAcctLeadView(tr.dataset.lead); }); });
      P.querySelectorAll('.acct-st').forEach(function (s) { s.addEventListener('change', function () { db.from('deals').update({ acct_status: s.value }).eq('id', s.dataset.acct).then(function () {}); }); });
      P.querySelectorAll('a[data-doc]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); C.viewDoc(a.dataset.doc, a.dataset.docname); }); });
      P.querySelectorAll('.comm-edit').forEach(function (inp) { inp.addEventListener('change', function () { var v = inp.value.trim() === '' ? null : (parseFloat(inp.value) || 0); db.from('deals').update({ commission: v }).eq('id', inp.dataset.comm).then(function (r) { if (r.error) alert('שמירת עמלה נכשלה: ' + r.error.message); else inp.style.borderColor = v ? '' : 'var(--warn)'; }); }); });
      // bulk selection + status change
      function ids() { return Object.keys(selectedAcct).filter(function (k) { return selectedAcct[k]; }); }
      function upd() { var n = ids().length, bar = C.$('aBulk'); if (!bar) return; bar.style.display = n ? 'flex' : 'none'; if (C.$('aBulkCount')) C.$('aBulkCount').textContent = 'נבחרו ' + n; var sa = C.$('aSelAll'); if (sa) { var b = P.querySelectorAll('input[data-asel]'), c = P.querySelectorAll('input[data-asel]:checked'); sa.checked = b.length && c.length === b.length; sa.indeterminate = c.length > 0 && c.length < b.length; } }
      P.querySelectorAll('input[data-asel]').forEach(function (cb) { cb.addEventListener('change', function () { if (cb.checked) selectedAcct[cb.dataset.asel] = true; else delete selectedAcct[cb.dataset.asel]; upd(); }); });
      if (C.$('aSelAll')) C.$('aSelAll').addEventListener('change', function () { var on = this.checked; P.querySelectorAll('input[data-asel]').forEach(function (cb) { cb.checked = on; if (on) selectedAcct[cb.dataset.asel] = true; else delete selectedAcct[cb.dataset.asel]; }); upd(); });
      if (C.$('aBulkClear')) C.$('aBulkClear').addEventListener('click', function () { selectedAcct = {}; P.querySelectorAll('input[data-asel]').forEach(function (cb) { cb.checked = false; }); upd(); });
      if (C.$('aBulkApply')) C.$('aBulkApply').addEventListener('click', function () { var list = ids(); if (!list.length) return; var st = C.$('aBulkStatus').value; if (!st) { alert('בחרו סטטוס'); return; } db.from('deals').update({ acct_status: st }).in('id', list).then(function (r) { if (r.error) { alert('שגיאה: ' + r.error.message); return; } selectedAcct = {}; window.C2B_renderAccounting(); }); });
      upd();
    }
    C.$('acctTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-atab]'); if (!b) return; acctTab = b.dataset.atab; C.$('acctTabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.atab === acctTab); }); C.$('acctPanel').innerHTML = panels[acctTab]; bindPanel(); });
    bindPanel();
  }

  // accounting manager's dedicated per-lead view (only what's critical for her)
  var PAY_PURPOSES = [
    { k: 'deposit1', label: 'מקדמה ראשונית' },
    { k: 'deposit2', label: 'השלמת מקדמה' },
    { k: 'purchase', label: 'תשלום רכישת הרכב' },
    { k: 'other', label: 'אחר / התאמה' }
  ];
  function purposeLabel(k) { for (var i = 0; i < PAY_PURPOSES.length; i++) if (PAY_PURPOSES[i].k === k) return PAY_PURPOSES[i].label; return 'תשלום'; }
  var PKIND = { payment: 'תשלום', receipt: 'קבלה', invoice: 'חשבונית' };
  function acctPayList(ps) {
    return ps.length ? ps.map(function (p) {
      var head = p.purpose ? esc(purposeLabel(p.purpose)) : (PKIND[p.kind] || p.kind);
      var doc = (p.kind && p.kind !== 'payment') ? ' <span class="tag" style="font-size:10px">' + esc(PKIND[p.kind] || p.kind) + '</span>' : '';
      return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)"><span>' + head + doc + (p.method ? ' · ' + esc(p.method) : '') + (p.ref_no ? ' · ' + esc(p.ref_no) : '') + ' <span class="muted" style="font-size:11px">' + fmt(p.created_at) + '</span></span><b>' + nis(p.amount) + '</b></div>';
    }).join('') : '<p class="muted" style="margin:4px 0">אין תשלומים</p>';
  }
  function openAcctLeadView(id) {
    loading();
    Promise.all([
      db.from('leads').select('*').eq('id', id).single(),
      db.from('deals').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      db.from('payments').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
      db.from('lead_documents').select('*').eq('lead_id', id).order('created_at', { ascending: false })
    ]).then(function (r) {
      if (r[0].error) return errBox(r[0].error.message);
      var lead = r[0].data, deals = (r[1] && r[1].data) || [], pays = (r[2] && r[2].data) || [], docs = (r[3] && r[3].data) || [];
      var paths = docs.map(function (d) { return d.storage_path; }), sf = db.storage.from('lead-docs');
      (paths.length && sf.createSignedUrls ? sf.createSignedUrls(paths, 3600) : Promise.resolve({ data: [] })).then(function (sr) {
        var urls = {}; ((sr && sr.data) || []).forEach(function (s) { if (s && s.signedUrl) urls[s.path] = s.signedUrl; });
        var paidByDeal = {}; pays.forEach(function (p) { if (p.kind !== 'invoice') paidByDeal[p.deal_id] = (paidByDeal[p.deal_id] || 0) + (+p.amount || 0); });
        function lf2(k, v) { return '<div class="lf"><span class="k">' + k + '</span><span class="v">' + (v == null || v === '' ? '—' : v) + '</span></div>'; }
        function fld(lbl, name, val, ph) { return '<label class="lf" style="align-items:center"><span class="k">' + lbl + '</span><input class="inp" name="' + name + '" value="' + esc(val || '') + '" placeholder="' + (ph || '') + '" style="max-width:190px"></label>'; }

        var dealCards = deals.length ? deals.map(function (d) {
          var dp = pays.filter(function (p) { return p.deal_id === d.id; });
          var tot = +d.total || 0, paid = paidByDeal[d.id] || 0, bal = tot - paid;
          var charge = (d.charge_amount != null && d.charge_amount !== '') ? +d.charge_amount : bal;
          // הפרדת תשלומים לפי שלב (ללא חשבוניות)
          var byPurpose = {}; dp.forEach(function (p) { if (p.kind === 'invoice') return; var k = p.purpose || 'other'; byPurpose[k] = (byPurpose[k] || 0) + (+p.amount || 0); });
          var breakdown = PAY_PURPOSES.map(function (pp) { var v = byPurpose[pp.k] || 0; return '<div class="lf"><span class="k">' + pp.label + '</span><span class="v"><b style="color:' + (v > 0 ? 'var(--ok)' : 'var(--muted)') + '">' + nis(v) + '</b></span></div>'; }).join('');

          return '<div class="card"><div class="row-between"><h3 style="margin:0">עסקה #' + esc(d.order_no) + (d.has_signature ? ' <span class="tag" style="border-color:var(--ok);color:var(--ok)">✅ נחתם</span>' : '') + '</h3>' + acctStatusSel(d.id, d.acct_status) + '</div>' +
            '<div class="grid2">' +
              // פרטי חשבונית מרוכזים — ניתנים לעריכה ע"י הנה"ח
              '<form class="aef lead-fields" data-deal="' + d.id + '"><div class="muted" style="font-size:12px;font-weight:700;margin-bottom:4px">🧾 פרטים לחשבונית / קבלה</div>' +
                fld('שם על החשבונית', 'invoice_name', d.invoice_name || d.client_name, 'שם מלא / חברה') +
                fld('ת.ז / ח.פ', 'client_id', d.client_id, 'מספר מזהה') +
                fld('טלפון', 'client_phone', d.client_phone || lead.phone) +
                fld('דוא"ל', 'client_email', d.client_email || lead.email) +
                fld('כתובת לחיוב', 'client_address', d.client_address, 'רחוב, עיר') +
                fld('סכום לחיוב ₪', 'charge_amount', (d.charge_amount != null ? d.charge_amount : ''), 'ברירת מחדל: היתרה') +
                '<button class="btn btn-sm" style="margin-top:6px">💾 שמור פרטי חשבונית</button></form>' +
              // סיכום כספי
              '<div class="lead-fields"><div class="muted" style="font-size:12px;font-weight:700;margin-bottom:4px">💰 סיכום כספי</div>' +
                lf2('מה נקנה', esc(((d.car_make || '') + ' ' + (d.car_model || '')).trim())) +
                lf2('מחיר הרכב', nis(d.car_price)) +
                lf2('מקדמה נדרשת', nis(d.down_total)) +
                lf2('סכום העסקה', '<b>' + nis(tot) + '</b>') +
                lf2('סכום לחיוב', '<b style="color:var(--brand)">' + nis(charge) + '</b>') +
                lf2('שולם עד כה', '<b style="color:var(--ok)">' + nis(paid) + '</b>') +
                lf2('יתרה לתשלום', '<b style="color:' + (bal > 0 ? 'var(--danger)' : 'var(--ok)') + '">' + nis(bal) + '</b>') +
                lf2('עמלת סוכן (מוקפאת)', '<b style="color:var(--ok)">' + nis(d.commission) + '</b>') +
                lf2('סוכן מכירות', esc(d.salesperson)) +
              '</div></div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-receipt="' + d.id + '">📄 הפק קבלה</button><button class="btn btn-ghost" data-invoice="' + d.id + '">🧾 הפק חשבונית</button></div>' +
            '<h3 style="margin:18px 0 8px">📊 פירוט תשלומים לפי שלב</h3><div class="lead-fields">' + breakdown + '</div>' +
            '<h3 style="margin:18px 0 8px">רישום תשלומים / קבלות</h3><div>' + acctPayList(dp) + '</div>' +
            '<form class="apf" data-deal="' + d.id + '" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">' +
              '<select class="inp" name="purpose" style="min-width:150px">' + PAY_PURPOSES.map(function (pp) { return '<option value="' + pp.k + '">' + esc(pp.label) + '</option>'; }).join('') + '</select>' +
              '<select class="inp" name="kind"><option value="payment">תשלום</option><option value="receipt">קבלה</option><option value="invoice">חשבונית</option></select>' +
              '<input class="inp" name="amount" type="number" placeholder="סכום ₪" style="width:120px"><select class="inp" name="method" style="width:160px"><option value="">אמצעי תשלום…</option><option>אשראי</option><option>העברה בנקאית</option><option>מזומן</option><option>צ׳ק</option><option>הוראת קבע</option><option>ביט</option><option>אחר</option></select><input class="inp" name="ref" placeholder="אסמכתא" style="width:120px"><button class="btn btn-sm">+ רשום</button></form>' +
          '</div>';
        }).join('') : '<div class="card"><p class="muted">אין עסקה/הצעה לליד זה עדיין.</p></div>';
        var docRows = docs.map(function (x) { var u = urls[x.storage_path], ic = /\.pdf$/i.test(x.name || '') ? '📄' : (/\.(png|jpe?g|gif|webp)$/i.test(x.name || '') ? '🖼️' : '📎'); return '<div style="padding:7px 0;border-bottom:1px solid var(--line)">' + (u ? '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + ic + ' ' + esc(x.name) + '</a>' : ic + ' ' + esc(x.name)) + ' <span class="muted" style="font-size:11px">· ' + fmt(x.created_at) + '</span></div>'; }).join('') || '<p class="muted">אין מסמכים</p>';
        view('<div class="lead-top"><button class="btn btn-ghost btn-sm" id="alBack">→ להנהלת חשבונות</button><h3 style="margin:0">🧮 תיק חשבונות — ' + esc(lead.name || 'לקוח') + '</h3></div>' + dealCards + '<div class="card"><h3>📁 מסמכים</h3>' + docRows + '</div>');
        var $ = C.$;
        $('alBack').addEventListener('click', function () { window.C2B_renderAccounting(); });
        $('view').querySelectorAll('.acct-st').forEach(function (s) { s.addEventListener('change', function () { db.from('deals').update({ acct_status: s.value }).eq('id', s.dataset.acct).then(function () {}); }); });
        $('view').querySelectorAll('.aef').forEach(function (f) { f.addEventListener('submit', function (e) { e.preventDefault(); var upd = { invoice_name: this.invoice_name.value.trim() || null, client_id: this.client_id.value.trim() || null, client_phone: this.client_phone.value.trim() || null, client_email: this.client_email.value.trim() || null, client_address: this.client_address.value.trim() || null, charge_amount: this.charge_amount.value === '' ? null : (parseFloat(this.charge_amount.value) || 0) }; var btn = this.querySelector('button'); btn.textContent = 'שומר…'; db.from('deals').update(upd).eq('id', this.dataset.deal).then(function (r) { if (r.error) { alert('שגיאה: ' + r.error.message); btn.textContent = '💾 שמור פרטי חשבונית'; return; } btn.textContent = '✅ נשמר'; setTimeout(function () { btn.textContent = '💾 שמור פרטי חשבונית'; }, 1500); }); }); });
        $('view').querySelectorAll('[data-receipt]').forEach(function (b) { b.addEventListener('click', function () { db.from('deals').update({ acct_status: 'receipt' }).eq('id', b.dataset.receipt).then(function () { alert('סומן "הופקה קבלה". חיבור לחשבונית ירוקה יאפשר הפקה אוטומטית. 🧾'); openAcctLeadView(lead.id); }); }); });
        $('view').querySelectorAll('[data-invoice]').forEach(function (b) { b.addEventListener('click', function () { db.from('deals').update({ acct_status: 'invoice' }).eq('id', b.dataset.invoice).then(function () { alert('סומן "הופקה חשבונית". חיבור לחשבונית ירוקה יאפשר הפקה אוטומטית. 🧾'); openAcctLeadView(lead.id); }); }); });
        $('view').querySelectorAll('.apf').forEach(function (f) { f.addEventListener('submit', function (e) { e.preventDefault(); var amt = parseFloat(this.amount.value) || 0; if (!amt) return; db.from('payments').insert({ deal_id: this.dataset.deal, lead_id: lead.id, kind: this.kind.value, purpose: this.purpose.value, amount: amt, method: this.method.value, ref_no: this.ref.value, paid_at: new Date().toISOString().slice(0, 10) }).then(function (r) { if (r.error) { alert('שגיאה: ' + r.error.message); return; } logActivity(lead.id, 'system', 'נרשם ' + purposeLabel(f.purpose.value) + ': ' + nis(amt)); openAcctLeadView(lead.id); }); }); });
      });
    });
  }

  // מנוע ההדפסה המקורי של הדפדפן (Chrome) — bidi עברית מושלם, טקסט וקטורי אמיתי, בלי האקים.
  // הוכח מול html2canvas ששבר RTL (היפוך מספרים, בליעת רווחים) — לכן זה הנתיב היחיד ל-PDF יפה.
  // הורדת ההסכם כקובץ בלחיצה אחת (בלי דיאלוג הדפסה).
  // פורמט Word: html2canvas נפסל — הוא בולע רווחים והופך ספרות בעברית. Word שומר RTL מושלם
  // וניתן לשמור ממנו כ-PDF. BOM + charset מונעים ג'יבריש (mojibake).
  function downloadContractDoc(inner, title) {
    var head = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
      + '<head><meta charset="utf-8"><title>' + (title || 'הסכם') + '</title>'
      + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
      + '<style>@page WordSection1{size:21cm 29.7cm;margin:1.6cm}div.WordSection1{page:WordSection1}'
      + 'body{font-family:Arial,sans-serif;direction:rtl;text-align:right}</style></head>'
      + '<body dir="rtl"><div class="WordSection1">';
    var blob = new Blob([String.fromCharCode(0xFEFF), head, inner, '</div></body></html>'],
                        { type: 'application/msword;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = (title || 'הסכם').replace(/[\/:*?"<>|]/g, '-') + '.doc';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  function printContractHtml(inner, title) {
    var w = window.open('', '_blank');
    if (!w) { alert('חלון ההדפסה נחסם — אפשרו חלונות קופצים לאתר ונסו שוב.'); return; }
    w.document.write('<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>' +
      (title || 'הסכם — פרי דרייב') + '</title><style>' +
      '@page{size:A4;margin:16mm 15mm}' +
      '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      'body{margin:0;background:#fff;color:#111;font-family:Arial,\'Segoe UI\',sans-serif}' +
      '.sheet{max-width:100%;margin:0 auto}' +
      '.c2b-clause{page-break-inside:avoid;orphans:3;widows:3}h1{page-break-after:avoid}p,div{orphans:3;widows:3}img{max-width:100%}' +
      '</style></head><body><div class="sheet">' + inner + '</div></body></html>');
    w.document.close(); w.focus();
    // מחכים לרינדור מלא (כולל תמונת החתימה) לפני פתיחת דיאלוג ההדפסה
    setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
  }

  // ---------- CONTRACT (auto-filled + browser signature) ----------
  function contractHTML(d, sig, ownership) {
    var today = new Date().toLocaleDateString('he-IL');
    var own = ownership || (d.checklist && d.checklist._ownership) || '01';
    var ad = d.addons || {};
    var monthly = d.monthly || d.monthly_payment || '';
    function spec(k, on) { return '<div style="margin:3px 0">' + k + ': <b>' + (on ? 'כן' : '____________') + '</b></div>'; }
    var owner = (window.C2B && C2B.userName) || '';
    // ---- הסכם יחיד: לחברה מותג אחד, לכן תמיד הגרסה המפורטת (סעיפים 1–7) ----
    var ctype = 'car2buy';
    var brandName = 'פרי דרייב';
    // סעיפי הסכם "Car 2 Buy" — מבנה מפורט (1–7) לפי התבנית של גלובל דרייב
    function car2buyClauses() {
      function sec(t, b) { return '<div class="c2b-clause" style="margin:0 0 13px;text-align:justify;line-height:1.85;font-size:13px"><b style="font-size:13.5px"><u>' + t + '</u></b><br>' + b + '</div>'; }
      var q = '”'; // גרש כפול
      return sec('1. מחיר הרכב ותשלומו:',
          '1.1 מחיר הרכב במועד ההזמנה הינו כמפורט בהסכם זה וכולל את מחיר כל התוספות, המיסים ואגרת הרישוי המפורטים בו (להלן: "מחיר הרכב"). תשומת לב המזמין מופנית לכך שמחיר הרכב לעיל עשוי להשתנות בין מועד ההזמנה לבין מועד מסירת הרכב למזמין.<br><br>' +
          '1.2 האמור בהזמנה זו ביחס למחיר המחירון חל גם על מבצעים (הנחות, מתנות וכיו"ב). לכן המבצע שיחול על המזמין הוא המבצע שיהיה בתוקף, אם יהיה מבצע בתוקף במועד תשלום המחיר הסופי.<br><br>' +
          '1.3 כל תשלום שישלם המזמין על-פי הזמנה זו, למעט התשלום הראשוני, ישולם ישירות לידי היבואן בלבד בצירוף מספר הזמנה ושם המזמין. כל תשלום שישולם על פי הזמנה זו, לרבות תשלום המחיר הסופי, יחשב כתשלום ששולם רק מהמועד בו התשלום נפרע בפועל לחשבון היבואן.<br><br>' +
          '1.4 התחייבות החברה לביצוע טרייד אין עתידי הנה בכפוף לכך כי במקרה של תיקון נדרש לרכב בשל תאונה וכד׳, הנ"ל יבוצע אך ורק במוסכי הסדר של החברה ו/או במוסך שיאושר מראש ע"י החברה וככל והלקוח לא יעשה כן, מתבטלת התחייבות החברה.') +
        sec('2. אספקת הרכב ורישום הבעלות:',
          ownStmt + '<br><br>' +
          '2.1 מועד המסירה של הרכב למזמין, כאשר הרכב נמצא במחסן היבואן בישראל, הוא בתוך 30 ימי עסקים ממועד תשלום מלוא המחיר הסופי ומסירה על ידי המזמין ליבואן של כל המסמכים הדרושים על פי הדין ו/או ההזמנה, לרבות המסמכים הדרושים לשם משכון הרכב, ככל שנדרש משכונו. כל איחור במועד האספקה אינו באחריותה של החברה ולא יקנה למזמין כל פיצוי.<br><br>' +
          '2.2 מזמין אשר הנו זכאי לפטור מתשלום מס כלשהו, כולו או חלקו (כגון פטור לעולים, תיירים, בעלי מוגבלויות וכד׳) — ימציא ליבואן את כל המסמכים ו/או האישורים הדרושים לקבלת הפטור, בתוך 7 ימים ממועד קבלת הודעת היבואן כי ניתן להתחיל בהכנת הרכב למסירה. אין באמור בסעיף זה כדי לייצר חבות כלפי החברה.<br><br>' +
          '2.3 המזמין יישא בשינויים במיסים עקיפים המוטלים על ידי רשויות המדינה ואינם בשליטת החברה ו/או היבואן, שיחולו, אם יחולו, בין יום ההזמנה ליום מסירת הרכב למזמין, כמו גם בכל עמלת הקמת הלוואה ו/או פתיחת תיק ו/או כל עמלה בנקאית אחרת, ככל ויחולו. המזמין ישלם ליבואן את התשלום בגין שינוי במיסים לא יאוחר ממועד מסירת הרכב וכתנאי למסירה.<br><br>' +
          '2.4 הלקוח מאשר בזאת לחברה ו/או מי מטעמה לפנות בשמו לבנקים ו/או כל גורם מימון אחר בכדי לסייע בידו ולקדם את הלוואת המימון הנדרשת לרכישת הרכב, ככל ונדרשת. לשם כך, יחתום הלקוח על כל מסמך אשר יידרש. תוכנית המימון וגובה ההחזר הכולל ו/או החודשי יקבעו סופית ע"י הבנק או גוף המימון ואינם באחריות החברה. כל מידע הנמסר ללקוח במועד ההזמנה הנו בגדר השערה בלבד. במידה ומסיבה שאינה תלויה בחברה לא אושרה ההלוואה, החברה תשיב ללקוח את התשלום הראשוני המלא ולא תהיה לצדדים כל טענה זה כלפי זה.') +
        sec('3. הפרת תנאי ההזמנה וביטולה:',
          '3.1 ביטול הסכם זה ע"י הקונה מכל סיבה שהיא, למעט היעדר אישור מימון כמפורט לעיל, יחייב את הקונה בתשלום פיצוי מוסכם ללא צורך בהוכחת נזק בסכום של 5,000 שקלים (להלן — "פיצויי הביטול"). פיצוי הביטול יקוזז ע"י החברה מהתשלום הראשוני ויתרת התשלום הראשוני תושב לידי הלקוח. ככל ולא שילם הלקוח את התשלום הראשוני עד למועד הביטול, ישלם לחברה את פיצויי הביטול בתוך לא יאוחר מ-3 ימי עסקים ממועד משלוח הודעת הביטול.<br><br>' +
          '3.2 יובהר ויודגש, כי הלקוח אינו רשאי לבטל הסכם זה לאחר ביצוע העברת הבעלות ברכב על שמו במשרד הרישוי ו/או גמר התשלום המלא על הרכב ו/או קבלת אישור מימון מהבנק ו/או הגוף המממן, לפי המוקדם.') +
        '<div class="c2b-clause" style="margin:0 0 13px;text-align:justify;line-height:1.85;font-size:13px"><b>4.</b> פרטי ההתקשרות של המזמין שבמבוא להזמנה יישמרו במאגר המידע הרשום של החברה ו/או היבואן וישמשו לצורך מתן שירות למזמין ולביצוע סקרי שביעות רצון. בכפוף לקבלת הסכמת המזמין ולחתימתו במבוא להזמנה, יישלח למזמין מעת לעת בכל אמצעי התקשורת שמסר (לרבות דוא"ל ו/או נייד) דיוור ישיר לרבות שירות, שיווק ופרסומות, הטבות והצעות מהיבואן ו/או מגורמים קשורים. זאת כל עוד לא נתקבלה מהמזמין הודעה אחרת בכתב. סירוב לקבלת דיוור לא יגרע מתוקף ההזמנה.</div>' +
        sec('5. תעודת אחריות:',
          'אחריות היבואן לרכב היא כמפורט בתנאי האחריות שבתעודת האחריות שתתקבל מאת היבואן. אין החברה אחראית לטיב והיקף האחריות וזו באחריות היבואן בלבד.') +
        sec('6. פוליסת ביטוח חובה ומקיף:',
          'טרם מסירת הרכב למזמין, המזמין יבטח את הרכב לפי הנדרש על פי דין ויציג בפני היבואן, כתנאי למסירת הרכב, תעודת ביטוח חובה ומקיף תקפה לרכב. לצורך קיום התחייבויות החברה ובכדי לשמר את טיב ורמת הטיפול ברכב אשר יאפשר קבלתו בתום התקופה, פוליסות הביטוח כאמור ירכשו ע"י הלקוח <u>אך ורק</u> מאת החברה/סוכנות הביטוח מטעמה ובאישורה בלבד וכתנאי בלתו אין לתוקפו של ההסכם.') +
        sec('7. כתובות והודעות:',
          'כתובות הצדדים להזמנה זאת הן כקבוע במבוא לה, כל עוד לא הודיע צד למשנהו על שינוי בכתובת. כל הודעה שתישלח לצד אחר על פי כתובתו בדואר רשום, תיחשב כאילו התקבלה על ידי הנמען 72 שעות לאחר מסירתה למשלוח; אם נמסרה ביד — מעת מסירתה. הודעה בפקס תיחשב כאילו התקבלה בשעה הרשומה על אישור ההעברה בתנאי שנשלחה ביום עבודה (א׳–ה׳) בין 09:00–16:00. הודעה לדואר אלקטרוני שהמזמין מסר תיחשב כאילו התקבלה בשעה שנשלחה.') +
        '<p style="font-weight:700;margin:12px 0 4px;font-size:13px">* התשלום הראשוני המשולם לחברה הנו עבור ______________________________________________.</p>' +
        '<p style="font-size:12px;margin:0;font-weight:700">* הקונה מצהיר בזאת כי קרא את מלוא הוראות הסכם זה, הבין את משמעותו ותוכנו וחתם עליו מרצונו החופשי.</p>';
    }
    // הצהרת בעלות לפי סוג העסקה — 01 (ליסינג) / 00 (פרטי יד ראשונה)
    var ownStmt = (own === '00')
      ? 'הרכב יירשם על שם הלקוח כרכב פרטי יד ראשונה 00.'
      : 'הלקוח מצהיר ומסכים כי ידוע לו והובהר לו ע״י החברה כי הרכישה מכוח ההסכם הנה במסגרת "עסקת 01" והרכב נרשם במסגרת עסקת ליסינג.';
    // יתרת מקדמה שנותרה לתשלום = מקדמה כוללת − מקדמה ראשונית ששולמה
    var downBal = (d.down_balance != null) ? Number(d.down_balance) : ((Number(d.down_total) || 0) - (Number(d.down_initial) || 0));
    // "מחיר הרכב בנוסף על התשלום הראשוני" = מחיר הרכב + יתרת המקדמה שנותרה לתשלום
    var carPlusBal = (Number(d.car_price) || 0) + (downBal > 0 ? downBal : 0);
    // תא בגריד דו-טורי: תווית מימין, ערך בולט — bidi מושלם במנוע ההדפסה המקורי
    function fld(k, v, ltr) {
      var _v = (v == null || v === '' ? '—' : esc(v)); if (ltr) _v = '<span dir="ltr">' + _v + '</span>';
      return '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:7px 2px;border-bottom:1px solid #eee;direction:rtl;text-align:right">' +
        '<span style="color:#555;flex-shrink:0">' + String(k).replace(/ /g, String.fromCharCode(160)) + '</span>' +
        '<b style="text-align:left"><bdi>' + _v + '</bdi></b></div>';
    }
    function row(k, v, ltr) { var _v = (v == null || v === '' ? '—' : esc(v)); if (ltr) _v = '<span dir="ltr">' + _v + '</span>'; return '<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;width:34%;direction:rtl;text-align:right">' + String(k).replace(/ /g, String.fromCharCode(160)) + '</td><td style="padding:8px 12px;border-bottom:1px solid #eee;direction:rtl;text-align:right"><b><bdi>' + _v + '</bdi></b></td></tr>'; }
    var C = [
      'מבוא — הזמנה זו מהווה את התנאים הכלליים לרכישת הרכב בלבד.',
      'מחיר הרכב — תשומת לב המזמין מופנית לכך שמחיר הרכב, לרבות ובפרט רכב חשמלי, עשוי להשתנות בין מועד ההזמנה לבין מועד מסירת הרכב למזמין. כל שינוי במחיר הרכב, בין לאור שינוי במיסוי ובין לאור שינוי מחיר מכל סיבה שהיא, יחול על המזמין בלבד וישולם על ידו. כל תשלום שישלם המזמין, למעט דמי ההזמנה, ישולם בהעברה בנקאית לחשבון החברה ו/או היבואן. כל תשלום שישולם על פי הזמנה זו, בכל דרך תשלום שהיא, לרבות תשלום המחיר הסופי, יחשב כתשלום רק מהמועד בו התשלום נפרע בפועל לחשבון המוכר.',
      'עם חתימתו על הסכם זה הלקוח מאשר בזאת לחברה לבצע הזמנה בשמו אצל היבואן המורשה.',
      'האחריות לרכב הינה מטעם היבואן ולתקופה שתיקבע על ידו ו/או ע״י היצרן ועל פי תנאי האחריות שימסור היצרן למזמין בעת מסירת הרכב. בכל מקרה, החברה אינה אחראית ואינה מעניקה אחריות על הרכב.',
      'תאריך משוער לאספקת הרכב הנו 30 ימי עסקים מיום פירעון התשלום המלא על הרכב. זמן אספקת הרכב בהתאם ובכפוף למועדי אספקת הרכב על ידי היבואנים/חברות הליסינג. כל איחור במועד האספקה אינו באחריותה של החברה ולא יקנה למזמין כל פיצוי.',
      'הלקוח מאשר בזאת לחברה ו/או מי מטעמה לפנות בשמו לבנקים ו/או כל גורם מימון אחר בכדי לסייע בידו ולקדם את הלוואת המימון הנדרשת לרכישת הרכב, ככל ונדרשת. לשם כך, יחתום הלקוח על כל מסמך אשר יידרש ע״י החברה ו/או מי מטעמה ו/או ע״י הבנק ו/או הגוף המממן. במידה ומסיבה אשר אינה תלויה בחברה לא אושרה ללקוח ההלוואה, החברה תשיב ללקוח את תשלום התשלום הראשוני המלא וללקוח ולחברה לא תהיה כל טענה ו/או דרישה ו/או תביעה האחד כנגד משנהו.',
      'עמלת הקמת הלוואה ו/או פתיחת תיק ו/או כל עמלה בנקאית אחרת, ככל ויחולו, ישולמו ע״י הלקוח ישירות לבנק או לאותו גוף.',
      'תוכנית המימון הבנקאי וגובה ההחזר הכולל ו/או החודשי ו/או התשלומים הנלווים יקבעו סופית ע״י הבנק או גוף המימון והם אינם באחריותה של החברה. כל מידע הנמסר ללקוח במועד ההזמנה ו/או הפגישה הנו בגדר השערה בלבד וכפוף להחלטת הבנק ו/או הגוף המממן.',
      'המזמין יישא בשינויי מיסים עקיפים המוטלים על-ידי רשויות המדינה אשר אינם בשליטת היבואן ו/או החברה, שיחולו, אם יחולו, אם יוטלו ו/או יועלו בין יום ההזמנה ליום מסירת הרכב למזמין ויחולו על עסקת רכישת הרכב.',
      'ביטול הסכם זה ע״י הקונה מכל סיבה שהיא, למעט היעדר אישור מימון כמפורט לעיל, יחייב את הקונה בתשלום פיצוי מוסכם ללא צורך בהוכחת נזק בסכום של 5,000 שקלים (להלן — "פיצויי הביטול"). פיצוי הביטול יקוזז ע״י החברה מהתשלום הראשוני אשר שולם ע״י הלקוח ויתרת התשלום הראשוני תושב לידיו כמפורט לעיל. ככל ומסיבה כזו או אחרת לא שילם הלקוח את התשלום הראשוני עד למועד הביטול על ידו, ישלם הלקוח לחברה את פיצויי הביטול בתוך לא יאוחר מ-3 ימי עסקים ממועד משלוח הודעת הביטול.',
      'יובהר ויודגש, כי הלקוח אינו רשאי לבטל הסכם זה לאחר ביצוע העברת הבעלות ברכב על שמו במשרד הרישוי ו/או גמר התשלום המלא על הרכב ו/או קבלת אישור מימון מהבנק ו/או הגוף המממן, לפי המוקדם.',
      'ככל ובוטל ההסכם ע״י המזמין במועד ו/או מסיבה אשר אינה מנויה לעיל, יהא חייב המזמין בתשלום מלוא התשלום הראשוני כפיצוי מוסכם מוערך מראש, וזאת מבלי לגרוע מזכאותה של החברה לדרוש ו/או להיפרע מנזקיה עפ״י כל דין.',
      'מסירת הרכב למזמין תהא בהתאם להוראות היבואן. טרם מסירת הרכב למזמין וכתנאי לכך, יבטח המזמין את הרכב כנדרש על-פי דין ויציג מסמכים המאשרים זאת בפני החברה ו/או היבואן (לכל הפחות תעודת ביטוח חובה תקפה לרכב).',
      'לצורך קיום התחייבויות החברה במסגרת הסכם זה ובכדי לשמר את טיב ורמת הטיפול ברכב אשר יאפשר קבלתו בתום התקופה, פוליסות הביטוח כאמור לעיל ירכשו ע״י הלקוח אך ורק מאת החברה/סוכנות הביטוח מטעמה ובאישורה בלבד וכתנאי בלתו אין לתוקפו של ההסכם.',
      'התחייבות החברה לביצוע טרייד אין עתידי הנה בכפוף לכך כי במקרה של תיקון נדרש לרכב בשל תאונה וכד׳, הנ״ל יבוצע אך ורק במוסכי הסדר של החברה ו/או במוסך שיאושר מראש ע״י החברה, וככל והלקוח לא יעשה כן, מתבטלת התחייבות החברה.',
      'הצהרת פרטיות: ידוע לי כי הפרטים שמסרתי בהזמנה זו לעיל יכללו במאגרי המידע של החברה ו/או היבואן הרשומים כדין וזאת בהתאם למדיניות הפרטיות של החברה.'
    ];
    C.splice(1, 0, ownStmt);   // הצהרת הבעלות (01/00) כסעיף ממוספר רגיל — מיד אחרי המבוא
    var gen = [
      'הזמנה זו ממצה את יחסי הצדדים בכל הנוגע לנושאם, וכל הסכמה, התחייבות, הבטחה ומצג שנעשו בין הצדדים טרם חתימתם, בין בעל פה ובין בכתב, ככל שנעשו, בטלים בזאת. כל שינוי ו/או תיקון של ההזמנה יחייבו רק אם נערכו בכתב ונחתמו על-ידי כל הצדדים.',
      'בכל מקרה לפיו הוראה כלשהי בהזמנה ו/או בהסכם המקורי תהפוך לבלתי חוקית, בלתי תקפה או בלתי אכיפה, לא יהיה בכך כדי למנוע ו/או לגרוע מתקפות ו/או חוקיות ההוראות האחרות.',
      'כל שיהוי, ויתור, ארכה, איחור או הימנעות של צד להזמנה זו למימוש זכויותיו ו/או בדרישת קיום ו/או הסכמתו לסטות מתנאי הצהרה זו לא יהוו תקדים, לא יחשבו לוויתור ו/או הסכמה של אותו צד ואין להסיק מהן גזירה שווה למקרה אחר. מובהר, כי שום דבר האמור בהצהרה זו לא יתפרש כמקנה זכות כלשהי לטובת צד שלישי.',
      'המזמין מאשר ומצהיר כי קרא בעיון את הצהרה זו על כל סעיפיה, וכי הוא חותם עליהם מתוך הבנה מלאה של תוכנם ומשמעותם.',
      'על הצהרה זו ו/או ההסכם המקורי, פרשנותם ו/או ביצועם יחולו אך ורק דיני מדינת ישראל. סמכות השיפוט הבלעדית בכל הקשור ו/או הנובע מהם תהא נתונה לבית המשפט המוסמך במחוז המרכז.',
      'כתובות הצדדים להזמנה זאת הן כקבוע במבוא לה, זאת כל עוד לא הודיע צד למשנהו על שינוי בכתובת. כל הודעה או התראה שתישלח על-ידי צד למשנהו על פי כתובתו כאמור בדואר רשום, תיחשב כאילו התקבלה על-ידי הנמען 72 שעות לאחר מסירתה למשרד הדואר; אם נמסרה ביד — מעת מסירתה. הודעה שנשלחה בפקס תחשב כאילו התקבלה בשעה הרשומה על גבי אישור העברת הפקס בתנאי שנשלחה ביום עבודה (א׳–ה׳) בין השעות 09:00–17:00 (זמן ישראל).'
    ];
    return '<div style="font-family:Arial,sans-serif;line-height:1.75;width:100%;color:#111;font-size:13px;direction:rtl;text-align:right;overflow-wrap:break-word;word-break:break-word">' +
      '<div style="text-align:center;margin:0 0 8px"><img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCAB7AQQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8/wCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKK9c/Zw+G2k/FH43Wnh7XlkbTRBNLMI2Kk7Y2K8j3ArDFYmGGpSrVPhirsDyOiv0o/4Yy+Df8Az4X3/gS3+NJ/wxn8G/8Anwvv/Ahv8a+R/wBfcr7y+7/gjsfmxRX6T/8ADGXwc/58b7/wIb/GvOPiT8Hf2Z/hm9rZ6st5Pql1IscNhBdM0p3HAJAPyj3NdWF4xwOLn7OhGUn5L/giZ8P0V+ksP7GvwbkgV20++UsoOPtDccfWnf8ADGfwb/58b7/wIb/GuZ8eZYnb3vu/4IH5sUV+k/8Awxn8G/8Anwvv/Ahv8aZN+xf8HZbdkjttQicjAdZ2JHvyaS49ytuzcvu/4I7H5t0V6V8Yfhafhf8AG2XwWt2bq2cxyW8p+8Y3YgZ9+DX2X4c/Y6+Et94O0q8vbO9a6mtY5JmE7DLlQTxn1r2Mw4iweAo069VvlntZCPzqor9KP+GMfg5/z433/gQ3+NH/AAxj8G/+fG+/8CG/xrx3x7la3cvu/wCCFj816K/R3U/2RfgXoulTalqyXFnaQKXlmmuyiqvqSTXgWgeCvgb49/aFs/AvgvSrubSkjke5vpJ3/eFcfc56c16OD4owmLpzq0oycYq7dtNPmB8v0V+k5/Yy+Dn/AED73/wJb/Gl/wCGMfg5n/jwvf8AwIf/ABrzv9fcr7y+7/gjsfmvRX6U/wDDGXwa/wCgff8A/gS3+NJ/wxn8Gv8AoH3/AP4Et/jR/r7lf977v+CFj816K/Sj/hjP4M/9A6+/8CW/xo/4Yz+DR6adf/8AgS3+NH+vuV/3vu/4Ij816K+w/jV8Ov2b/hHYSWUlpeX2vumYdPjumJUkcF8H5R35r5AneOS5d4ohFGWJVAc7R6V9Pl+PhjqXtqcWova6tcCOiiiu4AooooAKKKKACiiigAooooAK+8/2Ifhv/Znhe98f3sBFzfAwWxYdI88kfXFfGXw/8J3fjf4i6X4bs42d7qdUbA6Lnk1+ufhjQLLwr4S0/QdOiWK2s4FhUKMZwMZ+pr4HjzNvq+EWEg/en+Q0cz8W4fHCeAJ7z4fXrR6zDzHBt3LN7HkY+tfMn/CS/tnZ/wCQSn/fP/169u8aftPfDTwT4wu/DeqXsr3lqdsvljIB9K4TxV+2r4DsPDc03hm3mvtRwRFFIMLn1NfL5HhswpUlTeCU09U5IGeR+NfjJ+1B4J0c3HihrfT4pPkViBuJPoM1y37N3hbVvi/+0YniHxNNPqMGnkXl1LMd25s/Kv8AP8q8n8d/ETxV8SvFD6p4i1CS4kkf93CDhI8ngAV+iH7LXwzi+H/wVtrq4tQmqari4ncj5tv8K/hz+dfYZ3iKeS5bKcYRjVmre6v62Eewa6APD9473z2KJEzm5Q4MQAJ3fhX5w6/+1N8WbHxLfWel+LGuLOKZkilaPBZQeD1r6w/am8Yazp/w8t/A/hWKWbXPEL/Z0SHlhHnDH6HkVx3wh/Y78MWHhVb/AOIULahqtwAxgDlUh9uOpr5Xhx4LLcC8ZmST537qsm9Oo2jE/Zc+K/xa+JvxMmXXtXNxo1pFunBTqT0FfYV7eW+nabPf3cgjggjaWRieAoGTXOeDvh94O+G2lTweG9Mg0+B/mlfufqa+aP2qP2jdNt/Dd34A8FX8dxeXQ8q8uojkRp/EoPqRx+NebWw64hzNLA0+WmrdLadWxp2PIdLg1D9ov9taS+MRfTYbnzGPaO3ibgfXJr9GFsxFpIsbWQwBIxGjr1TAwDXzd+xv8MG8KfC5/F+pwbdR1siSPcOVhGcfmSa9l+JHxR8K/C3QYdU8UXJiink8uNV5LGteKcTLG46GX4ON1T0SXdbgj598aan+1fpfji/svC//ABMtKjkIt7l4ghdfpk1ztx4u/bItLdp7nT4IokGWdwAAPc5r1Bv2yfhGELC5uWOOm2vmD44/tReJPiLdTaN4dlk0rQAcbYziSb3Y+ntX0+UYXF4icadfBQilu2hNHE/Ej44/E3x5E+h+KNcLW8DmN4Lc7UZgcHPrX0b+xD8MxFZ33xG1CE+bJ/o9nkfw/wATfjxXx54S8N3/AIx8cab4c09Wa5vp1hBHOMnlvw61+uHgLwlYeCPh9pnhvT4wkVpCqHHc45NbcaY6lluAWDw6UXPotNOv3gil8S4fFreAbufwVfNb6vEu6FFj3iQ+hGRXy4PEf7aGP+QTH/3z/wDXr3Dxx+0v8NvAXi+fw5rN5Ib2AAyLGMhc1zZ/bJ+Ef/Pzc/8AfNfKZPRx+HoJLBKonqm0Ox5l/wAJL+2fj/kEx/8AfP8A9egeJP2zj/zCY/8Avn/69emf8NkfCPH/AB8XP/fNA/bH+EWebm5/75r1va4//oWx+4LeZ5p/wkn7Zw66TF/3z/8AXrhfHnx1/aQ8GQix8U3ltp8lypVVQAuB69eK9Q+Jf7augW/hiS1+H9s9zqM6lRPOMLD747mviXxH4m1vxZr02sa9qE15dSnJeRicew9BX0mS5fPEL2mLwsKa6K2pLKepanqGsanNqOqXk13dTMXkllbczE1Uoor7BJJWQBRRRTAKKKKACiiigAooooAKKKKAPtT9iD4dRq998QtShXOfs9mX7f3iK+pvip48s/h78JdZ8UTzRh7aAiBSfvyN8qD8yK/LPRfih8QPDulpp2ieKb6xtI/uwxEBR+lV/EPxD8beK7FbLxF4lvtRt1bcIpn+XPrgV8LmPCVXMMxWMxFRcia012XQdzI1rVrzXfEN5rF/K0tzdStK7MckkmqFFFfcpKKshHrn7OXw8b4g/G/TbW4g8zTrNxc3RPTavIB+pr9SPMtdP03O6OK3t4+OQAqgf4Cvx48N+M/FPg+eWbwzrVzpskw2yNBgFh6city9+MfxQ1Gxks73xrqksEg2uhcAEfgK+M4j4ZxGcYiE3UShHpr8xnefGf45+Ida/aG1LxD4a1N7eCyY2dm6c4RflLL9SCfxr7Q/Zi+I118QvglbXuq3f2jU7Vzb3DtwWI71+XRJJJJyT3NdH4c8e+MfCMMkPhrxDe6bHKcusDABj+IrrzjhijjsFHC0rRcbWduwXP1i+I+mtrnwu1rS4Ll4ZprVwjRthgceor8vfhn8OdU8d/HCz8IsjOy3Z+2O38KI2XJP0BqF/jZ8VnQo/jnVGU8EFl/wrA0bxp4p8P67cazo2tXFnf3GfNuIsbmz17VlkHD+JynD1aKqJuWz10YXP2E0qwtdJ0W00y0CrBbRLEi+gAxWP4q8DeFPGscMXibS4NQSE5jWXkLX5a/8Lx+LWMf8J3qv/fS/4Uv/AAvL4t/9D3qv/fS/4V8xDgDGQqutDEJS76jTR+kD/AP4Sf8AQoaf/wB8ivJfjJ/wzt8KNGKXPhfTbzV3U+VYwgF8+reg+tfHJ+OXxbIwfHeq/wDfS/4Vxeraxqmu6pJqOsX097dSHLyzNuJr3Mu4WxlKsp4vEuUV0TYrn2R+yP4Ot/FvxE1b4rXel22n2sDmDT7aNcKhxgkfQZH1r7YDrjG4fnX4+6B8S/HnhbSl0zw94nvtPtFJYQwkAAk5PatY/HH4tHr471X/AL6X/CubPeDsTmmJdb2qUVolrogTR+l+s/B34b69rU2q6t4asrq7nO6SV1BJNUT8A/hH/wBChp//AHyK/N0fHH4tD/me9V/76X/Cl/4Xn8W/+h81X/vpf8K54cHZpCKjHF6L1C5+kI+Afwkz/wAihp//AHyKd/woT4SdvCGn/wDfAr83P+F5fFv/AKHzVf8Avpf8KP8AheXxb/6HvVf++l/wp/6o5t/0GfmGh+iGufCD4H+HNFn1bWPD2k2tpApeSSQKAAK+Gvjf8RPh5rl2+hfDnwnaWNjG5D3+wB5f930Fee6/8SfHfimw+xeIPFGoX9vnPlSv8p/LFcrX0WSZBVwT9piqzqS9XZCCiiivpwCiiigAooooAKKKKACiiigD0/8AZ98I2Xjb9oDQ9B1O0F1ZSOzzxsMqVVSefyr9Dl/Z3+Dw/wCZG0v/AL8ivA/2IPhpJbadffEbULcq0+bazLDnaDhmH4g19BfHfxBZ+GfgfrGp3V/LZypHi3kifaxkPQCvybijM8Ric2hgsJUato7Pr8ikRf8ADO/wf/6EbSv+/C/4Uf8ADO/wf/6EbSv+/C/4V+cjfHD4oF22+L9QC54/eHpSf8Lw+KX/AEOGof8Afw16P+qObf8AQY/vYcx+jZ/Z2+D5/wCZG0v/AL8Cj/hnX4PZ/wCRG0v/AL8ivzk/4Xh8Uv8Aob9Q/wC/ho/4Xf8AFI8f8JfqB/7aGl/qjm3/AEGP72HMfo5/wzv8Hf8AoRtL/wC/IrjPih+y98LdW+HeovpGiQaNfW8LTQ3NsNmCoJwQOCK6b9nG18VJ8EbG/wDF2oXF3fXp88Gc5Kqegrn/ANrT4jP4H+CM1hZXAi1DVybaLa3zBcfM38vzr5bA1sxjmscHTxDk1K17u2m4Hxr+zF4I0jx18d7XStesFvbCOJ3licZU/KcZ/GvvMfs5fB1QAfBOmn/tkK8r/Yt+GK+H/hzL451GDbf6sSIdw5SEHA/PGfxrr/2r/EkHhn4LNfQ6pc2WqNKEtDbybWJ759q9nPswxGYZysFhKrilpp36iOlP7OXwbJ/5EvTf+/Ypy/s5/BscDwTph/7ZCvzdX4sfE6QZTxRqrD/ZkY19+/sp6d4wT4P/ANveMdTu7q41GTzIY7gkmNO3X1rHO8qzDKcN9YqYxvW1rvUdxfHX7MXwm1PwRqMdj4at9Ouo4HkiuLceWVYDIzjqOK/PfwX4bTU/jPpnhuaMXMbagsEigZDKHwf0r9IP2kviNb/Dz4G6jOsoF/fqbS1QHklgct9AP518v/sXfDgeIfiBd+PdViZoNPJW3LDhpT1P4V6nDWY4nD5TXxmMm3H7N+//AA4mfVNv+zr8IUgjSTwTpbMF5JhXJr5J/ac0f4faJ8UtC8B+DfDmn2cwlRrx7eIBjuYALkfjX2j8XL280j4V6prNh4gk0aazhaVZ1UNkgdK/M3w3q2r+OP2h9L1LWbx76+u9QQvM3V8NxxWPByxWJ58dXrNxjfRt7gfonY/s4/CJNKto5/BemtKsSh2MQyTgZNfEv7WfhHwt4K+NMGjeFdKh0+2+xpI8cQwCxJ5xX6aZ5xX5y/tN6Nqvjn9rx/D2iW73N3IqQKo/h56n2rl4MzLEV8wqOvUbik3q9AZ478MvhxrfxO8d23h3Rom+dgZpsfLEncmv0S8O/sv/AAk0LwrbWF74ZtL+aKMebdXKhmkbuSTWj8C/gxpHwl8BxWqxxy6vOoe7usclv7o9hXln7VH7Q6+ENKm8DeErtX1i6Qpczxt/x7oeo+tbZjnOLzzHrB5bJxgt2tPVvyDY5afS/g54m/an0b4ZeEPBulyWVo0kup3SxAiQqMbAfQE8/hX0If2d/g7/ANCPpY/7YivBP2JfhtP5OpfFHWVYzXTG1sy4+YjrI/4nb+tfUXxC8MXvinwReafpepXFjflCbeaF9pV8cZ9s15vEOOnRxtPBUK8oqKSlK736tgjmf+GePg6B/wAiNpX/AH4X/Cj/AIZ5+DgH/IjaT/34X/CvAV+Bn7Thz/xXyge85riPiPoHxu+Gnh6TU/EnxOiTH3LdLjMkh9AtddDK8RiJqFHMbt9E2Fz1/wCMel/s4/CTQ/M1Dwfo9zqsgPkWEUSl2Pq3oK+EPFWuW3iHxPcalZ6TZ6Vbuf3VpaRhERew46n3qrrOuat4h1R9R1m/nvbl+skzFjWfX6LlGVvA0rVKjnPq2/yEFFFFeuAUUUUAFFFFABW54P8ADV94v8cab4c0+NpLi8nWJQBnqeaw6+w/2I/h/BJrN/8AEXVDAiW/+jWfmMAd/ViAfT5fzrzs2xywOEnX6paevQD7P8G+GLPwb4F0zw3YRqkFlbpCNoxkgAE/UnmvjD9tvxtqWq+LbDwPpqXDWtmvm3IRSVZz0B+lfcf9oWR63tt/38X/ABrOu9M8KX8xnvbPSriU9XlCMT+Jr8PyTNJYLHPG16bm9fvfXYrc/HP+ztQ/58rj/v2aP7Ov/wDnyuP+/Zr9gv8AhHvA+edJ0T/v3HR/wjvgb/oE6H/37jr7n/iIS/6Bpff/AMAOU/H3+zr/AP58rj/v2a9N+A3wyvfH/wAaNL0y5sphYwyrPcsyEDYpzj8cV+mn/CO+BP8AoEaH/wB+46sQDwf4fje5gOj6cuPmdGjjGPc5rHEcezq0pQo4dqTVk/6Q+U1YobXTNMWGFFit4E2qo4CqBX55/EO/1L9ob9sW28L2FwzaVaTC3THKIin53/HgfhXrn7RX7VGi6VoN74O8BXq32pXKGGa+hPyQKeDtbufcVR/Yr8AWWnaLqHxK1u6t/tt8xt7ZZXXcqjlm69yR+VcWSYCrk+DrZriY/vJK0V116ks+t9H0iw8P+H7LRtNiWG0tIVgiUdlUYH8q+Qvif4e1v9pH4+/8I9p9ytn4W0F/Kmuyf9Y/fb6nivfPjb8V9H+HPwk1PV0v7eXUHiMVpCkqljI3AIGe2c/hX5l6J498T6Z4ug1W31u9gJuxPIqTMqklsnIp8H5RiKqq5gtJu6i336sGfp/4V+CPw28L+G7XSbfwtYXPkKAbiePc7t3JNbPi3xv4P+GfhY32v39vptnEmIouF3YHCqPWrPg7xVpXiDwLperx6hbN9ot0cnzV645714H+2l4XtfEfwUj16xngmutJnWQojgkox2t37Ak187gcLXzDMo4fMJS5W9fUZ8sfGz4uat8d/inaW1hDJDpscn2axtgclixxvPuePyr9Bfg38P7H4cfCLSfD9tHiZYRJcuRy0rct+pr4e/ZA+Hlj4n+LTeKNalhjsNFAkRZXC75mzt69QAD+Yr9AfEXjHw/4a8M3es32qWawWsRkI85ctgdBz1r6XjOpyqllGDj7qte3foJHyt+218UJbPSrT4d6ZOFa4ImvCp52joK+aP2e7P7b+0h4Wi27gLsMR9BWD8T/ABxe/EP4oap4ovXJ+0THy1zwqA8D8q9H/ZGt7eb9pXTZblo1WCJpQXYAAjHr9a+ww+AWVZNKilqou/q0B+m46VwOg/CrQtJ+KGsePbmNbrVtQfKSOM+Snotdp/aWnf8AQQtf+/q/41wXxa+MPhr4YeAbnWbm+t7i9KlbW0jkDNI56cDtX4pgIY2dR0MMneej9B7HLftFfHSx+FPgxrSwkjm129QrBDu5jHTeRX516Fpmv/E/4qWenGaS61PVrtVeV+SNzcsfYVB448Z6z4+8bXviXW52kuLlywUnIReyj2FfT/7Enw+tZdcvviJqskEa2oNvaLKQCWIwWGfYmv2LC4Clw3lk6iV521fd9F6CPszwV4Xs/BvgPTPDVhGqQ2cCx8Dqccn868f+Kf7UWkfDfx7N4WTw7eapNAqmWWLIUEjOOnvXu51KwY/8f9t/39X/ABrMuNK8IXdy1zdWekTTMctJIEZj+NfkmDrU3iZV8dSdS99NtR2PlbWv225H0O4TRfA96l8ykRNLkqp9TxXyF4z8T+NPHfiKfWfEkl7dTSMWCsrbIx6KOwr9Wr2w+H2n2Mt5fWuhQwRKXeR1jAUCvi/46/tK+G5Xu/C3wy0HT0j5jl1Y26gn18vjI+tfonDGNoyquGBwbj3k3t96Ez5JIIJBGCO1FOd2kkaR2LMxyWPUmm1+jiCiiigAooooAKKKKACtGz1/W9Otvs9hq17bRZz5cMzKufXANZ1FJpPRgbP/AAlvij/oYdT/APAl/wDGj/hLfFP/AEMOp/8AgS/+NY1FR7KH8qA2f+Et8Uf9DDqf/gS/+NH/AAlvij/oYdT/APAl/wDGsaij2UP5UBsf8JZ4o/6GHU//AAIf/Go5vEviG4iMdxreoSoeqvOxH86y6Kfs4dkApJZiWJJPc1o23iDXbK2W3tNYvYIl6JHMygfgDWbRVOKejQF291fVdSVV1DUbq6C8gTSl8fnVKiihJLRAadv4j1+0t1t7XWr+GJeFSOdgB+GaW48R+ILu2a3udav5onGGSSdmB+ozWXRU8kb3sBcstW1TTlZbDULm2DfeEMhXP5VLca9rd3AYbrV72aM9UkmZgfwzWdRTcIt3sAVPaXt5YXHn2N1Nby4xvicqcfUVBRTavowNf/hKvE3/AEH9S/8AAhv8aqXuq6nqW3+0NQubrb086Qvj86p0VKpxWqQBWhZ69ren2/kWOrXltF12RTMo/IGs+iqaT0YGx/wlnif/AKGDUv8AwIb/ABo/4SzxR/0MOpf+BD/41j0VHsofyoDUn8S+IbmBobjW9QljYYZHnYg/hmsuiiqUVHZAFFFFUAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/9k=" alt="' + brandName + '" style="height:54px;width:auto;display:inline-block"></div>' +
      '<p style="text-align:center;color:#444;margin:0 0 6px;font-size:13px">באמצעות&nbsp;חברת&nbsp;גלובל&nbsp;דרייב&nbsp;בע״מ&nbsp;ח.פ&nbsp;516685898&nbsp;(להלן:&nbsp;"גלובל&nbsp;דרייב")</p>' +
      '<p style="text-align:center;color:#888;margin:0 0 14px;font-size:12.5px">מספר&nbsp;הזמנה:&nbsp;' + esc(d.order_no || '____________') + '&nbsp;·&nbsp;תאריך:&nbsp;' + today + '</p>' +
      '<hr style="border:0;border-top:1px solid #ddd;margin:0 0 14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;column-gap:28px;direction:rtl;margin:0 0 14px">' +
        fld('שם המזמין', d.client_name) + fld('ת.ז. / ח.פ', d.client_id) +
        fld('כתובת', d.client_address) + fld('טלפון', d.client_phone, true) +
        fld('יצרן', d.car_make) + fld('דגם', d.car_model) +
        fld('רמת גימור', d.car_trim) + fld('שנת ייצור', d.car_year) +
        fld('נפח מנוע', d.car_engine) + fld('תיבת הילוכים', d.car_gearbox) +
        fld('צבע', d.car_color) + fld('מועד אספקה משוער', d.delivery_days ? (d.delivery_days + ' ימים') : '') +
        fld('תשלום ראשוני *', d.down_total ? nis(d.down_total) : '') + fld('מחיר הרכב בנוסף על התשלום הראשוני', carPlusBal ? nis(carPlusBal) : '') +
      '</div>' +
      '<p style="font-size:12.5px;margin:0 0 10px">מחיר התשלום הראשוני לא יורד ממחיר הרכב. עסקה בת 36–60 חודשים — תלוי חברת מימון וכפוף לאישורה. בתום התקופה מספר אופציות: (1) החזרת הרכב (כפוף לתקנון ותנאי מחירון לוי יצחק). (2) החלפת הרכב לחדש (ללא הגבלה לדגם או יצרן) וללא תשלום ראשוני נוסף (לא כולל רישוי ומיגון לפי דרישת ביטוח) בעסקה הבאה (כפוף לתקנון ותנאי מחירון לוי יצחק). (3) פריסה נוספת של היתרה עד 60 תשלומים נוספים. (4) מכירת הרכב עצמאית ופירעון המימון.</p>' +
      '<p style="margin:0 0 4px;font-size:13px"><b>** החזר חודשי משוער: </b><bdi>' + (monthly ? esc(nis(monthly)) : '____________') + '</bdi></p>' +
      '<p style="font-size:11.5px;color:#555;margin:0 0 12px">** יובהר כי גובה ההחזר החודשי הסופי ייקבע בהתאם לגובה הריבית שתוסכם בין הגוף המממן ללקוח ולפריסת התשלומים שהוסכמה בין הגוף המממן ללקוח.</p>' +
      '<p style="font-weight:700;margin:8px 0 4px;font-size:13.5px">מפרט הרכב הנמכר ותוספות, ככל וישנן:</p>' +
      '<div style="font-size:12.5px;margin:0 0 14px;page-break-inside:avoid">' + spec('אביזרים נלווים להזמנה', ad.accessories) + spec('עמדת טעינה', ad.charging) + spec('מיגון לפי דרישת ביטוח', ad.armor) + spec(ctype === 'car2buy' ? 'עד 40% הנחה על ביטוח חובה' : '40% הנחה על ביטוח חובה — דרך חברת "הכשרה" בלבד (בכפוף להיעדר תביעות מצד הלקוח)', ad.insurance) + '</div>' +
      (ctype === 'car2buy' ? car2buyClauses() : (
        '<table style="width:100%;border-collapse:collapse;table-layout:fixed;direction:rtl;margin:6px 0 14px">' + C.map(function (t, i) { return '<tr class="c2b-clause"><td style="width:2.3em;vertical-align:top;text-align:right;font-weight:700;line-height:1.85;padding:0 0 11px"><span dir="ltr" style="unicode-bidi:embed;direction:ltr">' + (i + 1) + '</span>.</td><td style="vertical-align:top;text-align:right;line-height:1.85;padding:0 0 11px">' + t + '</td></tr>'; }).join('') + '</table>' +
        '<p style="font-weight:700;margin:16px 0 6px;font-size:14px"><span dir="ltr" style="direction:ltr;unicode-bidi:embed">' + (C.length + 1) + '</span>. כללי:</p>' +
        '<table style="width:100%;border-collapse:collapse;table-layout:fixed;direction:rtl">' + gen.map(function (t, i) { return '<tr class="c2b-clause"><td style="width:2.3em;vertical-align:top;text-align:right;font-weight:700;line-height:1.85;padding:0 0 11px"><span dir="ltr" style="unicode-bidi:embed;direction:ltr">' + String.fromCharCode(97 + i) + '</span>.</td><td style="vertical-align:top;text-align:right;line-height:1.85;padding:0 0 11px">' + t + '</td></tr>'; }).join('') + '</table>' +
        '<p style="font-size:11.5px;color:#555;margin-top:14px">המחיר הנקוב לעיל הינו לפי המחירון התקף של היבואן נכון למועד ההזמנה, והינו המחיר למשלם במועד ביצוע ההזמנה. המחיר הסופי למשלם ייקבע במועד קבלת הודעה כי הרכב מוכן לשחרור מהמכס, בהתאם למחיר הרכב במחירון התקף של היבואן ביום התשלום ובהתאם לשינוי במיסים החלים אותה העת, ככל ויהיה.</p>'
      )) +
      '<div style="margin-top:34px;display:flex;justify-content:space-between;align-items:flex-end;page-break-inside:avoid">' +
        (ctype === 'car2buy'
          ? '<div>חתימת הקונה:<br>' + (sig ? '<img src="' + sig + '" style="height:70px">' : '________________________') + '<div style="font-size:11px;color:#666;margin-top:2px">תאריך: ' + today + '</div></div><div style="text-align:left">חתימה וחותמת החברה:<br><b>צוות פרי דרייב</b></div>'
          : '<div>חתימת המזמין:<br>' + (sig ? '<img src="' + sig + '" style="height:70px">' : '________________________') + '</div><div style="text-align:left">בברכה,<br><b>צוות פרי דרייב</b></div>'
        ) +
      '</div></div>';
  }
  function contractView(lead, deal, justSaved) {
    // pull the latest signature (esp. after a remote sign) so we can show it
    if (deal.id && !deal._sigLoaded) {
      db.from('deals').select('signature,signed_at').eq('id', deal.id).single().then(function (r) {
        deal._sigLoaded = true;
        if (r.data) { deal.signature = deal.signature || r.data.signature; deal.signed_at = r.data.signed_at; }
        contractView(lead, deal);
      });
      return;
    }
    var signed = !!deal.signature;
    // מעקב חי אחרי חתימת הלקוח: כל עוד ההסכם פתוח ולא נחתם, בודקים כל 8 שניות.
    // הבדיקה נעצרת מעצמה כשעוזבים את המסך (cDoc נעלם מה-DOM) או כשנחתם.
    if (window.__fdSignPoll) { clearInterval(window.__fdSignPoll); window.__fdSignPoll = null; }
    if (deal.id && !signed) {
      window.__fdSignPoll = setInterval(function () {
        if (!C.$('cDoc')) { clearInterval(window.__fdSignPoll); window.__fdSignPoll = null; return; }
        db.from('deals').select('signature,signed_at').eq('id', deal.id).single().then(function (r) {
          if (!r.data || !r.data.signature) return;
          clearInterval(window.__fdSignPoll); window.__fdSignPoll = null;
          if (!C.$('cDoc')) return;
          deal.signature = r.data.signature; deal.signed_at = r.data.signed_at; deal._sigLoaded = true;
          logActivity(lead.id, 'contract', 'הלקוח חתם על ההסכם' + (deal.order_no ? ' #' + deal.order_no : ''));
          try { C.toast ? C.toast('✅ הלקוח חתם על ההסכם!') : null; } catch (e) {}
          contractView(lead, deal);
        });
      }, 8000);
    }
    var curOwn = (deal.checklist && deal.checklist._ownership) || '01';
    var curType = deal.contract_type === 'car2buy' ? 'car2buy' : 'click_drive';
    view(
      '<div class="lead-top"><button class="btn btn-ghost btn-sm" id="cBack">→ לעסקה</button><h3 style="margin:0">הסכם' + (deal.brand ? ' · ' + esc(deal.brand) : '') + ' — ' + esc(deal.client_name || '') + (signed ? ' <span class="tag" style="border-color:var(--ok);color:var(--ok);background:rgba(22,163,74,.1)">✅ נחתם</span>' : '') + '</h3>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '' +   /* בורר סוג הסכם הוסר — לחברה הסכם אחד */
          (signed ? '' : '<label style="font-size:12.5px;color:var(--muted)">בעלות:</label><select class="inp" id="cOwnership" style="width:auto;padding:5px 8px"><option value="01"' + (curOwn === '01' ? ' selected' : '') + '>בעלים 01</option><option value="00"' + (curOwn === '00' ? ' selected' : '') + '>בעלים 00</option></select>') +
          '<button class="btn btn-sm" id="cPrint">📄 הורד PDF</button>' + (signed ? '' : '<button class="btn btn-ghost btn-sm" id="cSend">💾 שמור הסכם</button>') + '</div></div>' +
      (justSaved && !signed ? '<div class="card" style="border:2px solid var(--ok);background:rgba(22,163,74,.07);text-align:center;padding:22px">' +'<div style="font-size:40px;line-height:1">✅</div>' +'<h2 style="margin:10px 0 4px;font-size:22px">ההסכם נוצר בהצלחה' + (deal.order_no ? ' #' + esc(deal.order_no) : '') + '</h2>' +'<p class="muted" style="margin:0;font-size:14px">השלב הבא: שלחו אותו ללקוח לחתימה באחת הדרכים שלמטה.</p></div>' : '') +
      (signed ? '<div class="card" style="border:1px solid var(--ok);background:rgba(22,163,74,.06)"><b style="color:var(--ok)">✅ ההסכם נחתם על ידי הלקוח' + (deal.signed_at ? ' בתאריך ' + fmt(deal.signed_at) : '') + '</b><span class="muted"> — למטה ההסכם המלא עם חתימת הלקוח.</span></div>' : '') +
      // תצוגה כ"דף A4" ממורכז — בדיוק כפי שהלקוח והמסמך המודפס נראים; overflow-x מונע גלישת טקסט מחוץ למסמך
      '<div class="card" style="background:var(--surface-2);padding:22px;overflow-x:auto"><div id="cDoc" style="max-width:820px;margin:0 auto;background:#fff;color:#111;padding:34px 44px;box-shadow:0 2px 14px rgba(16,24,40,.14);border-radius:5px">' + contractHTML(deal, deal.signature || null) + '</div></div>' +
      (signed ? '' :
        '<div class="card"><h3>📨 שליחה לחתימה מרחוק' + (deal.id ? ' <span style="font-size:12px;font-weight:500;color:var(--muted)">· ⏳ ממתין לחתימת הלקוח — המסך יתעדכן אוטומטית</span>' : '') + '</h3><p class="muted" style="font-size:12px;margin:-6px 0 12px">רק הלקוח חותם — דרך הקישור שנשלח אליו. אין חתימה במקום כדי למנוע זיופים.</p>' +
          (deal.id ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">' +
              '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)">' +
                '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px">📧 מייל</div>' +
                '<input class="inp" id="cLinkEmail" value="' + esc(deal.client_email || '') + '" placeholder="אימייל הלקוח" style="width:100%;margin-bottom:8px">' +
                '<button class="btn btn-sm" id="cSendMail" style="width:100%;justify-content:center">שלח במייל</button></div>' +
              '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)">' +
                '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px">💬 וואטסאפ</div>' +
                '<input class="inp" id="cWaPhone" value="' + esc(deal.client_phone || '') + '" placeholder="טלפון הלקוח" style="width:100%;margin-bottom:8px">' +
                '<button class="btn btn-sm" id="cWa" style="width:100%;justify-content:center">פתח וואטסאפ</button></div>' +
              '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)">' +
                '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px">✉️ SMS</div>' +
                '<p class="muted" style="font-size:12px;margin:0 0 8px">נפתחת אפליקציית המסרונים עם הקישור.</p>' +
                '<button class="btn btn-ghost btn-sm" id="cSms" style="width:100%;justify-content:center">שלח SMS</button></div>' +
              '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)">' +
                '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px">🔗 קישור ידני</div>' +
                '<p class="muted" style="font-size:12px;margin:0 0 8px">להעתקה ושליחה בכל דרך שתבחרו.</p>' +
                '<button class="btn btn-ghost btn-sm" id="cCopy" style="width:100%;justify-content:center">העתק קישור</button></div>' +
            '</div>' +
            '<div id="cLinkMsg" style="font-size:13px;margin-top:12px"></div>'
            : '<p class="muted">לחצו <b>💾 שמור הסכם</b> תחילה — לאחר השמירה יופיעו כאן דרכי השליחה ללקוח (מייל / וואטסאפ / SMS / העתקת קישור).</p>') + '</div>')
    );
    var $ = C.$;
    $('cBack').addEventListener('click', function () { dealForm(lead, deal); });
    if ($('cOwnership')) $('cOwnership').addEventListener('change', function () {
      deal.checklist = deal.checklist || {}; deal.checklist._ownership = this.value;
      $('cDoc').innerHTML = contractHTML(deal, deal.signature || null);
      // שומרים גם את ה-HTML המעוצב → הלקוח יראה בדיוק את אותו הסכם (כולל סעיף הבעלות הנכון)
      if (deal.id) db.from('deals').update({ checklist: deal.checklist, contract_html: contractHTML(deal, null) }).eq('id', deal.id).then(function () {});
    });
    // (בורר סוג ההסכם הוסר — מותג אחד, הסכם אחד)
    // PDF מושלם דרך מנוע ההדפסה של הדפדפן (בדיאלוג בוחרים "שמירה כ-PDF") — bidi עברית ללא פגם
    $('cPrint').addEventListener('click', function () { printContractHtml($('cDoc').innerHTML, 'הסכם פרי דרייב' + (deal.order_no ? ' #' + deal.order_no : '') + ' — ' + (deal.client_name || '')); });
    if (signed) { ensureSignedDoc(lead, deal); return; }   // חתום → שומר עותק HTML לתיק + ציר זמן, ואז צפייה/הדפסה בלבד
    // ---- remote signing: build link + send via email / WhatsApp / SMS ----
    if (deal.id) {
      // sign.html מוגש באתר הציבורי (לא ב-CRM) — חייב כתובת מלאה, כמו במייל (phase-signing.sql)
      var signBase = 'https://tzahilevi1.github.io/freedrive-crm/sign.html';
      var signUrl = null;
      function withUrl(cb) {
        if (signUrl) return cb(signUrl);
        db.rpc('make_sign_token', { p_deal: deal.id }).then(function (r) {
          if (r.error || !r.data) { alert('שגיאה ביצירת קישור: ' + ((r.error && r.error.message) || '')); return; }
          signUrl = signBase + '?d=' + deal.id + '&t=' + r.data; cb(signUrl);
        });
      }
      var linkMsg = $('cLinkMsg');
      $('cSendMail').addEventListener('click', function () {
        var to = ($('cLinkEmail').value || '').trim();
        if (!to || to.indexOf('@') < 0) { linkMsg.style.color = 'var(--danger)'; linkMsg.textContent = 'הזינו אימייל תקין'; return; }
        linkMsg.style.color = 'var(--muted)'; linkMsg.textContent = 'שולח…';
        db.rpc('send_contract_email', { p_deal: deal.id, p_to: to }).then(function (r) {
          if (r.error) { linkMsg.style.color = 'var(--danger)'; linkMsg.textContent = 'שגיאה: ' + r.error.message; return; }
          logActivity(lead.id, 'contract', 'נשלח הסכם לחתימה: ' + to);
          var req = r.data && r.data.email_req;
          if (!req) { linkMsg.style.color = 'var(--ok)'; linkMsg.textContent = '✅ נשלח ל-' + to; return; }
          linkMsg.style.color = 'var(--muted)'; linkMsg.textContent = 'נשלח — בודק אישור מ-Resend…';
          var tries = 0, poll = setInterval(function () {
            if (++tries > 8) { clearInterval(poll); linkMsg.style.color = 'var(--ok)'; linkMsg.textContent = '✅ נשלח ל-' + to; return; }
            db.rpc('admin_net_result', { p_id: req }).then(function (g) {
              if (g.error || !g.data) return;   // still pending / not admin → keep the optimistic result
              clearInterval(poll);
              var st = g.data.status, b = null; try { b = JSON.parse(g.data.content); } catch (e) {}
              if (st >= 200 && st < 300) { linkMsg.style.color = 'var(--ok)'; linkMsg.textContent = '✅ נשלח בהצלחה ל-' + to; }
              else { linkMsg.style.color = 'var(--danger)'; linkMsg.textContent = '✖ Resend דחה (' + st + '): ' + ((b && b.message) || String(g.data.content || '').slice(0, 160)); }
            });
          }, 1500);
        });
      });
      $('cWa').addEventListener('click', function () { withUrl(function (u) { var p = waIntl(($('cWaPhone') && $('cWaPhone').value) || deal.client_phone); window.open('https://wa.me/' + p + '?text=' + encodeURIComponent('שלום, לחתימה על ההסכם: ' + u), '_blank'); }); });
      $('cSms').addEventListener('click', function () { withUrl(function (u) { window.location.href = 'sms:' + (deal.client_phone || '') + '?body=' + encodeURIComponent('לחתימה על ההסכם: ' + u); }); });
      $('cCopy').addEventListener('click', function () { withUrl(function (u) { (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { linkMsg.style.color = 'var(--ok)'; linkMsg.textContent = '🔗 הקישור הועתק'; }).catch(function () { linkMsg.style.color = 'var(--txt)'; linkMsg.textContent = u; }); }); });
    }
    // "שמור הסכם" — persist the deal (so it shows in "הצעות / הסכמים לחתימה"), then reload so the send options appear
    if ($('cSend')) $('cSend').addEventListener('click', function () {
      var btn = $('cSend'); btn.disabled = true; btn.textContent = 'שומר…';
      var payload = Object.assign({}, deal);
      ['id', 'order_no', 'created_at', 'updated_at', '_sigLoaded', 'signature', 'signed_at'].forEach(function (k) { delete payload[k]; });
      payload.contract_html = contractHTML(deal, null);   // מקור-אמת יחיד: הלקוח ב-sign.html יראה בדיוק את ה-HTML המעוצב הזה
      var q = deal.id ? db.from('deals').update(payload).eq('id', deal.id).select().single() : db.from('deals').insert(payload).select().single();
      q.then(function (r) {
        if (r.error || !r.data) { alert('שמירה נכשלה: ' + ((r.error && r.error.message) || 'שגיאה')); btn.disabled = false; btn.textContent = '💾 שמור הסכם'; return; }
        var wasNew = !deal.id, saved = r.data; saved._sigLoaded = true;
        logActivity(lead.id, 'contract', (wasNew ? 'נוצר' : 'עודכן') + ' הסכם לחתימה' + (saved.order_no ? ' #' + saved.order_no : ''));
        // יצירת/שמירת הסכם לחתימה → סטטוס הליד "הצעת מחיר" (אלא אם כבר שם או בשלב מתקדם יותר)
        var lst = lead.status;
        if (lst !== 'quote_sent' && lst !== 'won' && lst !== 'lost') changeStatus(lead.id, 'quote_sent', lead, function () { contractView(lead, saved, true); });
        else contractView(lead, saved, true);
      });
    });
  }
  // לאחר שהלקוח חתם — שומרים עותק HTML של ההסכם החתום פעם אחת → מופיע בציר הזמן וב"מסמכי הלקוח".
  // הצפייה היא דרך הפופאפ הפנימי (viewDoc מביא ב-fetch ומרנדר ב-iframe srcdoc — עברית+חתימה מלאות),
  // ובו כפתור "הורד PDF". (קישור ישיר ל-.html מוגש ע"י Supabase כ-text/plain=קוד, לכן לא חושפים אותו.)
  var docGenerating = {};
  function ensureSignedDoc(lead, deal, onSaved) {
    if (!deal || !deal.id || !deal.signature || docGenerating[deal.id]) return;
    var path = lead.id + '/signed_' + deal.id + '.html';
    var oldDoc = lead.id + '/signed_' + deal.id + '.doc';   // גרסת Word ריקה ישנה — לניקוי
    docGenerating[deal.id] = true;
    db.from('lead_documents').select('id').eq('storage_path', path).then(function (chk) {
      if (chk.error || (chk.data && chk.data.length)) { docGenerating[deal.id] = false; return; }   // כבר נשמר
      db.from('lead_documents').delete().eq('storage_path', oldDoc).then(function () {});
      db.storage.from('lead-docs').remove([oldDoc]);
      var inner = contractHTML(deal, deal.signature || null);
      var full = String.fromCharCode(0xFEFF) + '<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>הסכם חתום' + (deal.order_no ? ' #' + deal.order_no : '') + '</title>' +
        '<style>@page{size:A4;margin:11mm 13mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:#fff;color:#111;font-family:Arial,\'Segoe UI\',sans-serif}.sheet{max-width:820px;margin:0 auto;padding:16px 18px}</style>' +
        '</head><body><div class="sheet">' + inner + '</div></body></html>';
      db.storage.from('lead-docs').upload(path, new Blob([full], { type: 'text/html;charset=utf-8' }), { contentType: 'text/html;charset=utf-8', upsert: true }).then(function (u) {
        docGenerating[deal.id] = false;
        if (u.error) return;
        db.from('lead_documents').insert({ lead_id: lead.id, name: 'הסכם חתום' + (deal.order_no ? ' #' + deal.order_no : ''), storage_path: path }).then(function () {
          logActivity(lead.id, 'contract', 'התקבל הסכם חתום מהלקוח' + (deal.order_no ? ' #' + deal.order_no : '')).then(function () { if (onSaved) onSaved(); });
        });
      });
    });
  }

  // ---------- FILES (client file manager) ----------
  var fileFilter = null, selectedDeals = {};
  function bindFilesBulk(stageFilter) {
    var $ = C.$;
    function ids() { return Object.keys(selectedDeals).filter(function (k) { return selectedDeals[k]; }); }
    function reRender() { selectedDeals = {}; window.C2B_renderFiles(stageFilter); }
    function update() {
      var n = ids().length, bar = $('fBulk'); if (!bar) return;
      bar.style.display = n ? 'flex' : 'none'; if ($('fBulkCount')) $('fBulkCount').textContent = 'נבחרו ' + n;
      var sa = $('fSelAll'); if (sa) { var b = $('filesBody').querySelectorAll('input[data-fsel]'), c = $('filesBody').querySelectorAll('input[data-fsel]:checked'); sa.checked = b.length && c.length === b.length; sa.indeterminate = c.length > 0 && c.length < b.length; }
    }
    $('filesBody').querySelectorAll('input[data-fsel]').forEach(function (cb) { cb.addEventListener('change', function () { if (cb.checked) selectedDeals[cb.dataset.fsel] = true; else delete selectedDeals[cb.dataset.fsel]; update(); }); });
    if ($('fSelAll')) $('fSelAll').addEventListener('change', function () { var on = this.checked; $('filesBody').querySelectorAll('input[data-fsel]').forEach(function (cb) { cb.checked = on; if (on) selectedDeals[cb.dataset.fsel] = true; else delete selectedDeals[cb.dataset.fsel]; }); update(); });
    if ($('fBulkClear')) $('fBulkClear').addEventListener('click', function () { selectedDeals = {}; $('filesBody').querySelectorAll('input[data-fsel]').forEach(function (cb) { cb.checked = false; }); update(); });
    if ($('fBulkApply')) $('fBulkApply').addEventListener('click', function () { var list = ids(); if (!list.length) return; var st = $('fBulkStage').value; if (!st) { alert('בחרו שלב'); return; } db.from('deals').update({ stage: st }).in('id', list).then(function (r) { if (r.error) { alert('שגיאה: ' + r.error.message); return; } reRender(); }); });
    if ($('fBulkDel')) $('fBulkDel').addEventListener('click', function () { var list = ids(); if (!list.length) return; if (!confirm('למחוק ' + list.length + ' תיקים/הסכמים? פעולה בלתי הפיכה.')) return; db.from('deals').delete().in('id', list).then(function (r) { if (r.error) { alert('שגיאה: ' + r.error.message); return; } reRender(); }); });
    update();
  }
  var FILE_COLS = [
    { key: 'order', label: '#', fixed: true, th: 'style="width:70px"', cell: function (d) { return '<td data-open="1" style="cursor:pointer"><b>#' + esc(d.order_no) + '</b></td>'; } },
    { key: 'client', label: 'לקוח', fixed: true, cell: function (d) { return '<td data-open="1" style="cursor:pointer">' + esc(d.client_name) + (d.signature ? ' <span style="color:var(--ok)" title="נחתם">✅</span>' : '') + '</td>'; } },
    { key: 'car', label: 'רכב', cell: function (d) { return '<td>' + esc(((d.car_make || '') + ' ' + (d.car_model || '')).trim() || '—') + '</td>'; } },
    { key: 'total', label: 'סכום', cell: function (d) { return '<td>' + nis(d.total) + '</td>'; } },
    { key: 'commission', label: 'עמלת סוכן', cell: function (d) { return '<td style="color:var(--ok);font-weight:700">' + nis(d.commission) + '</td>'; } },
    { key: 'stage', label: 'שלב', cell: function (d) { return '<td><span class="stage-click" data-stagesel="' + d.id + '" title="לחצו לשינוי שלב" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px">' + stageBadge(d.stage || 'initial') + '<span class="muted" style="font-size:10px">▾</span></span></td>'; } },
    { key: 'checklist', label: 'צ\'קליסט', cell: function (d) { var chk = d.checklist || {}, done = FILE_CHECKLIST_ITEMS.filter(function (k) { return chk[k]; }).length, tot = FILE_CHECKLIST_ITEMS.length; return '<td><div class="bar" style="width:80px;display:inline-block;vertical-align:middle"><span style="width:' + Math.round(done / tot * 100) + '%"></span></div> ' + done + '/' + tot + '</td>'; } },
    { key: 'salesperson', label: 'איש מכירות', def: false, cell: function (d) { return '<td>' + esc(d.salesperson || '—') + '</td>'; } },
    { key: 'brand', label: 'מותג', def: false, cell: function (d) { return '<td>' + esc(d.brand || '—') + '</td>'; } },
    { key: 'phone', label: 'טלפון', def: false, cell: function (d) { return '<td>' + esc(d.client_phone || '—') + '</td>'; } },
    { key: 'created', label: 'נוצר', def: false, cell: function (d) { return '<td class="muted">' + fmt(d.created_at) + '</td>'; } }
  ];
  var fileCols = null;
  window.C2B_renderFiles = function (stageFilter) {
    loading(); selectedDeals = {};
    db.from('deals').select('id,lead_id,order_no,brand,stage,status,client_name,client_phone,car_make,car_model,total,commission,salesperson,created_at,updated_at,checklist,cancel_reason,acct_status,has_contract,has_signature').order('created_at', { ascending: false }).limit(2000).then(function (r) {
      if (r.error) return errBox(r.error.message);
      var deals = r.data || [];
      var counts = { all: deals.length }; DEAL_STAGES.forEach(function (s) { counts[s.k] = 0; });
      deals.forEach(function (d) { var st = d.stage || 'initial'; counts[st] = (counts[st] || 0) + 1; });
      var f = stageFilter || 'all';
      fileFilter = C.makeFilter([
        { key: 'order_no', label: 'מס\' הזמנה' }, { key: 'client_name', label: 'לקוח' },
        { key: 'car', label: 'רכב', get: function (d) { return ((d.car_make || '') + ' ' + (d.car_model || '')).trim(); } },
        { key: 'stage', label: 'שלב', options: DEAL_STAGES.map(function (s) { return { v: s.k, l: s.label }; }) },
        { key: 'total', label: 'סכום עסקה' }, { key: 'commission', label: 'עמלת סוכן' }, { key: 'salesperson', label: 'איש מכירות' }
      ], function () { drawF(); });
      if (!fileCols) fileCols = C.colPicker('files', FILE_COLS, function () { drawF(); }, { sortable: true });
      function tab(k, label, n) { return '<button data-fstage="' + k + '"' + (f === k ? ' class="active"' : '') + '>' + label + ' (' + n + ')</button>'; }
      view('<div class="card"><div class="row-between"><h3 style="margin:0">תיקי לקוחות</h3>' + fileCols.button() + '</div><nav class="tabs" id="fTabs" style="margin:10px 0 12px;flex-wrap:wrap">' + tab('all', 'הכל', counts.all) + DEAL_STAGES.map(function (s) { return tab(s.k, s.label, counts[s.k] || 0); }).join('') + '</nav><div id="filesBody"></div></div>');
      fileCols.bind();
      function drawF() {
        var lst = fileCols.sortRows((f === 'all' ? deals : deals.filter(function (d) { return (d.stage || 'initial') === f; })).filter(function (d) { return fileFilter.match(d); }));
        var rows = lst.map(function (d) {
          return '<tr data-deal="' + d.id + '"><td style="width:30px;text-align:center"><input type="checkbox" data-fsel="' + d.id + '"' + (selectedDeals[d.id] ? ' checked' : '') + ' onclick="event.stopPropagation()"></td>' + fileCols.cells(d) + '</tr>';
        }).join('');
        var bulk = '<div id="fBulk" class="filterbar" style="display:none;background:var(--brand-soft);align-items:center"><b id="fBulkCount" style="color:var(--brand)">נבחרו 0</b>' +
          '<select id="fBulkStage"><option value="">🏷️ שנה שלב…</option>' + DEAL_STAGES.map(function (s) { return '<option value="' + s.k + '">' + esc(s.label) + '</option>'; }).join('') + '</select>' +
          '<button class="btn btn-sm" id="fBulkApply">החל</button><button class="btn btn-ghost btn-sm" id="fBulkDel" style="color:var(--danger);border-color:var(--danger)">🗑️ מחק נבחרים</button><button class="btn btn-ghost btn-sm" id="fBulkClear">בטל בחירה</button></div>';
        C.$('filesBody').innerHTML = fileFilter.render() + bulk +
          '<div class="table-scroll"><table><thead><tr><th style="width:30px;text-align:center"><input type="checkbox" id="fSelAll"></th>' + fileCols.thead() + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + (fileCols.colCount() + 1) + '" class="empty">אין תיקים</td></tr>') + '</tbody></table></div>';
        fileFilter.bind();
        C.$('filesBody').querySelectorAll('td[data-open]').forEach(function (td) { td.addEventListener('click', function () { window.C2B_openDeal(td.parentNode.dataset.deal); }); });
        // change a file's stage directly from the "שלב" column → updates DB + pipeline + the file view inside
        C.$('filesBody').querySelectorAll('[data-stagesel]').forEach(function (el) {
          el.addEventListener('click', function (e) {
            e.stopPropagation();
            var d = deals.filter(function (x) { return String(x.id) === el.dataset.stagesel; })[0]; if (!d) return;
            openStageMenu(el, d, function () { window.C2B_renderFiles(stageFilter); });
          });
        });
        bindFilesBulk(stageFilter);
      }
      C.$('fTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-fstage]'); if (b) window.C2B_renderFiles(b.dataset.fstage === 'all' ? null : b.dataset.fstage); });
      drawF();
    });
  };

  // ---------- DASHBOARD ----------
  var dashRange = { preset: 'year' };   // לא 'all' — ראה dashLoad למטה
  var PERIODS = [['today', 'היום'], ['7', '7 ימים'], ['30', '30 יום'], ['month', 'החודש'], ['quarter', 'רבעון'], ['year', 'שנה'], ['all', 'הכל']];
  function periodStart(p) { var d = new Date(); d.setHours(0, 0, 0, 0); if (p === 'today') return d.getTime(); if (p === '7') return Date.now() - 7 * 864e5; if (p === '30') return Date.now() - 30 * 864e5; if (p === 'month') { var m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); return m.getTime(); } if (p === 'quarter') return Date.now() - 90 * 864e5; if (p === 'year') return Date.now() - 365 * 864e5; return 0; }
  // ---- per-block date filters (each dashboard card filters independently) ----
  var blockR = {}, blockF = {}, dashAll = null;
  // שדות שאפשר לסנן לפיהם כל בלוק בדשבורד (שדה + ערך)
  var DASH_FIELDS = [
    ['brand', 'מותג'], ['source', 'מקור הגעה'], ['status', 'סטטוס'], ['marketing_company', 'חברת שיווק'],
    ['city', 'עיר'], ['utm_source', 'utm_source'], ['utm_campaign', 'utm_campaign'], ['assigned_to', 'סוכן'], ['car', 'רכב']
  ];
  var DASH_FIELD_LABEL = {}; DASH_FIELDS.forEach(function (f) { DASH_FIELD_LABEL[f[0]] = f[1]; });
  function fieldVal(l, field) {
    if (!l) return '';
    if (field === 'assigned_to') return (dashAll && dashAll.prof[l.assigned_to]) || 'לא שויך';
    if (field === 'status') return stDef(l.status || 'new').label;
    return l[field] == null ? '' : String(l[field]);
  }
  function matchField(l, f) { return !f || !f.field || !f.value ? true : fieldVal(l, f.field).toLowerCase() === String(f.value).toLowerCase(); }
  function closeFieldPop() { var m = document.getElementById('fieldPop'); if (m) m.remove(); }
  function fieldFilterPopup(anchor, k, onApply) {
    closeFieldPop();
    var cur = blockF[k] || {};
    var m = document.createElement('div'); m.id = 'fieldPop';
    m.style.cssText = 'position:absolute;z-index:9999;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px;width:230px';
    m.innerHTML = '<label class="muted" style="font-size:12px">שדה</label>' +
      '<select class="inp" id="ffField" style="margin:4px 0 8px;width:100%"><option value="">— בחר שדה —</option>' + DASH_FIELDS.map(function (f) { return '<option value="' + f[0] + '"' + (cur.field === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>' +
      '<label class="muted" style="font-size:12px">ערך</label>' +
      '<select class="inp" id="ffVal" style="margin:4px 0 10px;width:100%"></select>' +
      '<div style="display:flex;gap:6px"><button class="btn btn-sm" id="ffApply">החל</button><button class="btn btn-ghost btn-sm" id="ffClear">נקה</button></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { e.stopPropagation(); });   // קליק בתוך הפופאפ לא יסגור אותו
    var rc = anchor.getBoundingClientRect();
    m.style.top = (rc.bottom + window.scrollY + 4) + 'px'; m.style.left = Math.max(8, rc.left + window.scrollX - 120) + 'px';
    function fillVals() { var fld = m.querySelector('#ffField').value, seen = {}, vals = []; if (fld && dashAll) dashAll.leads.forEach(function (l) { var v = fieldVal(l, fld); if (v && !seen[v]) { seen[v] = 1; vals.push(v); } }); vals.sort(); m.querySelector('#ffVal').innerHTML = window.C2B.selOpts(vals, cur.value, '— בחר ערך —'); }
    m.querySelector('#ffField').addEventListener('change', fillVals); fillVals();
    m.querySelector('#ffApply').addEventListener('click', function (e) { e.stopPropagation(); onApply({ field: m.querySelector('#ffField').value, value: m.querySelector('#ffVal').value.trim() }); closeFieldPop(); });
    m.querySelector('#ffClear').addEventListener('click', function (e) { e.stopPropagation(); onApply({}); closeFieldPop(); });
    setTimeout(function () { document.addEventListener('click', closeFieldPop, { once: true }); }, 0);
  }
  function fieldBtnLabel(f) { return f && f.field && f.value ? '🔎 ' + (DASH_FIELD_LABEL[f.field] || f.field) + ': ' + esc(f.value) : '🔎 שדה'; }
  // האם הטווח שנבחר חורג מהחלון שכבר נטען לדשבורד?
  function needsFullHistory(r) {
    if (dashLoaded === null) return false;                 // כבר טעון הכל
    if (!r) return false;
    if (r.preset === 'all') return true;
    if (r.from && new Date(r.from + 'T00:00:00').getTime() < Date.now() - dashLoaded * 864e5) return true;
    return false;
  }
  function inRange(ts, r) {
    if (!r || r.preset === 'all' || (!r.preset && !r.from && !r.to)) return true;
    var t = new Date(ts || 0).getTime();
    if (r.preset) return t >= periodStart(r.preset);
    if (r.from && t < new Date(r.from + 'T00:00:00').getTime()) return false;
    if (r.to && t > new Date(r.to + 'T23:59:59').getTime()) return false;
    return true;
  }
  function fltLabel(r) {
    if (!r || r.preset === 'all' || (!r.preset && !r.from && !r.to)) return '📅 הכל';
    if (r.preset) { var p = PERIODS.filter(function (x) { return x[0] === r.preset; })[0]; return '📅 ' + (p ? p[1] : r.preset); }
    return '📅 ' + (r.from || '…') + ' – ' + (r.to || '…');
  }
  function closeDatePopup() { var m = document.getElementById('datepop'); if (m) m.remove(); }
  function dateFilterPopup(anchor, cur, onApply) {
    closeDatePopup();
    var m = document.createElement('div'); m.className = 'stmenu'; m.id = 'datepop'; m.style.minWidth = '250px'; m.style.padding = '12px';
    m.innerHTML = '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">' + PERIODS.map(function (p) { return '<button class="btn btn-ghost btn-sm" data-dp="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<label class="muted" style="font-size:12px">טווח תאריכים מותאם</label>' +
      '<div style="display:flex;gap:6px;align-items:center;margin:5px 0 10px"><input type="date" class="inp" id="dpFrom" value="' + ((cur && cur.from) || '') + '"><span class="muted">–</span><input type="date" class="inp" id="dpTo" value="' + ((cur && cur.to) || '') + '"></div>' +
      '<div style="display:flex;gap:6px"><button class="btn btn-sm" id="dpApply">החל טווח</button><button class="btn btn-ghost btn-sm" id="dpClear">נקה</button></div>';
    document.body.appendChild(m);
    var rc = anchor.getBoundingClientRect();
    m.style.top = (rc.bottom + window.scrollY + 4) + 'px'; m.style.left = Math.max(8, rc.left + window.scrollX - 140) + 'px';
    m.querySelectorAll('[data-dp]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); onApply({ preset: b.dataset.dp }); closeDatePopup(); }); });
    m.querySelector('#dpApply').addEventListener('click', function (e) { e.stopPropagation(); onApply({ from: m.querySelector('#dpFrom').value, to: m.querySelector('#dpTo').value }); closeDatePopup(); });
    m.querySelector('#dpClear').addEventListener('click', function (e) { e.stopPropagation(); onApply({ preset: 'all' }); closeDatePopup(); });
    setTimeout(function () { document.addEventListener('click', closeDatePopup, { once: true }); }, 0);
  }
  // drawer popup listing leads → click opens the lead card
  function leadsPopup(title, list) {
    C.openDrawer('<div class="dw-head"><h3 style="margin:0">' + esc(title) + ' <span class="muted" style="font-size:13px">(' + list.length + ')</span></h3></div>' +
      '<div class="dw-body">' + (list.length ? list.map(function (l) {
        return '<div data-lead="' + l.id + '" style="padding:11px 12px;border-bottom:1px solid var(--line);cursor:pointer;border-radius:8px" onmouseover="this.style.background=\'var(--surface-2)\'" onmouseout="this.style.background=\'\'">' +
          '<div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(l.name || 'ליד') + '</b>' + (l.status ? badge(l.status) : '') + '</div>' +
          '<div class="muted" style="font-size:12.5px;margin-top:3px">' + esc(l.phone || '') + (l.car ? ' · ' + esc(l.car) : '') + (l.brand ? ' · ' + esc(l.brand) : '') + (l._extra ? ' · ' + esc(l._extra) : '') + '</div></div>';
      }).join('') : '<p class="empty">אין רשומות</p>') + '</div>');
    document.getElementById('drawer').querySelectorAll('[data-lead]').forEach(function (el) { el.addEventListener('click', function () { C.closeDrawer(); window.C2B_openLeadCard(el.dataset.lead); }); });
  }
  // כמה היסטוריה כבר נטענה (ms). null = הכל. מונע הורדה חוזרת של אותם נתונים.
  var dashLoaded = null;
  window.C2B_renderDashboard = function (opts) {
    var wantAll = (opts && opts.all) || dashRange.preset === 'all' || !!dashRange.from;
    var days = wantAll ? null : 400;                       // 400 יום מכסה את "שנה אחורה" בנוחות
    // כבר יש בזיכרון כיסוי מספיק? מציירים מחדש בלי בקשה נוספת.
    if (dashAll && (dashLoaded === null || (days !== null && dashLoaded >= days))) return drawDashboard();
    loading();
    var since = days ? new Date(Date.now() - days * 864e5).toISOString() : null;
    var leadsQ = db.from('leads').select('id,name,phone,car,brand,status,source,created_at,first_response_at,assigned_to,marketing_company,city,utm_source,utm_campaign').is('deleted_at', null);
    var dealsQ = db.from('deals').select('id,lead_id,client_name,car_make,car_model,total,stage,created_at');
    if (since) { leadsQ = leadsQ.gte('created_at', since); dealsQ = dealsQ.gte('created_at', since); }
    Promise.all([
      leadsQ, db.from('tasks').select('done'), db.from('appointments').select('status'),
      dealsQ, db.from('profiles').select('user_id,full_name')
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var prof = {}; ((res[4] && res[4].data) || []).forEach(function (p) { prof[p.user_id] = p.full_name; });
      dashAll = { leads: res[0].data || [], tasks: res[1].data || [], deals: (res[3] && res[3].data) || [], prof: prof };
      dashLoaded = days;
      drawDashboard();
    }).catch(function (e) { errBox(e.message || e); });
  };
  function fbtn(k) { return '<button class="btn btn-ghost btn-sm" id="flt_' + k + '">' + fltLabel(blockR[k]) + '</button>'; }
  function fbtn2(k) { return '<button class="btn btn-ghost btn-sm" id="fltf_' + k + '" title="סינון לפי שדה וערך">' + fieldBtnLabel(blockF[k]) + '</button>'; }
  function drawDashboard() {
    var allLeads = dashAll.leads, allDeals = dashAll.deals, tasks = dashAll.tasks;
    var leads = allLeads.filter(function (l) { return inRange(l.created_at, dashRange); });
    var deals = allDeals.filter(function (d) { return inRange(d.created_at, dashRange); });
    var todayS = periodStart('today');
    var todayN = allLeads.filter(function (l) { return new Date(l.created_at || 0).getTime() >= todayS; }).length;
    var dealsTodayN = allDeals.filter(function (d) { return new Date(d.created_at || 0).getTime() >= todayS; }).length;
    var by = {}; STATUSES.forEach(function (s) { by[s.k] = 0; }); leads.forEach(function (l) { by[l.status || 'new'] = (by[l.status || 'new'] || 0) + 1; });
    var won = by.won || 0, lost = by.lost || 0, conv = (won + lost) ? Math.round(won / (won + lost) * 100) : 0;
    var rts = leads.filter(function (l) { return l.first_response_at; }).map(function (l) { return (new Date(l.first_response_at) - new Date(l.created_at)) / 60000; });
    var avgRt = rts.length ? Math.round(rts.reduce(function (a, b) { return a + b; }, 0) / rts.length) : 0;
    var openTasks = tasks.filter(function (t) { return !t.done; }).length;

    var dashCustom = dashRange && !dashRange.preset && (dashRange.from || dashRange.to);
    var pTabs = '<div class="row-between" style="margin-bottom:2px"><div class="tabs" id="dashPeriod">' + PERIODS.map(function (p) { return '<button data-p="' + p[0] + '"' + (dashRange && dashRange.preset === p[0] ? ' class="active"' : '') + '>' + p[1] + '</button>'; }).join('') + '<button data-dpcustom="1"' + (dashCustom ? ' class="active"' : '') + '>📅 טווח מותאם</button></div><span class="muted" style="font-size:12px">' + (dashCustom ? fltLabel(dashRange) : 'מסנן ראשי (KPI)') + '</span></div>';
    function hdr(title, k, hint) { return '<div class="row-between"><h3 style="margin:0">' + title + (hint ? ' <span class="muted" style="font-size:12px">' + hint + '</span>' : '') + '</h3><div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">' + fbtn(k) + fbtn2(k) + '</div></div>'; }
    view(
      pTabs +
      '<div class="cards" style="margin-top:14px">' +
        C.stat('לידים חדשים היום', todayN, true) + C.stat('עסקאות היום', dealsTodayN, true) +
        C.stat('סה"כ לידים', leads.length) + C.stat('סה"כ עסקאות', deals.length) +
        C.stat('פגישות נקבעו', by.meeting_set || 0) +
        C.stat('עסקאות שנסגרו', won) + C.stat('אחוז סגירה', conv + '%') +
        C.stat('זמן תגובה', avgRt ? avgRt + ' דק\'' : '—') + C.stat('משימות פתוחות', openTasks) +
      '</div>' +
      '<div class="grid2">' +
        '<div class="card">' + hdr('לידים לאורך זמן', 'chart') + '<div id="dashChart"></div></div>' +
        '<div class="card">' + hdr('פילוח לפי סטטוס', 'status', '(לחצו לפתיחת הלידים)') + '<div class="table-scroll"><table><tbody id="dashStatus"></tbody></table></div></div>' +
      '</div>' +
      '<div class="card">' + hdr('🗂️ משפך תיקי לקוחות', 'stage', '(לחצו על שלב לצפייה בלקוחות)') + '<div class="table-scroll"><table><tbody id="dashStage"></tbody></table></div></div>' +
      '<div class="grid2">' +
        '<div class="card">' + hdr('לידים לפי מותג', 'brand', '(לחצו לפתיחה)') + '<div class="table-scroll"><table><tbody id="dashBrand"></tbody></table></div></div>' +
        '<div class="card">' + hdr('לידים לפי סוכן מכירות', 'agent', '(לחצו לפתיחה)') + '<div class="table-scroll"><table><thead><tr><th>סוכן</th><th>לידים</th><th>עסקאות</th></tr></thead><tbody id="dashAgent"></tbody></table></div></div>' +
      '</div>' +
      '<div class="card">' + hdr('מקורות מובילים', 'source') + '<div class="table-scroll"><table><tbody id="dashSource"></tbody></table></div></div>'
    );
    C.$('dashPeriod').addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]');
      if (b) {
        dashRange = { preset: b.dataset.p };
        // 'all' דורש היסטוריה מלאה — טוענים לפי דרישה ולא מראש
        if (b.dataset.p === 'all' && dashLoaded !== null) return window.C2B_renderDashboard({ all: true });
        drawDashboard(); return;
      }
      var c = e.target.closest('[data-dpcustom]');
      if (c) { e.stopPropagation(); dateFilterPopup(c, dashRange, function (r) {
        dashRange = r;
        if (needsFullHistory(r)) return window.C2B_renderDashboard({ all: true });
        drawDashboard();
      }); }
    });
    ['chart', 'status', 'stage', 'brand', 'agent', 'source'].forEach(function (k) {
      drawBlock(k);
      var btn = C.$('flt_' + k);
      if (btn) btn.addEventListener('click', function (e) { e.stopPropagation(); dateFilterPopup(btn, blockR[k], function (r) {
        blockR[k] = r; btn.innerHTML = fltLabel(r);
        if (needsFullHistory(r)) return window.C2B_renderDashboard({ all: true });
        drawBlock(k);
      }); });
      var fb = C.$('fltf_' + k);
      if (fb) fb.addEventListener('click', function (e) { e.stopPropagation(); fieldFilterPopup(fb, k, function (f) { blockF[k] = f; fb.innerHTML = fieldBtnLabel(f); drawBlock(k); }); });
    });
  }
  function drawBlock(k) {
    var prof = dashAll.prof, allLeads = dashAll.leads, allDeals = dashAll.deals, r = blockR[k];
    var leads = allLeads.filter(function (l) { return inRange(l.created_at, r); });
    var deals = allDeals.filter(function (d) { return inRange(d.created_at, r); });
    var leadById = {}; allLeads.forEach(function (l) { leadById[l.id] = l; });
    var ff = blockF[k];   // סינון שדה+ערך פר-בלוק
    if (ff && ff.field && ff.value) {
      leads = leads.filter(function (l) { return matchField(l, ff); });
      deals = deals.filter(function (d) { return matchField(leadById[d.lead_id], ff); });
    }
    if (k === 'chart') {
      var byDay = {}; leads.forEach(function (l) { var dd = (l.created_at || '').slice(0, 10); if (dd) byDay[dd] = (byDay[dd] || 0) + 1; });
      var days = []; for (var i = 13; i >= 0; i--) { var dz = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push({ d: dz, v: byDay[dz] || 0 }); }
      C.$('dashChart').innerHTML = svgBars(days);
    } else if (k === 'status') {
      var by = {}; leads.forEach(function (l) { by[l.status || 'new'] = (by[l.status || 'new'] || 0) + 1; });
      C.$('dashStatus').innerHTML = STATUSES.filter(function (s) { return by[s.k]; }).map(function (s) { var pct = leads.length ? Math.round(by[s.k] / leads.length * 100) : 0; return '<tr data-status="' + s.k + '" style="cursor:pointer"><td>' + badge(s.k) + '</td><td>' + by[s.k] + '</td><td style="width:45%"><div class="bar"><span style="width:' + pct + '%;background:' + s.color + '"></span></div></td></tr>'; }).join('') || '<tr><td class="empty">אין נתונים</td></tr>';
      C.$('dashStatus').querySelectorAll('[data-status]').forEach(function (tr) { tr.addEventListener('click', function () { var kk = tr.dataset.status; leadsPopup(stDef(kk).label, leads.filter(function (l) { return (l.status || 'new') === kk; })); }); });
    } else if (k === 'stage') {
      var byStage = {}; DEAL_STAGES.forEach(function (s) { byStage[s.k] = 0; }); deals.forEach(function (d) { byStage[d.stage || 'initial'] = (byStage[d.stage || 'initial'] || 0) + 1; });
      var maxStage = Math.max(1, Math.max.apply(null, DEAL_STAGES.map(function (s) { return byStage[s.k] || 0; })));
      C.$('dashStage').innerHTML = DEAL_STAGES.map(function (s) { var n = byStage[s.k] || 0; return '<tr data-stage="' + s.k + '" style="cursor:pointer"><td>' + stageBadge(s.k) + '</td><td>' + n + '</td><td style="width:55%"><div class="bar"><span style="width:' + Math.round(n / maxStage * 100) + '%;background:' + s.color + '"></span></div></td></tr>'; }).join('');
      C.$('dashStage').querySelectorAll('[data-stage]').forEach(function (tr) { tr.addEventListener('click', function () { var kk = tr.dataset.stage; var list = deals.filter(function (d) { return (d.stage || 'initial') === kk; }).map(function (d) { var l = leadById[d.lead_id] || {}; return { id: d.lead_id, name: d.client_name || l.name, phone: l.phone, car: ((d.car_make || '') + ' ' + (d.car_model || '')).trim() || l.car, brand: l.brand, status: l.status, _extra: d.total ? nis(d.total) : '' }; }); leadsPopup('שלב תיק: ' + stageDef(kk).label, list); }); });
    } else if (k === 'brand') {
      // רק המותגים-השיווקיים שלנו (מ-brand_companies) — לא יצרנים/ריקים
      var mkt = (window.C2B && window.C2B.marketingBrands) || [];
      var byBrand = {}; leads.forEach(function (l) { var b = l.brand; if (b && (!mkt.length || mkt.indexOf(b) >= 0)) byBrand[b] = (byBrand[b] || 0) + 1; });
      var brands = Object.keys(byBrand).sort(function (a, b) { return byBrand[b] - byBrand[a]; }).slice(0, 10);
      var maxBrand = brands.length ? byBrand[brands[0]] : 1;
      C.$('dashBrand').innerHTML = brands.map(function (b) { return '<tr data-brand="' + esc(b) + '" style="cursor:pointer"><td>' + esc(b) + '</td><td>' + byBrand[b] + '</td><td style="width:50%"><div class="bar"><span style="width:' + Math.round(byBrand[b] / maxBrand * 100) + '%"></span></div></td></tr>'; }).join('') || '<tr><td class="empty">אין נתונים</td></tr>';
      C.$('dashBrand').querySelectorAll('[data-brand]').forEach(function (tr) { tr.addEventListener('click', function () { var b = tr.dataset.brand; leadsPopup('מותג: ' + b, leads.filter(function (l) { return (l.brand || 'לא ידוע') === b; })); }); });
    } else if (k === 'agent') {
      var byAgent = {}; leads.forEach(function (l) { var n = prof[l.assigned_to] || 'לא שויך'; byAgent[n] = byAgent[n] || { t: 0, w: 0 }; byAgent[n].t++; if (l.status === 'won') byAgent[n].w++; });
      var agents = Object.keys(byAgent).sort(function (a, b) { return byAgent[b].t - byAgent[a].t; });
      C.$('dashAgent').innerHTML = agents.map(function (n) { return '<tr data-agent="' + esc(n) + '" style="cursor:pointer"><td>' + esc(n) + '</td><td>' + byAgent[n].t + '</td><td>' + byAgent[n].w + '</td></tr>'; }).join('') || '<tr><td class="empty">אין נתונים</td></tr>';
      C.$('dashAgent').querySelectorAll('[data-agent]').forEach(function (tr) { tr.addEventListener('click', function () { var n = tr.dataset.agent; leadsPopup('סוכן: ' + n, leads.filter(function (l) { return (prof[l.assigned_to] || 'לא שויך') === n; })); }); });
    } else if (k === 'source') {
      var bySource = {}; leads.forEach(function (l) { var s = l.source || 'לא ידוע'; bySource[s] = (bySource[s] || 0) + 1; });
      var topSrc = Object.keys(bySource).sort(function (a, b) { return bySource[b] - bySource[a]; }).slice(0, 8);
      var maxSrc = topSrc.length ? bySource[topSrc[0]] : 1;
      C.$('dashSource').innerHTML = topSrc.map(function (s) { return '<tr data-source="' + esc(s) + '" style="cursor:pointer"><td>' + esc(s) + '</td><td>' + bySource[s] + '</td><td style="width:55%"><div class="bar"><span style="width:' + Math.round(bySource[s] / maxSrc * 100) + '%"></span></div></td></tr>'; }).join('') || '<tr><td class="empty">אין נתונים</td></tr>';
      C.$('dashSource').querySelectorAll('[data-source]').forEach(function (tr) { tr.addEventListener('click', function () { var s = tr.dataset.source; leadsPopup('מקור: ' + s, leads.filter(function (l) { return (l.source || 'לא ידוע') === s; })); }); });
    }
  }
  function svgBars(days) {
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.v; }))), W = 100 / days.length;
    var bars = days.map(function (d, i) { var h = d.v / max * 92; return '<rect x="' + (i * W + W * 0.15) + '" y="' + (100 - h) + '" width="' + (W * 0.7) + '" height="' + h + '" rx="1.5" fill="var(--brand)"><title>' + esc(d.d) + ': ' + d.v + '</title></rect>'; }).join('');
    // below each bar: the count itself (bold) + date (LTR, evenly spaced) — outside the stretched SVG so they don't distort
    var labs = days.map(function (d, i) { return '<div style="flex:1;min-width:0;text-align:center;white-space:nowrap"><div style="font-size:11.5px;font-weight:700;color:var(--brand);line-height:1.2">' + (d.v > 0 ? d.v : '') + '</div><div style="font-size:10px;color:var(--muted)">' + (i % 2 === 0 ? esc(d.d.slice(5)) : '') + '</div></div>'; }).join('');
    return '<div><svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:160px;display:block">' + bars + '</svg><div style="display:flex;direction:ltr;margin-top:6px">' + labs + '</div></div>';
  }

  // expose the status model for admin.js (bell, reports)
  window.C2B_STATUSES = STATUSES;
  window.C2B_badge = badge;
  window.C2B_stageDef = stageDef;
})();
