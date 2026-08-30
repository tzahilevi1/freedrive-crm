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
          db.from('deals').update({ status: st }).eq('id', id).then(function (rr) {
            if (rr.error) return alert('שגיאה: ' + rr.error.message);
            var d = rows.filter(function (x) { return String(x.id) === String(id); })[0];
            if (d && d.lead_id) { var ns = st === 'ordered' ? 'won' : (st === 'cancelled' ? 'lost' : 'quote_sent'); db.from('leads').update({ status: ns }).eq('id', d.lead_id); }
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
        '<p class="muted" style="font-size:12px;margin-top:10px">✅ <b>המנוע רץ בשרת.</b> החוקים נורים בכל מסלול שבו סטטוס משתנה — שינוי ידני, עדכון מרוכז, חתימת לקוח, ליד שנקלט מפייסבוק או מהאתר. כל חוק רץ פעם אחת בלבד לכל ליד בכל סטטוס. שליחת WhatsApp אוטומטית תתאפשר אחרי חיבור ManyChat; עד אז החוק פותח משימה ידנית.</p>' +
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
})();
