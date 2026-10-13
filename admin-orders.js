/*  admin-orders.js — מודול "עסקאות - Global" (מחלקת הזמנת הרכבים של הקבוצה).
 *
 *  נטען רק בנתיב /orders (fleet-boot מוסיף אותו לרשימה), ומשתלט על האפליקציה
 *  אחרי ההתחברות במקום מסכי-המותג: הסכימה של Global שונה לגמרי (global_deals,
 *  order_statuses, vehicle_orders) ואין בה leads/deals/field_options.
 *
 *  הרשאות: ה-UI רק משקף את ה-RLS — האכיפה האמיתית ב-DB. מחיר-רכישה נשלף רק
 *  לתפקידים פיננסיים (global_deal_financials מבודד; לסוכן ה-RLS מחזיר ריק).
 */
(function () {
  'use strict';
  var C = window.C2B;
  var db = C.db, esc = C.esc, fmt = C.fmt, nis = C.nis, view = C.view, loading = C.loading, errBox = C.errBox, $ = C.$;

  var FIN = ['admin', 'global_orders_manager', 'accounting', 'branch'];          // = can_see_financials()
  var WRITE = ['admin', 'global_orders_manager', 'orders_agent'];                // = gd_write / vo_write
  var ROLE = { admin: 'מנהל מערכת', global_orders_manager: 'מנהל מחלקת הזמנות', orders_agent: 'נציג הזמנות',
               branch: 'מנהל סניף', accounting: 'הנהלת חשבונות', sales: 'סוכן מכירות', case_manager: 'מנהל תיקים' };
  var SRC = { approved: 'אושר מימון', signed: 'נחתם מימון', collection: 'שיחת גבייה', ordered: 'הזמנת רכב', delivered: 'רכב נמסר', cancelled: 'בוטל' };
  var DOC_KINDS = ['חשבונית ספק', 'אישור הזמנה', 'תעודת משלוח', 'רישיון רכב', 'אחר'];

  var S = { role: null, me: null, uid: null, orgs: {}, orgList: [], statuses: [], suppliers: [], deals: [], byId: {},
            fin: {}, vo: {}, sel: {}, cur: 'dash', token: 0 };
  var F = loadFilter();

  function canFin() { return FIN.indexOf(S.role) >= 0; }
  function canWrite() { return WRITE.indexOf(S.role) >= 0; }
  function isAdmin() { return S.role === 'admin'; }
  function toast(m, bad) { if (C.toast) C.toast(m, bad); }
  function dOnly(iso) { return iso ? new Date(iso).toLocaleDateString('he-IL') : ''; }
  function dVal(iso) { return iso ? String(iso).slice(0, 10) : ''; }
  function num(v) { return v === '' || v == null ? null : (parseFloat(v) || 0); }
  function stById(id) { for (var i = 0; i < S.statuses.length; i++) if (S.statuses[i].id === id) return S.statuses[i]; return null; }
  function stByKey(k) { for (var i = 0; i < S.statuses.length; i++) if (S.statuses[i].key === k) return S.statuses[i]; return null; }
  function isDone(d) { var s = stById(d.global_status_id); return !!s && (s.key === 'delivered' || s.key === 'cancelled'); }
  function orgName(d) { var o = S.orgs[d.organization_id]; return (o && o.name) || d.source_org_name || '—'; }
  function supName(id) { for (var i = 0; i < S.suppliers.length; i++) if (S.suppliers[i].id === id) return S.suppliers[i].name; return ''; }
  function badge(s) {
    if (!s) return '<span class="ost" style="background:var(--surface-2);color:var(--muted)">—</span>';
    var c = /^#[0-9a-f]{3,8}$/i.test(s.color || '') ? s.color : '#6b7280';   // רק hex — הערך נכנס לתוך style
    return '<span class="ost" style="background:' + esc(c) + '1f;color:' + esc(c) + ';border:1px solid ' + esc(c) + '55">' + esc(s.icon || '') + ' ' + esc(s.label) + '</span>';
  }
  function late(d) {
    var v = S.vo[d.id]; if (!v || !v.eta || v.delivered_at || isDone(d)) return false;
    var t = new Date(); t.setHours(0, 0, 0, 0); return new Date(v.eta) < t;
  }
  function loadFilter() { try { return JSON.parse(localStorage.getItem('orders_filter') || '') || blankF(); } catch (e) { return blankF(); } }
  function blankF() { return { q: '', org: '', st: 'open', sup: '', from: '', to: '', flag: '' }; }
  function saveFilter() { try { localStorage.setItem('orders_filter', JSON.stringify(F)); } catch (e) {} }
  function savedViews() { try { return JSON.parse(localStorage.getItem('orders_views') || '[]'); } catch (e) { return []; } }
  function setSavedViews(v) { try { localStorage.setItem('orders_views', JSON.stringify(v)); } catch (e) {} }

  // ---------- סגנון ----------
  function injectCss() {
    if (document.getElementById('ordersCss')) return;
    var st = document.createElement('style'); st.id = 'ordersCss';
    st.textContent =
      '.ost{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:12.5px;font-weight:700;white-space:nowrap}' +
      '.ofilt{display:grid;grid-template-columns:2fr repeat(6,minmax(0,1fr));gap:8px;align-items:center}' +
      '.ofilt .inp{width:100%;min-width:0}' +
      '@media(max-width:1100px){.ofilt{grid-template-columns:1fr 1fr}}' +
      '.oform{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}' +
      '.oform label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}' +
      '.oform .inp{width:100%;box-sizing:border-box}' +
      '.osec{border-top:1px solid var(--line);padding:16px 22px}.osec h4{margin:0 0 12px;font-size:15px}' +
      '.ohead{padding:20px 22px 14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}' +
      '.otl{list-style:none;margin:0;padding:0}.otl li{padding:8px 0;border-bottom:1px dashed var(--line);font-size:13px;line-height:1.5}' +
      'tr.orow{cursor:pointer}tr.orow:hover td{background:var(--surface-2)}' +
      '.obulk{position:sticky;bottom:12px;background:var(--surface);border:1px solid var(--brand);border-radius:14px;padding:10px 14px;display:flex;gap:10px;align-items:center;box-shadow:var(--shadow);margin-top:12px;flex-wrap:wrap}' +
      '.oflag{color:var(--danger);font-weight:700;font-size:12px}' +
      '.ochips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.ochip{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:12.5px;cursor:pointer;background:var(--surface)}' +
      '.ochip:hover{border-color:var(--brand)}.ochip b{margin-inline-start:6px;color:var(--muted);cursor:pointer}' +
      '.ogrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 16px;font-size:13.5px}.ogrid div span{display:block;color:var(--muted);font-size:11.5px}' +
      '.onum{font-variant-numeric:tabular-nums}';
    document.head.appendChild(st);
  }

  // ---------- טעינת נתונים ----------
  function loadAll(cb) {
    var qs = [
      db.from('organizations').select('id,slug,name').order('name'),
      db.from('order_statuses').select('*').order('sort'),
      db.from('suppliers').select('*').order('name'),
      db.from('global_deals').select('*').order('created_at', { ascending: false }).limit(5000),
      db.from('vehicle_orders').select('*').order('created_at', { ascending: true }),
      canFin() ? db.from('global_deal_financials').select('deal_id,purchase_price,supplier_invoice_no,notes') : Promise.resolve({ data: [] })
    ];
    Promise.all(qs).then(function (r) {
      for (var i = 0; i < 4; i++) if (r[i].error) return errBox(r[i].error.message);
      S.orgList = r[0].data || []; S.orgs = {}; S.orgList.forEach(function (o) { S.orgs[o.id] = o; });
      S.statuses = r[1].data || []; S.suppliers = r[2].data || [];
      S.deals = r[3].data || []; S.byId = {}; S.deals.forEach(function (d) { S.byId[d.id] = d; });
      S.vo = {}; (r[4].data || []).forEach(function (v) { S.vo[v.deal_id] = v; });        // האחרונה גוברת
      S.fin = {}; ((r[5] && r[5].data) || []).forEach(function (f) { S.fin[f.deal_id] = f; });
      updateBadge();
      cb();
    }, function (e) { errBox(e && e.message || String(e)); });
  }
  function updateBadge() {
    var b = document.getElementById('obOpen'); if (!b) return;
    b.textContent = S.deals.filter(function (d) { return !isDone(d); }).length;
  }

  // ---------- מעטפת: מחליף את תפריט-המותג ----------
  function navItems() {
    var it = [['dash', '📊', 'דשבורד הזמנות'], ['deals', '📦', 'עסקאות להזמנה'], ['suppliers', '🏭', 'ספקים']];
    if (canFin()) it.push(['stock', '🏬', 'מלאי רכש']);
    if (canFin()) it.push(['profit', '💰', 'רווחיות']);
    it.push(['log', '🕒', 'יומן פעולות']);
    if (isAdmin()) { it.push(['statuses', '🎨', 'סטטוסים']); it.push(['users', '👥', 'משתמשים והרשאות']); }
    return it;
  }
  function allowed(r) { for (var i = 0, n = navItems(); i < n.length; i++) if (n[i][0] === r) return true; return false; }
  function shell() {
    injectCss();
    var nav = $('nav');
    Array.prototype.forEach.call(nav.children, function (el) { el.style.display = 'none'; });
    var box = document.createElement('div'); box.id = 'onav';
    box.innerHTML = '<div class="nav-group-label" style="display:block">עסקאות Global</div>' +
      navItems().map(function (x) {
        return '<div class="nav-item" data-onav="' + x[0] + '"><span class="ic">' + x[1] + '</span> ' + esc(x[2]) +
          (x[0] === 'deals' ? ' <span class="badge" id="obOpen">0</span>' : '') + '</div>';
      }).join('');
    nav.appendChild(box);
    //  stopPropagation: אחרת המאזין של admin.js על #nav היה מנווט למסך-מותג
    box.addEventListener('click', function (e) {
      var it = e.target.closest('[data-onav]'); if (!it) return;
      e.stopPropagation();
      route(it.dataset.onav);
      if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); }
    });
    //  פקדי-מותג בכותרת (חיפוש לידים, מסך פעילות, משימות) — לא קיימים ב-Global
    var gs = $('gsearch'); if (gs && gs.closest('.search')) gs.closest('.search').style.visibility = 'hidden';
    ['activityBtn', 'bell'].forEach(function (id) { var el = $(id); if (el) el.style.display = 'none'; });
    var sub = $('subnav'); if (sub) sub.style.display = 'none';
    document.title = 'עסקאות Global';
  }
  function route(r) {
    if (!allowed(r)) r = 'dash';
    S.cur = r; S.token++;
    try { sessionStorage.setItem('orders_view', r); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('#onav [data-onav]'), function (el) { el.classList.toggle('active', el.dataset.onav === r); });
    C.closeDrawer && C.closeDrawer();
    ({ dash: renderDash, deals: renderDeals, suppliers: renderSuppliers, stock: renderStock, profit: renderProfit, log: renderLog,
       statuses: renderStatuses, users: renderUsers })[r]();
  }
  function rerender() { route(S.cur); }

  window.C2B_startOrders = function (session) {
    S.uid = session.user.id;
    db.from('profiles').select('role,full_name,email,active,organization_id').eq('user_id', session.user.id).maybeSingle().then(function (r) {
      var p = r.data;
      if (!p || p.active === false) {
        view('<div class="card"><h3>אין גישה למערכת עסקאות Global</h3><p class="muted">החשבון שלך אינו פעיל כאן. פנה למנהל המערכת כדי שיפעיל אותך ויקצה תפקיד.</p></div>');
        return;
      }
      S.role = p.role; S.me = p; C.role = p.role; C.userId = session.user.id; C.fullName = p.full_name || '';
      $('whoami').textContent = (p.full_name || p.email || session.user.email) + ' · ' + (ROLE[p.role] || p.role);
      shell();
      var last = ''; try { last = sessionStorage.getItem('orders_view') || ''; } catch (e) {}
      route(last || 'dash');
    });
  };

  // ================= דשבורד =================
  function renderDash() {
    loading(); var tk = S.token;
    loadAll(function () {
      if (tk !== S.token) return;
      var open = S.deals.filter(function (d) { return !isDone(d); });
      var wk = Date.now() - 7 * 864e5;
      var newWk = S.deals.filter(function (d) { return new Date(d.created_at).getTime() > wk; }).length;
      var lateN = S.deals.filter(late).length;
      var srcCancel = open.filter(function (d) { return d.source_status === 'cancelled'; }).length;
      var noOrder = open.filter(function (d) { return !S.vo[d.id]; }).length;
      var unpriced = canFin() ? open.filter(function (d) { return !S.fin[d.id] || S.fin[d.id].purchase_price == null; }).length : null;
      var cnt = {}; S.deals.forEach(function (d) { cnt[d.global_status_id] = (cnt[d.global_status_id] || 0) + 1; });
      var byOrg = {}; S.deals.forEach(function (d) { var k = orgName(d); byOrg[k] = byOrg[k] || { t: 0, o: 0 }; byOrg[k].t++; if (!isDone(d)) byOrg[k].o++; });

      var h = '<div class="row-between" style="margin-bottom:14px"><h2 style="margin:0">📊 דשבורד מחלקת ההזמנות</h2>' +
        '<button class="btn btn-ghost btn-sm" id="oRefresh">↻ רענון</button></div>';
      h += '<div class="cards">' +
        C.stat('עסקאות פתוחות', open.length, null, 'f:open', 'לא נמסרו ולא בוטלו') +
        C.stat('נכנסו ב-7 ימים', newWk, null, 'f:week') +
        C.stat('באיחור אספקה', lateN, null, 'f:late', 'צפי האספקה עבר') +
        C.stat('ללא הזמנת ספק', noOrder, null, 'f:noorder', 'עסקה פתוחה בלי הזמנה') +
        C.stat('בוטלו במותג', srcCancel, null, 'f:srccancel', 'לבדוק לפני הזמנה') +
        (unpriced != null ? C.stat('ללא מחיר רכישה', unpriced, null, 'f:unpriced', 'עסקאות פתוחות') : '') +
        '</div>';
      h += '<div class="card"><h3>לפי סטטוס</h3><div class="cards" style="margin:0">' +
        S.statuses.filter(function (s) { return s.active || cnt[s.id]; }).map(function (s) {
          return '<div class="kpi click" data-kpi="st:' + s.id + '"><div class="k">' + badge(s) + '</div><div class="v onum">' + (cnt[s.id] || 0) + '</div></div>';
        }).join('') + '</div></div>';
      var orgRows = Object.keys(byOrg).sort(function (a, b) { return byOrg[b].o - byOrg[a].o; });
      h += '<div class="card"><h3>לפי מותג</h3><div class="table-scroll"><table><thead><tr><th>מותג</th><th>פתוחות</th><th>סה"כ</th></tr></thead><tbody>' +
        (orgRows.map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="onum"><b>' + byOrg[k].o + '</b></td><td class="onum">' + byOrg[k].t + '</td></tr>'; }).join('') ||
         '<tr><td colspan="3" class="muted">עוד לא נכנסו עסקאות</td></tr>') + '</tbody></table></div></div>';
      view(h);
      $('oRefresh').addEventListener('click', rerender);
      $('view').querySelectorAll('[data-kpi]').forEach(function (k) {
        k.addEventListener('click', function () {
          var v = k.dataset.kpi; F = blankF();
          if (v === 'f:open') F.st = 'open';
          else if (v === 'f:week') { F.st = ''; F.from = new Date(wk).toISOString().slice(0, 10); }
          else if (v.indexOf('f:') === 0) { F.st = 'open'; F.flag = v.slice(2); }
          else if (v.indexOf('st:') === 0) F.st = v.slice(3);
          saveFilter(); route('deals');
        });
      });
    });
  }

  // ================= רשימת עסקאות =================
  function filtered() {
    var q = (F.q || '').trim().toLowerCase();
    var from = F.from ? new Date(F.from).getTime() : null, to = F.to ? new Date(F.to).getTime() + 864e5 : null;
    return S.deals.filter(function (d) {
      if (F.st === 'open' && isDone(d)) return false;
      if (F.st && F.st !== 'open' && String(d.global_status_id) !== String(F.st)) return false;
      if (F.org && String(d.organization_id) !== String(F.org)) return false;
      if (F.sup && !(S.vo[d.id] && String(S.vo[d.id].supplier_id) === String(F.sup))) return false;
      var t = new Date(d.finance_approved_at || d.created_at).getTime();
      if (from && t < from) return false; if (to && t >= to) return false;
      if (F.flag === 'late' && !late(d)) return false;
      if (F.flag === 'srccancel' && d.source_status !== 'cancelled') return false;
      if (F.flag === 'noorder' && S.vo[d.id]) return false;
      if (F.flag === 'unpriced' && S.fin[d.id] && S.fin[d.id].purchase_price != null) return false;
      if (q) {
        var hay = [d.client_name, d.client_phone, d.order_no, d.car_make, d.car_model, d.salesperson, d.plate, orgName(d)].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function stSelect(cur, attrs) {
    return '<select class="inp" ' + (attrs || '') + '>' + S.statuses.filter(function (s) { return s.active || s.id === cur; })
      .map(function (s) { return opt(s.id, (s.icon || '') + ' ' + s.label, cur); }).join('') + '</select>';
  }
  function renderDeals() {
    loading(); var tk = S.token;
    loadAll(function () { if (tk !== S.token) return; drawDeals(); });
  }
  function drawDeals() {
    var rows = filtered(), w = canWrite(), fin = canFin();
    var h = '<div class="row-between" style="margin-bottom:12px"><h2 style="margin:0">📦 עסקאות להזמנה <span class="muted onum" style="font-size:15px">(' + rows.length + ')</span></h2>' +
      '<div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" id="oSaveView">⭐ שמור תצוגה</button><button class="btn btn-ghost btn-sm" id="oXlsx">📥 ייצוא Excel</button></div></div>';
    h += '<div class="card"><div class="ofilt">' +
      '<input class="inp" id="of_q" placeholder="חיפוש: לקוח / טלפון / מס׳ הזמנה / רכב / נציג" value="' + esc(F.q) + '">' +
      '<select class="inp" id="of_org">' + opt('', 'כל המותגים', F.org) + S.orgList.map(function (o) { return opt(o.id, o.name, F.org); }).join('') + '</select>' +
      '<select class="inp" id="of_st">' + opt('open', 'פתוחות', F.st) + opt('', 'כל הסטטוסים', F.st) + S.statuses.map(function (s) { return opt(s.id, s.label, F.st); }).join('') + '</select>' +
      '<select class="inp" id="of_sup">' + opt('', 'כל הספקים', F.sup) + S.suppliers.map(function (s) { return opt(s.id, s.name, F.sup); }).join('') + '</select>' +
      '<select class="inp" id="of_flag">' + opt('', 'ללא סינון נוסף', F.flag) + opt('late', '⏰ באיחור אספקה', F.flag) + opt('noorder', 'ללא הזמנת ספק', F.flag) +
        opt('srccancel', '⚠ בוטל במותג', F.flag) + (fin ? opt('unpriced', 'ללא מחיר רכישה', F.flag) : '') + '</select>' +
      '<input class="inp" type="date" id="of_from" title="אושר מתאריך" value="' + esc(F.from) + '">' +
      '<input class="inp" type="date" id="of_to" title="עד תאריך" value="' + esc(F.to) + '">' +
      '</div><div class="ochips" id="oViews">' + savedViews().map(function (v, i) { return '<span class="ochip" data-v="' + i + '">⭐ ' + esc(v.name) + '<b data-del="' + i + '" title="מחק">✕</b></span>'; }).join('') +
      '<span class="ochip" id="oReset">נקה סינון</span></div></div>';

    var cols = (w ? '<th style="width:28px"><input type="checkbox" id="oAll"></th>' : '') +
      '<th>מס׳ הזמנה</th><th>מותג</th><th>לקוח</th><th>רכב</th><th>נציג</th><th>אושר</th><th>שלב במותג</th><th>סטטוס</th><th>ספק</th><th>צפי אספקה</th><th>מחיר עסקה</th>' +
      (fin ? '<th>מחיר רכישה</th><th>רווח</th>' : '');
    var body = rows.slice(0, 600).map(function (d) {
      var v = S.vo[d.id] || {}, f = S.fin[d.id], pp = f ? f.purchase_price : null;
      var mg = (pp != null && d.deal_total != null) ? (+d.deal_total - +pp) : null;
      return '<tr class="orow" data-id="' + d.id + '">' +
        (w ? '<td data-nc="1"><input type="checkbox" class="osel" data-id="' + d.id + '"' + (S.sel[d.id] ? ' checked' : '') + '></td>' : '') +
        '<td class="onum">' + esc(d.order_no || '—') + '</td><td>' + esc(orgName(d)) + '</td>' +
        '<td><b>' + esc(d.client_name || '—') + '</b><div class="muted ltr" style="font-size:12px">' + esc(d.client_phone || '') + '</div></td>' +
        '<td>' + esc([d.car_make, d.car_model].filter(Boolean).join(' ') || '—') + '<div class="muted" style="font-size:12px">' + esc([d.car_year, d.car_color].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td>' + esc(d.salesperson || '') + '</td><td class="onum">' + dOnly(d.finance_approved_at || d.created_at) + '</td>' +
        '<td>' + (d.source_status === 'cancelled' ? '<span class="oflag">⚠ בוטל במותג</span>' : esc(SRC[d.source_status] || d.source_status || '')) + '</td>' +
        '<td data-nc="1">' + (w ? stSelect(d.global_status_id, 'data-st="' + d.id + '" style="min-width:150px"') : badge(stById(d.global_status_id))) + '</td>' +
        '<td>' + esc(supName(v.supplier_id)) + '</td>' +
        '<td class="onum">' + (v.eta ? dOnly(v.eta) + (late(d) ? ' <span class="oflag">איחור</span>' : '') : '') + '</td>' +
        '<td class="onum">' + nis(d.deal_total) + '</td>' +
        (fin ? '<td class="onum">' + (pp != null ? nis(pp) : '<span class="muted">—</span>') + '</td><td class="onum" style="font-weight:700;color:' + (mg == null ? 'inherit' : mg >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + (mg == null ? '' : nis(mg)) + '</td>' : '') +
        '</tr>';
    }).join('');
    h += '<div class="card" style="padding:0"><div class="table-scroll"><table><thead><tr>' + cols + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="16" class="muted" style="padding:28px;text-align:center">אין עסקאות שתואמות לסינון</td></tr>') + '</tbody></table></div>' +
      (rows.length > 600 ? '<p class="muted" style="padding:10px 16px">מוצגות 600 הראשונות — צמצם בעזרת הסינון (הייצוא כולל הכל).</p>' : '') + '</div>';
    if (w) h += '<div class="obulk" id="oBulk" style="display:none"><b id="oBulkN">0</b> נבחרו · שנה סטטוס ל: ' + stSelect(null, 'id="oBulkSt"') +
      '<button class="btn btn-sm" id="oBulkGo">עדכן</button><button class="btn btn-ghost btn-sm" id="oBulkClr">בטל בחירה</button></div>';
    view(h);
    wireDeals(rows);
  }
  function wireDeals(rows) {
    var re = function () { saveFilter(); drawDeals(); };
    var bind = function (id, key, ev) { var el = $(id); if (!el) return; el.addEventListener(ev || 'change', function () { F[key] = el.value; re(); }); };
    bind('of_org', 'org'); bind('of_st', 'st'); bind('of_sup', 'sup'); bind('of_flag', 'flag'); bind('of_from', 'from'); bind('of_to', 'to');
    var qt = null, qi = $('of_q');
    qi.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { F.q = qi.value; saveFilter(); drawDeals(); var n = $('of_q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    $('oReset').addEventListener('click', function () { F = blankF(); re(); });
    $('oViews').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); var vs = savedViews(); vs.splice(+del.dataset.del, 1); setSavedViews(vs); drawDeals(); return; }
      var ch = e.target.closest('[data-v]'); if (!ch) return;
      F = Object.assign(blankF(), savedViews()[+ch.dataset.v].f); re();
    });
    $('oSaveView').addEventListener('click', function () {
      var bar = $('oViews'); if (document.getElementById('oVName')) return;
      bar.insertAdjacentHTML('beforeend', '<span style="display:inline-flex;gap:6px"><input class="inp" id="oVName" placeholder="שם התצוגה" style="height:30px;width:150px"><button class="btn btn-sm" id="oVOk">שמור</button></span>');
      var nm = $('oVName'); nm.focus();
      var ok = function () { var n = nm.value.trim(); if (!n) return; var vs = savedViews(); vs.push({ name: n, f: F }); setSavedViews(vs); drawDeals(); };
      $('oVOk').addEventListener('click', ok); nm.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
    });
    $('oXlsx').addEventListener('click', function () { exportDeals(rows); });
    $('view').querySelectorAll('tr.orow').forEach(function (tr) {
      tr.addEventListener('click', function (e) { if (e.target.closest('[data-nc]')) return; openDeal(tr.dataset.id); });
    });
    $('view').querySelectorAll('select[data-st]').forEach(function (s) {
      s.addEventListener('change', function () { setStatus([s.dataset.st], +s.value); });
    });
    if (!canWrite()) return;
    var syncBulk = function () {
      var ids = Object.keys(S.sel).filter(function (k) { return S.sel[k]; });
      $('oBulk').style.display = ids.length ? 'flex' : 'none'; $('oBulkN').textContent = ids.length;
    };
    $('view').querySelectorAll('.osel').forEach(function (c) { c.addEventListener('change', function () { S.sel[c.dataset.id] = c.checked; syncBulk(); }); });
    $('oAll').addEventListener('change', function () {
      var on = this.checked; rows.slice(0, 600).forEach(function (d) { S.sel[d.id] = on; });
      $('view').querySelectorAll('.osel').forEach(function (c) { c.checked = on; }); syncBulk();
    });
    $('oBulkClr').addEventListener('click', function () { S.sel = {}; drawDeals(); });
    $('oBulkGo').addEventListener('click', function () {
      var ids = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }); if (!ids.length) return;
      setStatus(ids, +$('oBulkSt').value, function () { S.sel = {}; });
    });
    syncBulk();
  }
  function setStatus(ids, sid, after) {
    db.from('global_deals').update({ global_status_id: sid }).in('id', ids).then(function (r) {
      if (r.error) { toast('שגיאה: ' + r.error.message, true); return; }
      toast(ids.length > 1 ? 'עודכנו ' + ids.length + ' עסקאות' : 'הסטטוס עודכן');
      ids.forEach(function (id) { if (S.byId[id]) S.byId[id].global_status_id = sid; });
      if (after) after();
      if (S.cur === 'deals') drawDeals();
      updateBadge();
    });
  }
  function exportDeals(rows) {
    var fin = canFin();
    var out = rows.map(function (d) {
      var v = S.vo[d.id] || {}, f = S.fin[d.id] || {}, st = stById(d.global_status_id);
      var o = { order_no: d.order_no, org: orgName(d), client: d.client_name, phone: d.client_phone, email: d.client_email,
        car: [d.car_make, d.car_model, d.car_trim].filter(Boolean).join(' '), year: d.car_year, color: d.car_color, deal_type: d.deal_type,
        salesperson: d.salesperson, approved: dOnly(d.finance_approved_at || d.created_at), src: SRC[d.source_status] || d.source_status,
        status: st ? st.label : '', supplier: supName(v.supplier_id), sup_order: v.order_no, ordered: dOnly(v.ordered_at), eta: dOnly(v.eta),
        delivered: dOnly(v.delivered_at), vin: v.vin, plate: v.plate || d.plate, total: d.deal_total };
      if (fin) { o.purchase = f.purchase_price; o.margin = (f.purchase_price != null && d.deal_total != null) ? (+d.deal_total - +f.purchase_price) : ''; }
      return o;
    });
    var cols = ['order_no', 'org', 'client', 'phone', 'email', 'car', 'year', 'color', 'deal_type', 'salesperson', 'approved', 'src', 'status',
                'supplier', 'sup_order', 'ordered', 'eta', 'delivered', 'vin', 'plate', 'total'];
    if (fin) cols.push('purchase', 'margin');
    C.exportXlsx(out, cols, 'orders-global', { order_no: 'מס׳ הזמנה', org: 'מותג', client: 'לקוח', phone: 'טלפון', email: 'אימייל', car: 'רכב',
      year: 'שנה', color: 'צבע', deal_type: 'סוג עסקה', salesperson: 'נציג', approved: 'אושר', src: 'שלב במותג', status: 'סטטוס', supplier: 'ספק',
      sup_order: 'מס׳ הזמנה מספק', ordered: 'הוזמן', eta: 'צפי אספקה', delivered: 'סופק', vin: 'מס׳ שלדה', plate: 'לוחית', total: 'מחיר עסקה',
      purchase: 'מחיר רכישה', margin: 'רווח' });
  }

  // ================= כרטיס עסקה (Drawer) =================
  function fld(lbl, id, val, type, ro) {
    return '<div><label>' + esc(lbl) + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (ro ? ' disabled' : '') + '></div>';
  }
  function openDeal(id) {
    var d = S.byId[id]; if (!d) return;
    var v = S.vo[id] || {}, f = S.fin[id] || {}, w = canWrite(), fin = canFin(), st = stById(d.global_status_id);
    var h = '<div class="ohead"><div><div class="muted" style="font-size:12.5px">' + esc(orgName(d)) + (d.order_no ? ' · הזמנה #' + esc(d.order_no) : '') + '</div>' +
      '<h2 style="margin:4px 0 8px">' + esc(d.client_name || 'עסקה') + '</h2>' +
      (w ? stSelect(d.global_status_id, 'id="dSt" style="min-width:190px"') : badge(st)) +
      (d.source_status === 'cancelled' ? ' <span class="oflag">⚠ העסקה בוטלה ב-CRM המותג</span>' : '') + '</div>' +
      '<div style="display:flex;gap:6px;flex:none">' + (/^https:\/\//.test(d.source_record_url || '') ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(d.source_record_url) + '">↗ CRM המותג</a>' : '') +
      '<button class="btn btn-ghost btn-sm" id="dClose">✕</button></div></div>';

    h += '<div class="osec"><h4>פרטי העסקה <span class="muted" style="font-weight:400;font-size:12px">(מגיע מה-CRM של המותג)</span></h4><div class="ogrid">' +
      [['לקוח', d.client_name], ['טלפון', d.client_phone ? '<a class="ltr" href="tel:' + esc(d.client_phone) + '">' + esc(d.client_phone) + '</a>' : '', 1], ['אימייל', d.client_email],
       ['רכב', [d.car_make, d.car_model, d.car_trim].filter(Boolean).join(' ')], ['שנה', d.car_year], ['צבע מבוקש', d.car_color],
       ['סוג עסקה', d.deal_type], ['נציג מכירות', d.salesperson], ['סניף/מותג במקור', d.source_branch],
       ['שלב במותג', SRC[d.source_status] || d.source_status], ['אושר מימון', dOnly(d.finance_approved_at)], ['מחיר עסקה', nis(d.deal_total)],
       ['מקדמה', nis(d.down_total)]].map(function (x) { return '<div><span>' + esc(x[0]) + '</span>' + (x[2] ? (x[1] || '—') : esc(x[1] == null || x[1] === '' ? '—' : x[1])) + '</div>'; }).join('') +
      '</div>' + (w ? '<div class="oform" style="margin-top:12px">' + fld('מס׳ הזמנה (פנימי)', 'dOrderNo', d.order_no) + fld('לוחית רישוי', 'dPlate', d.plate) +
      '<div style="align-self:end"><button class="btn btn-sm" id="dSaveDeal">💾 שמור</button></div></div>' : '') + '</div>';

    h += '<div class="osec"><h4>🚚 הזמנת רכב מספק</h4><div class="oform">' +
      '<div><label>שייך למלאי רכש <span class="muted" style="font-weight:400">· ממלא ספק+עלות ומוריד יחידה</span></label><select class="inp" id="vStock"' + (w ? '' : ' disabled') + '><option value="">— ללא שיוך —</option></select></div>' +
      '<div><label>ספק</label><select class="inp" id="vSup"' + (w ? '' : ' disabled') + '>' + opt('', '— בחר ספק —', v.supplier_id || '') +
        S.suppliers.map(function (s) { return opt(s.id, s.name, v.supplier_id || ''); }).join('') + '</select></div>' +
      fld('איש קשר בספק', 'vContact', v.supplier_contact, 'text', !w) + fld('טלפון ספק', 'vPhone', v.supplier_phone, 'tel', !w) +
      fld('מס׳ הזמנה מהספק', 'vOrder', v.order_no, 'text', !w) + fld('תאריך הזמנה', 'vOrdered', dVal(v.ordered_at), 'date', !w) +
      fld('צפי אספקה', 'vEta', dVal(v.eta), 'date', !w) + fld('תאריך אספקה בפועל', 'vDelivered', dVal(v.delivered_at), 'date', !w) +
      fld('מס׳ שלדה (VIN)', 'vVin', v.vin, 'text', !w) + fld('לוחית', 'vPlate', v.plate, 'text', !w) +
      fld('צבע שהוזמן', 'vColorO', v.color_ordered, 'text', !w) + fld('צבע שהתקבל', 'vColorR', v.color_received, 'text', !w) +
      '</div><div style="margin-top:10px"><label class="muted" style="font-size:12px">הערות פנימיות</label><textarea class="inp" id="vNotes" rows="2" style="width:100%;box-sizing:border-box"' + (w ? '' : ' disabled') + '>' + esc(v.internal_notes || '') + '</textarea></div>' +
      (w ? '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><button class="btn btn-sm" id="vSave">💾 שמור הזמנה</button>' +
        '<span class="muted" style="font-size:12px">ספק חדש:</span><input class="inp" id="vNewSup" placeholder="שם הספק" style="height:32px;width:160px"><button class="btn btn-ghost btn-sm" id="vAddSup">➕ הוסף</button></div>' : '') + '</div>';

    if (fin) {
      var mg = (f.purchase_price != null && d.deal_total != null) ? (+d.deal_total - +f.purchase_price) : null;
      h += '<div class="osec"><h4>💰 מחיר רכישה <span class="muted" style="font-weight:400;font-size:12px">· נראה רק לבעלי הרשאה פיננסית · מסונכרן להנה"ח של המותג</span></h4><div class="oform">' +
        fld('מחיר רכישה ₪', 'fPrice', f.purchase_price, 'number') + fld('מס׳ חשבונית ספק', 'fInv', f.supplier_invoice_no) +
        '<div><label>רווח (עסקה − רכישה)</label><div style="font-weight:800;font-size:18px;padding-top:6px;color:' + (mg == null ? 'var(--muted)' : mg >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + (mg == null ? '—' : nis(mg)) + '</div></div></div>' +
        '<div style="margin-top:10px"><label class="muted" style="font-size:12px">הערות כספיות</label><textarea class="inp" id="fNotes" rows="2" style="width:100%;box-sizing:border-box">' + esc(f.notes || '') + '</textarea></div>' +
        '<div style="margin-top:10px"><button class="btn btn-sm" id="fSave">💾 שמור מחיר</button></div></div>';
    }

    h += '<div class="osec"><h4>📎 מסמכים מהמותג <span class="muted" style="font-weight:400;font-size:12px">· הסכם + מה שהסוכן העלה (ת"ז, תמונות…)</span></h4><div id="dBrandDocs" class="muted">טוען…</div></div>';
    h += '<div class="osec"><h4>📎 מסמכי הזמנה <span class="muted" style="font-weight:400;font-size:12px">· נוספו כאן במחלקת ההזמנות</span></h4><div id="dDocs" class="muted">טוען…</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><select class="inp" id="docKind" style="width:160px">' +
      DOC_KINDS.map(function (k) { return opt(k, k, ''); }).join('') + '</select><input type="file" id="docFile"><button class="btn btn-ghost btn-sm" id="docUp">⬆ העלה</button></div></div>';
    h += '<div class="osec"><h4>🕒 היסטוריה</h4><ul class="otl" id="dTl"><li class="muted">טוען…</li></ul></div>';
    C.openDrawer(h);
    wireDeal(id);
  }
  function refresh(id, msg) {
    if (msg) toast(msg);
    loadAll(function () { openDeal(id); if (S.cur === 'deals') drawDeals(); });
  }
  function val(id) { var el = $(id); return el ? el.value : ''; }
  function wireDeal(id) {
    $('dClose').addEventListener('click', function () { C.closeDrawer(); });
    //  אוטו-מילוי פרטי-הספק (איש-קשר+טלפון) בבחירת ספק — חוסך הקלדה, נשאר נ-ער.
    var supMap = {}; S.suppliers.forEach(function (s) { supMap[s.id] = s; });
    var fillSup = function (sid) {
      var s = supMap[sid]; if (!s) return;
      var c = $('vContact'), ph = $('vPhone');
      if (c) c.value = s.contact || ''; if (ph) ph.value = s.phone || '';
    };
    var vsup = $('vSup');
    if (vsup) vsup.addEventListener('change', function () { fillSup(+vsup.value); });

    //  בורר-מלאי: בחירת לוט ממלאת ספק (→ואיש-קשר/טלפון) + צבע-שהוזמן; מחיר-הרכישה
    //  מוזן בשמירה (טריגר vo_stock_sync). stock_pick מחזיר פרטי-רכב בלי עלות.
    var vst = $('vStock'), stockMap = {};
    if (vst) db.rpc('stock_pick').then(function (r) {
      var cur = (S.vo[id] || {}).stock_item_id || '';
      var list = (r && r.data) || [], seen = false;
      var html = '<option value="">— ללא שיוך —</option>' + list.map(function (x) {
        stockMap[x.id] = x;
        if (String(x.id) === String(cur)) seen = true;
        return '<option value="' + esc(x.id) + '"' + (String(x.id) === String(cur) ? ' selected' : '') + '>' + esc(x.label) + ' · זמין ' + x.available + '</option>';
      }).join('');
      if (cur && !seen) html += '<option value="' + esc(cur) + '" selected>(הלוט המשויך — לא פעיל/אזל)</option>';
      vst.innerHTML = html;
      vst.addEventListener('change', function () {
        var it = stockMap[vst.value]; if (!it) return;
        if (it.supplier_id && vsup) { vsup.value = String(it.supplier_id); fillSup(it.supplier_id); }
        var co = $('vColorO'); if (co && it.color) co.value = it.color;
        toast('מולא מהמלאי: ספק, צבע · מחיר-הרכישה יוזן בשמירה');
      });
    }, function () {});
    var dSt = $('dSt'); if (dSt) dSt.addEventListener('change', function () { setStatus([id], +dSt.value, function () { refresh(id); }); });
    var sd = $('dSaveDeal');
    if (sd) sd.addEventListener('click', function () {
      db.from('global_deals').update({ order_no: val('dOrderNo').trim() || null, plate: val('dPlate').trim() || null }).eq('id', id).then(function (r) {
        if (r.error) return toast('שגיאה: ' + r.error.message, true); refresh(id, 'נשמר');
      });
    });
    var vs = $('vSave');
    if (vs) vs.addEventListener('click', function () {
      var p = { supplier_id: val('vSup') ? +val('vSup') : null, supplier_contact: val('vContact').trim() || null, supplier_phone: val('vPhone').trim() || null,
        order_no: val('vOrder').trim() || null, ordered_at: val('vOrdered') || null, eta: val('vEta') || null, delivered_at: val('vDelivered') || null,
        vin: val('vVin').trim() || null, plate: val('vPlate').trim() || null, color_ordered: val('vColorO').trim() || null,
        color_received: val('vColorR').trim() || null, internal_notes: val('vNotes').trim() || null,
        stock_item_id: val('vStock') || null, updated_at: new Date().toISOString() };
      var cur = S.vo[id];
      (cur ? db.from('vehicle_orders').update(p).eq('id', cur.id) : db.from('vehicle_orders').insert(Object.assign({ deal_id: id }, p))).then(function (r) {
        if (r.error) return toast('שגיאה: ' + r.error.message, true); refresh(id, 'ההזמנה נשמרה');
      });
    });
    var as = $('vAddSup');
    if (as) as.addEventListener('click', function () {
      var n = val('vNewSup').trim(); if (!n) return;
      db.from('suppliers').insert({ name: n }).select('id').single().then(function (r) {
        if (r.error) return toast('שגיאה: ' + r.error.message, true);
        S.suppliers.push({ id: r.data.id, name: n });
        var sel = $('vSup'); sel.insertAdjacentHTML('beforeend', opt(r.data.id, n, r.data.id)); sel.value = r.data.id; $('vNewSup').value = '';
        toast('הספק נוסף — לחץ "שמור הזמנה"');
      });
    });
    var fs = $('fSave');
    if (fs) fs.addEventListener('click', function () {
      db.from('global_deal_financials').upsert({ deal_id: id, purchase_price: num(val('fPrice')), supplier_invoice_no: val('fInv').trim() || null,
        notes: val('fNotes').trim() || null }, { onConflict: 'deal_id' }).then(function (r) {
        if (r.error) return toast('שגיאה: ' + r.error.message, true); refresh(id, 'המחיר נשמר וסונכרן למותג');
      });
    });
    loadDocs(id); loadBrandDocs(id);
    $('docUp').addEventListener('click', function () {
      var file = $('docFile').files[0]; if (!file) return toast('בחר קובץ', true);
      var safe = file.name.replace(/[^\w.\-]+/g, '_'), path = id + '/' + Date.now() + '_' + safe;
      $('docUp').disabled = true; $('docUp').textContent = 'מעלה…';
      db.storage.from('order-docs').upload(path, file).then(function (u) {
        if (u.error) { $('docUp').disabled = false; $('docUp').textContent = '⬆ העלה'; return toast('שגיאה בהעלאה: ' + u.error.message, true); }
        db.from('attachments').insert({ deal_id: id, kind: val('docKind') + ' · ' + file.name, url: path, uploaded_by: S.uid }).then(function (r) {
          $('docUp').disabled = false; $('docUp').textContent = '⬆ העלה'; $('docFile').value = '';
          if (r.error) return toast('שגיאה: ' + r.error.message, true);
          toast('המסמך הועלה'); loadDocs(id); loadTl(id);
        });
      });
    });
    loadTl(id);
  }
  function loadDocs(id) {
    db.from('attachments').select('*').eq('deal_id', id).order('created_at', { ascending: false }).then(function (r) {
      var el = $('dDocs'); if (!el) return;
      var a = r.data || [];
      el.className = '';
      el.innerHTML = a.length ? a.map(function (x) {
        return '<div class="row-between" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span>📄 ' + esc(x.kind || 'מסמך') +
          ' <span class="muted" style="font-size:12px">· ' + dOnly(x.created_at) + '</span></span><button class="btn btn-ghost btn-sm" data-doc="' + esc(x.url) + '">פתח</button></div>';
      }).join('') : '<span class="muted">אין מסמכים עדיין</span>';
      el.querySelectorAll('[data-doc]').forEach(function (b) {
        b.addEventListener('click', function () {
          var win = window.open('', '_blank');
          db.storage.from('order-docs').createSignedUrl(b.dataset.doc, 300).then(function (s) {
            if (s.error || !s.data) { if (win) win.close(); return toast('לא ניתן לפתוח: ' + (s.error && s.error.message), true); }
            if (win) win.location = s.data.signedUrl; else location.href = s.data.signedUrl;
          });
        });
      });
    });
  }
  function loadBrandDocs(id) {
    db.functions.invoke('order-docs', { body: { deal_id: id } }).then(function (r) {
      var el = $('dBrandDocs'); if (!el) return;
      var d = (r && r.data) || {}, docs = d.documents || [], c = d.contract, html = '';
      if (c) html += '<div class="row-between" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span>📝 הסכם ' + (c.signed ? 'חתום' : 'לחתימה') +
        (c.signed_at ? ' <span class="muted" style="font-size:12px">· ' + dOnly(c.signed_at) + '</span>' : '') + '</span>' +
        (c.html ? '<button class="btn btn-ghost btn-sm" id="dContract">פתח</button>' : '<span class="muted">—</span>') + '</div>';
      html += docs.map(function (x) {
        var link = /^https:\/\//.test(x.url || '') ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(x.url) + '">פתח</a>' : '<span class="muted">—</span>';
        return '<div class="row-between" style="padding:6px 0;border-bottom:1px dashed var(--line)"><span>📄 ' + esc(x.name || 'מסמך') +
          ' <span class="muted" style="font-size:12px">· ' + dOnly(x.created_at) + '</span></span>' + link + '</div>';
      }).join('');
      el.className = '';
      el.innerHTML = html || '<span class="muted">אין מסמכים מהמותג' + (d.note ? ' · ' + esc(d.note) : '') + '</span>';
      var cb = $('dContract');
      if (cb && c && c.html) cb.addEventListener('click', function () {
        try { window.open(URL.createObjectURL(new Blob([c.html], { type: 'text/html' })), '_blank'); }
        catch (e) { toast('לא ניתן לפתוח את ההסכם', true); }
      });
    }, function () { var el = $('dBrandDocs'); if (el) { el.className = ''; el.innerHTML = '<span class="muted">לא ניתן לטעון מסמכים מהמותג כרגע</span>'; } });
  }
  function loadTl(id) {
    db.from('activity_logs').select('*').eq('deal_id', id).order('created_at', { ascending: false }).limit(200).then(function (r) {
      var el = $('dTl'); if (!el) return;
      var a = r.data || [];
      el.innerHTML = a.length ? a.map(function (x) {
        var chg = x.field ? '<b>' + esc(x.field) + '</b>: ' + (x.old_value ? esc(x.old_value) + ' ← ' : '') + esc(x.new_value || '') : esc(x.new_value || x.action || '');
        return '<li>' + chg + '<div class="muted" style="font-size:11.5px">' + esc(x.actor_name || 'מערכת') + ' · ' + esc(fmt(x.created_at)) + '</div></li>';
      }).join('') : '<li class="muted">אין פעולות עדיין</li>';
    });
  }

  // ================= ספקים =================
  function renderSuppliers() {
    loading(); var tk = S.token;
    loadAll(function () {
      if (tk !== S.token) return;
      var w = canWrite(), act = {};
      S.deals.forEach(function (d) { var v = S.vo[d.id]; if (v && v.supplier_id && !isDone(d)) act[v.supplier_id] = (act[v.supplier_id] || 0) + 1; });
      var h = '<h2 style="margin:0 0 14px">🏭 ספקים</h2>';
      if (w) h += '<div class="card"><h3>ספק חדש</h3><div class="oform">' + fld('שם הספק', 'sName', '') + fld('איש קשר', 'sContact', '') + fld('טלפון', 'sPhone', '', 'tel') +
        '<div style="align-self:end"><button class="btn btn-sm" id="sAdd">➕ הוסף ספק</button></div></div></div>';
      h += '<div class="card" style="padding:0"><div class="table-scroll"><table><thead><tr><th>ספק</th><th>איש קשר</th><th>טלפון</th><th>הזמנות פתוחות</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
        (S.suppliers.map(function (s) {
          return '<tr><td>' + (w ? '<input class="inp" data-sn="' + s.id + '" value="' + esc(s.name) + '">' : esc(s.name)) + '</td>' +
            '<td>' + (w ? '<input class="inp" data-sc="' + s.id + '" value="' + esc(s.contact || '') + '">' : esc(s.contact || '')) + '</td>' +
            '<td>' + (w ? '<input class="inp ltr" data-sp="' + s.id + '" value="' + esc(s.phone || '') + '">' : esc(s.phone || '')) + '</td>' +
            '<td class="onum">' + (act[s.id] || 0) + '</td>' +
            (w ? '<td><button class="btn btn-sm" data-ss="' + s.id + '">💾</button> ' + (act[s.id] ? '' : '<button class="btn btn-ghost btn-sm" data-sd="' + s.id + '">🗑</button>') + '</td>' : '') + '</tr>';
        }).join('') || '<tr><td colspan="5" class="muted">אין ספקים עדיין</td></tr>') + '</tbody></table></div></div>';
      view(h);
      if (!w) return;
      $('sAdd').addEventListener('click', function () {
        var n = val('sName').trim(); if (!n) return toast('הזן שם ספק', true);
        db.from('suppliers').insert({ name: n, contact: val('sContact').trim() || null, phone: val('sPhone').trim() || null }).then(function (r) {
          if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('הספק נוסף'); renderSuppliers();
        });
      });
      $('view').querySelectorAll('[data-ss]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = b.dataset.ss, q = function (a) { return $('view').querySelector('[' + a + '="' + i + '"]').value.trim(); };
          db.from('suppliers').update({ name: q('data-sn'), contact: q('data-sc') || null, phone: q('data-sp') || null }).eq('id', i).then(function (r) {
            if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('נשמר');
          });
        });
      });
      $('view').querySelectorAll('[data-sd]').forEach(function (b) {
        b.addEventListener('click', function () {
          db.from('suppliers').delete().eq('id', b.dataset.sd).then(function (r) {
            if (r.error) return toast('לא ניתן למחוק (ספק בשימוש בהזמנה): ' + r.error.message, true); toast('נמחק'); renderSuppliers();
          });
        });
      });
    });
  }

  // ================= מלאי רכש =================
  function renderStock() {
    loading(); var tk = S.token;
    loadAll(function () {   // S.byId (סטטוסי-עסקאות) לחישוב "משויך"
      if (tk !== S.token) return;
      Promise.all([
        db.from('stock_items').select('*').order('created_at', { ascending: false }),
        db.from('vehicle_orders').select('deal_id,stock_item_id')
      ]).then(function (r) {
        if (r[0].error) return errBox(r[0].error.message);
        var items = r[0].data || [];
        //  משויך = עסקאות לא-מבוטלות שקושרו ללוט (נמסר עדיין "צורך" יחידה)
        var alloc = {};
        (r[1].data || []).forEach(function (v) {
          if (!v.stock_item_id) return;
          var d = S.byId[v.deal_id], s = d && stById(d.global_status_id);
          if (s && s.key === 'cancelled') return;
          alloc[v.stock_item_id] = (alloc[v.stock_item_id] || 0) + 1;
        });
        var totUnits = 0, totAvail = 0, totVal = 0;
        items.forEach(function (it) { var a = alloc[it.id] || 0; totUnits += it.qty; totAvail += Math.max(0, it.qty - a); totVal += (+it.unit_cost || 0) * it.qty; });
        var label = function (it) { return esc([it.make, it.model, it.trim, it.year, it.color].filter(Boolean).join(' ')); };

        var h = '<div class="row-between" style="margin-bottom:12px"><h2 style="margin:0">🏬 מלאי רכש <span class="muted onum" style="font-size:15px">(' + totAvail + ' זמין מתוך ' + totUnits + ')</span></h2><button class="btn btn-ghost btn-sm" id="stX">📥 ייצוא Excel</button></div>' +
          '<p class="muted" style="margin:-4px 0 14px;font-size:13px">כל לוט = רכבים שרכשנו מראש. "זמין" = כמה שנרכש פחות כמה ששויכו לעסקאות (עסקה שבוטלה משחררת יחידה). שיוך נעשה בכרטיס העסקה → "הזמנת רכב".</p>' +
          '<div class="cards">' + C.stat('סה"כ יחידות', totUnits) + C.stat('זמינות', totAvail, null, null, (totUnits - totAvail) + ' שויכו') + C.stat('שווי מלאי (עלות)', nis(totVal)) + '</div>';
        h += '<div class="card"><h3>לוט חדש</h3><div class="oform">' +
          fld('יצרן', 'nkMake', '') + fld('דגם *', 'nkModel', '') + fld('גימור', 'nkTrim', '') + fld('שנה', 'nkYear', '', 'number') + fld('צבע', 'nkColor', '') +
          '<div><label>ספק</label><select class="inp" id="nkSup">' + opt('', '— ללא —', '') + S.suppliers.map(function (s) { return opt(s.id, s.name, ''); }).join('') + '</select></div>' +
          fld('עלות ליחידה ₪', 'nkCost', '', 'number') + fld('כמות שנרכשה', 'nkQty', '1', 'number') +
          '<div style="align-self:end"><button class="btn btn-sm" id="nkAdd">➕ הוסף לוט</button></div></div></div>';
        h += '<div class="card" style="padding:0"><div class="table-scroll"><table><thead><tr><th>פריט</th><th>ספק</th><th>עלות ליחידה</th><th>נרכש</th><th>שויך</th><th>זמין</th><th>שווי לוט</th><th></th></tr></thead><tbody>' +
          (items.map(function (it) {
            var a = alloc[it.id] || 0, av = it.qty - a;
            return '<tr><td><b>' + label(it) + '</b>' + (it.active ? '' : ' <span class="muted">(לא פעיל)</span>') + '</td>' +
              '<td>' + esc(supName(it.supplier_id)) + '</td>' +
              '<td><input class="inp onum" type="number" data-cost="' + it.id + '" value="' + (it.unit_cost == null ? '' : it.unit_cost) + '" style="width:110px"></td>' +
              '<td><input class="inp onum" type="number" data-qty="' + it.id + '" value="' + it.qty + '" style="width:80px"></td>' +
              '<td class="onum">' + a + '</td>' +
              '<td class="onum" style="font-weight:700;color:' + (av > 0 ? 'var(--ok)' : 'var(--danger)') + '">' + av + '</td>' +
              '<td class="onum">' + nis((+it.unit_cost || 0) * it.qty) + '</td>' +
              '<td><button class="btn btn-sm" data-sk="' + it.id + '">💾</button> ' + (a ? '' : '<button class="btn btn-ghost btn-sm" data-skd="' + it.id + '">🗑</button>') + '</td></tr>';
          }).join('') || '<tr><td colspan="8" class="muted" style="padding:24px;text-align:center">אין מלאי עדיין — הוסף לוט ראשון למעלה</td></tr>') + '</tbody></table></div></div>';
        view(h);
        var q = function (a, i) { return $('view').querySelector('[' + a + '="' + i + '"]'); };
        $('nkAdd').addEventListener('click', function () {
          var model = val('nkModel').trim(); if (!model) return toast('הזן דגם', true);
          db.from('stock_items').insert({ make: val('nkMake').trim() || null, model: model, trim: val('nkTrim').trim() || null,
            year: num(val('nkYear')), color: val('nkColor').trim() || null, supplier_id: val('nkSup') ? +val('nkSup') : null,
            unit_cost: num(val('nkCost')), qty: parseInt(val('nkQty'), 10) || 1, created_by: S.uid }).then(function (r) {
            if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('הלוט נוסף'); renderStock();
          });
        });
        $('view').querySelectorAll('[data-sk]').forEach(function (b) {
          b.addEventListener('click', function () {
            var i = b.dataset.sk;
            db.from('stock_items').update({ unit_cost: q('data-cost', i).value === '' ? null : (parseFloat(q('data-cost', i).value) || 0), qty: parseInt(q('data-qty', i).value, 10) || 0 }).eq('id', i).then(function (r) {
              if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('נשמר (מחיר-הרכישה בעסקאות המשויכות יתעדכן בשיוך הבא)');
            });
          });
        });
        $('view').querySelectorAll('[data-skd]').forEach(function (b) {
          b.addEventListener('click', function () {
            db.from('stock_items').delete().eq('id', b.dataset.skd).then(function (r) {
              if (r.error) return toast('לא ניתן למחוק (לוט משויך לעסקה): ' + r.error.message, true); toast('נמחק'); renderStock();
            });
          });
        });
        $('stX').addEventListener('click', function () {
          C.exportXlsx(items.map(function (it) { var a = alloc[it.id] || 0; return { item: [it.make, it.model, it.trim, it.year, it.color].filter(Boolean).join(' '), supplier: supName(it.supplier_id), unit_cost: it.unit_cost, qty: it.qty, allocated: a, available: it.qty - a, value: (+it.unit_cost || 0) * it.qty }; }),
            ['item', 'supplier', 'unit_cost', 'qty', 'allocated', 'available', 'value'], 'stock',
            { item: 'פריט', supplier: 'ספק', unit_cost: 'עלות ליחידה', qty: 'נרכש', allocated: 'שויך', available: 'זמין', value: 'שווי לוט' });
        });
      });
    });
  }

  // ================= רווחיות =================
  function renderProfit() {
    loading(); var tk = S.token;
    db.from('v_order_profit').select('*').order('month', { ascending: false }).then(function (r) {
      if (tk !== S.token) return;
      if (r.error) return errBox(r.error.message);
      var rows = r.data || [], tot = { deals: 0, priced: 0, revenue: 0, purchase: 0, margin: 0 }, byOrg = {};
      rows.forEach(function (x) {
        ['deals', 'priced', 'revenue', 'purchase', 'margin'].forEach(function (k) { tot[k] += +x[k] || 0; });
        var o = byOrg[x.org_name || '—'] = byOrg[x.org_name || '—'] || { deals: 0, priced: 0, revenue: 0, purchase: 0, margin: 0 };
        ['deals', 'priced', 'revenue', 'purchase', 'margin'].forEach(function (k) { o[k] += +x[k] || 0; });
      });
      var pct = function (m, rv) { return rv ? Math.round(m / rv * 1000) / 10 + '%' : '—'; };
      var h = '<div class="row-between" style="margin-bottom:12px"><h2 style="margin:0">💰 רווחיות</h2><button class="btn btn-ghost btn-sm" id="pX">📥 ייצוא Excel</button></div>' +
        '<p class="muted" style="margin:-4px 0 14px;font-size:13px">רווח = מחיר העסקה פחות מחיר הרכישה, רק לעסקאות שהוזן להן מחיר רכישה. עסקאות שבוטלו לא נספרות.</p>' +
        '<div class="cards">' + C.stat('עסקאות', tot.deals) + C.stat('עם מחיר רכישה', tot.priced, null, null, (tot.deals - tot.priced) + ' עוד חסרות מחיר') +
        C.stat('מחזור (עסקאות מתומחרות ולא)', nis(tot.revenue)) + C.stat('סה"כ רכישה', nis(tot.purchase)) + C.stat('רווח', nis(tot.margin), null, null, 'שיעור ' + pct(tot.margin, tot.revenue)) + '</div>';
      h += '<div class="card"><h3>לפי מותג</h3><div class="table-scroll"><table><thead><tr><th>מותג</th><th>עסקאות</th><th>מתומחרות</th><th>מחזור</th><th>רכישה</th><th>רווח</th></tr></thead><tbody>' +
        Object.keys(byOrg).sort(function (a, b) { return byOrg[b].margin - byOrg[a].margin; }).map(function (k) {
          var o = byOrg[k];
          return '<tr><td>' + esc(k) + '</td><td class="onum">' + o.deals + '</td><td class="onum">' + o.priced + '</td><td class="onum">' + nis(o.revenue) + '</td><td class="onum">' + nis(o.purchase) +
            '</td><td class="onum" style="font-weight:700;color:' + (o.margin >= 0 ? 'var(--ok)' : 'var(--danger)') + '">' + nis(o.margin) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
      h += '<div class="card"><h3>לפי חודש ומותג</h3><div class="table-scroll"><table><thead><tr><th>חודש</th><th>מותג</th><th>עסקאות</th><th>מתומחרות</th><th>מחזור</th><th>רכישה</th><th>רווח</th></tr></thead><tbody>' +
        (rows.map(function (x) {
          return '<tr><td class="onum">' + esc(String(x.month || '').slice(0, 7)) + '</td><td>' + esc(x.org_name || '—') + '</td><td class="onum">' + x.deals + '</td><td class="onum">' + x.priced +
            '</td><td class="onum">' + nis(x.revenue) + '</td><td class="onum">' + nis(x.purchase) + '</td><td class="onum">' + nis(x.margin) + '</td></tr>';
        }).join('') || '<tr><td colspan="7" class="muted">אין נתונים עדיין</td></tr>') + '</tbody></table></div></div>';
      view(h);
      $('pX').addEventListener('click', function () {
        C.exportXlsx(rows.map(function (x) { return { month: String(x.month || '').slice(0, 7), org: x.org_name, deals: x.deals, priced: x.priced, revenue: x.revenue, purchase: x.purchase, margin: x.margin }; }),
          ['month', 'org', 'deals', 'priced', 'revenue', 'purchase', 'margin'], 'orders-profit',
          { month: 'חודש', org: 'מותג', deals: 'עסקאות', priced: 'מתומחרות', revenue: 'מחזור', purchase: 'רכישה', margin: 'רווח' });
      });
    });
  }

  // ================= יומן פעולות =================
  function renderLog() {
    loading(); var tk = S.token;
    loadAll(function () {
      db.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(400).then(function (r) {
        if (tk !== S.token) return;
        if (r.error) return errBox(r.error.message);
        var a = r.data || [];
        var h = '<h2 style="margin:0 0 14px">🕒 יומן פעולות</h2><div class="card" style="padding:0"><div class="table-scroll"><table><thead><tr><th>זמן</th><th>מי</th><th>עסקה</th><th>מה השתנה</th></tr></thead><tbody>' +
          (a.map(function (x) {
            var d = S.byId[x.deal_id];
            return '<tr' + (d ? ' class="orow" data-id="' + d.id + '"' : '') + '><td class="onum">' + esc(fmt(x.created_at)) + '</td><td>' + esc(x.actor_name || 'מערכת') + '</td>' +
              '<td>' + (d ? esc(d.client_name || '') + ' <span class="muted">· ' + esc(orgName(d)) + '</span>' : '<span class="muted">—</span>') + '</td>' +
              '<td class="wrap">' + (x.field ? '<b>' + esc(x.field) + '</b>: ' + (x.old_value ? esc(x.old_value) + ' ← ' : '') + esc(x.new_value || '') : esc(x.new_value || x.action || '')) + '</td></tr>';
          }).join('') || '<tr><td colspan="4" class="muted">אין פעולות</td></tr>') + '</tbody></table></div></div>';
        view(h);
        $('view').querySelectorAll('tr.orow').forEach(function (tr) { tr.addEventListener('click', function () { openDeal(tr.dataset.id); }); });
      });
    });
  }

  // ================= סטטוסים (admin) =================
  function renderStatuses() {
    loading(); var tk = S.token;
    loadAll(function () {
      if (tk !== S.token) return;
      var used = {}; S.deals.forEach(function (d) { used[d.global_status_id] = (used[d.global_status_id] || 0) + 1; });
      var h = '<h2 style="margin:0 0 6px">🎨 סטטוסים</h2><p class="muted" style="margin:0 0 14px;font-size:13px">הסדר כאן הוא סדר ההופעה בכל המערכת. סטטוס בשימוש אי-אפשר למחוק — אפשר לכבות ("לא פעיל").</p>' +
        '<div class="card" style="padding:0"><div class="table-scroll"><table><thead><tr><th>תצוגה</th><th>שם</th><th>אייקון</th><th>צבע</th><th>סדר</th><th>פעיל</th><th>עסקאות</th><th></th></tr></thead><tbody>' +
        S.statuses.map(function (s) {
          return '<tr><td>' + badge(s) + '</td><td><input class="inp" data-l="' + s.id + '" value="' + esc(s.label) + '"></td>' +
            '<td><input class="inp" data-i="' + s.id + '" value="' + esc(s.icon || '') + '" style="width:60px"></td>' +
            '<td><input type="color" data-c="' + s.id + '" value="' + esc(s.color || '#6b7280') + '"></td>' +
            '<td><input class="inp onum" type="number" data-o="' + s.id + '" value="' + (s.sort || 0) + '" style="width:80px"></td>' +
            '<td><input type="checkbox" data-a="' + s.id + '"' + (s.active ? ' checked' : '') + '></td><td class="onum">' + (used[s.id] || 0) + '</td>' +
            '<td><button class="btn btn-sm" data-ss="' + s.id + '">💾</button> ' + (used[s.id] || ['new', 'delivered', 'cancelled', 'ordered'].indexOf(s.key) >= 0 ? '' : '<button class="btn btn-ghost btn-sm" data-sd="' + s.id + '">🗑</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '<div class="card"><h3>סטטוס חדש</h3><div class="oform">' + fld('שם', 'nsL', '') + fld('אייקון', 'nsI', '📌') +
        '<div><label>צבע</label><input type="color" id="nsC" value="#2563eb"></div>' + fld('סדר', 'nsO', (S.statuses.length + 1) * 10, 'number') +
        '<div style="align-self:end"><button class="btn btn-sm" id="nsAdd">➕ הוסף</button></div></div></div>';
      view(h);
      var q = function (a, i) { return $('view').querySelector('[' + a + '="' + i + '"]'); };
      $('view').querySelectorAll('[data-ss]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = b.dataset.ss;
          db.from('order_statuses').update({ label: q('data-l', i).value.trim(), icon: q('data-i', i).value.trim(), color: q('data-c', i).value,
            sort: +q('data-o', i).value || 0, active: q('data-a', i).checked }).eq('id', i).then(function (r) {
            if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('נשמר'); renderStatuses();
          });
        });
      });
      $('view').querySelectorAll('[data-sd]').forEach(function (b) {
        b.addEventListener('click', function () {
          db.from('order_statuses').delete().eq('id', b.dataset.sd).then(function (r) {
            if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('נמחק'); renderStatuses();
          });
        });
      });
      $('nsAdd').addEventListener('click', function () {
        var l = val('nsL').trim(); if (!l) return toast('הזן שם', true);
        db.from('order_statuses').insert({ key: 's_' + Date.now().toString(36), label: l, icon: val('nsI').trim(), color: val('nsC'), sort: +val('nsO') || 0, active: true }).then(function (r) {
          if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('נוסף'); renderStatuses();
        });
      });
    });
  }

  // ================= משתמשים (admin) =================
  function renderUsers() {
    loading(); var tk = S.token;
    Promise.all([
      db.from('profiles').select('user_id,full_name,email,role,active,organization_id,notify_orders,created_at').order('created_at'),
      db.from('organizations').select('id,name').order('name')
    ]).then(function (r) {
      if (tk !== S.token) return;
      if (r[0].error) return errBox(r[0].error.message);
      var us = r[0].data || [], orgs = r[1].data || [];
      var roleSel = function (cur, attrs) { return '<select class="inp" ' + attrs + '>' + Object.keys(ROLE).map(function (k) { return opt(k, ROLE[k], cur); }).join('') + '</select>'; };
      var orgSel = function (cur, attrs) { return '<select class="inp" ' + attrs + '>' + opt('', '— כל הארגונים —', cur || '') + orgs.map(function (o) { return opt(o.id, o.name, cur || ''); }).join('') + '</select>'; };
      var h = '<h2 style="margin:0 0 6px">👥 משתמשים והרשאות</h2>' +
        '<p class="muted" style="margin:0 0 14px;font-size:13px">מחיר רכישה גלוי ל: מנהל מערכת · מנהל מחלקת הזמנות · הנהלת חשבונות · מנהל סניף (רק המותג שלו). נציג הזמנות מנהל הזמנות בלי לראות מחיר רכישה. "מייל על עסקה חדשה" — התראה כשנכנסת עסקה.</p>' +
        '<div class="card"><h3>משתמש חדש</h3><div class="oform">' + fld('אימייל', 'uEmail', '', 'email') + fld('שם מלא', 'uName', '') +
        '<div><label>תפקיד</label>' + roleSel('orders_agent', 'id="uRole"') + '</div><div><label>ארגון (חובה למנהל סניף)</label>' + orgSel('', 'id="uOrg"') + '</div>' +
        '<div style="align-self:end"><button class="btn btn-sm" id="uAdd">➕ צור משתמש</button></div></div><div id="uRes" style="margin-top:10px"></div></div>' +
        '<div class="card" style="padding:0"><div class="table-scroll"><table><thead><tr><th>שם</th><th>אימייל</th><th>תפקיד</th><th>ארגון</th><th>פעיל</th><th>מייל על עסקה חדשה</th><th></th></tr></thead><tbody>' +
        us.map(function (u) {
          var me = u.user_id === S.uid;
          return '<tr><td><input class="inp" data-n="' + u.user_id + '" value="' + esc(u.full_name || '') + '"></td><td class="ltr">' + esc(u.email || '') + '</td>' +
            '<td>' + roleSel(u.role, 'data-r="' + u.user_id + '"' + (me ? ' disabled title="אי-אפשר לשנות את התפקיד של עצמך"' : '')) + '</td>' +
            '<td>' + orgSel(u.organization_id, 'data-g="' + u.user_id + '"') + '</td>' +
            '<td><input type="checkbox" data-a="' + u.user_id + '"' + (u.active ? ' checked' : '') + (me ? ' disabled' : '') + '></td>' +
            '<td><input type="checkbox" data-m="' + u.user_id + '"' + (u.notify_orders ? ' checked' : '') + '></td>' +
            '<td><button class="btn btn-sm" data-us="' + u.user_id + '">💾</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      view(h);
      var q = function (a, i) { return $('view').querySelector('[' + a + '="' + i + '"]'); };
      $('view').querySelectorAll('[data-us]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = b.dataset.us, me = i === S.uid, role = q('data-r', i).value, org = q('data-g', i).value;
          if (role === 'branch' && !org) return toast('מנהל סניף חייב ארגון', true);
          var p = { full_name: q('data-n', i).value.trim() || null, organization_id: org ? +org : null, notify_orders: q('data-m', i).checked };
          if (!me) { p.role = role; p.active = q('data-a', i).checked; }
          db.from('profiles').update(p).eq('user_id', i).then(function (r) { if (r.error) return toast('שגיאה: ' + r.error.message, true); toast('נשמר'); });
        });
      });
      $('uAdd').addEventListener('click', function () {
        var em = val('uEmail').trim(), role = val('uRole'), org = val('uOrg');
        if (!em) return toast('הזן אימייל', true);
        if (role === 'branch' && !org) return toast('מנהל סניף חייב ארגון', true);
        $('uAdd').disabled = true;
        db.rpc('admin_create_user', { p_email: em, p_name: val('uName').trim() || null, p_role: role, p_org: org ? +org : null }).then(function (res) {
          $('uAdd').disabled = false;
          if (res.error) { $('uRes').innerHTML = '<p class="err">' + esc(res.error.message) + '</p>'; return; }
          var d = res.data || {};
          $('uRes').innerHTML = '<div class="kpi"><div class="k">המשתמש נוצר — פרטי ההתחברות נשלחו במייל</div><div style="font-size:14px;line-height:1.8">אימייל: <b class="ltr">' + esc(d.email) +
            '</b><br>סיסמה זמנית: <b class="ltr" style="font-size:16px">' + esc(d.password) + '</b> <span class="muted" style="font-size:12px">(למקרה שהמייל מתעכב)</span></div><div id="uNet" class="muted" style="font-size:12px;margin-top:6px">בודק יצירה…</div></div>';
          setTimeout(function () {
            db.rpc('admin_net_result', { p_id: d.req }).then(function (n) {
              var s = n.data && n.data.status, el = $('uNet'); if (!el) return;
              el.textContent = (s === 200 || s === 201) ? '✓ החשבון נוצר — יופיע ברשימה ברענון המסך' : (s === 422 ? '⚠ כתובת זו כבר רשומה — התפקיד יעודכן כשיחובר' : (s ? '⚠ תשובת שרת ' + s : '…עדיין בתהליך'));
            });
          }, 2500);
        });
      });
    });
  }
})();
