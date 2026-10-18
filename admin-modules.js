/* ============================================================
   פרי דרייב CRM — modules that used to be "coming soon":
   Quotes · Documents & contracts · WhatsApp / Email / SMS ·
   Automations · Branches. All wired to the live Supabase data.
   Exposes window.C2B_render{Quotes,Documents,Comms,Automations,Branches}.
   ============================================================ */
(function () {
  var C = window.C2B; if (!C) return;
  var db = C.db, esc = C.esc, nis = C.nis, fmt = C.fmt, view = C.view;
  var $ = C.$;
  function money(v) { return (v == null || v === '') ? '—' : nis(v); }
  function when(v) { return v ? fmt(v) : '—'; }
  function logAct(leadId, type, body) { if (!leadId) return; db.from('activities').insert({ lead_id: leadId, type: type, body: body || null, created_by: C.userId || null }).then(function () { C.refreshBadges && C.refreshBadges(); }).catch(function () {}); }
  function intlPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (!d) return ''; if (d.indexOf('972') === 0) return d; if (d[0] === '0') return '972' + d.slice(1); return d; }
  function fill(tpl, lead) { return String(tpl || '').replace(/\{name\}/g, lead.name || '').replace(/\{car\}/g, lead.car || '').replace(/\{firstname\}/g, (lead.name || '').split(' ')[0]); }
  function openLead(id) { if (window.C2B_openLeadCard) window.C2B_openLeadCard(id); }

  /* ============================ הצעות מחיר ============================ */
  window.C2B_renderQuotes = function (statusFilter) {
    var isAdmin = (C.role === 'admin');
    view('<div class="loading">טוען הצעות מחיר…</div>');
    db.from('deals').select('id,order_no,lead_id,client_name,brand,car_make,car_model,total,monthly,down_total,status,created_at').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return view('<div class="card"><h3>הצעות מחיר</h3><p class="muted">שגיאה בטעינה: ' + esc(r.error.message) + '</p></div>');
      var rows = r.data || [];
      var STAT = { quote: ['הצעת מחיר', '#8b6f2e'], ordered: ['הזמנה', '#1f8a4c'], cancelled: ['בוטל', '#c0392b'] };
      var filtered = statusFilter ? rows.filter(function (d) { return (d.status || 'quote') === statusFilter; }) : rows;
      var sum = filtered.reduce(function (a, d) { return a + (+d.total || 0); }, 0);
      function chip(k, label) { return '<button class="btn btn-ghost btn-sm qf' + ((statusFilter || '') === k ? ' active' : '') + '" data-qf="' + k + '">' + label + '</button>'; }
      var body = filtered.length ? filtered.map(function (d) {
        var st = STAT[d.status || 'quote'] || ['—', '#888'];
        return '<tr data-lead="' + esc(d.lead_id) + '" style="cursor:pointer">' +
          '<td><b>#' + esc(d.order_no || '—') + '</b></td>' +
          '<td>' + esc(d.client_name || '—') + '</td>' +
          '<td>' + esc(((d.car_make || d.brand || '') + ' ' + (d.car_model || '')).trim() || '—') + '</td>' +
          '<td>' + money(d.total) + '</td>' +
          '<td>' + money(d.monthly) + ' / חודש</td>' +
          '<td onclick="event.stopPropagation()"><select class="inp" data-qstatus="' + esc(d.id) + '" style="padding:5px 8px;font-size:12.5px;width:auto;font-weight:700;color:' + st[1] + '">' + ['quote', 'ordered', 'cancelled'].map(function (k) { return '<option value="' + k + '"' + ((d.status || 'quote') === k ? ' selected' : '') + '>' + STAT[k][0] + '</option>'; }).join('') + '</select></td>' +
          '<td>' + when(d.created_at) + '</td>' +
          // מחיקת הצעה = מחיקת עסקה. פעולת ניהול, לא פעולה תפעולית.
          (isAdmin ? '<td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" data-qdel="' + esc(d.id) +
                     '" data-qno="' + esc(d.order_no || '') + '" style="color:var(--danger)">🗑️</button></td>' : '') +
          '</tr>';
      }).join('') : '<tr><td colspan="' + (isAdmin ? 8 : 7) + '" class="empty">אין הצעות מחיר עדיין. צרו הצעה מתוך כרטיס ליד → "עסקה".</td></tr>';
      view('<div class="row-between" style="align-items:center;margin-bottom:12px"><h2 style="margin:0">📄 הצעות מחיר <span class="muted" style="font-size:14px">(' + filtered.length + ')</span></h2>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + chip('', 'הכל') + chip('quote', 'הצעות') + chip('ordered', 'הזמנות') + chip('cancelled', 'בוטלו') + '<button class="btn btn-sm" id="qExport">⬇ ייצוא CSV</button></div></div>' +
        '<div class="card" style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px"><div><div class="muted" style="font-size:12px">סה"כ הצעות</div><b style="font-size:20px">' + filtered.length + '</b></div>' +
        '<div><div class="muted" style="font-size:12px">שווי מצטבר</div><b style="font-size:20px">' + money(sum) + '</b></div></div>' +
        '<div class="card"><div class="table-scroll"><table><thead><tr><th>מס\' הזמנה</th><th>לקוח</th><th>רכב</th><th>סכום</th><th>החזר חודשי</th><th>סטטוס</th><th>תאריך</th></tr></thead><tbody>' + body + '</tbody></table></div></div>');
      $('view').querySelectorAll('tr[data-lead]').forEach(function (tr) { tr.addEventListener('click', function () { openLead(tr.dataset.lead); }); });
      $('view').querySelectorAll('[data-qf]').forEach(function (b) { b.addEventListener('click', function () { window.C2B_renderQuotes(b.dataset.qf || null); }); });
      // change a quote's status inline → also syncs the sales lead status
      $('view').querySelectorAll('[data-qstatus]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var id = sel.dataset.qstatus, st = sel.value;
          //  status ו-stage הם שני מימדים נפרדים, אבל ביטול והזמנה הם מצב סופי
          //  שחייב להשתקף גם בפייפליין: בלי זה עסקה מבוטלת נשארה תלויה
          //  ב"ממתין לחתימה" אצל מנהלת תיקי הלקוחות.
          var patch = { status: st };
          if (st === 'cancelled') patch.stage = 'cancelled';
          else if (st === 'ordered') patch.stage = 'ordered';
          db.from('deals').update(patch).eq('id', id).then(function (rr) {
            if (rr.error) return alert('שגיאה: ' + rr.error.message);
            var d = rows.filter(function (x) { return String(x.id) === String(id); })[0];
            if (d && d.lead_id) { var ns = st === 'ordered' ? 'won' : (st === 'cancelled' ? 'lost' : 'quote_sent'); db.from('leads').update({ status: ns }).eq('id', d.lead_id).then(function () {}, function () {}); }
            window.C2B_renderQuotes(statusFilter);
          });
        });
      });
      $('view').querySelectorAll('[data-qdel]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('להעביר את הצעה #' + (b.dataset.qno || '') + ' לסל המיחזור?\n\nההסכם והמסמכים נשמרים. אפשר לשחזר ממסך הסל.')) return;
          b.disabled = true;
          db.rpc('trash_deal', { p_deal: b.dataset.qdel }).then(function (r) {
            b.disabled = false;
            if (r.error || (r.data && r.data.ok === false)) return alert('שגיאה: ' + (r.error ? r.error.message : r.data.error));
            window.C2B_renderQuotes(statusFilter);
          });
        });
      });
      if ($('qExport')) $('qExport').addEventListener('click', function () { C.exportCsv(filtered, ['order_no', 'client_name', 'car_make', 'car_model', 'total', 'monthly', 'status', 'created_at'], 'הצעות-מחיר'); });
    });
  };

  /* ======================= מסמכים והסכמים ======================= */
  window.C2B_renderDocuments = function () {
    var isAdmin = (C.role === 'admin');
    view('<div class="loading">טוען מסמכים…</div>');
    Promise.all([
      db.from('deals').select('id,order_no,lead_id,client_name,brand,signed_at,created_at').not('signature', 'is', null).order('signed_at', { ascending: false }),
      db.from('lead_documents').select('id,lead_id,name,storage_path,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(300)
    ]).then(function (res) {
      var contracts = (res[0] && res[0].data) || [], docs = (res[1] && res[1].data) || [];
      var cRows = contracts.length ? contracts.map(function (d) {
        return '<tr data-lead="' + esc(d.lead_id) + '" style="cursor:pointer"><td>✍️ הסכם חתום</td><td><b>#' + esc(d.order_no || '—') + '</b> · ' + esc(d.client_name || '') + (d.brand ? ' · ' + esc(d.brand) : '') + '</td><td><span class="tag" style="color:#1f8a4c;border-color:#1f8a4c">נחתם</span></td><td>' + when(d.signed_at || d.created_at) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="empty">אין עדיין הסכמים חתומים.</td></tr>';
      var dRows = docs.length ? docs.map(function (o) {
        return '<tr><td>📎 ' + esc(o.name || 'מסמך') + '</td><td>' + when(o.created_at) + '</td><td><button class="btn btn-ghost btn-sm" data-doc="' + esc(o.storage_path || '') + '" data-docname="' + esc(o.name || '') + '">👁️ פתח</button> <button class="btn btn-ghost btn-sm" data-lead="' + esc(o.lead_id) + '">לכרטיס הליד</button>' +
          (isAdmin ? ' <button class="btn btn-ghost btn-sm" data-ddel="' + esc(o.id) + '" data-dname="' + esc(o.name || '') + '" style="color:var(--danger)">🗑️</button>' : '') +
          '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="empty">אין מסמכים שהועלו. אפשר להעלות מכרטיס ליד → "מסמכים".</td></tr>';
      view('<h2 style="margin:0 0 12px">✍️ מסמכים והסכמים</h2>' +
        '<div class="card"><h3>הסכמים חתומים (' + contracts.length + ')</h3><div class="table-scroll"><table><thead><tr><th>סוג</th><th>פרטים</th><th>סטטוס</th><th>תאריך</th></tr></thead><tbody>' + cRows + '</tbody></table></div></div>' +
        '<div class="card"><h3>מסמכי לקוחות שהועלו (' + docs.length + ')</h3><p class="muted" style="font-size:12px;margin:-4px 0 10px">ת"ז · תלושים · דפי בנק · כל קובץ שהועלה לתיקי הלקוחות.</p><div class="table-scroll"><table><thead><tr><th>מסמך</th><th>תאריך</th><th>פעולות</th></tr></thead><tbody>' + dRows + '</tbody></table></div></div>');
      $('view').querySelectorAll('tr[data-lead]').forEach(function (tr) { tr.addEventListener('click', function (e) { if (e.target.closest('[data-doc]')) return; openLead(tr.dataset.lead); }); });
      $('view').querySelectorAll('[data-lead]').forEach(function (b) { if (b.tagName === 'BUTTON') b.addEventListener('click', function (e) { e.stopPropagation(); openLead(b.dataset.lead); }); });
      $('view').querySelectorAll('[data-ddel]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('להעביר את "' + (b.dataset.dname || 'המסמך') + '" לסל המיחזור? אפשר לשחזר ממסך הסל.')) return;
          b.disabled = true;
          db.rpc('trash_document', { p_doc: b.dataset.ddel }).then(function (r) {
            b.disabled = false;
            if (r.error || (r.data && r.data.ok === false)) return alert('שגיאה: ' + (r.error ? r.error.message : r.data.error));
            window.C2B_renderDocuments();
          });
        });
      });
      $('view').querySelectorAll('[data-doc]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var path = b.dataset.doc; if (!path) return; window.C2B.viewDoc(path, b.dataset.docname); }); });
    });
  };

  /* =================== WhatsApp / Email / SMS =================== */
  var COMMS = {
    whatsapp: { icon: '💬', title: 'WhatsApp', tpls: [
      ['פנייה ראשונה', 'היי {firstname}, כאן צוות פרי דרייב 🚗 קיבלנו את פנייתך לגבי {car}. מתי נוח לך לשוחח על הצעת מימון אישית?'],
      ['מעקב', 'היי {firstname}, רק מוודאים שקיבלת את ההצעה. יש שאלות? נשמח לעזור למצוא לך את ההחזר החודשי הכי משתלם.'],
      ['תזכורת פגישה', 'היי {firstname}, תזכורת לפגישה שלנו. מחכים לך! צוות פרי דרייב.'],
      ['הצעה נשלחה', 'היי {firstname}, שלחנו לך הצעת מחיר ל{car}. מוזמן/ת לעבור עליה ולחזור אלינו — ההצעה בתוקף מוגבל.']
    ]},
    emails: { icon: '📧', title: 'מיילים', tpls: [
      ['פנייה ראשונה', 'שלום {name},\n\nתודה על פנייתך ל-פרי דרייב בנוגע ל{car}. נשמח לבנות עבורך מסלול מימון אישי עם ההחזר החודשי הטוב ביותר.\n\nמתי נוח לשוחח?\n\nבברכה,\nצוות פרי דרייב'],
      ['הצעת מחיר', 'שלום {name},\n\nמצורפת הצעת המחיר עבור {car}. ההצעה כוללת מימון עד 100% ואפשרות טרייד-אין לרכב הישן.\n\nלכל שאלה אנחנו כאן.\n\nבברכה,\nצוות פרי דרייב'],
      ['מעקב', 'שלום {name},\n\nרצינו לוודא שקיבלת את ההצעה שלנו ולראות אם יש שאלות. נשמח להתקדם יחד.\n\nבברכה,\nצוות פרי דרייב']
    ]},
    sms: { icon: '📱', title: 'SMS', tpls: [
      ['פנייה ראשונה', 'פרי דרייב: היי {firstname}, קיבלנו את פנייתך. מתי נוח לשוחח על הצעת מימון? להסרה השב הסר'],
      ['תזכורת', 'פרי דרייב: תזכורת לפגישה שלנו. מחכים לך!'],
      ['הצעה', 'פרי דרייב: שלחנו לך הצעה ל{car}. נשמח לחזור אליך — צוות פרי דרייב']
    ]}
  };
  window.C2B_renderComms = function (channel) {
    var cfg = COMMS[channel]; if (!cfg) return;
    view('<div class="loading">טוען…</div>');
    db.from('leads').select('id,name,phone,email,car,status,created_at').order('created_at', { ascending: false }).limit(200).then(function (r) {
      var leads = (r.data || []).filter(function (l) { return channel === 'emails' ? l.email : l.phone; });
      var tplOpts = cfg.tpls.map(function (t, i) { return '<option value="' + i + '">' + esc(t[0]) + '</option>'; }).join('');
      var leadOpts = leads.map(function (l) { return '<tr data-lid="' + esc(l.id) + '"><td><b>' + esc(l.name || '—') + '</b></td><td>' + esc(channel === 'emails' ? (l.email || '') : (l.phone || '')) + '</td><td>' + esc(l.car || '—') + '</td><td><button class="btn btn-sm" data-send="' + esc(l.id) + '">' + cfg.icon + ' שלח</button></td></tr>'; }).join('') || '<tr><td colspan="4" class="empty">אין לידים עם ' + (channel === 'emails' ? 'אימייל' : 'טלפון') + '.</td></tr>';
      view('<h2 style="margin:0 0 4px">' + cfg.icon + ' ' + cfg.title + '</h2>' +
        '<p class="muted" style="font-size:12.5px;margin:0 0 14px">בחרו תבנית, ערכו את ההודעה (משתנים: <code>{name}</code> <code>{firstname}</code> <code>{car}</code>) ושלחו לליד. ' + (channel === 'emails' ? 'המייל <b>נשלח ישירות מהמערכת</b> (דרך Resend) ומתועד בציר הזמן.' : 'השליחה נפתחת ב' + (channel === 'whatsapp' ? 'WhatsApp' : 'הודעות') + ' עם ההודעה מוכנה, ומתועדת בציר הזמן.') + '</p>' +
        '<div class="card"><div class="row-between" style="gap:10px;flex-wrap:wrap;align-items:end"><div class="field" style="flex:0 0 220px;margin:0"><label>תבנית</label><select class="inp" id="cmTpl" style="width:100%"><option value="">— חדש —</option>' + tplOpts + '</select></div></div>' +
        '<div class="field" style="margin:10px 0 0"><label>תוכן ההודעה</label><textarea class="inp" id="cmMsg" rows="' + (channel === 'emails' ? 7 : 4) + '" style="width:100%" placeholder="הקלד/י הודעה…">' + esc(cfg.tpls[0][1]) + '</textarea></div>' +
        (channel === 'emails' ? '<div class="field" style="margin:10px 0 0"><label>נושא</label><input class="inp" id="cmSubj" style="width:100%" value="הצעה אישית מ-פרי דרייב"></div>' : '') + '</div>' +
        '<div class="card"><h3>לידים (' + leads.length + ')</h3><input class="inp" id="cmSearch" placeholder="חיפוש לפי שם/טלפון…" style="width:100%;margin-bottom:10px"><div class="table-scroll"><table><thead><tr><th>שם</th><th>' + (channel === 'emails' ? 'אימייל' : 'טלפון') + '</th><th>רכב</th><th></th></tr></thead><tbody id="cmRows">' + leadOpts + '</tbody></table></div></div>');
      var tplSel = $('cmTpl'), msg = $('cmMsg');
      if (tplSel) tplSel.addEventListener('change', function () { if (this.value !== '') msg.value = cfg.tpls[+this.value][1]; });
      var search = $('cmSearch');
      if (search) search.addEventListener('input', function () { var q = this.value.trim().toLowerCase(); $('view').querySelectorAll('#cmRows tr[data-lid]').forEach(function (tr) { tr.style.display = (!q || tr.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none'; }); });
      $('view').querySelectorAll('[data-send]').forEach(function (b) {
        b.addEventListener('click', function () {
          var l = leads.filter(function (x) { return String(x.id) === b.dataset.send; })[0]; if (!l) return;
          var text = fill(msg.value, l);
          if (channel === 'emails') {
            // real send from the system via the send-message Edge Function (Resend)
            b.textContent = 'שולח…'; b.disabled = true;
            db.functions.invoke('send-message', { body: { channel: 'email', to: l.email, subject: ($('cmSubj') && $('cmSubj').value) || 'הצעה אישית מ-פרי דרייב', text: text, fromName: (l.marketing_company || l.brand || 'פרי דרייב') } }).then(function (r) {
              var d = r.data || {};
              if (r.error || d.error) {
                b.textContent = cfg.icon + ' שלח'; b.disabled = false;
                alert('שליחת המייל נכשלה: ' + ((d.error) || (r.error && r.error.message) || 'שגיאה') + '\n\nוודאו שהפונקציה "send-message" פרוסה ב-Supabase ושה-Secret "RESEND_API_KEY" מוגדר.');
                return;
              }
              logAct(l.id, 'email', 'נשלח מייל ללקוח: ' + text.slice(0, 80));
              b.textContent = '✓ נשלח'; setTimeout(function () { b.textContent = cfg.icon + ' שלח'; b.disabled = false; }, 3000);
            }, function (e) { b.textContent = cfg.icon + ' שלח'; b.disabled = false; alert('שגיאת רשת: ' + (e && e.message || e)); });
            return;
          }
          // whatsapp / sms — open the app with the message ready
          var url;
          if (channel === 'whatsapp') { url = 'https://wa.me/' + intlPhone(l.phone) + '?text=' + encodeURIComponent(text); window.open(url, '_blank', 'noopener'); }
          else { url = 'sms:' + (l.phone || '') + '?body=' + encodeURIComponent(text); window.location.href = url; }
          logAct(l.id, channel === 'sms' ? 'sms' : 'whatsapp', 'נשלחה הודעת ' + cfg.title + ': ' + text.slice(0, 80));
          b.textContent = '✓ נשלח'; b.disabled = true; setTimeout(function () { b.textContent = cfg.icon + ' שלח'; b.disabled = false; }, 2500);
        });
      });
    });
  };

  /* ============================ אוטומציות ============================ */
  window.C2B_renderAutomations = function () {
    view('<div class="loading">טוען אוטומציות…</div>');
    var STAT = (window.C2B_STATUSES || []).map(function (s) { return [s.k, s.label]; });
    var ACTIONS = [['task', 'פתח משימת מעקב'], ['note', 'רשום הערה בציר הזמן'], ['whatsapp', 'פתח משימת "שלח WhatsApp"'], ['email', '📧 שלח מייל ללקוח (אוטומטי)'], ['whatsapp_send', '📱 שלח WhatsApp ללקוח (אוטומטי)']];
    // recommended starter pack — customer emails only (one-click load, deduped by name).
    // NOTE: the "new lead welcome" email is sent by a Database Webhook (on lead INSERT),
    // so it fires for public-form leads too — not only when a lead is touched in the CRM.
    var PACK = [
      { name: 'הצעה נשלחה — מייל מעקב ללקוח', trigger_status: 'quote_sent', action: 'email', params: { subject: 'ההצעה שלך מ-פרי דרייב מחכה לך', text: 'שלום {name},\nשלחנו לך הצעת מחיר ל{car}. ההצעה כוללת מימון עד 100% ואפשרות טרייד-אין.\nיש שאלות? אנחנו כאן. ההצעה בתוקף מוגבל — נשמח להתקדם יחד.\n\nצוות פרי דרייב' } },
      { name: 'נחתם! — מייל ברכות ושלבים הבאים', trigger_status: 'won', action: 'email', params: { subject: 'ברכות! העסקה שלך נסגרה 🎉 — פרי דרייב', text: 'שלום {name}, ברכות! 🎉\nהעסקה על {car} נסגרה. הנה השלבים הבאים:\n1. נתאם איתך מסירה בהקדם.\n2. נסגור את הביטוח והרישוי — הכל עלינו.\n3. תקבל את המפתח לרכב החדש!\n\nתודה שבחרת ב-פרי דרייב — אנחנו כאן לכל שאלה.\nצוות פרי דרייב' } }
    ];
    db.from('automations').select('*').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) {
        return view('<h2 style="margin:0 0 12px">🤖 אוטומציות</h2><div class="card"><h3>נדרשת הקמה חד-פעמית</h3><p class="muted">כדי לשמור ולהריץ אוטומציות, צרו את הטבלה ב-Supabase (SQL Editor):</p>' +
          '<pre style="background:var(--surface-2);padding:12px;border-radius:8px;overflow:auto;font-size:12px">create table if not exists public.automations (\n  id uuid primary key default gen_random_uuid(),\n  name text, trigger_status text, action text, params jsonb,\n  active boolean default true, created_at timestamptz default now()\n);\nalter table public.automations enable row level security;\ncreate policy automations_auth on public.automations for all to authenticated using (true) with check (true);</pre>' +
          '<p class="muted" style="font-size:12px">לאחר יצירת הטבלה, רעננו את העמוד. הרצה בפועל (שליחה אוטומטית) דורשת חיבור ל-Edge Function — נשמח להנחות.</p></div>');
      }
      var rules = r.data || [];
      var list = rules.length ? rules.map(function (a) {
        var st = (STAT.filter(function (s) { return s[0] === a.trigger_status; })[0] || [a.trigger_status, a.trigger_status])[1];
        var ac = (ACTIONS.filter(function (x) { return x[0] === a.action; })[0] || [a.action, a.action])[1];
        var pd = a.params || {};
        var detail = (pd.text ? ' <span class="muted">("' + esc(pd.text) + '")</span>' : '') + (a.action === 'task' && pd.days != null ? ' <span class="muted">· בעוד ' + esc(pd.days) + ' ימים</span>' : '');
        return '<tr><td><b>' + esc(a.name || 'חוק') + '</b></td><td>כשסטטוס → <b>' + esc(st) + '</b></td><td>' + esc(ac) + detail + '</td><td><label class="switch-sm"><input type="checkbox" data-toggle="' + a.id + '"' + (a.active ? ' checked' : '') + '> ' + (a.active ? 'פעיל' : 'כבוי') + '</label></td><td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-edit="' + a.id + '">✏️ ערוך</button> <button class="btn btn-ghost btn-sm" data-del="' + a.id + '">🗑️</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="empty">אין עדיין חוקים. הוסיפו חוק ראשון למטה.</td></tr>';
      view('<div class="row-between" style="align-items:center;margin-bottom:12px"><h2 style="margin:0">🤖 אוטומציות</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="auEmailOnly">🧹 השאר רק מיילים</button><button class="btn btn-sm" id="auPack">✨ טען חבילת מיילים מומלצת</button></div></div>' +
        '<div class="card"><h3>חוק חדש</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
          '<div class="field" style="margin:0;flex:1;min-width:150px"><label>שם החוק</label><input class="inp" id="auName" placeholder="למשל: מעקב אחרי הצעה"></div>' +
          '<div class="field" style="margin:0"><label>כאשר הסטטוס הופך ל…</label><select class="inp" id="auTrig">' + STAT.map(function (s) { return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field" style="margin:0"><label>בצע פעולה</label><select class="inp" id="auAct">' + ACTIONS.map(function (a) { return '<option value="' + a[0] + '">' + esc(a[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field" style="margin:0;flex:1;min-width:170px"><label>טקסט מותאם (אופציונלי)</label><input class="inp" id="auText" placeholder="כותרת המשימה / תוכן ההערה"></div>' +
          '<div class="field" style="margin:0;width:120px"><label>בעוד (ימים)</label><input class="inp" id="auDays" type="number" min="0" value="1"></div>' +
          '<button class="btn" id="auAdd">➕ הוסף חוק</button></div></div>' +
        '<div class="card"><h3>חוקים פעילים (' + rules.length + ')</h3><div class="table-scroll"><table><thead><tr><th>שם</th><th>תנאי</th><th>פעולה</th><th>מצב</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>' +
        '<p class="muted" style="font-size:12px;margin-top:10px">✅ <b>המנוע רץ בשרת.</b> החוקים נורים בכל מסלול שבו סטטוס משתנה — שינוי ידני, עדכון מרוכז, חתימת לקוח, ליד שנקלט מפייסבוק או מהאתר. כל חוק רץ פעם אחת בלבד לכל ליד בכל סטטוס. לשליחת WhatsApp החוק פותח משימה ידנית (השליחה בפועל דרך Heyy).</p>' +
        '<div class="row-between" style="margin-top:14px"><h3 style="margin:0">הרצות אחרונות</h3><button class="btn btn-ghost btn-sm" id="auRefreshRuns">↻ רענן</button></div>' +
        '<div id="auRuns" class="muted" style="font-size:12.5px;margin-top:8px">טוען…</div></div>');
      var editState = null;
      $('auAdd').addEventListener('click', function () {
        var name = $('auName').value.trim(); if (!name) { $('auName').focus(); return; }
        var action = $('auAct').value;
        var params = { text: ($('auText').value || '').trim() || null, days: (+$('auDays').value || 1) };
        if (editState && editState.params && editState.params.subject && action === 'email') params.subject = editState.params.subject;
        var payload = { name: name, trigger_status: $('auTrig').value, action: action, params: params };
        var q = editState ? db.from('automations').update(payload).eq('id', editState.id) : db.from('automations').insert(Object.assign({ active: true }, payload));
        q.then(function (u) { if (u.error) return alert('שגיאה: ' + u.error.message); window.C2B_renderAutomations(); });
      });
      $('view').querySelectorAll('[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = rules.filter(function (x) { return String(x.id) === b.dataset.edit; })[0]; if (!a) return;
          editState = a;
          $('auName').value = a.name || '';
          $('auTrig').value = a.trigger_status || '';
          $('auAct').value = a.action || 'task';
          $('auText').value = (a.params && a.params.text) || '';
          $('auDays').value = (a.params && a.params.days != null) ? a.params.days : 1;
          $('auAdd').textContent = '✔️ עדכן חוק';
          if ($('auName').scrollIntoView) $('auName').scrollIntoView({ behavior: 'smooth', block: 'center' });
          $('auName').focus();
        });
      });
      $('auPack').addEventListener('click', function () {
        var have = {}; rules.forEach(function (x) { have[x.name] = 1; });
        var add = PACK.filter(function (p) { return !have[p.name]; }).map(function (p) { return { name: p.name, trigger_status: p.trigger_status, action: p.action, params: p.params, active: true }; });
        if (!add.length) { alert('כל אוטומציות המייל המומלצות כבר קיימות ✓'); return; }
        db.from('automations').insert(add).then(function (u) { if (u.error) return alert('שגיאה: ' + u.error.message); window.C2B_renderAutomations(); });
      });
      $('auEmailOnly').addEventListener('click', function () {
        var kill = rules.filter(function (x) { return x.action !== 'email' && x.action !== 'whatsapp_send'; }).map(function (x) { return x.id; });
        if (!kill.length) { alert('כבר יש רק אוטומציות שליחה ✓'); return; }
        if (!confirm('למחוק ' + kill.length + ' חוקים שאינם שליחת מייל/וואטסאפ ללקוח? (חוקי המשימות/הערות)')) return;
        db.from('automations').delete().in('id', kill).then(function (u) { if (u.error) return alert('שגיאה: ' + u.error.message); window.C2B_renderAutomations(); });
      });
      $('view').querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { db.from('automations').delete().eq('id', b.dataset.del).then(function () { window.C2B_renderAutomations(); }); }); });
      $('view').querySelectorAll('[data-toggle]').forEach(function (cb) { cb.addEventListener('change', function () { db.from('automations').update({ active: cb.checked }).eq('id', cb.dataset.toggle).then(function () { window.C2B_renderAutomations(); }); }); });
      // ניטור: כל הרצה נרשמת, כולל כישלונות — אין כישלון שקט
      function loadRuns() {
        var box = $('auRuns'); if (!box) return;
        db.from('automation_runs').select('at,rule_name,action,ok,detail,lead_id')
          .order('at', { ascending: false }).limit(40).then(function (r) {
            if (!$('auRuns')) return;
            if (r.error) { $('auRuns').textContent = 'לא ניתן לטעון הרצות: ' + r.error.message; return; }
            var rows = r.data || [];
            if (!rows.length) { $('auRuns').innerHTML = '<p class="empty" style="margin:0">עוד לא רצו אוטומציות</p>'; return; }
            $('auRuns').innerHTML = '<div class="table-scroll"><table><thead><tr><th>מתי</th><th>חוק</th><th>תוצאה</th><th>פרטים</th></tr></thead><tbody>' +
              rows.map(function (x) {
                return '<tr><td style="white-space:nowrap">' + C.fmt(x.at) + '</td><td>' + esc(x.rule_name || '—') + '</td>' +
                  '<td style="white-space:nowrap;color:' + (x.ok ? 'var(--ok)' : 'var(--danger)') + '">' + (x.ok ? '✔ בוצע' : '✖ לא בוצע') + '</td>' +
                  '<td>' + esc(x.detail || '') + '</td></tr>';
              }).join('') + '</tbody></table></div>';
          });
      }
      loadRuns();
      if ($('auRefreshRuns')) $('auRefreshRuns').addEventListener('click', loadRuns);
    });
  };

  /* ============================== סניפים ============================== */
  window.C2B_renderBranches = function () {
    view('<div class="loading">טוען סניפים…</div>');
    db.from('field_options').select('*').eq('field', 'branch').order('value', { ascending: true }).then(function (r) {
      var rows = (r.data || []);
      var list = rows.length ? rows.map(function (o) { return '<tr><td>🏢 <b>' + esc(o.value) + '</b></td><td><button class="btn btn-ghost btn-sm" data-del="' + o.id + '">🗑️ מחק</button></td></tr>'; }).join('') : '<tr><td colspan="2" class="empty">אין סניפים עדיין. הוסיפו סניף ראשון.</td></tr>';
      view('<h2 style="margin:0 0 12px">🏢 סניפים</h2>' +
        '<div class="card"><h3>הוספת סניף</h3><div style="display:flex;gap:10px;flex-wrap:wrap"><input class="inp" id="brName" placeholder="שם / כתובת הסניף" style="flex:1;min-width:200px"><button class="btn" id="brAdd">➕ הוסף</button></div>' +
        '<p class="muted" style="font-size:12px;margin-top:8px">הסניפים מופיעים אוטומטית כאפשרויות בתיאום פגישה ובשיוך לידים.</p></div>' +
        '<div class="card"><h3>סניפים (' + rows.length + ')</h3><div class="table-scroll"><table><tbody>' + list + '</tbody></table></div></div>');
      $('brAdd').addEventListener('click', function () {
        var v = $('brName').value.trim(); if (!v) { $('brName').focus(); return; }
        db.from('field_options').insert({ field: 'branch', value: v }).then(function (u) { if (u.error) return alert('שגיאה: ' + u.error.message); window.C2B_renderBranches(); });
      });
      $('view').querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { db.from('field_options').delete().eq('id', b.dataset.del).then(function () { window.C2B_renderBranches(); }); }); });
    });
  };

  /* ============================ מלאי יד2 ============================
     yad2-Global הוא מקור-האמת היחיד. מסך הניהול (C2B_renderInventory) רק
     בפרויקט yad2; מסך הקריאה (C2B_renderYad2Stock) בשאר המותגים — קורא חי
     מ-yad2 (published+available), כך שמכירה/הוספה מתעדכנת מיד בכולם. */
  var INV_ST = { intake: ['קליטה', '#8b6f2e'], available: ['זמין', '#1f8a4c'], reserved: ['שמור', '#b8860b'], sold: ['נמכר', '#c0392b'], hidden: ['מוסתר', '#6b7280'] };
  //  תיאור קצר לכל סטטוס מלאי — למקרא ול-tooltip. כולם בשימוש (כל אחד מצב-ניהול שונה):
  var INV_DESC = {
    intake: 'נקלט למערכת, בהשלמת פרטים — לא מוצג באתר',
    available: 'מפורסם ומוצג באתרים — זמין למכירה',
    reserved: 'שמור ללקוח — זמנית לא זמין לאחרים',
    sold: 'נמכר — ירד מהאתר, לא מוצג לציבור',
    hidden: 'הוסתר ידנית — לא מוצג באתר (בלי למחוק)'
  };
  function invImgs(car) { try { return Array.isArray(car.images) ? car.images : JSON.parse(car.images || '[]'); } catch (e) { return []; } }
  function invCover(car) { var im = invImgs(car); return im.length ? im[Math.min(car.cover_idx || 0, im.length - 1)] : null; }
  function invTitle(car) { return [car.make, car.model, car.year].filter(Boolean).join(' ') || 'רכב ללא שם'; }
  function invBg(cov) { return "height:160px;background:#0b0f14;background-size:cover;background-position:center" + (cov ? ";background-image:url('" + esc(cov) + "')" : ""); }

  //  תצוגת-הוצאות מרוכזת — סה"כ הוצאות פר-רכב + פילוח לפי סוג. לחיצה על רכב פותחת אותו.
  window.C2B_renderInvExpenses = function () {
    view('<div class="loading">טוען הוצאות…</div>');
    Promise.all([
      db.from('inventory_expenses').select('*').order('spent_at', { ascending: false }),
      db.from('inventory').select('id,make,model,year,plate')
    ]).then(function (res) {
      var exps = (res[0] && res[0].data) || [], inv = (res[1] && res[1].data) || [];
      var carById = {}; inv.forEach(function (c) { carById[c.id] = c; });
      var byCar = {}, byKind = {}, grand = 0;
      exps.forEach(function (e) {
        var amt = +e.amount || 0; grand += amt;
        byCar[e.inventory_id] = byCar[e.inventory_id] || { total: 0, n: 0 }; byCar[e.inventory_id].total += amt; byCar[e.inventory_id].n++;
        byKind[e.kind || 'אחר'] = (byKind[e.kind || 'אחר'] || 0) + amt;
      });
      var carKeys = Object.keys(byCar).sort(function (a, b) { return byCar[b].total - byCar[a].total; });
      var kindKeys = Object.keys(byKind).sort(function (a, b) { return byKind[b] - byKind[a]; });
      function tlCard(lbl, v, col) { return '<div class="card" style="flex:1;min-width:150px;padding:12px 15px"><div class="muted" style="font-size:12px">' + lbl + '</div><div style="font-size:20px;font-weight:800' + (col ? ';color:' + col : '') + '">' + v + '</div></div>'; }
      var carRows = carKeys.map(function (id) {
        var c = carById[id] || {}, title = [c.make, c.model, c.year].filter(Boolean).join(' ') || 'רכב שנמחק';
        return '<tr' + (carById[id] ? ' data-expcar="' + id + '" style="cursor:pointer"' : '') + '><td style="padding:8px 12px;font-weight:600">' + esc(title) + '</td><td style="padding:8px 12px;color:var(--muted)">' + esc(c.plate || '') + '</td><td style="padding:8px 12px">' + byCar[id].n + '</td><td style="padding:8px 12px;font-weight:800;color:var(--danger)">' + money(byCar[id].total) + '</td></tr>';
      }).join('');
      var kindRows = kindKeys.map(function (k) { var pct = grand ? Math.round(byKind[k] / grand * 100) : 0; return '<tr><td style="padding:7px 12px">' + esc(k) + '</td><td style="padding:7px 12px;font-weight:700">' + money(byKind[k]) + '</td><td style="padding:7px 12px;color:var(--muted)">' + pct + '%</td></tr>'; }).join('');
      view('<h2 style="margin:0 0 4px">💸 הוצאות רכבים</h2><p class="muted" style="font-size:13px;margin-bottom:14px">ריכוז כל ההוצאות על רכבי המלאי — פר-רכב ולפי סוג.</p>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">' + tlCard('סה"כ הוצאות', money(grand), 'var(--danger)') + tlCard('רכבים עם הוצאות', carKeys.length) + tlCard('רשומות', exps.length) + '</div>' +
        '<div class="grid2">' +
          '<div class="card"><h3 style="margin:0 0 8px">לפי רכב</h3><div class="table-scroll"><table style="width:100%"><thead><tr style="color:var(--muted);font-size:12px;text-align:right"><th style="padding:6px 12px">רכב</th><th style="padding:6px 12px">לוחית</th><th style="padding:6px 12px">#</th><th style="padding:6px 12px">סה"כ</th></tr></thead><tbody>' + (carRows || '<tr><td colspan="4" class="empty">אין הוצאות</td></tr>') + '</tbody></table></div></div>' +
          '<div class="card"><h3 style="margin:0 0 8px">לפי סוג הוצאה</h3><div class="table-scroll"><table style="width:100%"><thead><tr style="color:var(--muted);font-size:12px;text-align:right"><th style="padding:6px 12px">סוג</th><th style="padding:6px 12px">סכום</th><th style="padding:6px 12px">%</th></tr></thead><tbody>' + (kindRows || '<tr><td colspan="3" class="empty">אין</td></tr>') + '</tbody></table></div></div>' +
        '</div>');
      $('view').querySelectorAll('[data-expcar]').forEach(function (tr) { tr.addEventListener('click', function () { db.from('inventory').select('*').eq('id', tr.dataset.expcar).single().then(function (r) { if (r.data) { window.C2B_renderInventory(); setTimeout(function () { openInvEdit(r.data); }, 120); } }); }); });
    }).catch(function (e) { view('<div class="card"><p class="muted">שגיאה: ' + esc(e.message || e) + '</p></div>'); });
  };
  window.C2B_renderInventory = function (statusFilter) {
    view('<div class="loading">טוען מלאי…</div>');
    db.from('inventory').select('*').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return view('<div class="card"><h3>מלאי יד2</h3><p class="muted">שגיאה: ' + esc(r.error.message) + '</p></div>');
      var rows = r.data || [], counts = {};
      rows.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
      function chip(k, label) { return '<button class="btn btn-ghost btn-sm' + ((statusFilter || '') === k ? ' active' : '') + '" data-if="' + k + '"' + (k && INV_DESC[k] ? ' title="' + esc(INV_DESC[k]) + '"' : '') + '>' + label + ' <span class="muted" style="font-size:11px">(' + (k ? (counts[k] || 0) : rows.length) + ')</span></button>'; }
      //  מקרא סטטוסים — כדי שיובן מה כל שלב (עיגול-צבע + תיאור קצר).
      var invLegend = '<div class="muted" style="font-size:11.5px;margin:-4px 0 12px;line-height:1.9;display:flex;gap:14px;flex-wrap:wrap">' +
        ['intake', 'available', 'reserved', 'sold', 'hidden'].map(function (k) { return '<span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + INV_ST[k][1] + ';margin-inline-end:5px"></span><b>' + esc(INV_ST[k][0]) + '</b> — ' + esc(INV_DESC[k]) + '</span>'; }).join('') + '</div>';
      var shown = statusFilter ? rows.filter(function (c) { return c.status === statusFilter; }) : rows;
      var cards = shown.map(function (c) {
        var cov = invCover(c), st = INV_ST[c.status] || ['—', '#888'];
        return '<div class="card" data-edit="' + c.id + '" style="cursor:pointer;padding:0;overflow:hidden">' +
          '<div style="' + invBg(cov) + ';position:relative">' + (cov ? '' : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#44505f;font-size:13px">אין תמונה</div>') +
            '<span style="position:absolute;top:8px;inset-inline-start:8px;background:' + st[1] + ';color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px">' + st[0] + '</span>' +
            (c.published ? '<span style="position:absolute;top:8px;inset-inline-end:8px;background:#111;color:#fff;font-size:11px;padding:2px 8px;border-radius:999px">● מפורסם</span>' : '') + '</div>' +
          '<div style="padding:11px 13px"><div style="font-weight:800;font-size:15px">' + esc(invTitle(c)) + '</div>' +
            '<div class="muted" style="font-size:12.5px;margin-top:2px">' + [c.hand ? 'יד ' + esc(c.hand) : '', c.km != null ? Number(c.km).toLocaleString('en-US') + ' ק"מ' : '', c.plate ? esc(c.plate) : ''].filter(Boolean).join(' · ') + '</div>' +
            '<div style="font-weight:800;margin-top:6px">' + (c.price != null ? money(c.price) : '<span class="muted" style="font-weight:400">ללא מחיר</span>') + '</div>' +
            (c.source === 'trade-in' ? '<div class="muted" style="font-size:11px;margin-top:4px">↩︎ טרייד-אין · ' + esc(c.source_org || '') + '</div>' : '') +
            //  שינוי סטטוס ישירות מהרשימה (בלי לפתוח את הרכב). onclick עוצר את פתיחת-הכרטיס.
            '<select class="inp" data-stsel="' + c.id + '" onclick="event.stopPropagation()" title="שינוי סטטוס מהיר" style="width:100%;margin-top:9px;font-size:12.5px;padding:5px 8px;cursor:pointer">' + ['intake', 'available', 'reserved', 'sold', 'hidden'].map(function (s) { return '<option value="' + s + '"' + (c.status === s ? ' selected' : '') + '>' + INV_ST[s][0] + '</option>'; }).join('') + '</select>' +
            '</div></div>';
      }).join('');
      view('<div class="row-between" style="margin-bottom:12px;align-items:center;flex-wrap:wrap;gap:8px"><h2 style="margin:0">🚗 מלאי יד2</h2><button class="btn btn-sm" id="invAdd">➕ הוסף רכב</button></div>' +
        '<div id="invEdit"></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + chip('', 'הכל') + chip('intake', 'קליטה') + chip('available', 'זמין') + chip('reserved', 'שמור') + chip('sold', 'נמכר') + chip('hidden', 'מוסתר') + '</div>' + invLegend +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px">' + (cards || '<div class="empty">אין רכבים בסטטוס זה</div>') + '</div>');
      $('invAdd').addEventListener('click', function () { openInvEdit(null); });
      $('view').querySelectorAll('[data-if]').forEach(function (b) { b.addEventListener('click', function () { window.C2B_renderInventory(b.dataset.if || ''); }); });
      $('view').querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openInvEdit(rows.filter(function (x) { return x.id === b.dataset.edit; })[0]); }); });
      //  שינוי-סטטוס מהיר מהרשימה — מעדכן ומצייר מחדש (שומר את הסינון הנוכחי).
      $('view').querySelectorAll('[data-stsel]').forEach(function (sel) {
        sel.addEventListener('click', function (e) { e.stopPropagation(); });
        sel.addEventListener('change', function (e) {
          e.stopPropagation(); var id = sel.dataset.stsel, st = sel.value; sel.disabled = true;
          db.from('inventory').update({ status: st }).eq('id', id).then(function (r) { sel.disabled = false; if (!r.error) window.C2B_renderInventory(statusFilter); });
        });
      });
    });
  };

  function invF(label, id, val, type) { return '<div class="field" style="margin:0"><label>' + label + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" style="width:100%"></div>'; }
  var INV_DOC_TYPES = ['רישיון רכב', 'בדיקת רכב', 'סליקה', 'קאר זון', 'תשלומים', 'קבלות', 'הסכם', 'אחר'];
  var INV_EXP_KINDS = ['שטיפה', 'תיקון', 'טיפול', 'צמיגים', 'פחחות וצבע', 'בדיקת מכון', 'הובלה', 'אגרות/רישוי', 'מתווך/עמלה', 'ריהוט/ניקיון', 'אחר'];
  //  שדות-רשימה למלאי: יד / סוג-דלק / שנה. ערך קיים שאינו ברשימה נשמר כאופציה (לא מאבדים נתונים ישנים).
  var INV_HANDS = ['יד ראשונה', 'יד שנייה', 'יד שלישית', 'יד רביעית', 'יד חמישית ומעלה'];
  var INV_FUELS = ['בנזין', 'דיזל', 'היברידי', 'היברידי נטען', 'חשמלי', 'גז'];
  function invYears() { var y = new Date().getFullYear() + 1, a = []; for (; y >= 2000; y--) a.push(String(y)); return a; }
  function invS(label, id, val, opts) {
    var v = (val == null ? '' : String(val)), list = opts.slice();
    if (v && list.indexOf(v) < 0) list.unshift(v);   // ערך-מורשת שאינו ברשימה
    return '<div class="field" style="margin:0"><label>' + label + '</label><select class="inp" id="' + id + '" style="width:100%"><option value="">— בחר —</option>' +
      list.map(function (o) { return '<option value="' + esc(o) + '"' + (v === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
  }
  //  קביעת ערך ל-select (יוצר אופציה אם חסרה) — לשימוש אחרי שליפת-לוח.
  function invSetSel(id, val) { var e = $(id); if (!e || !val) return; val = String(val); if (![].some.call(e.options, function (o) { return o.value === val; })) { var op = document.createElement('option'); op.value = val; op.textContent = val; e.appendChild(op); } e.value = val; }
  function openInvEdit(car) {
    car = car || {}; var isNew = !car.id, box = $('invEdit'); if (!box) return;
    box.innerHTML = '<div class="card" style="border:1px solid var(--line);background:var(--surface-2)">' +
      '<div class="row-between" style="margin-bottom:12px"><b>' + (isNew ? '➕ רכב חדש' : '✏️ ' + esc(invTitle(car))) + '</b><button class="btn btn-ghost btn-sm" id="invClose">✕ סגור</button></div>' +
      //  מספר-רכב למעלה — נקודת-ההתחלה: שליפה אוטומטית ממשרד התחבורה ממלאת יצרן/דגם/רמת-גימור/שנה/צבע/סוג-דלק.
      '<div class="field" style="margin:0 0 12px"><label>מספר רכב — התחל כאן (שליפה אוטומטית ממשרד התחבורה)</label><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="inp" id="iv_plate" value="' + esc(car.plate || '') + '" placeholder="מספר רכב (ספרות)" inputmode="numeric" style="flex:1;min-width:150px"><button type="button" class="btn btn-sm" id="iv_plateLk">🔎 שלוף פרטי רכב</button><span id="iv_plateMsg" style="font-size:12px"></span></div></div>' +
      '<div class="grid2">' + invF('יצרן', 'iv_make', car.make) + invF('דגם', 'iv_model', car.model) + invF('רמת גימור', 'iv_trim', car.trim) + invS('שנה', 'iv_year', car.year, invYears()) + invS('יד', 'iv_hand', car.hand, INV_HANDS) + invF('ק"מ', 'iv_km', car.km, 'number') + invF('צבע', 'iv_color', car.color) + invS('סוג דלק', 'iv_fuel', car.fuel, INV_FUELS) + invF('מחיר מכירה (₪)', 'iv_price', car.price, 'number') + '</div>' +
      '<div style="font-size:12px;color:var(--muted);font-weight:600;margin:12px 0 4px">💰 תמחור פנימי + יומן מסחר (לא מוצג באתרים)</div>' +
      '<div class="grid2">' + invF('מחיר מחירון (₪)', 'iv_listprice', '', 'number') + invF('מחיר מינימום (₪)', 'iv_minprice', '', 'number') + invF('מחיר מנהל (₪)', 'iv_mgrprice', '', 'number') + '</div>' +
      '<div class="grid2" style="margin-top:4px">' + invF('עלות רכישה (₪)', 'iv_pcost', '', 'number') + invF('תאריך רכישה', 'iv_pdate', '', 'date') + invF('נרכש מ- (ספק)', 'iv_psup') + invF('נמכר ל- (קונה)', 'iv_buyer') + '</div>' +
      '<div class="field" style="margin-top:10px"><label>תיאור</label><textarea class="inp" id="iv_desc" style="height:70px;width:100%">' + esc(car.description || '') + '</textarea></div>' +
      '<div style="margin-top:12px"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">תמונות (לחיצה על תמונה = קביעת שער)</label><div id="iv_imgs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"></div><input type="file" id="iv_file" accept="image/*" multiple style="font-size:13px"> <span id="iv_upmsg" class="muted" style="font-size:12px"></span></div>' +
      //  מסמכי-רכב + הוצאות — זמינים אחרי שמירה ראשונה (צריך id לקישור).
      (car.id ? '<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">📎 מסמכי הרכב — רישיון / בדיקה / סליקה / קאר-זון / תשלומים / קבלות</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><select class="inp" id="iv_doctype" style="width:auto">' + INV_DOC_TYPES.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('') + '</select>' +
        '<label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">⬆ העלה מסמך<input type="file" id="iv_docfile" accept="image/*,application/pdf" style="display:none"></label><span id="iv_docmsg" class="muted" style="font-size:12px"></span></div>' +
        '<div id="iv_doclist" style="display:flex;flex-direction:column;gap:5px"></div></div>' +
        '<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">💸 הוצאות על הרכב</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><select class="inp" id="iv_expkind" style="width:auto">' + INV_EXP_KINDS.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</select>' +
        '<input class="inp" id="iv_expamt" type="number" inputmode="numeric" placeholder="סכום ₪" style="width:120px"><input class="inp" id="iv_expnote" placeholder="הערה (לא חובה)" style="width:160px"><button class="btn btn-sm" id="iv_expadd" type="button">+ הוסף</button></div>' +
        '<div id="iv_explist"></div></div>'
        : '<p class="muted" style="font-size:12px;margin-top:12px">💡 שמרו את הרכב כדי להוסיף מסמכים והוצאות.</p>') +
      '<div class="grid2" style="margin-top:12px"><div class="field" style="margin:0"><label>סטטוס</label><select class="inp" id="iv_status" style="width:100%">' + ['intake', 'available', 'reserved', 'sold', 'hidden'].map(function (s) { return '<option value="' + s + '"' + ((car.status || (isNew ? 'available' : 'intake')) === s ? ' selected' : '') + '>' + INV_ST[s][0] + '</option>'; }).join('') + '</select></div>' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:22px;font-size:14px"><input type="checkbox" id="iv_pub"' + ((isNew || car.published) ? ' checked' : '') + '> מפורסם (מוצג באתרים וב-CRM-ים)</label></div>' +
      '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm" id="iv_save">💾 שמור</button>' + (isNew ? '' : '<button class="btn btn-ghost btn-sm" id="iv_del" style="color:var(--danger)">🗑 מחק</button>') + '<span id="iv_msg" style="font-size:13px;margin-inline-start:8px"></span></div></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // טעינת תמחור פנימי קיים (טבלה נפרדת צוות-בלבד)
    if (car.id) db.from('inventory_pricing').select('list_price,min_price,manager_price,purchase_cost,purchased_at,supplier_name,buyer_name').eq('inventory_id', car.id).maybeSingle().then(function (pr) {
      if (pr && pr.data) { var st = function (id, v) { var e = $(id); if (e) e.value = (v == null ? '' : v); }; st('iv_listprice', pr.data.list_price); st('iv_minprice', pr.data.min_price); st('iv_mgrprice', pr.data.manager_price); st('iv_pcost', pr.data.purchase_cost); st('iv_pdate', pr.data.purchased_at); st('iv_psup', pr.data.supplier_name); st('iv_buyer', pr.data.buyer_name); }
    });
    var state = { images: invImgs(car).slice(), cover: car.cover_idx || 0 };
    function paintImgs() {
      $('iv_imgs').innerHTML = state.images.length ? state.images.map(function (u, i) {
        return '<div style="position:relative;width:88px;height:66px;border-radius:8px;overflow:hidden;border:2px solid ' + (i === state.cover ? 'var(--brand)' : 'transparent') + '"><img src="' + esc(u) + '" style="width:100%;height:100%;object-fit:cover;cursor:pointer" data-cover="' + i + '"><button data-rmimg="' + i + '" style="position:absolute;top:1px;inset-inline-end:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;line-height:1">×</button></div>';
      }).join('') : '<span class="muted" style="font-size:12px">אין תמונות עדיין</span>';
      $('iv_imgs').querySelectorAll('[data-cover]').forEach(function (im) { im.addEventListener('click', function () { state.cover = +im.dataset.cover; paintImgs(); }); });
      $('iv_imgs').querySelectorAll('[data-rmimg]').forEach(function (b) { b.addEventListener('click', function () { state.images.splice(+b.dataset.rmimg, 1); if (state.cover >= state.images.length) state.cover = 0; paintImgs(); }); });
    }
    paintImgs();
    $('invClose').addEventListener('click', function () { box.innerHTML = ''; });
    //  שליפת פרטי-רכב ממשרד התחבורה לפי מספר-רכב — ממלא יצרן/דגם/רמת-גימור/שנה/צבע/סוג-דלק.
    if ($('iv_plateLk') && window.C2B_plateLookup) $('iv_plateLk').addEventListener('click', function () {
      var plate = (($('iv_plate') && $('iv_plate').value) || '').replace(/\D/g, '');
      if (!plate) { $('iv_plateMsg').style.color = 'var(--danger)'; $('iv_plateMsg').textContent = 'הזן מספר רכב'; return; }
      var b = this; b.disabled = true; $('iv_plateMsg').style.color = 'var(--muted)'; $('iv_plateMsg').textContent = 'מחפש…';
      window.C2B_plateLookup(plate, function (v, err) {
        b.disabled = false;
        if (err || !v) { $('iv_plateMsg').style.color = 'var(--danger)'; $('iv_plateMsg').textContent = err || 'לא נמצא רכב עם מספר זה'; return; }
        function setv(id, x) { var e = $(id); if (e && x) e.value = x; }
        setv('iv_make', v.make); setv('iv_model', v.model); setv('iv_trim', v.trim); setv('iv_color', v.color);
        invSetSel('iv_year', v.year); invSetSel('iv_fuel', v.fuel);
        $('iv_plateMsg').style.color = 'var(--ok)'; $('iv_plateMsg').textContent = '✔ נשלפו פרטי הרכב — השלם יד, ק"מ ותמונות';
      });
    });
    $('iv_file').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []); if (!files.length) return;
      $('iv_upmsg').textContent = 'מעלה ' + files.length + '…'; var done = 0, errs = 0;
      files.forEach(function (f) {
        var path = (car.id || 'new') + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ((f.name.split('.').pop() || 'jpg').toLowerCase());
        db.storage.from('inventory').upload(path, f, { upsert: true, contentType: f.type || 'image/jpeg' }).then(function (res) {
          done++; if (res.error) errs++; else state.images.push(db.storage.from('inventory').getPublicUrl(path).data.publicUrl);
          if (done === files.length) { $('iv_upmsg').textContent = errs ? (errs + ' נכשלו') : '✔ הועלו'; paintImgs(); }
        });
      });
      this.value = '';
    });
    //  ===== מסמכי-רכב (inventory.documents JSONB) =====
    if (car.id) {
      //  מסמכי-רכב רגישים (רישיון/תשלומים/קבלות) → דלי פרטי lead-docs + signed URL (לא ציבורי).
      var docs = Array.isArray(car.documents) ? car.documents.slice() : [];
      function safeHttp(u) { u = String(u || ''); return /^https?:\/\//i.test(u) ? u : null; }   // חוסם javascript:/data: (XSS)
      var paintDocs = function () {
        var el = $('iv_doclist'); if (!el) return;
        if (!docs.length) { el.innerHTML = '<span class="muted" style="font-size:12px">אין מסמכים עדיין</span>'; return; }
        Promise.all(docs.map(function (d) {
          if (d.path) return db.storage.from('lead-docs').createSignedUrl(d.path, 3600).then(function (r) { return (r && r.data && r.data.signedUrl) || null; }, function () { return null; });
          return Promise.resolve(safeHttp(d.url));   // תאימות-לאחור לרשומות ישנות עם url
        })).then(function (urls) {
          el.innerHTML = docs.map(function (d, i) {
            var u = safeHttp(urls[i]);
            var label = '📄 ' + esc(d.type || 'מסמך') + (d.name ? ' · ' + esc(d.name) : '');
            var link = u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener" style="font-size:12.5px">' + label + '</a>' : '<span class="muted" style="font-size:12.5px">' + label + ' (לא זמין)</span>';
            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 8px;background:var(--surface-2);border-radius:8px">' + link + '<button class="btn btn-ghost btn-sm" data-docdel="' + i + '" style="color:var(--danger)">🗑</button></div>';
          }).join('');
          el.querySelectorAll('[data-docdel]').forEach(function (b) { b.addEventListener('click', function () { docs.splice(+b.dataset.docdel, 1); db.from('inventory').update({ documents: docs }).eq('id', car.id).then(function () { car.documents = docs.slice(); paintDocs(); }); }); });
        });
      };
      paintDocs();
      if ($('iv_docfile')) $('iv_docfile').addEventListener('change', function () {
        var f = this.files && this.files[0]; if (!f) return; var type = $('iv_doctype').value;
        $('iv_docmsg').textContent = 'מעלה…';
        var path = 'inventory/' + car.id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.' + ((f.name.split('.').pop() || 'bin').toLowerCase());
        db.storage.from('lead-docs').upload(path, f, { upsert: true, contentType: f.type || 'application/octet-stream' }).then(function (res) {
          if (res.error) { $('iv_docmsg').textContent = 'שגיאה: ' + res.error.message; return; }
          docs.push({ type: type, path: path, name: f.name || '' });
          db.from('inventory').update({ documents: docs }).eq('id', car.id).then(function () { car.documents = docs.slice(); $('iv_docmsg').textContent = '✔ הועלה'; paintDocs(); });
        });
        this.value = '';
      });
      //  ===== הוצאות-רכב (טבלת inventory_expenses) =====
      var paintExp = function () {
        db.from('inventory_expenses').select('*').eq('inventory_id', car.id).order('spent_at', { ascending: false }).then(function (r) {
          var rows = r.data || [], el = $('iv_explist'); if (!el) return;
          var total = rows.reduce(function (a, x) { return a + (+x.amount || 0); }, 0);
          el.innerHTML = (rows.length ? rows.map(function (x) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--line)"><span style="font-size:12.5px">' + esc(x.kind) + (x.notes ? ' · ' + esc(x.notes) : '') + ' <span class="muted">· ' + esc(String(x.spent_at || '').slice(0, 10)) + '</span></span><span style="display:flex;align-items:center;gap:8px"><b>' + money(x.amount) + '</b><button class="btn btn-ghost btn-sm" data-expdel="' + x.id + '" style="color:var(--danger)">🗑</button></span></div>';
          }).join('') : '<span class="muted" style="font-size:12px">אין הוצאות עדיין</span>') +
            '<div style="display:flex;justify-content:space-between;padding:8px;font-weight:800;border-top:2px solid var(--line);margin-top:4px"><span>סה"כ הוצאות</span><span style="color:var(--danger)">' + money(total) + '</span></div>';
          el.querySelectorAll('[data-expdel]').forEach(function (b) { b.addEventListener('click', function () { db.from('inventory_expenses').delete().eq('id', b.dataset.expdel).then(function () { paintExp(); }); }); });
        });
      };
      paintExp();
      if ($('iv_expadd')) $('iv_expadd').addEventListener('click', function () {
        var amt = $('iv_expamt').value !== '' ? Number($('iv_expamt').value) : null;
        if (amt == null) { alert('הזינו סכום'); return; }
        db.from('inventory_expenses').insert({ inventory_id: car.id, kind: $('iv_expkind').value, amount: amt, notes: ($('iv_expnote').value || '').trim() || null }).then(function (r) {
          if (r.error) { alert('שגיאה: ' + r.error.message); return; }
          $('iv_expamt').value = ''; $('iv_expnote').value = ''; paintExp();
        });
      });
    }
    function val(id) { var e = $(id); return e && e.value.trim() ? e.value.trim() : null; }
    function numv(id) { var e = $(id); return e && e.value !== '' ? Number(e.value) : null; }
    $('iv_save').addEventListener('click', function () {
      //  רכב שמתפרסם לאתר (מפורסם או סטטוס "זמין") חייב להיות שלם: מספר-רכב, יצרן, דגם,
      //  שנה, יד, ק"מ, סוג-דלק ולפחות תמונה אחת. טיוטה/אינטייק לא-מפורסמת — אפשר חלקי.
      if ($('iv_pub').checked || $('iv_status').value === 'available') {
        var miss = [];
        if (!val('iv_plate')) miss.push('מספר רכב');
        if (!val('iv_make')) miss.push('יצרן');
        if (!val('iv_model')) miss.push('דגם');
        if (!val('iv_year')) miss.push('שנה');
        if (!val('iv_hand')) miss.push('יד');
        if (numv('iv_km') == null) miss.push('ק"מ');
        if (!val('iv_fuel')) miss.push('סוג דלק');
        if (!state.images.length) miss.push('תמונה אחת לפחות');
        if (miss.length) { var _m = 'חובה להשלים: ' + miss.join(', '); $('iv_msg').style.color = 'var(--danger)'; $('iv_msg').innerHTML = '⚠ <b>הרכב לא פורסם</b> — ' + esc(_m); alert('⚠ הרכב לא נשמר/פורסם לאתר.\n\n' + _m + '\n\n(או שמור כ"קליטה" לא-מפורסם כדי לשמור טיוטה חלקית.)'); return; }
      }
      var patch = { make: val('iv_make'), model: val('iv_model'), trim: val('iv_trim'), year: numv('iv_year'), hand: val('iv_hand'), km: numv('iv_km'), color: val('iv_color'), fuel: val('iv_fuel'), plate: val('iv_plate'), price: numv('iv_price'), description: val('iv_desc'), images: state.images, cover_idx: state.cover, status: $('iv_status').value, published: $('iv_pub').checked };
      var btn = this; btn.disabled = true; $('iv_msg').style.color = 'var(--muted)'; $('iv_msg').textContent = 'שומר…';
      var pricing = { list_price: numv('iv_listprice'), min_price: numv('iv_minprice'), manager_price: numv('iv_mgrprice'), purchase_cost: numv('iv_pcost'), purchased_at: val('iv_pdate'), supplier_name: val('iv_psup'), buyer_name: val('iv_buyer') };
      function savePricing(invId, done) {
        if (!invId) return done();
        db.from('inventory_pricing').upsert({ inventory_id: invId, list_price: pricing.list_price, min_price: pricing.min_price, manager_price: pricing.manager_price, purchase_cost: pricing.purchase_cost, purchased_at: pricing.purchased_at, supplier_name: pricing.supplier_name, buyer_name: pricing.buyer_name, updated_at: new Date().toISOString() }, { onConflict: 'inventory_id' }).then(function () { done(); });
      }
      var p = car.id ? db.from('inventory').update(patch).eq('id', car.id).select('id').single() : db.from('inventory').insert(patch).select('id').single();
      p.then(function (u) { if (u.error) { btn.disabled = false; $('iv_msg').style.color = 'var(--danger)'; $('iv_msg').textContent = 'שגיאה: ' + u.error.message; return; } savePricing(u.data && u.data.id, function () { btn.disabled = false; $('iv_msg').style.color = 'var(--ok)'; $('iv_msg').textContent = '✔ נשמר'; window.C2B_renderInventory(); }); });
    });
    if ($('iv_del')) $('iv_del').addEventListener('click', function () { if (confirm('למחוק את הרכב?')) db.from('inventory').delete().eq('id', car.id).then(function () { window.C2B_renderInventory(); }); });
  }

  /* ============================ יומן מסחר ============================
     פנקס קניות/מכירות לכל רכב: עלות רכישה (מ-inventory_pricing הצוות-בלבד)
     מול מחיר-מכירה (inventory.price) → רווח. סינון-תאריכים + סיכומים + CSV. */
  function tlDays(a, b) { if (!a) return ''; var d = Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 86400000); return d >= 0 ? d : ''; }
  window.C2B_renderTradeLog = function (opts) {
    opts = opts || {};
    view('<div class="loading">טוען יומן מסחר…</div>');
    db.from('inventory').select('id,make,model,year,plate,status,created_at,sold_at,price,inventory_pricing(purchase_cost,purchased_at,supplier_name,buyer_name)').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return view('<div class="card"><h3>יומן מסחר</h3><p class="muted">שגיאה: ' + esc(r.error.message) + '</p></div>');
      var rows = (r.data || []).map(function (c) {
        var pr = c.inventory_pricing; if (Array.isArray(pr)) pr = pr[0]; pr = pr || {};
        var inDate = pr.purchased_at || (c.created_at ? c.created_at.slice(0, 10) : null);
        var outDate = c.sold_at ? c.sold_at.slice(0, 10) : null;
        var cost = pr.purchase_cost == null ? null : Number(pr.purchase_cost);
        var sale = c.price == null ? null : Number(c.price);
        var profit = (cost != null && sale != null) ? (sale - cost) : null;
        return { id: c.id, title: invTitle(c), plate: c.plate, status: c.status, inDate: inDate, outDate: outDate,
          supplier: pr.supplier_name, buyer: pr.buyer_name, cost: cost, sale: sale, profit: profit,
          days: tlDays(inDate, outDate), sold: c.status === 'sold' };
      });
      // סינון תאריכים (לפי תאריך-כניסה)
      var from = opts.from || '', to = opts.to || '';
      var shown = rows.filter(function (x) { if (from && (!x.inDate || x.inDate < from)) return false; if (to && (!x.inDate || x.inDate > to)) return false; return true; });
      var tCost = 0, tSale = 0, tProfit = 0, nSold = 0, nStock = 0;
      shown.forEach(function (x) { if (x.cost) tCost += x.cost; if (x.sold) { if (x.sale) tSale += x.sale; if (x.profit != null) tProfit += x.profit; nSold++; } else if (x.status !== 'hidden') nStock++; });
      var head = ['רכב', 'רישוי', 'נכנס', 'נרכש מ-', 'עלות', 'נמכר', 'נמכר ל-', 'מחיר מכירה', 'רווח', 'ימים', 'סטטוס'];
      var body = shown.map(function (x) {
        var st = INV_ST[x.status] || ['—', '#888'];
        var pc = x.profit == null ? '' : (x.profit >= 0 ? 'var(--ok)' : 'var(--danger)');
        return '<tr data-tlrow="' + x.id + '" style="cursor:pointer;border-bottom:1px solid var(--line)">' +
          '<td style="padding:7px 8px">' + esc(x.title) + '</td><td style="padding:7px 8px">' + esc(x.plate || '—') + '</td>' +
          '<td style="padding:7px 8px;white-space:nowrap">' + (x.inDate || '—') + '</td><td style="padding:7px 8px">' + esc(x.supplier || '—') + '</td>' +
          '<td style="padding:7px 8px;text-align:left">' + (x.cost != null ? money(x.cost) : '—') + '</td>' +
          '<td style="padding:7px 8px;white-space:nowrap">' + (x.outDate || '—') + '</td><td style="padding:7px 8px">' + esc(x.buyer || '—') + '</td>' +
          '<td style="padding:7px 8px;text-align:left">' + (x.sale != null ? money(x.sale) : '—') + '</td>' +
          '<td style="padding:7px 8px;text-align:left;font-weight:700;color:' + pc + '">' + (x.profit != null ? money(x.profit) : '—') + '</td>' +
          '<td style="padding:7px 8px;text-align:center">' + (x.days === '' ? '—' : x.days) + '</td>' +
          '<td style="padding:7px 8px"><span style="background:' + st[1] + ';color:#fff;font-size:11px;padding:1px 8px;border-radius:999px">' + st[0] + '</span></td></tr>';
      }).join('');
      view('<div class="row-between" style="margin-bottom:12px;align-items:center;flex-wrap:wrap;gap:8px"><h2 style="margin:0">📒 יומן מסחר</h2>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><label style="font-size:12px;color:var(--muted)">מ-</label><input class="inp" type="date" id="tl_from" value="' + esc(from) + '" style="width:140px">' +
        '<label style="font-size:12px;color:var(--muted)">עד</label><input class="inp" type="date" id="tl_to" value="' + esc(to) + '" style="width:140px">' +
        '<button class="btn btn-ghost btn-sm" id="tl_apply">סנן</button><button class="btn btn-ghost btn-sm" id="tl_csv">⬇ CSV</button></div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">' +
          tlCard('עלות רכישה (סה"כ)', money(tCost)) + tlCard('מכירות (נמכרו)', money(tSale)) + tlCard('רווח (נמכרו)', money(tProfit), tProfit >= 0 ? 'var(--ok)' : 'var(--danger)') +
          tlCard('נמכרו', nSold) + tlCard('במלאי', nStock) + '</div>' +
        '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13.5px"><thead><tr style="color:var(--muted);text-align:right;font-size:12px;border-bottom:2px solid var(--line)">' +
          head.map(function (h) { return '<th style="padding:7px 8px;white-space:nowrap">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (body || '<tr><td colspan="11" style="padding:20px;text-align:center" class="muted">אין רשומות בטווח</td></tr>') + '</tbody></table></div>');
      $('tl_apply').addEventListener('click', function () { window.C2B_renderTradeLog({ from: $('tl_from').value, to: $('tl_to').value }); });
      $('view').querySelectorAll('[data-tlrow]').forEach(function (tr) { tr.addEventListener('click', function () {
        db.from('inventory').select('*').eq('id', tr.dataset.tlrow).single().then(function (res) { if (res.error || !res.data) return; window.C2B_renderInventory(); setTimeout(function () { openInvEdit(res.data); }, 150); }); }); });
      $('tl_csv').addEventListener('click', function () {
        var lines = [head.join(',')].concat(shown.map(function (x) {
          return [x.title, x.plate || '', x.inDate || '', x.supplier || '', x.cost != null ? x.cost : '', x.outDate || '', x.buyer || '', x.sale != null ? x.sale : '', x.profit != null ? x.profit : '', x.days, (INV_ST[x.status] || [''])[0]]
            .map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
        }));
        var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'יומן-מסחר-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      });
    });
  };
  function tlCard(label, val, color) { return '<div class="card" style="padding:12px 14px"><div class="muted" style="font-size:12px">' + label + '</div><div style="font-weight:800;font-size:18px;margin-top:3px' + (color ? ';color:' + color : '') + '">' + val + '</div></div>'; }

  /* ============================ ספקי יד2 ============================ */
  window.C2B_renderTenderSuppliers = function (filter) {
    view('<div class="loading">טוען ספקים…</div>');
    db.from('tender_suppliers').select('*').order('name').then(function (r) {
      if (r.error) return view('<div class="card"><h3>ספקים</h3><p class="muted">שגיאה: ' + esc(r.error.message) + '</p></div>');
      var rows = r.data || [];
      //  "active" = מקבל מכרזים. סינון: מקבלים / לא-מקבלים — שליטה מי מקבל מכרזים ומי לא.
      var nOn = rows.filter(function (s) { return s.active !== false; }).length, nOff = rows.length - nOn;
      var shown = filter === 'on' ? rows.filter(function (s) { return s.active !== false; })
                : filter === 'off' ? rows.filter(function (s) { return s.active === false; }) : rows;
      function chip(k, label, n) { return '<button class="btn btn-ghost btn-sm' + ((filter || '') === k ? ' active' : '') + '" data-sf="' + k + '">' + label + ' <span class="muted" style="font-size:11px">(' + n + ')</span></button>'; }
      var list = shown.map(function (s) {
        var on = s.active !== false;
        return '<div class="card" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px">' +
          '<div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + esc(s.name) +
            '<span style="font-size:10.5px;font-weight:700;padding:1px 9px;border-radius:999px;' + (on ? 'background:rgba(31,138,76,.14);color:#1f8a4c' : 'background:rgba(107,114,128,.16);color:#6b7280') + '">' + (on ? '✓ מקבל מכרזים' : '✕ לא מקבל') + '</span></div>' +
          '<div class="muted" style="font-size:12.5px;margin-top:3px">' + [s.phone ? '📱 ' + esc(s.phone) : '', s.email ? '✉ ' + esc(s.email) : '', s.region ? esc(s.region) : ''].filter(Boolean).join(' · ') + '</div></div>' +
          '<div style="display:flex;gap:10px;align-items:center;flex-shrink:0">' +
            '<label title="מקבל מכרזים" style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap"><input type="checkbox" data-stog="' + s.id + '"' + (on ? ' checked' : '') + '> ' + (on ? 'פעיל' : 'כבוי') + '</label>' +
            '<button class="btn btn-ghost btn-sm" data-sedit="' + s.id + '">✏️</button><button class="btn btn-ghost btn-sm" data-sdel="' + s.id + '" style="color:var(--danger)">🗑</button></div></div>';
      }).join('');
      view('<div class="row-between" style="margin-bottom:12px;align-items:center"><h2 style="margin:0">🤝 ספקים <span class="muted" style="font-size:13px;font-weight:400">· ' + rows.length + '</span></h2><button class="btn btn-sm" id="supAdd">➕ ספק חדש</button></div>' +
        '<div id="supEdit"></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + chip('', 'הכל', rows.length) + chip('on', '✓ מקבלים מכרזים', nOn) + chip('off', '✕ לא מקבלים', nOff) + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' + (list || '<div class="empty">אין ספקים בקטגוריה זו</div>') + '</div>');
      $('supAdd').addEventListener('click', function () { openSupEdit(null); });
      $('view').querySelectorAll('[data-sf]').forEach(function (b) { b.addEventListener('click', function () { window.C2B_renderTenderSuppliers(b.dataset.sf || null); }); });
      $('view').querySelectorAll('[data-stog]').forEach(function (cb) { cb.addEventListener('change', function () { db.from('tender_suppliers').update({ active: cb.checked }).eq('id', cb.dataset.stog).then(function () { window.C2B_renderTenderSuppliers(filter); }); }); });
      $('view').querySelectorAll('[data-sedit]').forEach(function (b) { b.addEventListener('click', function () { openSupEdit(rows.filter(function (x) { return x.id == b.dataset.sedit; })[0]); }); });
      $('view').querySelectorAll('[data-sdel]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('למחוק את הספק?')) db.from('tender_suppliers').delete().eq('id', b.dataset.sdel).then(function () { window.C2B_renderTenderSuppliers(filter); }); }); });
    });
  };
  function supF(label, id, val, type) { return '<div class="field" style="margin:0"><label>' + label + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" style="width:100%"></div>'; }
  function openSupEdit(s) {
    s = s || {}; var isNew = !s.id, box = $('supEdit'); if (!box) return;
    box.innerHTML = '<div class="card" style="border:1px solid var(--line);background:var(--surface-2)">' +
      '<div class="row-between" style="margin-bottom:12px"><b>' + (isNew ? '➕ ספק חדש' : '✏️ ' + esc(s.name)) + '</b><button class="btn btn-ghost btn-sm" id="supClose">✕</button></div>' +
      '<div class="grid2">' + supF('שם', 'sp_name', s.name) + supF('טלפון WhatsApp', 'sp_phone', s.phone, 'tel') + supF('מייל', 'sp_email', s.email, 'email') + supF('אזור', 'sp_region', s.region) + '</div>' +
      '<div class="field" style="margin-top:10px"><label>הערות</label><textarea class="inp" id="sp_notes" style="height:54px;width:100%">' + esc(s.notes || '') + '</textarea></div>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px"><input type="checkbox" id="sp_active"' + (s.active === false ? '' : ' checked') + '> פעיל (מקבל מכרזים)</label>' +
      '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn btn-sm" id="sp_save">💾 שמור</button><span id="sp_msg" style="font-size:13px"></span></div></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('supClose').addEventListener('click', function () { box.innerHTML = ''; });
    function v(id) { var e = $(id); return e && e.value.trim() ? e.value.trim() : null; }
    $('sp_save').addEventListener('click', function () {
      if (!v('sp_name')) { $('sp_msg').textContent = 'חובה שם'; return; }
      var patch = { name: v('sp_name'), phone: v('sp_phone'), email: v('sp_email'), region: v('sp_region'), notes: v('sp_notes'), active: $('sp_active').checked };
      var p = s.id ? db.from('tender_suppliers').update(patch).eq('id', s.id) : db.from('tender_suppliers').insert(patch);
      p.then(function (u) { if (u.error) { $('sp_msg').style.color = 'var(--danger)'; $('sp_msg').textContent = u.error.message; return; } window.C2B_renderTenderSuppliers(); });
    });
  }

  /* ===================== בקשות הצעת מחיר (יד2) =====================
     שער-הכניסה המסודר לכל הבקשות הנכנסות (בעיקר מטרייד-אין של המותגים).
     אותה טבלת tenders; פתיחה → כרטיס-המכרז (שליחה לסוחרים/הצעות/זוכה). */
  window.C2B_renderQuoteRequests = function (statusFilter) {
    view('<div class="loading">טוען בקשות…</div>');
    db.from('tenders').select('*').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return view('<div class="card"><h3>בקשות הצעת מחיר</h3><p class="muted">שגיאה: ' + esc(r.error.message) + '</p></div>');
      var rows = r.data || [], counts = {};
      rows.forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
      function chip(k, label) { return '<button class="btn btn-ghost btn-sm' + ((statusFilter || '') === k ? ' active' : '') + '" data-qf="' + k + '">' + label + ' (' + (k ? (counts[k] || 0) : rows.length) + ')</button>'; }
      var shown = statusFilter ? rows.filter(function (t) { return t.status === statusFilter; }) : rows;
      var cards = shown.map(function (t) {
        var st = QR_ST(t.status), cov = (invImgs(t)[0]) || null;
        var src = t.source === 'trade-in' ? '↩︎ טרייד-אין · ' + esc(t.agent_org || '') : (t.agent_org ? esc(t.agent_org) : 'ידני');
        return '<div class="card" data-qopen="' + t.id + '" style="cursor:pointer;padding:0;overflow:hidden;display:flex;gap:0">' +
          '<div style="width:96px;flex:0 0 96px;background:#0b0f14;background-size:cover;background-position:center' + (cov ? ";background-image:url('" + esc(cov) + "')" : '') + '">' + (cov ? '' : '<div style="height:70px;display:flex;align-items:center;justify-content:center;color:#44505f;font-size:11px">אין תמונה</div>') + '</div>' +
          '<div style="padding:10px 12px;flex:1"><div class="row-between" style="align-items:flex-start"><div style="font-weight:800">' + esc(tndTitle(t)) + '</div><span style="background:' + st[1] + ';color:#fff;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap">' + st[0] + '</span></div>' +
          '<div class="muted" style="font-size:12px;margin-top:3px">' + src + '</div>' +
          '<div class="muted" style="font-size:11.5px;margin-top:2px">' + [t.agent_name ? '👤 ' + esc(t.agent_name) : '', t.car_plate ? esc(t.car_plate) : '', when(t.created_at)].filter(Boolean).join(' · ') + '</div></div></div>';
      }).join('');
      view('<div class="row-between" style="margin-bottom:12px;align-items:center;flex-wrap:wrap;gap:8px"><h2 style="margin:0">💸 בקשות הצעת מחיר</h2></div>' +
        '<div id="tndEdit"></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + chip('', 'הכל') + chip('draft', 'חדשות') + chip('open', 'נשלחו') + chip('awarded', 'הוכרזו') + chip('closed', 'נסגרו') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">' + (cards || '<div class="empty">אין בקשות בסטטוס זה</div>') + '</div>');
      $('view').querySelectorAll('[data-qf]').forEach(function (b) { b.addEventListener('click', function () { window.C2B_renderQuoteRequests(b.dataset.qf || ''); }); });
      $('view').querySelectorAll('[data-qopen]').forEach(function (b) { b.addEventListener('click', function () { openTnd(rows.filter(function (x) { return x.id === b.dataset.qopen; })[0]); }); });
    });
  };
  function QR_ST(s) { return ({ draft: ['חדשה', '#8b6f2e'], open: ['נשלחה לסוחרים', '#1f8a4c'], awarded: ['הוכרז זוכה', '#2563eb'], closed: ['נסגרה', '#6b7280'], cancelled: ['בוטלה', '#c0392b'] })[s] || ['—', '#888']; }

  /* ============================ מכרזי יד2 ============================ */
  var TND_ST = { draft: ['טיוטה', '#8b6f2e'], open: ['פתוח', '#1f8a4c'], awarded: ['הוכרז זוכה', '#2563eb'], closed: ['נסגר', '#6b7280'], cancelled: ['בוטל', '#c0392b'] };
  //  תיאור קצר לכל סטטוס — למקרא ול-tooltip על הצ'יפים (כדי שיובן מה כל שלב בחיי המכרז).
  var TND_DESC = { draft: 'נוצר וטרם נשלח לסוחרים', open: 'נשלח לסוחרים — מקבל הצעות עד שעת הסגירה', awarded: 'נסגר ונבחר סוחר זוכה', closed: 'נסגר ללא הכרזת זוכה', cancelled: 'המכרז בוטל' };
  function tndTitle(t) { return [t.car_make, t.car_model, t.car_trim, t.car_year].filter(Boolean).join(' ') || 'רכב ללא שם'; }
  function remainTxt(t) {
    if (t.status !== 'open' || !t.closes_at) return '';
    var ms = new Date(t.closes_at).getTime() - Date.now();
    if (ms <= 0) return 'נסגר ברגעים הקרובים';
    var m = Math.round(ms / 60000); return 'נותרו ~' + (m >= 60 ? Math.floor(m / 60) + ' ש\'' : m + ' דק\'');
  }
  window.C2B_renderTenders = function (statusFilter) {
    view('<div class="loading">טוען מכרזים…</div>');
    db.from('tenders').select('*').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return view('<div class="card"><h3>מכרזים</h3><p class="muted">שגיאה: ' + esc(r.error.message) + '</p></div>');
      var rows = r.data || [], counts = {};
      rows.forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });
      //  רק סטטוסים שבאמת בשימוש מקבלים צ'יפ (מלבד "הכל"). טיוטה/פתוח תמיד זמינים
      //  (שלבי-פתיחה טבעיים) גם אם 0 כרגע, כדי שתמיד יהיה אפשר לסנן אליהם.
      var ALWAYS = { draft: 1, open: 1 };
      function chip(k, label) { return '<button class="btn btn-ghost btn-sm' + ((statusFilter || '') === k ? ' active' : '') + '" data-tf="' + k + '"' + (k && TND_DESC[k] ? ' title="' + esc(TND_DESC[k]) + '"' : '') + '>' + label + ' <span class="muted" style="font-size:11px">(' + (k ? (counts[k] || 0) : rows.length) + ')</span></button>'; }
      var chipKeys = ['draft', 'open', 'awarded', 'closed', 'cancelled'].filter(function (k) { return ALWAYS[k] || counts[k]; });
      var chipsHtml = chip('', 'הכל') + chipKeys.map(function (k) { return chip(k, TND_ST[k][0]); }).join('');
      //  מקרא סטטוסים — כדי שיובן מה כל שלב (מוצגים רק סטטוסים קיימים + שלבי-פתיחה).
      var legend = '<div class="muted" style="font-size:11.5px;margin:-4px 0 12px;line-height:1.9;display:flex;gap:14px;flex-wrap:wrap">' +
        chipKeys.map(function (k) { return '<span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + TND_ST[k][1] + ';margin-inline-end:5px"></span><b>' + esc(TND_ST[k][0]) + '</b> — ' + esc(TND_DESC[k]) + '</span>'; }).join('') + '</div>';
      var shown = statusFilter ? rows.filter(function (t) { return t.status === statusFilter; }) : rows;
      var cards = shown.map(function (t) {
        var st = TND_ST[t.status] || ['—', '#888'], rem = remainTxt(t), cov = (invImgs(t)[0]) || null;
        var spec = [t.car_year || '', t.car_km != null && t.car_km !== '' ? Number(t.car_km).toLocaleString('en-US') + ' ק"מ' : '', t.car_hand ? 'יד ' + esc(t.car_hand) : '', t.car_fuel ? '⛽ ' + esc(t.car_fuel) : ''].filter(Boolean).join(' · ');
        return '<div class="card" data-topen="' + t.id + '" style="cursor:pointer;padding:0;overflow:hidden;transition:box-shadow .15s" onmouseover="this.style.boxShadow=\'0 4px 16px rgba(16,24,40,.14)\'" onmouseout="this.style.boxShadow=\'\'">' +
          '<div style="height:118px;background:#0b0f14;background-size:cover;background-position:center' + (cov ? ";background-image:url('" + esc(cov) + "')" : '') + ';position:relative">' +
            (cov ? '' : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#44505f;font-size:12px">🚗 אין תמונה</div>') +
            '<span style="position:absolute;top:8px;inset-inline-start:8px;background:' + st[1] + ';color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:999px;box-shadow:0 1px 5px rgba(0,0,0,.35)">' + st[0] + '</span>' +
            (rem ? '<span style="position:absolute;bottom:8px;inset-inline-end:8px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px">⏱ ' + esc(rem) + '</span>' : '') +
          '</div>' +
          '<div style="padding:11px 13px">' +
            '<div style="font-weight:800;font-size:14.5px;line-height:1.3">' + esc(tndTitle(t)) + '</div>' +
            (spec ? '<div class="muted" style="font-size:12px;margin-top:3px">' + spec + '</div>' : '') +
            '<div class="muted" style="font-size:11.5px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line)">' + [t.agent_name ? '👤 ' + esc(t.agent_name) : '', t.agent_org ? esc(t.agent_org) : '', t.car_plate ? '🔖 ' + esc(t.car_plate) : ''].filter(Boolean).join(' · ') + '</div>' +
          '</div></div>';
      }).join('');
      view('<div class="row-between" style="margin-bottom:12px;align-items:center;flex-wrap:wrap;gap:8px"><h2 style="margin:0">🔨 מכרזים <span class="muted" style="font-size:14px">(' + rows.length + ')</span></h2><button class="btn btn-sm" id="tndAdd">➕ מכרז חדש</button></div>' +
        '<div id="tndEdit"></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + chipsHtml + '</div>' + legend +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px">' + (cards || '<div class="empty">אין מכרזים בסטטוס זה</div>') + '</div>');
      $('tndAdd').addEventListener('click', function () { openTndCreate(); });
      $('view').querySelectorAll('[data-tf]').forEach(function (b) { b.addEventListener('click', function () { window.C2B_renderTenders(b.dataset.tf || ''); }); });
      $('view').querySelectorAll('[data-topen]').forEach(function (b) { b.addEventListener('click', function () { openTnd(rows.filter(function (x) { return x.id === b.dataset.topen; })[0]); }); });
    });
  };
  function tndF(label, id, val, type) { return '<div class="field" style="margin:0"><label>' + label + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" style="width:100%"></div>'; }
  // העלאת תמונות משותפת (bucket inventory הציבורי); דוחף URLs ל-arr וקורא onDone
  function tndUpload(fileEl, msgEl, arr, prefix, onDone) {
    if (!fileEl) return;
    fileEl.addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []); if (!files.length) return;
      if (msgEl) msgEl.textContent = 'מעלה ' + files.length + '…'; var done = 0, errs = 0;
      files.forEach(function (f) {
        var path = prefix + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ((f.name.split('.').pop() || 'jpg').toLowerCase());
        db.storage.from('inventory').upload(path, f, { upsert: true, contentType: f.type || 'image/jpeg' }).then(function (res) {
          done++; if (res.error) errs++; else arr.push(db.storage.from('inventory').getPublicUrl(path).data.publicUrl);
          if (done === files.length) { if (msgEl) msgEl.textContent = errs ? (errs + ' נכשלו') : '✔ הועלו'; if (onDone) onDone(); }
        });
      });
      this.value = '';
    });
  }
  function openTndCreate() {
    var box = $('tndEdit'); if (!box) return;
    box.innerHTML = '<div class="card" style="border:1px solid var(--line);background:var(--surface-2)">' +
      '<div class="row-between" style="margin-bottom:12px"><b>➕ מכרז חדש</b><button class="btn btn-ghost btn-sm" id="tndClose">✕</button></div>' +
      '<div class="field" style="margin:0 0 10px"><label>בחר רכב מהמלאי (לא חובה — אפשר גם למלא ידנית)</label><select class="inp" id="tn_inv" style="width:100%"><option value="">— ללא / מילוי ידני —</option></select></div>' +
      '<div style="font-size:13px;color:var(--brand);font-weight:600;margin-bottom:6px">פרטי הרכב</div>' +
      '<div class="grid2">' + tndF('יצרן', 'tn_make') + tndF('דגם', 'tn_model') + tndF('רמת גימור', 'tn_trim') + tndF('שנה', 'tn_year', '', 'number') + tndF('ק"מ', 'tn_km', '', 'number') + tndF('יד', 'tn_hand') + tndF('צבע', 'tn_color') + tndF('מספר רכב', 'tn_plate') + '</div>' +
      '<div class="field" style="margin-top:10px"><label>תיאור / הערות</label><textarea class="inp" id="tn_desc" style="height:54px;width:100%"></textarea></div>' +
      '<div style="margin-top:12px"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">תמונות (נשלחות לסוחרים במייל + מוצגות בקישור)</label><div id="tn_imgs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"></div><input type="file" id="tn_file" accept="image/*" multiple style="font-size:13px"> <span id="tn_upmsg" class="muted" style="font-size:12px"></span></div>' +
      '<div style="font-size:13px;color:var(--brand);font-weight:600;margin:14px 0 6px">הסוכן המבקש <span class="muted" style="font-weight:400;font-size:11.5px">(ברירת-מחדל: את/ה — יוצר/ת המכרז; ניתן לשנות)</span></div>' +
      '<div class="grid2">' + tndF('שם הסוכן', 'tn_aname', (window.C2B && window.C2B.userName) || '') + tndF('טלפון', 'tn_aphone', (window.C2B && window.C2B.userPhone) || '', 'tel') + tndF('מייל (לתוצאה)', 'tn_aemail', (window.C2B && window.C2B.userEmail) || '', 'email') + tndF('מותג/סניף', 'tn_aorg') + '</div>' +
      '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn btn-sm" id="tn_create">💾 צור מכרז</button><span id="tn_msg" style="font-size:13px"></span></div></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('tndClose').addEventListener('click', function () { box.innerHTML = ''; });
    // תמונות: מצב + רינדור + העלאה (bucket inventory, נתיב tender/new)
    var tnImgs = [];
    function paintTnImgs() {
      var el = $('tn_imgs'); if (!el) return;
      el.innerHTML = tnImgs.length ? tnImgs.map(function (u, i) {
        return '<div style="position:relative;width:88px;height:66px;border-radius:8px;overflow:hidden;border:1px solid var(--line)"><img src="' + esc(u) + '" style="width:100%;height:100%;object-fit:cover"><button data-rm="' + i + '" style="position:absolute;top:1px;inset-inline-end:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;line-height:1">×</button></div>';
      }).join('') : '<span class="muted" style="font-size:12px">אין תמונות</span>';
      el.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { tnImgs.splice(+b.dataset.rm, 1); paintTnImgs(); }); });
    }
    paintTnImgs();
    tndUpload($('tn_file'), $('tn_upmsg'), tnImgs, 'tender/new', paintTnImgs);
    // טעינת רכבי מלאי לבחירה (מילוי-אוטומטי של השדות + תמונות + קישור inventory_id)
    var invMap = {};
    db.from('inventory').select('id,make,model,trim,year,km,hand,color,plate,description,images,status').order('created_at', { ascending: false }).then(function (r) {
      var sel = $('tn_inv'); if (!sel || !r || !r.data) return;
      r.data.filter(function (c) { return c.status !== 'sold'; }).forEach(function (c) {
        invMap[c.id] = c;
        var o = document.createElement('option'); o.value = c.id;
        o.textContent = [c.make, c.model, c.trim, c.year].filter(Boolean).join(' ') + (c.plate ? ' · ' + c.plate : '');
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        var c = invMap[sel.value]; if (!c) return;
        var set = function (id, val) { var e = $(id); if (e) e.value = (val == null ? '' : val); };
        set('tn_make', c.make); set('tn_model', c.model); set('tn_trim', c.trim); set('tn_year', c.year);
        set('tn_km', c.km); set('tn_hand', c.hand); set('tn_color', c.color); set('tn_plate', c.plate); set('tn_desc', c.description);
        tnImgs.length = 0; invImgs(c).forEach(function (u) { tnImgs.push(u); }); paintTnImgs();  // ירושת תמונות מהמלאי
      });
    });
    function v(id) { var e = $(id); return e && e.value.trim() ? e.value.trim() : null; }
    function nv(id) { var e = $(id); return e && e.value !== '' ? Number(e.value) : null; }
    $('tn_create').addEventListener('click', function () {
      if (!v('tn_make') || !v('tn_aname')) { $('tn_msg').textContent = 'חובה יצרן ושם סוכן'; return; }
      var invId = ($('tn_inv') && $('tn_inv').value) || null;
      var patch = { inventory_id: invId, car_make: v('tn_make'), car_model: v('tn_model'), car_trim: v('tn_trim'), car_year: nv('tn_year'), car_km: nv('tn_km'), car_hand: v('tn_hand'), car_color: v('tn_color'), car_plate: v('tn_plate'), car_description: v('tn_desc'), images: tnImgs.slice(), agent_name: v('tn_aname'), agent_phone: v('tn_aphone'), agent_email: v('tn_aemail'), agent_org: v('tn_aorg'), status: 'draft' };
      this.disabled = true;
      db.from('tenders').insert(patch).then(function (u) { if (u.error) { $('tn_msg').style.color = 'var(--danger)'; $('tn_msg').textContent = u.error.message; return; } window.C2B_renderTenders(); });
    });
  }
  function openTnd(t) {
    if (!t) return; var box = $('tndEdit'); if (!box) return;
    box.innerHTML = '<div class="card" style="border:1px solid var(--line);background:var(--surface-2)"><div class="loading">טוען…</div></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    db.from('tender_bids').select('*').eq('tender_id', t.id).order('amount', { ascending: false }).order('created_at', { ascending: true }).then(function (r) {
      var bids = (r && r.data) || [], st = TND_ST[t.status] || ['—', '#888'];
      var bidRows = bids.map(function (b, i) {
        var win = (t.winner_bid_id && b.id === t.winner_bid_id) || (!t.winner_bid_id && i === 0 && t.status === 'open');
        return '<tr style="' + (win ? 'background:rgba(37,99,235,.12)' : '') + '"><td style="padding:6px 8px;vertical-align:top">' + (i + 1) + (win ? ' 🏆' : '') + '</td><td style="padding:6px 8px">' + esc(b.supplier_name || '—') + (b.note ? '<div class="muted" style="font-size:11.5px;margin-top:2px;white-space:normal">💬 ' + esc(b.note) + '</div>' : '') + '</td><td style="padding:6px 8px;font-weight:700;text-align:left;vertical-align:top">' + money(b.amount) + '</td><td style="padding:6px 8px;color:var(--muted);font-size:12px;vertical-align:top">' + when(b.created_at) + '</td></tr>';
      }).join('');
      var spec = [t.car_hand ? 'יד ' + esc(t.car_hand) : '', t.car_km != null ? Number(t.car_km).toLocaleString('en-US') + ' ק"מ' : '', t.car_color ? esc(t.car_color) : '', t.car_fuel ? '⛽ ' + esc(t.car_fuel) : '', t.car_plate ? '🔖 ' + esc(t.car_plate) : ''].filter(Boolean).join(' · ');
      var spec2 = [t.car_vin ? 'שלדה: ' + esc(t.car_vin) : '', t.list_price != null ? 'מחירון לוי יצחק: ' + money(t.list_price) : ''].filter(Boolean).join(' · ');
      var canSend = (t.status === 'draft' || t.status === 'open'), canClose = (t.status === 'open' || t.status === 'draft');
      box.innerHTML = '<div class="card" style="border:1px solid var(--line);background:var(--surface-2)">' +
        '<div class="row-between" style="margin-bottom:8px"><b>🔨 ' + esc(tndTitle(t)) + ' <span style="background:' + st[1] + ';color:#fff;font-size:11px;padding:2px 9px;border-radius:999px;margin-inline-start:6px">' + st[0] + '</span></b><button class="btn btn-ghost btn-sm" id="tndClose">✕</button></div>' +
        '<div class="muted" style="font-size:13px">' + spec + '</div>' +
        (spec2 ? '<div class="muted" style="font-size:12.5px;margin-top:3px">' + spec2 + '</div>' : '') +
        (t.car_description ? '<div style="font-size:13px;margin-top:6px">' + esc(t.car_description) + '</div>' : '') +
        (t.license_doc && /^https?:/.test(t.license_doc) ? '<div style="margin-top:6px"><a href="' + esc(t.license_doc) + '" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">📄 רישיון רכב</a></div>' : '') +
        '<div class="muted" style="font-size:12.5px;margin-top:8px">👤 ' + esc(t.agent_name || '—') + [t.agent_phone ? ' · ' + esc(t.agent_phone) : '', t.agent_email ? ' · ' + esc(t.agent_email) : '', t.agent_org ? ' · ' + esc(t.agent_org) : ''].join('') + '</div>' +
        (t.closes_at ? '<div class="muted" style="font-size:12.5px;margin-top:4px">⏱ סגירה: ' + when(t.closes_at) + ' · ' + remainTxt(t) + '</div>' : '') +
        '<div style="margin:12px 0"><label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">תמונות הרכב (נשלחות לסוחרים במייל + בקישור)</label><div id="td_imgs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"></div><input type="file" id="td_file" accept="image/*" multiple style="font-size:13px"> <span id="td_upmsg" class="muted" style="font-size:12px"></span></div>' +
        //  שלב 1 — הצעת-המחיר שלנו ללקוח (מזינים קודם), ורק אז שולחים לסוחרים (שלב 2).
        '<div style="margin:14px 0;padding:12px 14px;border:1px solid var(--brand);border-radius:12px;background:rgba(37,99,235,.05)">' +
          '<div style="font-weight:700;font-size:13.5px;margin-bottom:10px">💰 שלב 1 — הנתונים שלנו (לפני שליחה לסוחרים)</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
            '<input class="inp" id="tnd_listprice" type="number" inputmode="numeric" placeholder="מחירון לוי יצחק (₪) — חובה" value="' + (t.list_price != null && t.list_price !== '' ? esc(t.list_price) : '') + '" style="max-width:235px">' +
            '<label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📷 תמונת מחירון<input type="file" id="tnd_lpimg" accept="image/*" style="display:none"></label>' +
            '<span id="tnd_lpimgPrev" style="font-size:12px">' + (t.list_price_img ? '<a href="' + esc(t.list_price_img) + '" target="_blank" rel="noopener">✔ תמונת מחירון</a>' : '') + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<input class="inp" id="tnd_ourquote" type="number" inputmode="numeric" placeholder="הצעת המחיר שלנו ללקוח (₪)" value="' + (t.our_quote != null && t.our_quote !== '' ? esc(t.our_quote) : '') + '" style="max-width:235px">' +
            '<button class="btn btn-sm" id="tnd_saveQuote" type="button">💾 שמור</button>' +
            '<span id="tnd_quoteMsg" style="font-size:12.5px"></span>' +
          '</div></div>' +
        '<div style="font-weight:700;font-size:13.5px;margin:14px 0 6px">📤 שלב 2 — שליחה לסוחרים</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px">' +
          (canSend ? '<button class="btn btn-sm" id="tnd_send">📤 שלח לכל הסוחרים</button>' : '') +
          (t.status === 'open' ? '<button class="btn btn-ghost btn-sm" id="tnd_ext">⏱ הארך שעה</button>' : '') +
          (canClose ? '<button class="btn btn-ghost btn-sm" id="tnd_award">🏁 סגור והכרז זוכה</button>' : '') +
        '</div><div id="tnd_sendout"></div>' +
        '<div style="font-weight:700;margin:12px 0 6px">הצעות (' + bids.length + ')</div>' +
        (bids.length ? '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="color:var(--muted);text-align:right;font-size:12px"><th style="padding:6px 8px">#</th><th style="padding:6px 8px">סוחר</th><th style="padding:6px 8px;text-align:left">סכום</th><th style="padding:6px 8px">זמן</th></tr></thead><tbody>' + bidRows + '</tbody></table></div>' : '<div class="muted" style="font-size:13px">אין הצעות עדיין.</div>') +
        '</div>';
      $('tndClose').addEventListener('click', function () { box.innerHTML = ''; });
      // מנהל תמונות הרכב — נשמר מיידית למכרז (כדי שישלח בתמונות)
      var dImgs = invImgs(t).slice();
      function paintDImgs() {
        var el = $('td_imgs'); if (!el) return;
        el.innerHTML = dImgs.length ? dImgs.map(function (u, i) {
          return '<div style="position:relative;width:88px;height:66px;border-radius:8px;overflow:hidden;border:1px solid var(--line)"><img src="' + esc(u) + '" data-imgpop="' + esc(u) + '" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in"><button data-rm="' + i + '" style="position:absolute;top:1px;inset-inline-end:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;line-height:1">×</button></div>';
        }).join('') : '<span class="muted" style="font-size:12px">אין תמונות — העלה כדי שהסוחרים יקבלו</span>';
        el.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { dImgs.splice(+b.dataset.rm, 1); saveDImgs(); paintDImgs(); }); });
      }
      function saveDImgs() { db.from('tenders').update({ images: dImgs.slice() }).eq('id', t.id).then(function () { t.images = dImgs.slice(); }); }
      paintDImgs();
      tndUpload($('td_file'), $('td_upmsg'), dImgs, 'tender/' + t.id, function () { saveDImgs(); paintDImgs(); });
      //  שלב 1 — שמירת מחירון לוי יצחק + הצעת-המחיר שלנו (ההצעה שהסוחר יראה ויקבל במייל).
      if ($('tnd_saveQuote')) $('tnd_saveQuote').addEventListener('click', function () {
        var v = ($('tnd_ourquote').value || '').trim(), q = v === '' ? null : Number(v);
        var lp = ($('tnd_listprice').value || '').trim(), lpv = lp === '' ? null : Number(lp);
        var btn = this; btn.disabled = true; $('tnd_quoteMsg').style.color = 'var(--muted)'; $('tnd_quoteMsg').textContent = 'שומר…';
        db.from('tenders').update({ our_quote: q, list_price: lpv }).eq('id', t.id).then(function (r) {
          btn.disabled = false;
          if (r.error) { $('tnd_quoteMsg').style.color = 'var(--danger)'; $('tnd_quoteMsg').textContent = 'שגיאה: ' + esc(r.error.message); return; }
          t.our_quote = q; t.list_price = lpv; $('tnd_quoteMsg').style.color = 'var(--ok)'; $('tnd_quoteMsg').textContent = '✔ נשמר';
        });
      });
      //  העלאת תמונת-מחירון (לדלי tradein הציבורי) — אופציונלי.
      if ($('tnd_lpimg')) $('tnd_lpimg').addEventListener('change', function () {
        var f = this.files && this.files[0]; if (!f) return;
        var prev = $('tnd_lpimgPrev'); prev.textContent = 'מעלה…';
        var path = 'tender/' + t.id + '/listprice_' + Date.now() + '.' + ((f.name.split('.').pop() || 'jpg').toLowerCase());
        db.storage.from('tradein').upload(path, f, { upsert: true, contentType: f.type || 'image/jpeg' }).then(function (res) {
          if (res.error) { prev.textContent = 'שגיאה בהעלאה'; return; }
          var url = db.storage.from('tradein').getPublicUrl(path).data.publicUrl;
          db.from('tenders').update({ list_price_img: url }).eq('id', t.id).then(function () { t.list_price_img = url; prev.innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener">✔ תמונת מחירון</a>'; });
        });
      });
      if ($('tnd_send')) $('tnd_send').addEventListener('click', function () {
        //  "קודם הנתונים שלנו ואז שליחה": מחירון לוי יצחק + הצעת-המחיר שלנו חובה לפני שליחה.
        if ($('tnd_listprice') && ($('tnd_listprice').value || '').trim() !== '' && (t.list_price == null || t.list_price === '')) { alert('⚠ שמרו קודם (💾) — מחירון לוי יצחק טרם נשמר.'); return; }
        if (t.list_price == null || t.list_price === '') { alert('⚠ מחירון לוי יצחק הוא שדה חובה (שלב 1) — הזינו ושמרו לפני שליחה.'); return; }
        if (t.our_quote == null || t.our_quote === '') { alert('⚠ קודם הזינו ושמרו את הצעת-המחיר שלנו (שלב 1) — זו ההצעה שהסוחר יקבל.'); return; }
        var btn = this; btn.disabled = true; btn.textContent = 'שולח…';
        db.rpc('tender_send', { p_tender_id: t.id }).then(function (res) {
          btn.disabled = false; btn.textContent = '📤 שלח שוב';
          if (res.error || !res.data || !res.data.ok) { $('tnd_sendout').innerHTML = '<div class="muted" style="color:var(--danger);font-size:13px">שגיאה: ' + esc((res.error && res.error.message) || (res.data && res.data.error) || 'נכשל') + '</div>'; return; }
          var sups = res.data.suppliers || [], car = res.data.car || tndTitle(t);
          var items = sups.map(function (s) {
            var waTxt = encodeURIComponent('בקשת הצעת מחיר לרכב: ' + car + '\nלהגשת הצעה (עד שעה): ' + s.link);
            var wa = s.phone ? 'https://wa.me/' + intlPhone(s.phone) + '?text=' + waTxt : null;
            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--line)">' +
              '<div style="font-size:13px">' + esc(s.name) + (s.emailed ? ' <span style="color:var(--ok);font-size:11px">✓ מייל נשלח</span>' : (s.phone ? '' : ' <span class="muted" style="font-size:11px">אין טלפון/מייל</span>')) + '</div>' +
              (wa ? '<a class="btn btn-sm" href="' + wa + '" target="_blank" rel="noopener" style="white-space:nowrap">🟢 שלח WhatsApp</a>' : '') + '</div>';
          }).join('');
          $('tnd_sendout').innerHTML = '<div class="card" style="padding:0;margin-top:4px"><div style="padding:8px 10px;font-weight:700;font-size:13px;background:var(--surface-2)">נשלח ל-' + sups.length + ' סוחרים · לחץ לשליחת WhatsApp אישית</div>' + (items || '') + '</div>';
          db.from('tenders').select('status,closes_at').eq('id', t.id).single().then(function (u) { if (u.data) { t.status = u.data.status; t.closes_at = u.data.closes_at; } });
        });
      });
      if ($('tnd_ext')) $('tnd_ext').addEventListener('click', function () {
        var nc = new Date(Date.now() + 3600000).toISOString();
        db.from('tenders').update({ closes_at: nc }).eq('id', t.id).then(function () { t.closes_at = nc; openTnd(t); });
      });
      if ($('tnd_award')) $('tnd_award').addEventListener('click', function () {
        if (!confirm('לסגור את המכרז ולהכריז על ההצעה הגבוהה כזוכה?')) return;
        var btn = this; btn.disabled = true;
        db.rpc('tender_award_now', { p_tender_id: t.id }).then(function (res) {
          if (res.error || !res.data || !res.data.ok) { alert('שגיאה: ' + ((res.error && res.error.message) || (res.data && res.data.error) || 'נכשל')); btn.disabled = false; return; }
          window.C2B_renderTenders();
        });
      });
    });
  }

  window.C2B_renderYad2Stock = function () {
    view('<div class="loading">טוען מלאי יד2…</div>');
    var M = window.__fleetMaster;
    if (!M || !M.url) return view('<div class="card"><p class="muted">מאגר יד2 אינו זמין.</p></div>');
    fetch(M.url + '/rest/v1/rpc/fleet_resolve', { method: 'POST', headers: { apikey: M.anon, Authorization: 'Bearer ' + M.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: 'yad2' }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var cfg = Array.isArray(res) ? res[0] : res;
        var url = cfg && (cfg.supabase_url || cfg.url), anon = cfg && (cfg.anon_key || cfg.anon);
        if (!url || !anon) return view('<div class="card"><p class="muted">מאגר יד2 לא נמצא.</p></div>');
        return fetch(url + '/rest/v1/inventory?select=*&published=eq.true&status=eq.available&order=created_at.desc', { headers: { apikey: anon, Authorization: 'Bearer ' + anon } })
          .then(function (r) { return r.json(); })
          .then(function (cars) {
            cars = Array.isArray(cars) ? cars : [];
            var cards = cars.map(function (c) {
              var cov = invCover(c);
              return '<div class="card" style="padding:0;overflow:hidden"><div style="' + invBg(cov) + '">' + (cov ? '' : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#44505f;font-size:13px">אין תמונה</div>') + '</div>' +
                '<div style="padding:11px 13px"><div style="font-weight:800">' + esc(invTitle(c)) + '</div><div class="muted" style="font-size:12.5px;margin-top:2px">' + [c.hand ? 'יד ' + esc(c.hand) : '', c.km != null ? Number(c.km).toLocaleString('en-US') + ' ק"מ' : ''].filter(Boolean).join(' · ') + '</div><div style="font-weight:800;margin-top:6px">' + (c.price != null ? money(c.price) : '—') + '</div></div></div>';
            }).join('');
            view('<h2 style="margin:0 0 12px">🚗 מלאי יד2 <span class="muted" style="font-size:13px;font-weight:400">· ' + cars.length + ' רכבים זמינים · מתעדכן אוטומטית מ-יד2-Global</span></h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px">' + (cards || '<div class="empty">אין רכבים זמינים כרגע</div>') + '</div>');
          });
      })
      .catch(function (e) { view('<div class="card"><p class="muted">שגיאה בטעינת מלאי יד2: ' + esc(String(e && e.message || e)) + '</p></div>'); });
  };
})();
