/* ============================================================
   פרי דרייב — CRM shell: auth, sidebar routing, theme, global search,
   side drawer, and the cars/appointments/tasks/analytics screens.
   Dashboard, leads table and lead drawer live in admin-crm.js.
   Public anon key only; all access gated by Supabase Auth + RLS.
   ============================================================ */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://gfwopgoydfqiouratcpc.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmd29wZ295ZGZxaW91cmF0Y3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDg0NTUsImV4cCI6MjEwMzIyNDQ1NX0.ukPDUGS7KjYgD7jAhzSqAEKo_eJ8gQwsHMqTBGXeux8';
  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDateTime(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); }
  function nis(n) { return n == null || n === '' ? '—' : '₪' + Number(n).toLocaleString('en-US'); }
  function view(html) { $('view').innerHTML = html; }
  function loading() { view('<div class="loading">טוען…</div>'); }
  function errBox(msg) { view('<div class="card"><p class="err">שגיאה: ' + esc(msg) + '</p></div>'); }
  function stat(k, v, trend) {
    // trend===true נועד רק לסמן כרטיס "היום" (לא טקסט מגמה) — בעבר הודפס "true ▲"; עכשיו מוצג תג "היום".
    var live = trend === true;
    var ts = (trend && !live) ? String(trend) : '';
    var t = ts ? '<div class="t ' + (ts[0] === '-' ? 'down' : 'up') + '">' + (ts[0] === '-' ? '▼ ' : '▲ ') + esc(ts) + '</div>'
              : (live ? '<div class="t up">● היום</div>' : '');
    return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + t + '</div>';
  }

  // ---------- drawer ----------
  function openDrawer(html) { $('drawer').innerHTML = html; $('drawer').classList.add('open'); $('overlay').classList.add('open'); }
  function closeDrawer() { $('drawer').classList.remove('open'); $('overlay').classList.remove('open'); }
  $('overlay').addEventListener('click', function () { closeDrawer(); $('side').classList.remove('open'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); var dm = document.getElementById('docModal'); if (dm) dm.remove(); } });

  // ---- in-app document viewer (popup) — פותח מסמך מ-lead-docs בלי להוריד ----
  function viewDoc(path, name) {
    var host = document.createElement('div'); host.id = 'docModal';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    host.innerHTML = '<div style="background:var(--surface);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);max-width:920px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)"><b style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">📄 ' + esc(name || 'מסמך') + '</b><div style="display:flex;gap:6px;flex:none"><a class="btn btn-ghost btn-sm" id="docNewTab" target="_blank" rel="noopener">↗ בכרטיסייה</a><button class="btn btn-ghost btn-sm" id="docClose">✕ סגור</button></div></div>' +
      '<div id="docBody" style="flex:1;overflow:auto;background:var(--surface-2);display:flex;align-items:center;justify-content:center;min-height:340px"><p class="muted">טוען…</p></div></div>';
    document.body.appendChild(host);
    function close() { host.remove(); }
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    host.querySelector('#docClose').addEventListener('click', close);
    db.storage.from('lead-docs').createSignedUrl(path, 3600).then(function (r) {
      var url = r.data && r.data.signedUrl, body = host.querySelector('#docBody'), nt = host.querySelector('#docNewTab');
      if (!url) { body.innerHTML = '<p class="muted" style="color:var(--danger)">לא ניתן לפתוח את המסמך</p>'; return; }
      nt.href = url;
      var n = (path || name || '').toLowerCase();   // ה-path תמיד נושא את הסיומת האמיתית (השם עשוי להיות ידידותי בלי סיומת)
      if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) body.innerHTML = '<img src="' + esc(url) + '" style="max-width:100%;max-height:88vh;object-fit:contain">';
      else if (/\.html?$/.test(n)) {
        // HTML: מביאים כטקסט ומרנדרים ב-srcdoc — עוקף ניחוש-קידוד שגוי של הדפדפן (עברית UTF-8) ומונע הורדה.
        // sandbox ללא allow-scripts = הגנת-עומק (מסמך שהועלה לא יריץ סקריפט); allow-same-origin לרינדור תקין.
        var ifr = document.createElement('iframe');
        ifr.style.cssText = 'width:100%;height:88vh;border:0;background:#fff';
        // allow-modals → מאפשר print(); ללא allow-scripts → מסמך שהועלה לא יריץ סקריפט (הגנת-עומק)
        ifr.setAttribute('sandbox', 'allow-same-origin allow-modals');
        nt.style.display = 'none';   // "↗ בכרטיסייה" ל-.html מציג קוד (Supabase מגיש text/plain) — מסתירים
        body.innerHTML = ''; body.appendChild(ifr);
        fetch(url).then(function (rr) { return rr.text(); }).then(function (t) {
          ifr.srcdoc = t;
          // כפתור "הורד PDF": מדפיס את ה-iframe המסונדבק עצמו → "שמירה כ-PDF" = PDF וקטורי מושלם (עברית תקינה, בלי הרצת סקריפט)
          var pb = document.createElement('button'); pb.className = 'btn btn-sm'; pb.textContent = '📄 הורד PDF';
          pb.addEventListener('click', function () {
            try { ifr.contentWindow.focus(); ifr.contentWindow.print(); }
            catch (e) { alert('לא ניתן לפתוח את חלון ההדפסה. נסו שוב או פתחו את ההסכם מתוך העסקה.'); }
          });
          nt.parentNode.insertBefore(pb, nt);
        }).catch(function () { ifr.removeAttribute('sandbox'); ifr.src = url; });
      }
      else if (/\.(pdf|csv|txt|json|xml)$/.test(n)) body.innerHTML = '<iframe src="' + esc(url) + '" style="width:100%;height:88vh;border:0;background:#fff"></iframe>';
      else { var isWord = /\.docx?$/.test(n); body.innerHTML = '<div style="text-align:center;padding:44px 20px"><div style="font-size:46px">' + (isWord ? '📝' : '📎') + '</div><p class="muted" style="margin:12px 0 16px">' + (isWord ? 'מסמך Word — הורידו ופתחו ב-Word (או Google Docs).<br>משם ניתן "שמור כ-PDF".' : 'לא ניתן להציג תצוגה מקדימה לקובץ מסוג זה.<br>פתחו אותו בכרטיסייה חדשה או הורידו.') + '</p><a class="btn btn-sm" href="' + esc(url) + '" download target="_blank" rel="noopener">⬇ הורד' + (isWord ? ' ופתח ב-Word' : '') + '</a></div>'; }   // מסמכי לקוח לא נשלחים לשרת חיצוני
    });
  }

  // ספריית התמונות של icar.co.il חוסמת hotlinking (403 בלי Referer שלה).
  // הכתובות מגיעות מגיליון הרכבים ונדרסות בכל sync-cars, לכן מנתבים דרך proxy
  // במקום לתקן את המסד. כל מקור אחר עובר as-is.
  function carImg(u) {
    if (!u) return u;
    return /(^https:\/\/)(www\.)?icar\.co\.il\//.test(u)
      ? SUPABASE_URL + '/functions/v1/img-proxy?u=' + encodeURIComponent(u)
      : u;
  }
  window.C2B = { db: db, $: $, esc: esc, carImg: carImg, fmt: fmtDateTime, nis: nis, view: view, loading: loading, errBox: errBox, stat: stat, openDrawer: openDrawer, closeDrawer: closeDrawer, viewDoc: viewDoc, go: function (n, o) { return go(n, o); } };

  // ---------- theme ----------
  (function () {
    var t = localStorage.getItem('c2b_admin_theme') || 'light';
    document.documentElement.setAttribute('data-theme', t);
    $('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
  })();
  $('themeToggle').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    localStorage.setItem('c2b_admin_theme', cur);
    this.textContent = cur === 'dark' ? '☀️' : '🌙';
  });
  $('burger').addEventListener('click', function () { var o = $('side').classList.toggle('open'); if (window.innerWidth <= 820) $('overlay').classList.toggle('open', o); });

  // ---------- tasks bell ----------
  function loadBell() {
    db.from('tasks').select('id,title,due_at,done,lead_id').eq('done', false).order('due_at', { ascending: true }).then(function (r) {
      var tasks = r.data || [], now = Date.now();
      var over = tasks.filter(function (t) { return t.due_at && new Date(t.due_at).getTime() < now; });
      var b = $('bellBadge');
      if (tasks.length) { b.textContent = tasks.length; b.classList.remove('hidden'); b.style.background = over.length ? 'var(--danger)' : 'var(--ok)'; } else b.classList.add('hidden');
      $('bellMenu').innerHTML = tasks.map(function (t) {
        var isOver = t.due_at && new Date(t.due_at).getTime() < now;
        return '<div class="bt ' + (isOver ? 'over' : 'up') + '"' + (t.lead_id ? ' data-lead="' + t.lead_id + '"' : '') + '><span class="d"></span><div style="flex:1"><div>' + esc(t.title) + '</div><div class="muted" style="font-size:12px">' + (t.due_at ? fmtDateTime(t.due_at) : 'ללא מועד') + '</div></div></div>';
      }).join('') || '<div class="bt muted">אין משימות פתוחות 🎉</div>';
      $('bellMenu').querySelectorAll('.bt[data-lead]').forEach(function (el) { el.addEventListener('click', function () { $('bellMenu').classList.add('hidden'); window.C2B_openLeadCard(el.dataset.lead); }); });
    }).catch(function () {});
  }
  $('bell').addEventListener('click', function (e) { e.stopPropagation(); $('bellMenu').classList.toggle('hidden'); loadBell(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('#bell') && !e.target.closest('#bellMenu')) $('bellMenu').classList.add('hidden'); });

  // ---------- auth ----------
  function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); }
  function showApp(session) {
    $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('whoami').textContent = session.user.email;
    window.C2B.userId = session.user.id;
    window.C2B.userName = session.user.email;
    window.C2B.lists = {};
    loadLists();
    loadConfig();
    loadBrandCompanies();
    db.from('profiles').select('role,full_name,views,active,sip_ext,phone').eq('user_id', session.user.id).single().then(function (r) {
      window.C2B.userSip = (r.data && r.data.sip_ext) || '';
      window.C2B.userPhone = (r.data && r.data.phone) || '';
      // אכיפת השבתה — משתמש לא-פעיל מנותק מיד (בנוסף ל-RLS ו-Cloudflare Access)
      if (r.data && r.data.active === false) {
        db.auth.signOut().then(function () { showLogin(); });
        alert('החשבון שלך הושבת על ידי מנהל המערכת. לפרטים פנה למנהל.');
        return;
      }
      window.C2B.role = (r.data && r.data.role) || 'sales';
      window.C2B.views = (r.data && r.data.views && r.data.views.length) ? r.data.views : (DEFAULT_VIEWS[window.C2B.role] || ['dashboard']);
      if (r.data && r.data.full_name) { window.C2B.userName = r.data.full_name; $('whoami').textContent = r.data.full_name + ' · ' + roleLabel(window.C2B.role); }
      applyRole(window.C2B.role); refreshBadges(); go('dashboard');
    });
  }
  // admin-managed dropdown lists (brand / source / marketing_company / utm_source)
  var LIST_FIELDS = [['brand', 'מותג'], ['source', 'מקור הגעה'], ['marketing_company', 'חברת שיווק'], ['utm_source', 'utm_source']];
  function loadLists() {
    db.from('field_options').select('field,value').order('value', { ascending: true }).then(function (r) {
      var lists = {}; (r.data || []).forEach(function (o) { (lists[o.field] = lists[o.field] || []).push(o.value); });
      window.C2B.lists = lists;
    }).catch(function () { window.C2B.lists = {}; });
  }

  // בונה <option>-ים ל-select מעוצב מתוך רשימת ערכים (כולל שמירת הערך הנוכחי גם אם אינו ברשימה)
  window.C2B.selOpts = function (values, cur, placeholder) {
    var out = '<option value="">' + (placeholder || '— בחר —') + '</option>', has = false;
    (values || []).forEach(function (v) { var s = String(v); out += '<option value="' + esc(s) + '"' + (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>'; if (s === cur) has = true; });
    if (cur && !has) out += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    return out;
  };

  // רשימת המותגים-השיווקיים (מ-brand_companies) — לסינון דוחות "לפי מותג" (רק המותגים שלנו, לא יצרנים)
  window.C2B.marketingBrands = [];
  function loadBrandCompanies() {
    db.from('brand_companies').select('brand').then(function (r) {
      window.C2B.marketingBrands = (r.data || []).map(function (o) { return o.brand; });
    }, function () {});
  }

  // ---------- Telephony (SIP / Click-to-Call) ----------
  window.C2B.tel = { mode: 'tel', sip_domain: '', webhook_url: '', country: '972' };
  function loadConfig() {
    db.from('app_config').select('value').eq('key', 'telephony').maybeSingle().then(function (r) {
      if (r && r.data && r.data.value) window.C2B.tel = Object.assign({ mode: 'tel', sip_domain: '', webhook_url: '', country: '972' }, r.data.value);
    }, function () {});
  }
  window.C2B.toast = function (msg, bad) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:' + (bad ? '#dc2626' : 'var(--brand,#c74e12)') + ';color:#fff;padding:10px 18px;border-radius:10px;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.22);font-size:14px;font-weight:600';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 420); }, 2600);
  };
  function normPhone(p) {
    var d = String(p || '').replace(/[^\d+]/g, '');
    if (!d) return '';
    var cc = (window.C2B.tel && window.C2B.tel.country) || '972';
    if (d.charAt(0) === '+') return d;
    if (d.charAt(0) === '0') return '+' + cc + d.slice(1);
    if (d.indexOf(cc) === 0) return '+' + d;
    return d;
  }
  window.C2B.dial = function (phone, leadId) {
    var num = normPhone(phone); if (!num) { window.C2B.toast('אין מספר טלפון לחיוג', true); return; }
    var tel = window.C2B.tel || { mode: 'tel' };
    if (tel.mode === 'webhook' && tel.webhook_url) {
      window.C2B.toast('📞 מחייג אל ' + num + '…');
      fetch(tel.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: num, agent: window.C2B.userName || '', agent_id: window.C2B.userId || '', agent_sip: window.C2B.userSip || '', lead_id: leadId || null }) })
        .then(function (r) { if (!r.ok) window.C2B.toast('שגיאת חיוג (' + r.status + ') — בדוק את ה-Webhook בהגדרות', true); }, function () { window.C2B.toast('שגיאת חיוג — בדוק את כתובת ה-Webhook בהגדרות', true); });
    } else if (tel.mode === 'sip') {
      window.location.href = 'sip:' + num.replace(/^\+/, '') + (tel.sip_domain ? '@' + tel.sip_domain : '');
    } else {
      window.location.href = 'tel:' + num;
    }
    if (leadId) { try { db.from('activities').insert({ lead_id: leadId, type: 'call', body: '📞 חיוג יוצא אל ' + num, created_by: window.C2B.userId || null }); } catch (e) {} }
  };
  // delegated: any element with data-call triggers the dialer (works in lists, cards, anywhere)
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-call]');
    if (el) { e.preventDefault(); e.stopPropagation(); window.C2B.dial(el.getAttribute('data-call'), el.getAttribute('data-lead') || null); }
  });
  var ROLE_LABELS = { admin: 'מנהל מערכת', sales: 'סוכן מכירות', files: 'מנהלת תיקי לקוחות', accounting: 'מנהלת חשבונות', branch: 'מנהל סניף' };
  function roleLabel(r) { return ROLE_LABELS[r] || r; }
  // views a user MAY open. Admin sees all; others see dashboard+activity always,
  // plus whatever the admin granted (profiles.views). These are the defaults.
  var DEFAULT_VIEWS = {
    // מנהל מערכת רואה הכל — בלי זה C2B.views של אדמין מחושב כ-['dashboard'] בלבד
    admin: ['dashboard','leads','files','accounting','cars','appointments','tasks','analytics',
            'reports','ai','quotes','documents','whatsapp','emails','sms','automations','users','branches','settings'],
    // סוכן מכירות: דשבורד, לידים, תיקי לקוחות, רכבים, יומן, משימות
    sales: ['dashboard', 'leads', 'files', 'cars', 'appointments', 'tasks'],
    // מנהלת תיקי לקוחות: דשבורד, תיקי לקוחות, רכבים, יומן, משימות, הצעות מחיר, מסמכים והסכמים
    files: ['dashboard', 'files', 'cars', 'appointments', 'tasks', 'quotes', 'documents'],
    // מנהלת חשבונות: דשבורד, הנהלת חשבונות, רכבים, יומן, משימות, דוחות, עוזר AI, הצעות מחיר, מסמכים והסכמים
    accounting: ['dashboard', 'accounting', 'cars', 'appointments', 'tasks', 'reports', 'ai', 'quotes', 'documents'],
    // מנהל סניף: כל התפעול של הסניף — בלי הנהלת חשבונות, משתמשים והגדרות
    branch: ['dashboard', 'leads', 'files', 'cars', 'appointments', 'tasks', 'analytics', 'reports', 'quotes', 'documents', 'whatsapp', 'emails', 'sms']
  };
  // screens the admin can grant when creating a user (label + key)
  var GRANTABLE_VIEWS = [
    ['dashboard', 'דשבורד'], ['leads', 'לידים'], ['files', 'תיקי לקוחות'], ['accounting', 'הנהלת חשבונות'],
    ['cars', 'רכבים'], ['appointments', 'יומן פגישות'], ['tasks', 'משימות'], ['analytics', 'אנליטיקס'], ['reports', 'דוחות'],
    ['ai', 'עוזר AI'], ['quotes', 'הצעות מחיר'], ['documents', 'מסמכים והסכמים'], ['whatsapp', 'WhatsApp'], ['emails', 'מיילים'], ['sms', 'SMS']
  ];
  function navAllowed(nav, role) {
    if (role === 'admin' || !role) return true;
    if (nav === 'activity' || nav === 'dashboard') return true;   // always available
    if (nav === 'users' || (nav && nav.indexOf('soon:') === 0)) return false; // admin-only
    var views = (window.C2B && window.C2B.views) || DEFAULT_VIEWS[role] || ['dashboard'];
    return views.indexOf(nav) >= 0;
  }
  function applyRole(role) {
    $('nav').querySelectorAll('.nav-item, .nav-group-label').forEach(function (it) {
      if (it.classList.contains('nav-group-label')) { it.style.display = role === 'admin' ? '' : 'none'; return; }
      it.style.display = navAllowed(it.dataset.nav, role) ? '' : 'none';
    });
  }
  window.C2B.GRANTABLE_VIEWS = GRANTABLE_VIEWS;
  window.C2B.DEFAULT_VIEWS = DEFAULT_VIEWS;
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); $('loginErr').textContent = '';
    db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value }).then(function (r) {
      if (r.error) { $('loginErr').textContent = 'התחברות נכשלה: ' + r.error.message; return; }
      showApp(r.data.session);
    });
  });
  $('logout').addEventListener('click', function () { db.auth.signOut().then(showLogin); });
  // forgot password → Supabase recovery email → reset.html
  $('forgot').addEventListener('click', function (e) {
    e.preventDefault();
    var em = $('email').value.trim();
    if (!em) { $('loginErr').style.color = 'var(--danger)'; $('loginErr').textContent = 'הזינו אימייל למעלה ואז לחצו "שכחתי סיסמה".'; return; }
    var redirect = 'https://tzahilevi1.github.io/freedrive-crm/reset.html';
    db.auth.resetPasswordForEmail(em, { redirectTo: redirect }).then(function (r) {
      $('loginErr').style.color = r.error ? 'var(--danger)' : 'var(--ok)';
      $('loginErr').textContent = r.error ? ('שגיאה: ' + r.error.message) : 'נשלח מייל לאיפוס סיסמה (אם החשבון קיים). בדקו את תיבת הדואר.';
    });
  });
  // activity screen now lives in the header (next to the bell)
  $('activityBtn').addEventListener('click', function () { go('activity'); });

  // ---------- routing ----------
  function setActive(nav, status) {
    var items = $('nav').querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      it.classList.toggle('active', it.dataset.nav === nav && (status == null || it.dataset.status === status || (it.dataset.status === undefined && !it.dataset.status)));
    }
    var sub = $('leadSub'); if (sub) sub.classList.toggle('open', nav === 'leads');
  }
  function go(nav, opts) {
    opts = opts || {};
    if (window.C2B && window.C2B.role && !navAllowed(nav, window.C2B.role)) { nav = 'dashboard'; opts = {}; }
    if (nav === 'users') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderUsers(); }
    setActive(nav, opts.status);
    if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); }
    if (nav === 'dashboard') return window.C2B_renderDashboard && window.C2B_renderDashboard();
    if (nav === 'leads') return window.C2B_renderLeads && window.C2B_renderLeads(opts.status);
    if (nav === 'files') return window.C2B_renderFiles && window.C2B_renderFiles();
    if (nav === 'accounting') return window.C2B_renderAccounting && window.C2B_renderAccounting();
    if (nav === 'activity') return window.C2B_renderActivity && window.C2B_renderActivity();
    if (nav === 'cars') return renderCars();
    if (nav === 'appointments') return renderAppointments();
    if (nav === 'tasks') return renderTasks();
    if (nav === 'analytics') return renderAnalytics();
    if (nav === 'reports') return renderReports();
    if (nav === 'ai') return renderAI();
    if (nav === 'settings') return renderSettings();
    if (nav === 'quotes') return window.C2B_renderQuotes && window.C2B_renderQuotes();
    if (nav === 'documents') return window.C2B_renderDocuments && window.C2B_renderDocuments();
    if (nav === 'whatsapp') return window.C2B_renderComms && window.C2B_renderComms('whatsapp');
    if (nav === 'emails') return window.C2B_renderComms && window.C2B_renderComms('emails');
    if (nav === 'sms') return window.C2B_renderComms && window.C2B_renderComms('sms');
    if (nav === 'automations') return window.C2B_renderAutomations && window.C2B_renderAutomations();
    if (nav === 'branches') return window.C2B_renderBranches && window.C2B_renderBranches();
    if (nav.indexOf('soon:') === 0) return renderSoon(nav.slice(5));
    return window.C2B_renderDashboard && window.C2B_renderDashboard();
  }
  $('nav').addEventListener('click', function (e) {
    var it = e.target.closest('.nav-item'); if (!it) return;
    go(it.dataset.nav, { status: it.dataset.status });
  });

  function refreshBadges() {
    db.from('leads').select('id', { count: 'exact', head: true }).then(function (r) { if (r.count != null) $('bLeads').textContent = r.count; });
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('done', false).then(function (r) { if (r.count != null) $('bTasks').textContent = r.count; }).catch(function () {});
    loadBell();
  }

  // ---------- global search ----------
  var gsT;
  $('gsearch').addEventListener('input', function () {
    var q = this.value.trim().replace(/[(),*]/g, ' ').trim(); clearTimeout(gsT);   // strip PostgREST filter-grammar chars
    if (q.length < 2) { $('gsres').classList.add('hidden'); return; }
    gsT = setTimeout(function () {
      db.from('leads').select('id,name,phone,car,status').or('name.ilike.%' + q + '%,phone.ilike.%' + q + '%,car.ilike.%' + q + '%').limit(8).then(function (r) {
        var rows = (r.data || []).map(function (l) { return '<div class="sr" data-lead="' + l.id + '"><b>' + esc(l.name) + '</b> <span class="muted">· ' + esc(l.phone) + (l.car ? ' · ' + esc(l.car) : '') + '</span></div>'; }).join('');
        $('gsres').innerHTML = rows || '<div class="sr muted">אין תוצאות</div>';
        $('gsres').classList.remove('hidden');
        $('gsres').querySelectorAll('.sr[data-lead]').forEach(function (el) { el.addEventListener('click', function () { $('gsres').classList.add('hidden'); $('gsearch').value = ''; window.C2B_openLeadCard(el.dataset.lead); }); });
      });
    }, 250);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) $('gsres').classList.add('hidden'); });

  // ---------- generic field filter (used on leads / files / cars) ----------
  var OPS = { contains: 'מכיל', eq: 'שווה ל', ne: 'שונה מ', gt: 'גדול מ', lt: 'קטן מ', empty: 'ריק', nempty: 'לא ריק' };
  // fields: [{key,label,options?:[{v,l}],get?:fn(row)}]  onApply: fn() → caller redraws
  function makeFilter(fields, onApply) {
    var byKey = {}; fields.forEach(function (f) { byKey[f.key] = f; });
    var state = [];
    function valCtl(f) {
      if (f && f.options) return '<select id="fbVal">' + f.options.map(function (o) { return '<option value="' + esc(o.v) + '">' + esc(o.l) + '</option>'; }).join('') + '</select>';
      return '<input id="fbVal" placeholder="ערך…" style="width:150px">';
    }
    function get(f, row) { var d = byKey[f.field]; return d && d.get ? d.get(row) : row[f.field]; }
    var api = {
      render: function () {
        var chips = state.map(function (f, i) {
          var d = byKey[f.field];
          var shown = d && d.options ? ((d.options.filter(function (o) { return String(o.v) === String(f.val); })[0] || {}).l || f.val) : f.val;
          return '<span class="chip">' + esc(d ? d.label : f.field) + ' ' + OPS[f.op] + ' ' + esc(shown || '') + ' <b data-rmf="' + i + '">✕</b></span>';
        }).join('');
        return '<div class="filterbar" id="fbar"><span class="muted" style="font-size:12px">🧲 סינון לפי שדה:</span>' +
          '<select id="fbField">' + fields.map(function (f) { return '<option value="' + f.key + '">' + esc(f.label) + '</option>'; }).join('') + '</select>' +
          '<select id="fbOp">' + Object.keys(OPS).map(function (k) { return '<option value="' + k + '">' + OPS[k] + '</option>'; }).join('') + '</select>' +
          valCtl(fields[0]) +
          '<button class="btn btn-sm" id="fbAdd">+ הוסף</button>' +
          (state.length ? '<button class="btn btn-ghost btn-sm" id="fbClear">נקה הכל</button>' : '') + chips + '</div>';
      },
      bind: function () {
        var add = $('fbAdd'); if (!add) return;
        $('fbField').addEventListener('change', function () { var f = byKey[this.value]; var holder = $('fbVal'); if (holder) holder.outerHTML = valCtl(f); });
        add.addEventListener('click', function () {
          var field = $('fbField').value, op = $('fbOp').value, val = ($('fbVal') && $('fbVal').value || '').trim();
          if (op !== 'empty' && op !== 'nempty' && !val) return;
          state.push({ field: field, op: op, val: val }); onApply();
        });
        if ($('fbClear')) $('fbClear').addEventListener('click', function () { state = []; onApply(); });
        $('fbar').querySelectorAll('[data-rmf]').forEach(function (b) { b.addEventListener('click', function () { state.splice(+b.dataset.rmf, 1); onApply(); }); });
      },
      match: function (row) {
        return state.every(function (f) {
          var raw = get(f, row); var s = (raw == null ? '' : String(raw)).toLowerCase(), q = String(f.val).toLowerCase();
          if (f.op === 'contains') return s.indexOf(q) >= 0;
          if (f.op === 'eq') return s === q;
          if (f.op === 'ne') return s !== q;
          if (f.op === 'gt') return parseFloat(raw) > parseFloat(f.val);
          if (f.op === 'lt') return parseFloat(raw) < parseFloat(f.val);
          if (f.op === 'empty') return !s;
          if (f.op === 'nempty') return !!s;
          return true;
        });
      },
      count: function () { return state.length; }
    };
    return api;
  }
  window.C2B.makeFilter = makeFilter;

  // ---- reusable column chooser (show/hide + reorder columns), persisted per view ----
  function closeColPanel() { var m = document.getElementById('colpickmenu'); if (m) m.remove(); }
  // cols: [{key,label,cell:fn(row)->'<td>..</td>',th:'attrs?',fixed:bool,def:false-to-hide-by-default}]
  window.C2B.colPicker = function (viewKey, cols, onChange, opts) {
    var LSKEY = 'c2b_cols_' + viewKey, byKey = {}; cols.forEach(function (c) { byKey[c.key] = c; });
    var resizable = !!(opts && opts.resizable), sortable = !!(opts && opts.sortable);
    function load() {
      var s = null; try { s = JSON.parse(localStorage.getItem(LSKEY)); } catch (e) {}
      if (!s || !s.order) return { order: cols.map(function (c) { return c.key; }), hidden: cols.filter(function (c) { return !c.fixed && c.def === false; }).map(function (c) { return c.key; }), widths: {}, sort: null };
      var order = s.order.filter(function (k) { return byKey[k]; });
      cols.forEach(function (c) { if (order.indexOf(c.key) < 0) order.push(c.key); });
      return { order: order, hidden: (s.hidden || []).filter(function (k) { return byKey[k] && !byKey[k].fixed; }), widths: (s.widths && typeof s.widths === 'object') ? s.widths : {}, sort: (s.sort && s.sort.key ? s.sort : null) };
    }
    var state = load();
    function save() { try { localStorage.setItem(LSKEY, JSON.stringify(state)); } catch (e) {} }
    function visible() { return state.order.map(function (k) { return byKey[k]; }).filter(function (c) { return c && state.hidden.indexOf(c.key) < 0; }); }
    function openPanel(anchor) {
      closeColPanel();
      var m = document.createElement('div'); m.id = 'colpickmenu'; m.className = 'colpick-menu';
      m.innerHTML = '<div class="cp-head">בחירת עמודות · גררו בחצים לשינוי סדר</div><div class="cp-list">' +
        state.order.map(function (k) { var c = byKey[k], on = state.hidden.indexOf(k) < 0;
          return '<div class="cp-row" data-k="' + esc(k) + '"><span class="cp-mv"><button data-cpu aria-label="למעלה">▲</button><button data-cpd aria-label="למטה">▼</button></span><span class="cp-lbl">' + esc(c.label) + (c.fixed ? ' 🔒' : '') + '</span><label class="cp-sw"><input type="checkbox" data-cptg ' + (on ? 'checked' : '') + (c.fixed ? ' disabled' : '') + '><span class="cp-sl"></span></label></div>';
        }).join('') + '</div><button class="btn btn-ghost btn-sm" data-cpreset style="width:100%;margin-top:8px">איפוס לברירת מחדל</button>';
      document.body.appendChild(m);
      var r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 6) + 'px'; m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      m.addEventListener('click', function (e) { e.stopPropagation(); });
      m.querySelectorAll('[data-cptg]').forEach(function (cb) { cb.addEventListener('change', function () { var k = cb.closest('.cp-row').dataset.k, i = state.hidden.indexOf(k); if (cb.checked) { if (i >= 0) state.hidden.splice(i, 1); } else if (i < 0) state.hidden.push(k); save(); onChange(); }); });
      function move(k, d) { var i = state.order.indexOf(k), j = i + d; if (j < 0 || j >= state.order.length) return; var t = state.order[i]; state.order[i] = state.order[j]; state.order[j] = t; save(); onChange(); openPanel(anchor); }
      m.querySelectorAll('[data-cpu]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); move(b.closest('.cp-row').dataset.k, -1); }); });
      m.querySelectorAll('[data-cpd]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); move(b.closest('.cp-row').dataset.k, 1); }); });
      m.querySelector('[data-cpreset]').addEventListener('click', function () { try { localStorage.removeItem(LSKEY); } catch (e) {} state = load(); onChange(); openPanel(anchor); });
      setTimeout(function () { document.addEventListener('click', closeColPanel, { once: true }); }, 0);
    }
    function initResize() {
      if (resizable) document.querySelectorAll('.col-grip[data-cv="' + viewKey + '"]').forEach(function (g) {
        g.addEventListener('mousedown', function (e) {
          e.preventDefault(); e.stopPropagation();
          var th = g.closest('th'); if (!th) return;
          var key = g.dataset.ck, startX = e.clientX, startW = th.offsetWidth, tbl = th.closest('table');
          if (tbl) tbl.classList.add('rz-drag');
          function mv(ev) { var w = Math.max(56, startW + (startX - ev.clientX)); th.style.width = w + 'px'; state.widths[key] = w; }
          function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (tbl) tbl.classList.remove('rz-drag'); save(); }
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
      });
    }
    // מיון בלחיצה על כותרת — delegation אחד ששורד רינדורים: א→ת/קטן→גדול, לחיצה שנייה הופכת, שלישית מבטלת
    if (sortable) document.addEventListener('click', function (e) {
      var th = e.target.closest && e.target.closest('th[data-cv="' + viewKey + '"][data-sortcol]');
      if (!th || (e.target.closest && e.target.closest('.col-grip'))) return;
      var k = th.dataset.sortcol, s = state.sort;
      if (!s || s.key !== k) state.sort = { key: k, dir: 'asc' };
      else if (s.dir === 'asc') state.sort = { key: k, dir: 'desc' };
      else state.sort = null;
      save(); onChange();
    });
    // מיון שורות לפי העמודה הפעילה (accessor c.sort או row[key]); מספרים כמספרים, טקסט/תאריכים לפי סדר עברי
    function sortRows(rows) {
      var s = state.sort; if (!s || !s.key) return rows; var c = byKey[s.key]; if (!c) return rows;
      var getv = c.sort || function (r) { return r[s.key]; };
      var arr = rows.slice();
      arr.sort(function (a, b) {
        var va = getv(a), vb = getv(b); if (va == null) va = ''; if (vb == null) vb = ''; var cmp;
        // מספר טהור בלבד (אחרי הסרת פסיקי-אלפים) — תאריכי ISO/טקסט ממויינים כמחרוזת (סדר כרונולוגי/עברי)
        var sa = String(va).replace(/,/g, ''), sb = String(vb).replace(/,/g, '');
        var bothNum = /^-?\d+(\.\d+)?$/.test(sa) && /^-?\d+(\.\d+)?$/.test(sb);
        if (bothNum) cmp = parseFloat(sa) - parseFloat(sb); else cmp = String(va).localeCompare(String(vb), 'he');
        return s.dir === 'desc' ? -cmp : cmp;
      });
      return arr;
    }
    return {
      visible: visible,
      resize: initResize,
      sortRows: sortRows,
      thead: function () { return visible().map(function (c) {
        var extra = c.th || '', stW = resizable && state.widths[c.key] ? 'width:' + state.widths[c.key] + 'px' : '';
        var canSort = sortable && c.sortable !== false;
        var cursor = canSort ? 'cursor:pointer;user-select:none' : '';
        var mstyle = [stW, cursor].filter(Boolean).join(';');
        var attrs = ' data-ck="' + esc(c.key) + '" data-cv="' + esc(viewKey) + '"' + (canSort ? ' data-sortcol="' + esc(c.key) + '"' : '');
        if (extra && /style=/.test(extra) && mstyle) extra = extra.replace(/style="([^"]*)"/, 'style="$1;' + mstyle + '"');
        else if (mstyle) attrs += ' style="' + mstyle + '"';
        if (extra) attrs += ' ' + extra;
        var s = state.sort, arrow = (canSort && s && s.key === c.key) ? '<span style="color:var(--brand);font-weight:800"> ' + (s.dir === 'desc' ? '▼' : '▲') + '</span>' : '';
        var grip = resizable ? '<span class="col-grip" data-cv="' + esc(viewKey) + '" data-ck="' + esc(c.key) + '"></span>' : '';
        return '<th' + attrs + '>' + esc(c.label) + arrow + grip + '</th>';
      }).join(''); },
      cells: function (row) { return visible().map(function (c) { return c.cell(row); }).join(''); },
      colCount: function () { return visible().length; },
      button: function () { return '<button class="btn btn-ghost btn-sm" data-colpick="' + esc(viewKey) + '" title="בחירת עמודות"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px"><path d="M4 5h16M4 12h16M4 19h16"/></svg> עמודות</button>'; },
      bind: function () { var b = document.querySelector('[data-colpick="' + viewKey + '"]'); if (b) b.addEventListener('click', function (e) { e.stopPropagation(); openPanel(b); }); initResize(); }
    };
  };

  // ---------- CARS (read-only from the Google Sheet → cars.json) ----------
  var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LiK--j3BCPnHO4rZQj7N2RetdnExEmwimWTwn7kmWe8/edit';
  var CAR_COLS = 12;
  var CAR_COL_DEFS = [
    { key: 'img', label: 'תמונה', cell: function (c) { return '<td>' + (c.img ? '<img src="' + esc(carImg(c.img)) + '" style="width:52px;height:34px;object-fit:cover;border-radius:8px" onerror="this.style.display=\'none\'">' : '') + '</td>'; } },
    { key: 'brand', label: 'מותג', fixed: true, cell: function (c) { return '<td><b>' + esc(c.brand) + '</b></td>'; } },
    { key: 'name', label: 'דגם', fixed: true, cell: function (c) { return '<td>' + esc(c.name) + (c.nameEn ? '<div class="muted" style="font-size:11px">' + esc(c.nameEn) + '</div>' : '') + '</td>'; } },
    { key: 'trim', label: 'גרסה', cell: function (c) { return '<td class="muted">' + esc(c.trim || '—') + '</td>'; } },
    { key: 'engine', label: 'מנוע', cell: function (c) { return '<td class="muted">' + esc(c.engine || '—') + '</td>'; } },
    { key: 'seats', label: 'מושבים', cell: function (c) { return '<td>' + esc(c.seats || '—') + '</td>'; } },
    { key: 'colors', label: 'צבעים', cell: function (c) { return '<td class="muted" style="white-space:normal;max-width:120px">' + esc(c.colors || '—') + '</td>'; } },
    { key: 'm', label: 'החזר', cell: function (c) { return '<td>' + nis(c.m) + '</td>'; } },
    { key: 'p', label: 'מחיר', cell: function (c) { return '<td>' + nis(c.p) + '</td>'; } },
    { key: 'commission', label: 'עמלת סוכן', cell: function (c) { return '<td style="color:var(--ok);font-weight:700">' + (c.commission > 0 ? nis(c.commission) : '—') + '</td>'; } },
    { key: 'down', label: 'מקדמה', cell: function (c) { return '<td class="muted">' + (c.down > 0 ? nis(c.down) : 'אין מקדמה') + '</td>'; } },
    { key: 'code', label: 'קוד', cell: function (c) { return '<td class="muted">' + esc(c.code || '—') + '</td>'; } }
  ];
  var carCols = null;
  function carRows(list) {
    return list.map(function (c) {
      return '<tr><td>' + (c.img ? '<img src="' + esc(carImg(c.img)) + '" style="width:52px;height:34px;object-fit:cover;border-radius:8px" onerror="this.style.display=\'none\'">' : '') +
        '</td><td><b>' + esc(c.brand) + '</b></td><td>' + esc(c.name) + (c.nameEn ? '<div class="muted" style="font-size:11px">' + esc(c.nameEn) + '</div>' : '') + '</td>' +
        '<td class="muted">' + esc(c.trim) + '</td><td class="muted">' + esc(c.engine) + '</td><td>' + esc(c.seats || '') + '</td>' +
        '<td class="muted" style="white-space:normal;max-width:120px">' + esc(c.colors) + '</td>' +
        '<td>' + nis(c.m) + '</td><td>' + nis(c.p) + '</td>' +
        '<td style="color:var(--ok);font-weight:700">' + nis(c.commission) + '</td>' +
        '<td class="muted">' + esc(c.down ? nis(c.down) : '—') + '</td><td class="muted">' + esc(c.code) + '</td></tr>';
    }).join('');
  }
  // ממפה שורת cars מ-Supabase למבנה שהתצוגה/הפיקרים מצפים לו (m=החזר, p=מחיר, engine=דלק, extra jsonb)
  function mapCar(c) {
    var x = c.extra || {};
    // החזר חודשי = עמודה J (60%) מהגיליון; עמלת סוכן = עמודה K; מקדמה = עמודה L
    var m = (+x.monthly_60 > 0) ? +x.monthly_60 : (c.monthly || 0);
    var commission = (+x.agent_commission > 0) ? +x.agent_commission : (+x.commission > 0 ? +x.commission : 0);
    var down = (+x.down_payment > 0) ? +x.down_payment : (+x.down > 0 ? +x.down : 0);
    return {
      brand: c.brand, name: c.name, nameEn: x.name_en || x.nameEn || '', trim: c.trim,
      engine: c.fuel || x.engine || '', seats: x.seats || '', colors: x.color || x.colors || '',
      m: m, p: c.price, commission: commission, down: down,
      code: x.levi_code || x.code || x.plate || '', img: c.img, condition: c.condition || 'חדש',
      year: c.year, cat: c.cat, fuel: c.fuel, km: x.km, hand: x.hand, extra: x
    };
  }
  window.C2B.mapCar = mapCar;
  function renderCars() {
    loading();
    db.from('cars').select('*').order('brand', { ascending: true }).order('name', { ascending: true }).then(function (r) {
      if (r.error) { errBox(r.error.message); return; }
      var cars = (r.data || []).map(mapCar);
      var newN = cars.filter(function (c) { return c.condition !== 'יד 2'; }).length;
      var usedN = cars.length - newN;
      var curCond = 'חדש';   // טאב פעיל: חדש / יד 2
      var brands = Object.keys(cars.reduce(function (a, c) { if (c.brand) a[c.brand] = 1; return a; }, {})).sort();
      var filter = makeFilter([
        { key: 'brand', label: 'מותג', options: [{ v: '', l: 'הכל' }].concat(brands.map(function (b) { return { v: b, l: b }; })) },
        { key: 'name', label: 'דגם' }, { key: 'trim', label: 'גרסה' }, { key: 'engine', label: 'מנוע' },
        { key: 'colors', label: 'צבע' }, { key: 'code', label: 'קוד דגם' },
        { key: 'p', label: 'מחיר' }, { key: 'm', label: 'החזר חודשי' }, { key: 'commission', label: 'עמלת סוכן' }, { key: 'seats', label: 'מושבים' }
      ], draw);
      if (!carCols) carCols = window.C2B.colPicker('cars', CAR_COL_DEFS, draw, { sortable: true });
      view('<div class="card"><div class="row-between"><h3>רכבים <span class="muted" id="ccount"></span></h3><div><input class="inp" id="cq" placeholder="חיפוש חופשי…" style="width:180px"> <a class="btn btn-sm" href="' + SHEET_URL + '" target="_blank" rel="noopener">✎ פתח את הגיליון</a> ' + (window.C2B.role === 'admin' ? '<button class="btn btn-sm" id="carsSync">🔄 סנכרן מהגיליון</button> ' : '') + carCols.button() + '</div></div>' +
        '<div class="tabs2" id="carTabs" style="margin:8px 0 12px"><button class="active" data-cond="חדש">🚗 רכבים חדשים (' + newN + ')</button><button data-cond="יד 2">🔑 יד 2 (' + usedN + ')</button></div>' +
        '<div id="carsBody"></div></div>');
      function list() {
        var q = ($('cq') && $('cq').value || '').trim().toLowerCase();
        return cars.filter(function (c) {
          if ((c.condition || 'חדש') !== curCond) return false;
          if (q && ((c.brand || '') + ' ' + (c.name || '') + ' ' + (c.nameEn || '') + ' ' + (c.trim || '')).toLowerCase().indexOf(q) < 0) return false;
          return filter.match(c);
        });
      }
      $('carTabs').querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          curCond = b.dataset.cond;
          $('carTabs').querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active'); draw();
        });
      });
      function draw() {
        var rows = carCols.sortRows(list());
        var body = rows.map(function (c) { return '<tr>' + carCols.cells(c) + '</tr>'; }).join('');
        $('carsBody').innerHTML = filter.render() +
          '<div class="table-scroll"><table><thead><tr>' + carCols.thead() + '</tr></thead><tbody>' +
          (body || '<tr><td colspan="' + carCols.colCount() + '" class="empty">אין תואמים</td></tr>') + '</tbody></table></div>';
        if ($('ccount')) $('ccount').textContent = '(' + rows.length + ')';
        filter.bind();
      }
      carCols.bind();
      $('cq').addEventListener('input', draw);
      if ($('carsSync')) $('carsSync').addEventListener('click', function () {
        var b = this, old = b.textContent; b.disabled = true; b.textContent = 'מסנכרן…';
        db.functions.invoke('sync-cars', { body: {} }).then(function (r) {
          b.disabled = false; b.textContent = old;
          var d = r.data || {};
          if (r.error || d.error) { window.C2B.toast('שגיאת סנכרון: ' + ((d.error) || (r.error && r.error.message) || ''), true); return; }
          window.C2B.toast('✔ המלאי סונכרן מהגיליון'); renderCars();
        }, function () { b.disabled = false; b.textContent = old; window.C2B.toast('שגיאת סנכרון', true); });
      });
      draw();
    }).catch(function (e) { errBox(e.message || e); });
  }

  // ---------- APPOINTMENTS (calendar) ----------
  var APPT_MODES = ['פרונטלי', 'טלפוני', 'וידאו', 'בסניף'];
  var APPT_COLS = [
    { key: 'status', label: 'סטטוס', cell: function (a) { return '<td>' + (a._handled ? '<span class="done-badge">✓ בוצעה</span>' : a._soon ? '<span class="task-open">● עתידית</span>' : a._overdue ? '<span class="tag" style="background:rgba(220,38,38,.12);color:var(--danger)">⏰ עברה</span>' : '<span class="tag">חדשה</span>') + '</td>'; } },
    { key: 'name', label: 'שם', fixed: true, cell: function (a) { return '<td><b>' + esc(a.name) + '</b>' + (a._lid ? ' <span class="muted" style="font-size:11px">→ לכרטיס</span>' : '') + '</td>'; } },
    { key: 'phone', label: 'טלפון', cell: function (a) { return '<td>' + esc(a.phone || '—') + '</td>'; } },
    { key: 'when', label: 'מועד', cell: function (a) { return '<td><input type="datetime-local" class="inp" data-appt-when="' + a.id + '" value="' + a._dt + '" onclick="event.stopPropagation()" style="font-size:12.5px"></td>'; } },
    { key: 'mode', label: 'אופן', cell: function (a) { return '<td><select class="inp" data-appt-mode="' + a.id + '" onclick="event.stopPropagation()" style="width:auto;font-size:12.5px"><option value="">אופן…</option>' + APPT_MODES.map(function (m) { return '<option' + (a.appt_mode === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></td>'; } },
    { key: 'brand', label: 'מותג', cell: function (a) { return '<td><select class="inp" data-appt-brand="' + a.id + '" onclick="event.stopPropagation()" style="width:120px;font-size:12.5px">' + window.C2B.selOpts((window.C2B.marketingBrands || []), a.brand, '— מותג —') + '</select></td>'; } },
    { key: 'note', label: 'הערות', cell: function (a) { return '<td><input class="inp" data-appt-note="' + a.id + '" value="' + esc(a.note || '') + '" placeholder="הערות…" onclick="event.stopPropagation()" style="width:100%;min-width:150px;font-size:12.5px"></td>'; } },
    { key: 'type', label: 'עניין', def: false, cell: function (a) { return '<td>' + esc(a.type || '—') + '</td>'; } },
    { key: 'action', label: 'פעולה', cell: function (a) { return '<td><button class="btn btn-sm ' + (a._handled ? 'btn-ghost' : '') + '" data-appt="' + a.id + '" data-to="' + (a._handled ? 'new' : 'handled') + '" onclick="event.stopPropagation()">' + (a._handled ? 'החזר' : 'סמן כבוצעה') + '</button></td>'; } }
  ];
  var apptCols = null;
  var apptFilter = 'all';
  function renderAppointments() {
    loading();
    Promise.all([
      db.from('appointments').select('*').order('appt_at', { ascending: true }),
      db.from('leads').select('id,phone')
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var appts = res[0].data || [], byPhone = {};
      (res[1].data || []).forEach(function (l) { if (l.phone) byPhone[String(l.phone).replace(/\D/g, '')] = l.id; });
      function leadOf(a) { return a.lead_id || byPhone[String(a.phone || '').replace(/\D/g, '')] || null; }
      function whenMs(a) { return a.appt_at ? new Date(a.appt_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0); }
      var now = Date.now();
      var upcoming = appts.filter(function (a) { return a.status !== 'handled' && whenMs(a) >= now; });
      var doneA = appts.filter(function (a) { return a.status === 'handled'; });
      var overdue = appts.filter(function (a) { return a.status !== 'handled' && whenMs(a) < now; });   // עברו — לא בוצעו וחלף מועדן
      var list = apptFilter === 'upcoming' ? upcoming : apptFilter === 'done' ? doneA : apptFilter === 'overdue' ? overdue : appts;
      function tab(k, label, n) { return '<button data-af="' + k + '"' + (apptFilter === k ? ' class="active"' : '') + '>' + label + ' (' + n + ')</button>'; }
      var brandOpts = ((window.C2B.lists && window.C2B.lists.brand) || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
      function dtLocal(a) { var t = a.appt_at ? new Date(a.appt_at) : null; if (!t || isNaN(t)) return ''; var p = function (n) { return ('0' + n).slice(-2); }; return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + 'T' + p(t.getHours()) + ':' + p(t.getMinutes()); }
      list.forEach(function (a) { a._handled = a.status === 'handled'; a._lid = leadOf(a); a._soon = !a._handled && whenMs(a) >= now; a._overdue = !a._handled && whenMs(a) < now; a._dt = dtLocal(a); });
      if (!apptCols) apptCols = window.C2B.colPicker('appointments', APPT_COLS, renderAppointments, { sortable: true });
      var rows = apptCols.sortRows(list).map(function (a) {
        return '<tr' + (a._lid ? ' data-lead="' + a._lid + '" title="פתח כרטיס לקוח"' : '') + ' style="' + (a._lid ? 'cursor:pointer;' : '') + (a._handled ? 'background:rgba(22,163,74,.06)' : '') + '">' + apptCols.cells(a) + '</tr>';
      }).join('');
      view('<div class="card"><div class="row-between"><h3 style="margin:0">📅 יומן פגישות</h3><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-sm" id="apptNew">➕ פגישה חדשה</button>' + apptCols.button() + '</div></div>' +
        '<div id="apptForm"></div>' +
        '<nav class="tabs" id="apptTabs" style="margin:10px 0 12px;flex-wrap:wrap">' + tab('all', 'הכל', appts.length) + tab('upcoming', 'עתידיות', upcoming.length) + tab('overdue', 'עברו', overdue.length) + tab('done', 'בוצעו', doneA.length) + '</nav>' +
        '<datalist id="apBrand">' + brandOpts + '</datalist>' +
        '<div class="table-scroll"><table><thead><tr>' + apptCols.thead() + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + apptCols.colCount() + '" class="empty">אין פגישות</td></tr>') + '</tbody></table></div></div>');
      apptCols.bind();
      $('apptNew').addEventListener('click', function () { openApptForm(byPhone, brandOpts); });
      $('apptTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-af]'); if (b) { apptFilter = b.dataset.af; renderAppointments(); } });
      $('view').querySelectorAll('tr[data-lead]').forEach(function (tr) { tr.addEventListener('click', function () { window.C2B_openLeadCard(tr.dataset.lead); }); });
      $('view').querySelectorAll('[data-appt-when]').forEach(function (inp) { inp.addEventListener('change', function () { var v = inp.value ? new Date(inp.value) : null; var patch = { appt_at: v ? v.toISOString() : null }; if (v) { patch.appt_date = v.toLocaleDateString('he-IL'); patch.appt_time = ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2); } db.from('appointments').update(patch).eq('id', inp.dataset.apptWhen).then(renderAppointments); }); });
      $('view').querySelectorAll('[data-appt-mode]').forEach(function (s) { s.addEventListener('change', function () { db.from('appointments').update({ appt_mode: s.value || null }).eq('id', s.dataset.apptMode); }); });
      $('view').querySelectorAll('[data-appt-brand]').forEach(function (inp) { inp.addEventListener('change', function () { db.from('appointments').update({ brand: inp.value.trim() || null }).eq('id', inp.dataset.apptBrand); }); });
      $('view').querySelectorAll('[data-appt-note]').forEach(function (inp) { inp.addEventListener('change', function () { db.from('appointments').update({ note: inp.value.trim() || null }).eq('id', inp.dataset.apptNote); }); });
      $('view').querySelectorAll('button[data-appt]').forEach(function (b) { b.addEventListener('click', function () { db.from('appointments').update({ status: b.dataset.to }).eq('id', b.dataset.appt).then(renderAppointments); }); });
    });
  }
  // ---- create a new appointment (from the calendar view) ----
  function openApptForm(byPhone) {
    var host = $('apptForm'); if (!host) return;
    if (host.dataset.open === '1') { host.innerHTML = ''; host.dataset.open = '0'; return; }
    host.dataset.open = '1';
    host.innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--line);background:var(--surface-2);margin:10px 0">' +
      '<div class="grid2">' +
        '<div class="field" style="margin:0"><label>שם</label><input class="inp" id="afName" placeholder="שם הלקוח"></div>' +
        '<div class="field" style="margin:0"><label>טלפון</label><input class="inp" id="afPhone" type="tel" placeholder="050…"></div>' +
        '<div class="field" style="margin:0"><label>מועד</label><input class="inp" id="afWhen" type="datetime-local"></div>' +
        '<div class="field" style="margin:0"><label>אופן</label><select class="inp" id="afMode"><option value="">אופן…</option>' + APPT_MODES.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>' +
        '<div class="field" style="margin:0"><label>מותג</label><select class="inp" id="afBrand">' + window.C2B.selOpts((window.C2B.marketingBrands || []), '', '— מותג —') + '</select></div>' +
        '<div class="field" style="margin:0"><label>הערה</label><input class="inp" id="afNote" placeholder="הערה…"></div>' +
      '</div>' +
      '<div style="margin-top:12px"><button class="btn btn-sm" id="afSave">שמור פגישה</button> <button class="btn btn-ghost btn-sm" id="afCancel">✕ ביטול</button> <span id="afMsg" class="muted" style="font-size:13px;margin-inline-start:8px"></span></div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:8px">אם הטלפון תואם ליד קיים — הפגישה תקושר אליו אוטומטית.</p>' +
    '</div>';
    $('afCancel').addEventListener('click', function () { host.innerHTML = ''; host.dataset.open = '0'; });
    $('afSave').addEventListener('click', function () {
      var name = $('afName').value.trim(), phone = $('afPhone').value.trim(), when = $('afWhen').value, msg = $('afMsg');
      if (!name && !phone) { msg.style.color = 'var(--danger)'; msg.textContent = 'נא למלא שם או טלפון'; return; }
      if (!when) { msg.style.color = 'var(--danger)'; msg.textContent = 'נא לבחור מועד'; return; }
      var v = new Date(when), p2 = function (n) { return ('0' + n).slice(-2); };
      var lid = phone ? (byPhone[phone.replace(/\D/g, '')] || null) : null;
      var row = { name: name || null, phone: phone || null, appt_at: v.toISOString(), appt_date: v.toLocaleDateString('he-IL'), appt_time: p2(v.getHours()) + ':' + p2(v.getMinutes()), appt_mode: $('afMode').value || null, brand: $('afBrand').value.trim() || null, note: $('afNote').value.trim() || null, status: 'new', lead_id: lid };
      var btn = this; btn.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
      db.from('appointments').insert(row).then(function (r) {
        if (r.error) { btn.disabled = false; msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + r.error.message; return; }
        renderAppointments();
      });
    });
  }

  // ---------- TASKS (all open) ----------
  var TASK_COLS = [
    { key: 'status', label: 'סטטוס', cell: function (t) { return '<td>' + (t.done ? '<span class="done-badge">✓ בוצע</span>' : '<span class="task-open">● פתוחה</span>') + '</td>'; } },
    { key: 'title', label: 'משימה', fixed: true, cell: function (t) { return '<td' + (t.done ? ' class="muted" style="text-decoration:line-through"' : '') + '>' + esc(t.title) + '</td>'; } },
    { key: 'client', label: 'לקוח', cell: function (t) { var l = t._lead; return '<td>' + (l ? '<b>' + esc(l.name || '—') + '</b>' + (l.phone ? '<div class="muted" style="font-size:11px">' + esc(l.phone) + (l.car ? ' · ' + esc(l.car) : '') + '</div>' : '') : '<span class="muted">—</span>') + '</td>'; } },
    { key: 'created', label: 'נוצרה', cell: function (t) { return '<td class="muted">' + (t.created_at ? fmtDateTime(t.created_at) : '—') + '</td>'; } },
    { key: 'due', label: 'מועד', cell: function (t) { var over = !t.done && t.due_at && new Date(t.due_at).getTime() < Date.now(); return '<td' + (over ? ' style="color:var(--danger);font-weight:600"' : ' class="muted"') + '>' + (t.due_at ? fmtDateTime(t.due_at) : '—') + '</td>'; } },
    { key: 'notes', label: 'הערות', cell: function (t) { return '<td><input class="inp" data-tnote="' + t.id + '" value="' + esc(t.notes || '') + '" placeholder="הוסף הערה…" style="width:100%;min-width:150px;font-size:13px"></td>'; } },
    { key: 'open', label: 'פעולות', cell: function (t) { return '<td>' + (t.lead_id ? '<a href="#" data-lead="' + t.lead_id + '">פתח ליד →</a>' : '') + '</td>'; } }
  ];
  var taskCols = null;
  var taskFilter = 'all';
  function renderTasks() {
    loading();
    Promise.all([
      db.from('tasks').select('*').order('due_at', { ascending: true }),
      db.from('leads').select('id,name,phone,car')
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var tasks = res[0].data || [], lmap = {}, now = Date.now();
      (res[1].data || []).forEach(function (l) { lmap[l.id] = l; });
      var openList = tasks.filter(function (t) { return !t.done; });
      var doneList = tasks.filter(function (t) { return t.done; });
      var lst = taskFilter === 'open' ? openList : taskFilter === 'done' ? doneList : tasks;
      lst.forEach(function (t) { t._lead = lmap[t.lead_id]; });
      if (!taskCols) taskCols = window.C2B.colPicker('tasks', TASK_COLS, renderTasks, { sortable: true });
      var rows = taskCols.sortRows(lst).map(function (t) {
        return '<tr' + (t.done ? ' style="background:rgba(22,163,74,.05)"' : '') + '><td><input type="checkbox" data-task="' + t.id + '"' + (t.done ? ' checked' : '') + '></td>' + taskCols.cells(t) + '</tr>';
      }).join('');
      function tab(k, label, n) { return '<button data-tf="' + k + '"' + (taskFilter === k ? ' class="active"' : '') + '>' + label + ' (' + n + ')</button>'; }
      view('<div class="card"><div class="row-between"><h3 style="margin:0">✅ משימות</h3>' + taskCols.button() + '</div><nav class="tabs" id="taskTabs" style="margin:10px 0 12px;flex-wrap:wrap">' + tab('all', 'הכל', tasks.length) + tab('open', 'פתוחות', openList.length) + tab('done', 'בוצעו', doneList.length) + '</nav>' +
        '<div class="table-scroll"><table><thead><tr><th></th>' + taskCols.thead() + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + (taskCols.colCount() + 1) + '" class="empty">אין משימות</td></tr>') + '</tbody></table></div></div>');
      taskCols.bind();
      $('taskTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tf]'); if (b) { taskFilter = b.dataset.tf; renderTasks(); } });
      $('view').querySelectorAll('input[data-tnote]').forEach(function (inp) { inp.addEventListener('change', function () { db.from('tasks').update({ notes: inp.value.trim() || null }).eq('id', inp.dataset.tnote); }); });
      $('view').querySelectorAll('input[data-task]').forEach(function (cb) { cb.addEventListener('change', function () { db.from('tasks').update({ done: cb.checked }).eq('id', cb.dataset.task).then(function () { refreshBadges(); renderTasks(); }); }); });
      $('view').querySelectorAll('a[data-lead]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); window.C2B_openLeadCard(a.dataset.lead); }); });
    });
  }

  // ---------- ANALYTICS ----------
  function refDomain(r) { if (!r) return '(ישיר / הקלדה)'; try { var h = new URL(r).hostname.replace(/^www\./, ''); if (/google\./.test(h)) return 'Google (אורגני)'; if (/facebook|fb\.com|instagram/.test(h)) return 'Meta (פייסבוק/אינסטגרם)'; if (/t\.co|twitter|x\.com/.test(h)) return 'X/Twitter'; if (/youtube/.test(h)) return 'YouTube'; if (h.indexOf('tzahilevi1.github.io') >= 0) return '(פנימי)'; return h; } catch (e) { return '(אחר)'; } }
  function deviceOf(ua) { ua = ua || ''; if (/iPad|Tablet/i.test(ua)) return 'טאבלט'; if (/Mobi|Android|iPhone/i.test(ua)) return 'מובייל'; return 'דסקטופ'; }
  function browserOf(ua) { ua = ua || ''; if (/Edg/i.test(ua)) return 'Edge'; if (/Chrome/i.test(ua)) return 'Chrome'; if (/Firefox/i.test(ua)) return 'Firefox'; if (/Safari/i.test(ua)) return 'Safari'; return 'אחר'; }
  function anBars(days) {
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.v; }))), W = 100 / days.length;
    var bars = days.map(function (d, i) { var h = d.v / max * 92; return '<rect x="' + (i * W + W * 0.15) + '" y="' + (100 - h) + '" width="' + (W * 0.7) + '" height="' + h + '" rx="1.5" fill="var(--brand)"><title>' + esc(d.d) + ': ' + d.v + '</title></rect>'; }).join('');
    var labs = days.map(function (d, i) { return '<div style="flex:1;min-width:0;text-align:center;font-size:11px;color:var(--muted);white-space:nowrap">' + (i % 2 === 0 ? esc(d.d.slice(5)) : '') + '</div>'; }).join('');
    return '<div><svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:160px;display:block">' + bars + '</svg><div style="display:flex;direction:ltr;margin-top:6px">' + labs + '</div></div>';
  }
  function breakdown(title, obj, limit) {
    var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; }).slice(0, limit || 10);
    var mx = keys.length ? obj[keys[0]] : 1, total = keys.reduce(function (s, k) { return s + obj[k]; }, 0);
    return '<div class="card"><h3>' + title + '</h3><div class="table-scroll"><table><tbody>' + (keys.map(function (k) { return '<tr><td class="wrap">' + esc(k) + '</td><td>' + obj[k] + '</td><td class="muted">' + (total ? Math.round(obj[k] / total * 100) : 0) + '%</td><td style="width:40%"><div class="bar"><span style="width:' + Math.round(obj[k] / mx * 100) + '%"></span></div></td></tr>'; }).join('') || '<tr><td class="empty">אין נתונים</td></tr>') + '</tbody></table></div></div>';
  }
  function renderAnalytics() {
    loading();
    db.from('events').select('*').order('created_at', { ascending: false }).limit(8000).then(function (r) {
      if (r.error) return errBox(r.error.message);
      var ev = r.data || [], pv = ev.filter(function (e) { return e.type === 'pageview'; });
      var STD = { pageview: 1, session_end: 1 };
      var sessions = {}, pvBySession = {}, firstUaBySession = {};
      ev.forEach(function (e) { if (!e.session_id) return; sessions[e.session_id] = 1; if (e.type === 'pageview') { pvBySession[e.session_id] = (pvBySession[e.session_id] || 0) + 1; if (!firstUaBySession[e.session_id]) firstUaBySession[e.session_id] = e.ua; } });
      var sessCount = Object.keys(sessions).length, pvCount = pv.length;
      var durs = ev.filter(function (e) { return e.type === 'session_end' && e.duration_ms; }).map(function (e) { return e.duration_ms; });
      var avg = durs.length ? Math.round(durs.reduce(function (a, b) { return a + b; }, 0) / durs.length / 1000) : 0;
      var bounces = Object.keys(pvBySession).filter(function (s) { return pvBySession[s] === 1; }).length;
      var bounceRate = sessCount ? Math.round(bounces / sessCount * 100) : 0;
      var perSession = sessCount ? (pvCount / sessCount).toFixed(1) : 0;
      // breakdowns
      var byPage = {}, byRef = {}, byDev = {}, byBrowser = {}, byEvent = {}, byDay = {};
      pv.forEach(function (e) { var p = e.page || '/'; byPage[p] = (byPage[p] || 0) + 1; var dd = (e.created_at || '').slice(0, 10); if (dd) byDay[dd] = (byDay[dd] || 0) + 1; });
      Object.keys(firstUaBySession).forEach(function (s) { var ua = firstUaBySession[s]; byDev[deviceOf(ua)] = (byDev[deviceOf(ua)] || 0) + 1; byBrowser[browserOf(ua)] = (byBrowser[browserOf(ua)] || 0) + 1; });
      ev.forEach(function (e) { if (e.type === 'pageview') { var ref = refDomain(e.referrer); /* count referrer per pageview that has one, else direct */ } });
      // referrers: count sessions by their first pageview referrer
      var seenSessRef = {}; pv.slice().reverse().forEach(function (e) { if (e.session_id && !seenSessRef[e.session_id]) { seenSessRef[e.session_id] = 1; var k = refDomain(e.referrer); byRef[k] = (byRef[k] || 0) + 1; } });
      ev.forEach(function (e) { if (!STD[e.type]) byEvent[e.type || 'event'] = (byEvent[e.type || 'event'] || 0) + 1; });
      var conversions = (byEvent.whatsapp_click || 0) + (byEvent.phone_click || 0) + (byEvent.lead_saved || 0) + (byEvent.lead_form_submit || 0);
      var days = []; for (var i = 13; i >= 0; i--) { var dz = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push({ d: dz, v: byDay[dz] || 0 }); }

      view(
        '<h2 style="margin:0 0 12px">📊 אנליטיקס</h2>' +
        '<div class="cards">' +
          stat('צפיות בעמודים', pvCount) + stat('מבקרים (סשנים)', sessCount) +
          stat('זמן שהייה ממוצע', avg ? avg + ' שנ\'' : '—') + stat('אחוז נטישה', bounceRate + '%') +
          stat('עמודים לסשן', perSession) + stat('המרות (קליקים/לידים)', conversions, true) +
        '</div>' +
        '<div class="card"><h3>תנועה ב-14 הימים האחרונים</h3>' + anBars(days) + '</div>' +
        '<div class="grid2">' + breakdown('🔗 מקורות תנועה', byRef) + breakdown('📄 עמודים מובילים', byPage, 12) + '</div>' +
        '<div class="grid2">' + breakdown('📱 מכשירים', byDev) + breakdown('🌐 דפדפנים', byBrowser) + '</div>' +
        '<div class="card"><h3>⚡ אירועים והמרות</h3><div class="table-scroll"><table><thead><tr><th>אירוע</th><th>כמות</th></tr></thead><tbody>' +
          (Object.keys(byEvent).sort(function (a, b) { return byEvent[b] - byEvent[a]; }).map(function (k) { return '<tr><td>' + esc({ whatsapp_click: '💬 קליק וואטסאפ', phone_click: '📞 קליק טלפון', lead_saved: '✅ ליד נשמר', lead_form_submit: '📝 שליחת טופס', finance_calculator_start: '🧮 התחיל מחשבון', finance_calculator_result: '🧮 תוצאת מחשבון' }[k] || k) + '</td><td>' + byEvent[k] + '</td></tr>'; }).join('') || '<tr><td class="empty" colspan="2">אין אירועים עדיין — ייאספו מהאתר</td></tr>') +
        '</tbody></table></div><p class="muted" style="font-size:12px;margin-top:8px">נאסף first-party מהאתר (ללא עוגיות/צד ג\'). לפילוח קמפיינים לפי UTM — ראו "דוחות → שיווק" ושדות ה-UTM בלידים.</p></div>'
      );
    });
  }

  // ---------- REPORTS (marketing / sales / manager) ----------
  // ===== REPORTS — executive analytics (mirrors + improves the Electric-Lease dashboard, from our own data) =====
  var HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function M(n) { return '₪' + Math.round(+n || 0).toLocaleString('en-US'); }
  function P1(n) { return (Math.round((+n || 0) * 10) / 10) + '%'; }
  function repTop(obj, key, n) { return Object.keys(obj).map(function (k) { return { label: k, v: obj[k][key] || 0, o: obj[k] }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, n || 999); }
  function kpi(label, value, sub, accent) { return '<div class="kpi' + (accent ? ' accent' : '') + '"><div class="k">' + esc(label) + '</div><div class="v">' + value + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'; }
  function secCard(title, inner) { return '<div class="card"><div class="sec-title">' + title + '</div>' + inner + '</div>'; }
  function barRows(items, fmt) { var mx = Math.max.apply(null, items.map(function (i) { return i.v; }).concat([1])); return items.length ? items.map(function (i) { var w = mx ? Math.round(i.v / mx * 100) : 0; return '<div class="mbar"><span class="lbl" title="' + esc(i.label) + '">' + esc(i.label) + '</span><span class="track"><span style="width:' + w + '%"></span></span><span class="val">' + fmt(i.v) + '</span></div>'; }).join('') : '<p class="empty">אין נתונים</p>'; }
  function rankRows(items, fmt, subFmt) { return items.length ? items.map(function (i, idx) { return '<div class="rk' + (idx < 3 ? ' top' + (idx + 1) : '') + '"><span class="n">' + (idx + 1) + '</span><span class="nm">' + esc(i.label) + (subFmt ? ' <span class="mt">' + subFmt(i) + '</span>' : '') + '</span><span class="amt">' + fmt(i.v) + '</span></div>'; }).join('') : '<p class="empty">אין נתונים</p>'; }
  function repTable(headers, rows) { return '<div class="table-scroll"><table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows || '<tr><td class="empty" colspan="' + headers.length + '">אין נתונים</td></tr>') + '</tbody></table></div>'; }

  function renderReports() {
    loading();
    Promise.all([
      db.from('leads').select('id,name,status,source,created_at,first_response_at,assigned_to,brand,utm_campaign,utm_source,utm_content,marketing_company,city'),
      db.from('appointments').select('status'),
      db.from('events').select('type,session_id'),
      db.from('tasks').select('done'),
      db.from('profiles').select('user_id,full_name'),
      db.from('deals').select('*'),
      db.from('payments').select('amount,kind,deal_id')
    ]).then(function (res) {
      var leads = res[0].data || [], appts = res[1].data || [], events = res[2].data || [], tasks = res[3].data || [];
      var prof = {}; (res[4].data || []).forEach(function (p) { prof[p.user_id] = p.full_name; });
      var allDeals = res[5].data || [], pays = (res[6] && res[6].data) || [];
      var ST = window.C2B_STATUSES || [], bdg = window.C2B_badge || function (k) { return k; };
      var leadById = {}; leads.forEach(function (l) { leadById[l.id] = l; });

      // ---- lead-side aggregates ----
      var by = {}; ST.forEach(function (s) { by[s.k] = 0; });
      leads.forEach(function (l) { by[l.status || 'new'] = (by[l.status || 'new'] || 0) + 1; });
      var wonL = by.won || 0, lostL = by.lost || 0;
      var pv = events.filter(function (e) { return e.type === 'pageview'; }).length;
      var sess = {}; events.forEach(function (e) { if (e.session_id) sess[e.session_id] = 1; });
      var rts = leads.filter(function (l) { return l.first_response_at; }).map(function (l) { return (new Date(l.first_response_at) - new Date(l.created_at)) / 60000; });
      var avgRt = rts.length ? Math.round(rts.reduce(function (a, b) { return a + b; }, 0) / rts.length) : 0;

      // ---- deal-side aggregates ----
      // עסקה נחשבת "עסקה" רק לאחר חתימת הלקוח — הצעות/טיוטות לא-חתומות אינן נספרות בדאשבורד
      var deals = allDeals.filter(function (d) { return d.status !== 'cancelled' && !!d.signature; });
      var cancelled = allDeals.filter(function (d) { return d.status === 'cancelled'; }).length;
      function isDone(d) { return d.status === 'ordered' || !!d.signature; }
      var doneDeals = deals.filter(isDone);
      var revenue = deals.reduce(function (a, d) { return a + (+d.total || 0); }, 0);
      var profit = deals.reduce(function (a, d) { return a + (+d.commission || 0); }, 0);
      var doneProfit = doneDeals.reduce(function (a, d) { return a + (+d.commission || 0); }, 0);
      var collected = pays.filter(function (p) { return p.kind !== 'invoice'; }).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
      var avgDeal = deals.length ? revenue / deals.length : 0;
      var avgProfit = doneDeals.length ? doneProfit / doneDeals.length : 0;   // avg over completed deals only (consistent numerator/denominator)
      var closeRate = leads.length ? doneDeals.length / leads.length * 100 : 0;
      // time-to-close (lead → deal) for done deals
      var ttc = doneDeals.map(function (d) { var l = leadById[d.lead_id]; return l && l.created_at ? (new Date(d.created_at) - new Date(l.created_at)) / 86400000 : null; }).filter(function (x) { return x != null && x >= 0; });
      var avgTtc = ttc.length ? (ttc.reduce(function (a, b) { return a + b; }, 0) / ttc.length) : 0;
      // financing / trade-in quality
      var finCount = deals.filter(function (d) { return d.financing && (+d.financing.amount > 0 || d.financing.status); }).length;
      var tiDeals = deals.filter(function (d) { return d.tradein && d.tradein.make; });
      var tiBuys = tiDeals.map(function (d) { return +d.tradein.buy || 0; }).filter(function (x) { return x > 0; });
      var avgTi = tiBuys.length ? tiBuys.reduce(function (a, b) { return a + b; }, 0) / tiBuys.length : 0;
      var discs = deals.map(function (d) { return +d.discount_amt || 0; });
      var avgDisc = discs.length ? discs.reduce(function (a, b) { return a + b; }, 0) / discs.length : 0;

      // dimensions
      var byBrand = {}, byAgent = {}, byMaker = {}, byModel = {}, byStage = {}, bySource = {}, byCompany = {}, byCampaign = {}, byMonth = {};
      function bump(map, k, f) { if (!k) k = '—'; map[k] = map[k] || { count: 0, revenue: 0, profit: 0, done: 0, leads: 0, values: [] }; f(map[k]); }
      deals.forEach(function (d) {
        var l = leadById[d.lead_id] || {};
        var brand = d.brand || l.brand || 'ללא מותג';
        var agent = (d.salesperson && d.salesperson.trim()) || prof[l.assigned_to] || 'לא שויך';
        var maker = d.car_make || '—';
        var model = ((d.car_make || '') + ' ' + (d.car_model || '')).trim() || '—';
        var company = d.brand || l.marketing_company || 'ללא';
        var mk = new Date(d.created_at); var mkey = mk.getFullYear() * 12 + mk.getMonth();
        var rev = +d.total || 0, pf = +d.commission || 0, dn = isDone(d) ? 1 : 0;
        bump(byBrand, brand, function (o) { o.count++; o.revenue += rev; o.profit += pf; o.done += dn; });
        bump(byAgent, agent, function (o) { o.count++; o.revenue += rev; o.profit += pf; o.done += dn; });
        bump(byMaker, maker, function (o) { o.count++; o.revenue += rev; });
        bump(byModel, model, function (o) { o.count++; o.revenue += rev; o.profit += pf; o.done += dn; o.values.push({ v: rev, disc: +d.discount_amt || 0, maker: maker }); });
        bump(byCompany, company, function (o) { o.revenue += rev; o.count++; });
        byStage[d.stage || 'initial'] = (byStage[d.stage || 'initial'] || 0) + 1;
        byMonth[mkey] = byMonth[mkey] || { revenue: 0, profit: 0, count: 0, done: 0, key: mkey };
        byMonth[mkey].revenue += rev; byMonth[mkey].profit += pf; byMonth[mkey].count++; byMonth[mkey].done += dn;
      });
      // lead-driven agent leads count + source/campaign
      leads.forEach(function (l) {
        var agent = prof[l.assigned_to] || 'לא שויך';
        bump(byAgent, agent, function (o) { o.leads++; });
        var s = l.source || 'לא ידוע'; bump(bySource, s, function (o) { o.leads++; if (l.status === 'won') o.done++; });
        var camp = l.utm_campaign || l.marketing_company; if (camp) bump(byCampaign, camp, function (o) { o.leads++; if (l.status === 'won') o.done++; });
      });
      // attribute deal revenue back to source / campaign
      deals.forEach(function (d) { var l = leadById[d.lead_id] || {}; var s = l.source || 'לא ידוע'; bump(bySource, s, function (o) { o.revenue += (+d.total || 0); o.count++; }); var camp = l.utm_campaign || l.marketing_company; if (camp) bump(byCampaign, camp, function (o) { o.revenue += (+d.total || 0); o.count++; }); });

      // monthly series (chronological, last 12 with data)
      var months = Object.keys(byMonth).map(Number).sort(function (a, b) { return a - b; }).slice(-12).map(function (k) { var o = byMonth[k]; o.label = HEB_MONTHS[k % 12] + ' ' + Math.floor(k / 12); return o; });

      // ---------- MANAGER (executive) ----------
      var mgrProfitMonths = barRows(months.map(function (m) { return { label: m.label, v: m.profit }; }), M);
      var mgrTopAgents = rankRows(repTop(byAgent, 'profit', 5), M, function (i) { return i.o.done + ' עסקאות'; });
      var mgrTopBrands = rankRows(repTop(byBrand, 'profit', 5), M, function (i) { return i.o.count + ' עסקאות'; });
      var managerPanel =
        '<div class="cards">' +
          kpi('רווחיות כוללת', M(profit), 'סכום עמלות/רווח מכל העסקאות', true) +
          kpi('רווח ממוצע לעסקה', M(avgProfit), doneDeals.length + ' עסקאות שהושלמו') +
          kpi('סה״כ עסקאות', deals.length, cancelled + ' בוטלו') +
          kpi('נגבה בפועל', M(collected), 'מתוך ' + M(revenue) + ' שווי עסקאות') +
        '</div>' +
        (profit === 0 ? '<div class="sec-note">💡 טיפ: כדי שהרווחיות תשקף את המציאות, ודאו שדה <b>עמלת סוכן</b> מלא בעסקאות (מתמלא אוטומטית מהמלאי בבחירת רכב).</div>' : '') +
        '<div class="rep-grid">' +
          secCard('📈 רווחיות לפי חודש', mgrProfitMonths) +
          secCard('🏆 הנציגים המובילים ברווחיות', mgrTopAgents) +
          secCard('🚗 המותגים המובילים ברווחיות', mgrTopBrands) +
          secCard('💰 תמונת מצב שיווק', '<div class="cards" style="margin:0">' + kpi('הכנסות מעסקאות', M(revenue)) + kpi('הוצאות שיווק', M(0), 'יתחבר עם Facebook Ads') + kpi('דלתא (רווח מול הוצאה)', M(revenue), null, true) + '</div>') +
        '</div>';

      // ---------- SALES — sub-tabs ----------
      // overview
      var salesOverview =
        '<div class="cards">' +
          kpi('סה״כ לידים', leads.length.toLocaleString('en-US'), null, true) +
          kpi('סה״כ עסקאות', deals.length) +
          kpi('עסקאות שהושלמו', doneDeals.length) +
          kpi('אחוז סגירה', P1(closeRate), doneDeals.length + ' / ' + leads.length + ' לידים') +
          kpi('רווח עסקה ממוצע', M(avgProfit)) +
          kpi('זמן ממוצע לסגירה', (Math.round(avgTtc * 10) / 10) + ' ימים') +
        '</div>' +
        '<div class="rep-grid">' +
          secCard('💵 הכנסות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.revenue }; }), M)) +
          secCard('📊 עסקאות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.count }; }), function (v) { return v; })) +
          secCard('🔀 עסקאות לפי שלב', barRows(Object.keys(byStage).map(function (k) { var sd = (window.C2B_stageDef && window.C2B_stageDef(k)) || { label: k }; return { label: sd.label || k, v: byStage[k] }; }).sort(function (a, b) { return b.v - a.v; }), function (v) { return v; })) +
          secCard('🏢 הכנסות לפי חברה/מותג', barRows(repTop(byCompany, 'revenue', 10), M)) +
          secCard('📥 לידים לפי מקור', barRows(repTop(bySource, 'leads', 12), function (v) { return v; })) +
        '</div>';
      // trends
      var salesTrends =
        '<div class="cards">' + kpi('סה״כ הכנסות', M(revenue), null, true) + kpi('סה״כ רווחיות', M(profit)) + kpi('עסקאות שהושלמו', doneDeals.length) + kpi('זמן ממוצע לסגירה', (Math.round(avgTtc * 10) / 10) + ' ימים') + '</div>' +
        '<div class="rep-grid">' +
          secCard('📈 הכנסות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.revenue }; }), M)) +
          secCard('💎 רווחיות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.profit }; }), M)) +
          secCard('✅ עסקאות שהושלמו לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.done }; }), function (v) { return v; })) +
        '</div>';
      // agents
      var agentRows = repTop(byAgent, 'revenue', 200).map(function (i) { var o = i.o; var cr = o.leads ? Math.round(o.done / o.leads * 100) : 0; return '<tr><td><b>' + esc(i.label) + '</b></td><td>' + o.leads + '</td><td>' + o.done + '</td><td>' + M(o.revenue) + '</td><td style="color:var(--ok);font-weight:700">' + M(o.profit) + '</td><td>' + cr + '%</td></tr>'; }).join('');
      var salesAgents =
        secCard('👥 עסקאות והכנסות לפי מותג', barRows(repTop(byBrand, 'revenue', 12), M)) +
        secCard('🧑‍💼 ביצועי נציגים', repTable(['שם נציג', 'לידים', 'עסקאות שהושלמו', 'סה״כ הכנסות', 'רווחיות', 'אחוז סגירה'], agentRows));
      // cars
      var topModel = repTop(byModel, 'done', 1)[0] || repTop(byModel, 'count', 1)[0];
      var makerRows = repTop(byModel, 'revenue', 200).map(function (i) { var o = i.o; var av = o.values.length ? o.values.reduce(function (a, x) { return a + x.v; }, 0) / o.values.length : 0; var ad = o.values.length ? o.values.reduce(function (a, x) { return a + x.disc; }, 0) / o.values.length : 0; var mkr = o.values[0] ? o.values[0].maker : '—'; return '<tr><td>' + esc(mkr) + '</td><td><b>' + esc(i.label) + '</b></td><td>' + o.done + '</td><td>' + M(av) + '</td><td>' + M(ad) + '</td><td>' + M(o.revenue) + '</td><td style="color:var(--ok)">' + M(o.profit) + '</td></tr>'; }).join('');
      var salesCars =
        '<div class="cards">' + kpi('עסקאות שהושלמו', doneDeals.length, null, true) + kpi('הרכב הכי נמכר', topModel ? esc(topModel.label) : '—', topModel ? topModel.o.done + ' עסקאות' : '') + kpi('סכום טרייד-אין ממוצע', M(avgTi), tiDeals.length + ' עסקאות עם טרייד-אין') + '</div>' +
        '<div class="rep-grid">' +
          secCard('🚙 הכנסות לפי דגם', barRows(repTop(byModel, 'revenue', 10), M)) +
          secCard('🏭 עסקאות לפי יצרן', barRows(repTop(byMaker, 'count', 12), function (v) { return v; })) +
        '</div>' +
        secCard('📋 פירוט יצרן / דגם', repTable(['יצרן', 'דגם', 'עסקאות שהושלמו', 'ערך עסקה ממוצע', 'הנחה ממוצעת', 'סה״כ הכנסות', 'רווחיות'], makerRows));
      // quality
      var discBuckets = [{ l: '0%', a: 0, b: 0.0001 }, { l: '1-5%', a: 0.0001, b: 5 }, { l: '5-10%', a: 5, b: 10 }, { l: '10-15%', a: 10, b: 15 }, { l: '15-20%', a: 15, b: 20 }, { l: '20%+', a: 20, b: 1e9 }];
      var discDist = discBuckets.map(function (bk) { var c = deals.filter(function (d) { var pct = +d.discount_pct || (d.total ? (+d.discount_amt || 0) / (+d.total + (+d.discount_amt || 0)) * 100 : 0); return pct >= bk.a && pct < bk.b; }).length; return { label: bk.l, v: c }; });
      var finTracks = {}; deals.forEach(function (d) { if (d.financing && (d.financing.track || d.financing.status)) { var t = d.financing.track || d.financing.status || 'אחר'; finTracks[t] = (finTracks[t] || 0) + 1; } });
      var salesQuality =
        '<div class="cards">' + kpi('הנחה ממוצעת', M(avgDisc)) + kpi('אחוז מימון', P1(deals.length ? finCount / deals.length * 100 : 0), finCount + ' עסקאות במימון') + kpi('אחוז טרייד-אין', P1(deals.length ? tiDeals.length / deals.length * 100 : 0)) + kpi('סכום טרייד-אין ממוצע', M(avgTi)) + '</div>' +
        '<div class="rep-grid">' +
          secCard('🏷️ התפלגות עסקאות לפי טווח הנחה', barRows(discDist, function (v) { return v; })) +
          secCard('🏦 פילוח לפי סוג עסקת מימון', barRows(Object.keys(finTracks).map(function (k) { return { label: k, v: finTracks[k] }; }).sort(function (a, b) { return b.v - a.v; }), function (v) { return v; })) +
        '</div>';
      // targets
      var tgtRows = repTop(byAgent, 'revenue', 200).map(function (i) { var o = i.o; return '<tr><td><b>' + esc(i.label) + '</b></td><td>' + o.done + '</td><td class="muted">—</td><td class="muted">—</td><td>' + M(o.revenue) + '</td><td class="muted">—</td><td class="muted">—</td><td style="color:var(--ok)">' + M(o.profit) + '</td><td class="muted">—</td><td class="muted">—</td></tr>'; }).join('');
      var salesTargets =
        '<div class="cards">' + kpi('עסקאות בפועל', doneDeals.length) + kpi('הכנסות בפועל', M(revenue), null, true) + kpi('רווחיות בפועל', M(profit)) + '</div>' +
        '<div class="sec-note">🎯 יעדים לנציג טרם הוגדרו. אפשר להוסיף טבלת <b>יעדי נציג</b> (עסקאות/הכנסות/רווחיות) ואז עמודות ה-% יתמלאו אוטומטית. כרגע מוצגים הביצועים בפועל.</div>' +
        secCard('📊 ביצועים לפי נציג', repTable(['שם נציג', 'עסקאות', 'יעד עסקאות', '% עמידה', 'הכנסות', 'יעד הכנסות', '% עמידה', 'רווחיות', 'יעד רווחיות', '% עמידה'], tgtRows));

      var salesPanels = { overview: salesOverview, trends: salesTrends, agents: salesAgents, cars: salesCars, quality: salesQuality, targets: salesTargets };
      var salesSubs = [['overview', 'סקירה כללית'], ['trends', 'מגמות מכירות'], ['agents', 'חברה ונציגים'], ['cars', 'ניתוח רכבים'], ['quality', 'איכות עסקאות'], ['targets', 'יעדים']];
      function salesNav() { return '<nav class="tabs" id="repSalesTabs" style="margin-bottom:14px;flex-wrap:wrap">' + salesSubs.map(function (s) { return '<button data-ssub="' + s[0] + '"' + (salesSub === s[0] ? ' class="active"' : '') + '>' + s[1] + '</button>'; }).join('') + '</nav>'; }
      var salesPanel = salesNav() + '<div id="repSalesPanel">' + salesPanels[salesSub] + '</div>';

      // ---------- MARKETING ----------
      var netByBrand = repTop(byBrand, 'revenue', 5);
      var campRows = repTop(byCampaign, 'revenue', 60).map(function (i) { var o = i.o; var cr = o.leads ? Math.round(o.done / o.leads * 100) : 0; return '<tr><td><b>' + esc(i.label) + '</b></td><td>' + o.leads + '</td><td>' + (o.count || 0) + '</td><td>' + o.done + '</td><td>' + M(o.revenue) + '</td><td>' + cr + '%</td><td class="muted">—</td><td class="muted">—</td></tr>'; }).join('');
      var marketingPanel =
        '<div class="cards">' +
          kpi('הכנסה (מעסקאות)', M(revenue), 'כל ההיסטוריה ב-CRM', true) +
          kpi('הוצאה', M(0), 'יתחבר עם Facebook Ads') +
          kpi('נטו', M(revenue), 'הכנסה פחות הוצאה') +
          kpi('ROAS', '—', 'הכנסה / הוצאה') +
          kpi('אחוז המרה', P1(closeRate), doneDeals.length + ' סגירות') +
          kpi('לידים', leads.length.toLocaleString('en-US'), wonL + ' נסגרו') +
          kpi('עלות לפנייה (CPL)', '—', 'דורש חיבור הוצאות') +
          kpi('פגישות שנקבעו', appts.length) +
        '</div>' +
        '<div class="sec-note">📡 מדדי הפרסום (הוצאה, ROAS, CPL, CTR, CPC, CPM, קמפיינים פעילים) יתמלאו לאחר חיבור <b>Facebook Ads / Meta</b>. בינתיים מוצגים כל הנתונים מצד ה-CRM: הכנסות, לידים, המרות וייחוס לפי קמפיין.</div>' +
        '<div class="rep-grid">' +
          secCard('📣 לידים לפי מקור', barRows(repTop(bySource, 'leads', 12), function (v) { return v; })) +
          secCard('🏆 חמשת המותגים המובילים בהכנסות', rankRows(netByBrand, M, function (i) { return i.o.count + ' עסקאות'; })) +
          secCard('🌐 צפיות / מבקרים באתר', '<div class="cards" style="margin:0">' + kpi('צפיות בעמודים', pv.toLocaleString('en-US')) + kpi('מבקרים ייחודיים', Object.keys(sess).length.toLocaleString('en-US')) + '</div>') +
        '</div>' +
        secCard('📋 ביצועי קמפיינים (ייחוס מה-CRM)', repTable(['קמפיין', 'לידים', 'עסקאות', 'נסגרו', 'הכנסה', 'המרה', 'הוצאה', 'CPL'], campRows));

      var panels = { manager: managerPanel, sales: salesPanel, marketing: marketingPanel };
      function tab(k, label) { return '<button data-rep="' + k + '"' + (repTab === k ? ' class="active"' : '') + '>' + label + '</button>'; }
      view('<h2 style="margin:0 0 4px">📊 דוחות וניתוח</h2><p class="muted" style="margin:0 0 16px;font-size:13px">שלוש תצוגות: מנהל · מכירות · שיווק — מבוססות על נתוני ה-CRM שלכם</p>' +
        '<nav class="tabs" id="repTabs">' + tab('manager', '👔 מנהל') + tab('sales', '💼 מכירות') + tab('marketing', '📣 שיווק') + '</nav>' +
        '<div id="repPanel">' + panels[repTab] + '</div>');
      $('repTabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-rep]'); if (!b) return; repTab = b.dataset.rep; $('repTabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.rep === repTab); }); $('repPanel').innerHTML = panels[repTab]; });
      // sales sub-tab switching (delegated on the persistent repPanel)
      $('repPanel').addEventListener('click', function (e) { var b = e.target.closest('button[data-ssub]'); if (!b) return; salesSub = b.dataset.ssub; var nav = $('repSalesTabs'); if (nav) nav.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.ssub === salesSub); }); var sp = $('repSalesPanel'); if (sp) sp.innerHTML = salesPanels[salesSub]; });
    }).catch(function (e) { errBox(e.message || e); });
  }
  var repTab = 'manager', salesSub = 'overview';

  // ---------- USERS & ROLES (admin only) ----------
  var ROLES = [['admin', 'מנהל מערכת'], ['sales', 'סוכן מכירות'], ['files', 'מנהלת תיקי לקוחות'], ['accounting', 'מנהלת חשבונות'], ['branch', 'מנהל סניף']];
  function roleName(k) { var x = ROLES.filter(function (r) { return r[0] === k; })[0]; return x ? x[1] : k; }
  function viewsLabel(v, role) {
    var isDefault = !(v && v.length);
    var eff = isDefault ? (DEFAULT_VIEWS[role] || ['dashboard']) : v;
    var tags = eff.map(function (k) { var g = GRANTABLE_VIEWS.filter(function (x) { return x[0] === k; })[0]; return '<span class="tag" style="margin:2px">' + esc(g ? g[1] : k) + '</span>'; }).join('');
    return (isDefault ? '<span class="muted" style="font-size:10.5px;display:block;margin-bottom:3px">ברירת מחדל לתפקיד (מה שהם רואים):</span>' : '') + tags;
  }
  function viewChecks(idPrefix, checked) {
    return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">' + GRANTABLE_VIEWS.map(function (g) {
      return '<label style="display:flex;gap:5px;align-items:center;font-size:13px"><input type="checkbox" data-' + idPrefix + '="' + g[0] + '"' + (checked.indexOf(g[0]) >= 0 ? ' checked' : '') + '> ' + g[1] + '</label>';
    }).join('') + '</div>';
  }
  function renderUsers() {
    loading();
    db.from('profiles').select('*').order('created_at', { ascending: true }).then(function (r) {
      if (r.error) return errBox(r.error.message);
      var ps = r.data || [];
      var rows = ps.map(function (p) {
        var reset = p.email ? '<button class="btn btn-ghost btn-sm" data-reset="' + esc(p.email) + '">🔑 אפס סיסמה</button>' : '<span class="muted" style="font-size:12px">אין אימייל</span>';
        var seg = '<div style="display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden">' +
          '<button data-actset="' + p.user_id + '" data-on="1" style="border:none;padding:6px 12px;font-size:12.5px;cursor:pointer;font-weight:600;background:' + (p.active ? 'var(--ok)' : 'transparent') + ';color:' + (p.active ? '#fff' : 'var(--muted)') + '">✓ פעיל</button>' +
          '<button data-actset="' + p.user_id + '" data-on="0" style="border:none;border-inline-start:1px solid var(--line);padding:6px 12px;font-size:12.5px;cursor:pointer;font-weight:600;background:' + (!p.active ? 'var(--danger)' : 'transparent') + ';color:' + (!p.active ? '#fff' : 'var(--muted)') + '">✕ לא פעיל</button></div>';
        return '<tr><td><span class="avatar" style="margin-inline-end:8px">' + esc((p.full_name || '?').charAt(0)) + '</span><span class="uname-txt" data-nameuid="' + p.user_id + '">' + esc(p.full_name || '—') + '</span> <button class="btn btn-ghost btn-sm" data-edituser="' + p.user_id + '" title="ערוך את כל פרטי המשתמש">✏️ ערוך</button>' + (p.email ? '<div class="muted" style="font-size:11px">' + esc(p.email) + '</div>' : '') + '</td>' +
          '<td><select class="inp" data-role="' + p.user_id + '">' + ROLES.map(function (x) { return '<option value="' + x[0] + '"' + (p.role === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></td>' +
          '<td style="white-space:normal;max-width:260px">' + (p.role === 'admin' ? '<span class="muted" style="font-size:12.5px">👑 מנהל מערכת — רואה את הכל (תצוגות לא חלות על מנהל)</span>' : viewsLabel(p.views, p.role) + ' <button class="btn btn-ghost btn-sm" data-editviews="' + p.user_id + '">✏️</button><div class="hidden" id="ev_' + p.user_id + '"></div>') + '</td>' +
          '<td>' + seg + '</td>' +
          '<td>' + reset + '</td></tr>' +
          '<tr class="hidden" id="uedit_' + p.user_id + '"><td colspan="5" style="padding:0 8px"></td></tr>';
      }).join('');
      var addForm = '<div class="card"><h3>➕ הוספת משתמש</h3><p class="muted" style="font-size:13px">נשלח אליו מייל עם קישור, אימייל וסיסמה זמנית — הוא נכנס מיד ויכול לאפס סיסמה בעצמו.</p>' +
        '<div class="grid2"><div class="field" style="margin:0"><label>שם מלא</label><input class="inp" id="nuName" placeholder="למשל: דנה כהן"></div>' +
        '<div class="field" style="margin:0"><label>אימייל</label><input class="inp" id="nuEmail" type="email" placeholder="name@email.com"></div></div>' +
        '<div class="grid2" style="margin-top:12px"><div class="field" style="margin:0"><label>טלפון</label><input class="inp" id="nuPhone" type="tel" placeholder="050-0000000"></div>' +
        '<div class="field" style="margin:0"><label>תפקיד</label><select class="inp" id="nuRole">' + ROLES.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div></div>' +
        '<label style="font-size:13px;color:var(--muted);margin-top:12px;display:block">תצוגות שהמשתמש יראה (מוגדר לפי התפקיד — אפשר להוסיף/להוריד):</label><div id="nuViews">' + viewChecks('nv', DEFAULT_VIEWS.sales) + '</div>' +
        '<div style="margin-top:14px"><button class="btn" id="nuCreate">צור משתמש ושלח הזמנה</button> <span id="nuMsg" style="font-size:13px;margin-inline-start:10px"></span></div><div id="nuResult" style="margin-top:12px"></div></div>';
      view('<h2 style="margin:0 0 14px">משתמשים והרשאות</h2>' + addForm +
        '<div class="card"><h3>משתמשים קיימים (' + ps.length + ')</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>שם</th><th>תפקיד</th><th>תצוגות מותרות</th><th>פעיל</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">אין משתמשים</td></tr>') + '</tbody></table></div>' +
        '<div class="muted" style="font-size:12.5px;margin-top:10px">מנהל מערכת רואה הכל. שאר המשתמשים רואים רק את הלידים <b>שהוקצו להם</b> ואת התצוגות שסומנו כאן.</div></div>');

      // sync the Cloudflare Access gate to the CRM's active users (manager never touches Cloudflare)
      function syncAccessGate() {
        try {
          db.auth.getSession().then(function (s) {
            var tok = s && s.data && s.data.session && s.data.session.access_token;
            var opts = tok ? { headers: { Authorization: 'Bearer ' + tok } } : {};
            db.functions.invoke('index-ts', opts).then(function (r) {
              if (r && r.error) console.warn('access-sync:', (r.error && r.error.message) || r.error);
              else if (r && r.data) console.log('access-sync ok:', r.data);
            });
          });
        } catch (e) { console.warn('access-sync failed', e); }
      }

      // add-user: role change → reset the view checkboxes to that role's defaults
      $('nuRole').addEventListener('change', function () { $('nuViews').innerHTML = viewChecks('nv', DEFAULT_VIEWS[this.value] || ['dashboard']); });
      $('nuCreate').addEventListener('click', function () {
        var name = $('nuName').value.trim(), email = $('nuEmail').value.trim(), role = $('nuRole').value, phone = ($('nuPhone') ? $('nuPhone').value.trim() : '');
        var views = []; $('nuViews').querySelectorAll('input[data-nv]:checked').forEach(function (c) { views.push(c.dataset.nv); });
        var msg = $('nuMsg');
        if (!email || email.indexOf('@') < 0) { msg.style.color = 'var(--danger)'; msg.textContent = 'הזינו אימייל תקין'; return; }
        msg.style.color = 'var(--muted)'; msg.textContent = 'יוצר…'; this.disabled = true;
        var btn = this;
        db.rpc('admin_create_user', { p_email: email, p_name: name || email, p_role: role, p_views: views, p_phone: phone || null }).then(function (res) {
          btn.disabled = false;
          if (res.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + res.error.message; return; }
          var d = res.data || {};
          msg.textContent = '';
          // always show the credentials (works even if email is blocked)
          $('nuResult').innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--ok);background:rgba(22,163,74,.06);margin:0">' +
            '<b style="color:var(--ok)">✅ המשתמש נוצר.</b> נשלח מייל עם הפרטים. אם לא הגיע — מסרו ידנית:' +
            '<div style="margin-top:8px;font-family:monospace;font-size:13px;background:var(--surface);padding:10px;border-radius:8px">אימייל: ' + esc(d.email || email) + '<br>סיסמה זמנית: <b>' + esc(d.password || '') + '</b></div>' +
            '<div id="nuDiag" class="muted" style="font-size:12.5px;margin-top:8px">בודק סטטוס יצירה ושליחה…</div></div>';
          $('nuName').value = ''; $('nuEmail').value = ''; if ($('nuPhone')) $('nuPhone').value = '';
          diagnoseInvite(d);
          setTimeout(syncAccessGate, 6000); // let the async user-create finish, then update the gate
        });
      });

      $('view').querySelectorAll('select[data-role]').forEach(function (s) { s.addEventListener('change', function () { db.from('profiles').update({ role: s.value }).eq('user_id', s.dataset.role).then(function (u) { if (u.error) alert('שגיאה: ' + u.error.message); }); }); });
      // active / inactive segmented toggle
      $('view').querySelectorAll('[data-actset]').forEach(function (b) {
        b.addEventListener('click', function () {
          var uid = b.dataset.actset, on = b.dataset.on === '1';
          var p = ps.filter(function (x) { return x.user_id === uid; })[0] || {};
          if (!!p.active === on) return;   // already in that state
          if (!on && !confirm('להשבית את המשתמש? הוא יאבד מיד גישה למערכת (Cloudflare Access + נתונים).')) return;
          db.from('profiles').update({ active: on }).eq('user_id', uid).then(function (u) {
            if (u.error) { alert('שגיאה: ' + u.error.message); return; }
            syncAccessGate(); renderUsers();
          });
        });
      });
      // full user editor — all profile fields (name, contact, SIP, title, branch, notes)
      $('view').querySelectorAll('button[data-edituser]').forEach(function (b) {
        b.addEventListener('click', function () { openUserEdit(b.dataset.edituser, ps); });
      });
      // edit views inline
      $('view').querySelectorAll('button[data-editviews]').forEach(function (b) {
        b.addEventListener('click', function () {
          var uid = b.dataset.editviews, box = $('ev_' + uid);
          var pobj = ps.filter(function (p) { return p.user_id === uid; })[0] || {};
          // אם אין views מותאמים — מציגים את ברירות המחדל של התפקיד מסומנות (מה שהם רואים בפועל)
          var cur = (pobj.views && pobj.views.length) ? pobj.views : (DEFAULT_VIEWS[pobj.role] || ['dashboard']);
          if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
          box.classList.remove('hidden');
          box.innerHTML = '<p class="muted" style="font-size:11.5px;margin:6px 0 0">מסומן = מה שהמשתמש רואה. הוספת/הסרת וי ושמירה משנה מיידית (יחול בהתחברות/רענון הבא שלו).</p>' + viewChecks('vw_' + uid, cur) + '<button class="btn btn-sm" data-savev="' + uid + '" style="margin-top:8px">שמור תצוגות</button>';
          box.querySelector('[data-savev]').addEventListener('click', function () {
            var v = []; box.querySelectorAll('input[data-vw_' + uid + ']:checked').forEach(function (c) { v.push(c.getAttribute('data-vw_' + uid)); });
            var sb = this; sb.disabled = true; sb.textContent = 'שומר…';
            db.from('profiles').update({ views: v }).eq('user_id', uid).select().then(function (u) {
              if (u.error) { alert('שגיאה: ' + u.error.message); sb.disabled = false; sb.textContent = 'שמור תצוגות'; return; }
              if (!u.data || !u.data.length) { alert('לא נשמר — ודאו שאתם מחוברים כמנהל מערכת.'); sb.disabled = false; sb.textContent = 'שמור תצוגות'; return; }
              alert('✅ התצוגות נשמרו. השינוי ייכנס לתוקף אצל המשתמש בהתחברות/רענון הבא שלו.');
              renderUsers();
            });
          });
        });
      });
      // password reset for a user
      $('view').querySelectorAll('button[data-reset]').forEach(function (b) {
        b.addEventListener('click', function () {
          var email = b.dataset.reset, redirect = 'https://tzahilevi1.github.io/freedrive-crm/reset.html';
          db.auth.resetPasswordForEmail(email, { redirectTo: redirect }).then(function (r) { alert(r.error ? ('שגיאה: ' + r.error.message) : ('נשלח מייל לאיפוס סיסמה אל ' + email)); });
        });
      });
    });
  }
  // ---- full user editor (all profile fields — contact, SIP, title, branch, notes) ----
  function openUserEdit(uid, ps) {
    var tr = $('uedit_' + uid); if (!tr) return;
    var td = tr.querySelector('td');
    if (!tr.classList.contains('hidden')) { tr.classList.add('hidden'); td.innerHTML = ''; return; }
    $('view').querySelectorAll('tr[id^="uedit_"]').forEach(function (t) { if (t !== tr) { t.classList.add('hidden'); var c = t.querySelector('td'); if (c) c.innerHTML = ''; } });
    tr.classList.remove('hidden');
    var p = ps.filter(function (x) { return x.user_id === uid; })[0] || {};
    function fld(label, id, val, type) { return '<div class="field" style="margin:0"><label>' + label + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" style="width:100%"></div>'; }
    td.innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--line);background:var(--surface-2);margin:8px 0">' +
      '<div class="row-between" style="margin-bottom:10px"><b>✏️ עריכת פרטי משתמש</b><span class="muted" style="font-size:11.5px">' + roleLabel(p.role) + '</span></div>' +
      '<div class="grid2">' +
        fld('שם מלא', 'ue_name', p.full_name) +
        fld('מייל', 'ue_email', p.email, 'email') +
        fld('טלפון', 'ue_phone', p.phone, 'tel') +
        fld('נייד', 'ue_mobile', p.mobile, 'tel') +
        fld('שלוחת SIP', 'ue_sip', p.sip_ext) +
        fld('תפקיד / תואר', 'ue_title', p.title) +
        fld('סניף', 'ue_branch', p.branch) +
      '</div>' +
      '<div class="field" style="margin-top:10px"><label>הערות</label><textarea class="inp" id="ue_notes" style="height:64px;width:100%">' + esc(p.notes || '') + '</textarea></div>' +
      '<div style="margin-top:12px"><button class="btn btn-sm" id="ue_save">💾 שמור פרטים</button> <button class="btn btn-ghost btn-sm" id="ue_close">✕ סגור</button> <span id="ue_msg" style="font-size:12.5px;margin-inline-start:8px"></span></div>' +
      '<p class="muted" style="font-size:11px;margin-top:8px">שדות אלו (שלוחת SIP, טלפון, סניף…) זמינים לחיבור אוטומציות, חיוג וניתוב בהמשך.</p>' +
    '</div>';
    $('ue_close').addEventListener('click', function () { tr.classList.add('hidden'); td.innerHTML = ''; });
    $('ue_save').addEventListener('click', function () {
      var patch = {
        full_name: ($('ue_name').value || '').trim() || null,
        email: ($('ue_email').value || '').trim() || null,
        phone: ($('ue_phone').value || '').trim() || null,
        mobile: ($('ue_mobile').value || '').trim() || null,
        sip_ext: ($('ue_sip').value || '').trim() || null,
        title: ($('ue_title').value || '').trim() || null,
        branch: ($('ue_branch').value || '').trim() || null,
        notes: ($('ue_notes').value || '').trim() || null
      };
      if (!patch.full_name) { $('ue_msg').style.color = 'var(--danger)'; $('ue_msg').textContent = 'שם חובה'; return; }
      var btn = this; btn.disabled = true; $('ue_msg').style.color = 'var(--muted)'; $('ue_msg').textContent = 'שומר…';
      db.from('profiles').update(patch).eq('user_id', uid).select().then(function (u) {
        btn.disabled = false;
        if (u.error) { $('ue_msg').style.color = 'var(--danger)'; $('ue_msg').textContent = 'שגיאה: ' + u.error.message; return; }
        if (!u.data || !u.data.length) { $('ue_msg').style.color = 'var(--danger)'; $('ue_msg').textContent = 'לא נשמר — ודאו שאתם מחוברים כמנהל מערכת.'; return; }
        $('ue_msg').style.color = 'var(--ok)'; $('ue_msg').textContent = '✔ נשמר'; renderUsers();
      });
    });
  }

  // ---------- AI ASSISTANT (managers) ----------
  var SUGGESTIONS = [
    'אילו לידים כדאי לתעדף השבוע ולמה?',
    'נתח את אחוז ההמרה ומה חוסם אותנו',
    'מהם המקורות הכי משתלמים ואיפה לבזבז פחות?',
    'סכם את מצב הכספים והגבייה הפתוחה',
    'תן לי סיכום מנהלים של השבוע ו-3 פעולות'
  ];
  function renderAI() {
    loading();
    Promise.all([
      db.from('leads').select('status,source,created_at,first_response_at,city,brand'),
      db.from('deals').select('total,commission,stage,status'),
      db.from('payments').select('amount,kind'),
      db.from('tasks').select('done,due_at'),
      db.from('appointments').select('status')
    ]).then(function (res) {
      var leads = res[0].data || [], deals = res[1].data || [], pays = res[2].data || [], tasks = res[3].data || [], appts = res[4].data || [];
      var ST = window.C2B_STATUSES || [];
      var by = {}; leads.forEach(function (l) { by[l.status || 'new'] = (by[l.status || 'new'] || 0) + 1; });
      var won = by.won || 0, lost = by.lost || 0, conv = (won + lost) ? Math.round(won / (won + lost) * 100) : 0;
      var src = {}; leads.forEach(function (l) { var s = l.source || 'לא ידוע'; src[s] = src[s] || { t: 0, w: 0 }; src[s].t++; if (l.status === 'won') src[s].w++; });
      var rts = leads.filter(function (l) { return l.first_response_at; }).map(function (l) { return (new Date(l.first_response_at) - new Date(l.created_at)) / 60000; });
      var avgRt = rts.length ? Math.round(rts.reduce(function (a, b) { return a + b; }, 0) / rts.length) : 0;
      var revenue = deals.reduce(function (a, d) { return a + (+d.total || 0); }, 0);
      var commission = deals.reduce(function (a, d) { return a + (+d.commission || 0); }, 0);
      var collected = pays.filter(function (p) { return p.kind !== 'invoice'; }).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
      var stageC = {}; deals.forEach(function (d) { stageC[d.stage || 'initial'] = (stageC[d.stage || 'initial'] || 0) + 1; });
      // compact Hebrew data summary the model reasons over
      var ctx = 'נתוני פרי דרייב (' + new Date().toLocaleDateString('he-IL') + '):\n' +
        '- לידים: ' + leads.length + ' סה"כ. פילוח סטטוס: ' + ST.map(function (s) { return s.label + '=' + (by[s.k] || 0); }).join(', ') + '.\n' +
        '- אחוז סגירה: ' + conv + '% (נסגרו ' + won + ', אבודים ' + lost + '). זמן תגובה ממוצע: ' + (avgRt ? avgRt + ' דק\'' : 'לא ידוע') + '.\n' +
        '- לידים לפי מקור: ' + Object.keys(src).map(function (s) { return s + ' (' + src[s].t + ' לידים, ' + src[s].w + ' עסקאות)'; }).join('; ') + '.\n' +
        '- עסקאות: ' + deals.length + ', שווי כולל ' + nis(revenue) + ', עמלות סוכן ' + nis(commission) + ', נגבה ' + nis(collected) + ', יתרה פתוחה ' + nis(revenue - collected) + '.\n' +
        '- שלבי תיקים: ' + Object.keys(stageC).map(function (k) { return k + '=' + stageC[k]; }).join(', ') + '.\n' +
        '- משימות פתוחות: ' + tasks.filter(function (t) { return !t.done; }).length + '. פגישות: ' + appts.length + '.';
      view('<div class="card"><h3>🤖 עוזר AI למנהלים</h3><p class="muted" style="font-size:13px">שאל שאלה על העסק — המערכת מנתחת את נתוני ה-CRM (לידים, המרה, מקורות, כספים) ומחזירה תובנות והמלצות. הנתונים נשלחים ל-Claude; מפתח ה-API שמור במסד ואינו נחשף.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' + SUGGESTIONS.map(function (s) { return '<button class="btn btn-ghost btn-sm" data-sug="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<textarea class="inp" id="aiQ" rows="3" style="width:100%" placeholder="כתוב כאן שאלה…"></textarea>' +
        '<div style="margin-top:10px"><button class="btn" id="aiAsk">שאל את ה-AI</button> <span class="muted" id="aiState" style="font-size:13px;margin-inline-start:10px"></span></div>' +
        '<div id="aiAns" style="margin-top:16px"></div>' +
        '<details style="margin-top:16px"><summary class="muted" style="font-size:12px;cursor:pointer">הנתונים שנשלחים למודל</summary><pre style="white-space:pre-wrap;font-size:12px;color:var(--muted);margin-top:8px">' + esc(ctx) + '</pre></details></div>');
      $('view').querySelectorAll('[data-sug]').forEach(function (b) { b.addEventListener('click', function () { $('aiQ').value = b.dataset.sug; $('aiAsk').click(); }); });
      $('aiAsk').addEventListener('click', function () { askAI(ctx); });
    }).catch(function (e) { errBox(e.message || e); });
  }
  function askAI(ctx) {
    var q = ($('aiQ').value || '').trim(); if (!q) return;
    var state = $('aiState'), ans = $('aiAns'), btn = $('aiAsk');
    state.style.color = 'var(--muted)'; state.textContent = 'חושב… (עד ~30 שניות)'; ans.innerHTML = ''; btn.disabled = true;
    db.functions.invoke('ai-assistant', { body: { prompt: ctx + '\n\nשאלת המנהל: ' + q } }).then(function (r) {
      btn.disabled = false; state.textContent = '';
      var d = r.data || {};
      if (r.error || d.error) {
        state.style.color = 'var(--danger)';
        var msg = (d && d.error) || (r.error && r.error.message) || 'שגיאה';
        state.textContent = /unauthorized/i.test(msg) ? 'נדרשת התחברות מחדש.' : /ANTHROPIC_API_KEY/.test(msg) ? 'חסר מפתח Claude — יש להגדיר את הפונקציה (ראה הנחיות).' : 'שגיאה: ' + msg;
        return;
      }
      ans.innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--line);background:var(--surface-2)"><div style="white-space:pre-wrap;line-height:1.7">' + esc(d.text || 'לא התקבלה תשובה.') + '</div></div>';
    }).catch(function (e) { btn.disabled = false; state.style.color = 'var(--danger)'; state.textContent = 'שגיאת רשת: ' + (e && e.message || e); });
  }

  // after creating a user, poll the real async results so failures aren't silent
  function netParse(c) { try { return typeof c === 'string' ? JSON.parse(c) : c; } catch (e) { return null; } }
  function diagnoseInvite(d) {
    if (!$('nuDiag')) return;
    var createDone = (d.create_req == null), emailDone = (d.email_req == null);
    var createTxt = 'ממתין…', emailTxt = d.emailed ? 'ממתין…' : 'לא נשלח (אין resend_key ב-Vault)';
    var tries = 0;
    function paint() { if ($('nuDiag')) $('nuDiag').innerHTML = 'יצירת משתמש: ' + createTxt + '<br>שליחת מייל: ' + emailTxt; }
    function addRefresh() { var el = $('nuDiag'); if (!el) return; var b = document.createElement('button'); b.className = 'btn btn-ghost btn-sm'; b.style.marginTop = '8px'; b.textContent = 'רענן רשימת משתמשים'; b.addEventListener('click', renderUsers); el.appendChild(document.createElement('br')); el.appendChild(b); }
    paint();
    var poll = setInterval(function () {
      tries++;
      if (tries > 10 || (createDone && emailDone)) { clearInterval(poll); paint(); addRefresh(); return; }
      if (!createDone) db.rpc('admin_net_result', { p_id: d.create_req }).then(function (r) {
        if (r.error || !r.data) return; createDone = true; var b = netParse(r.data.content) || {};
        createTxt = (r.data.status >= 200 && r.data.status < 300) ? '<span style="color:var(--ok)">✔ הצליחה</span>' : '<span style="color:var(--danger)">✖ נכשלה (' + r.data.status + '): ' + esc(b.msg || b.error_description || b.message || b.error || '') + '</span>'; paint();
      });
      if (!emailDone) db.rpc('admin_net_result', { p_id: d.email_req }).then(function (r) {
        if (r.error || !r.data) return; emailDone = true; var b = netParse(r.data.content) || {};
        emailTxt = (r.data.status >= 200 && r.data.status < 300) ? '<span style="color:var(--ok)">✔ נשלח בהצלחה</span>' : '<span style="color:var(--danger)">✖ נכשל (' + r.data.status + '): ' + esc(b.message || b.error || '') + '</span> — כנראה הדומיין ב-Resend לא מאומת'; paint();
      });
    }, 1500);
  }

  // ---------- SETTINGS: managed field lists (admin) ----------
  function renderSettings() {
    loading();
    db.from('field_options').select('*').order('field', { ascending: true }).order('value', { ascending: true }).then(function (r) {
      var opts = (r && r.data) || [], byField = {}, fieldErr = r && r.error;
      LIST_FIELDS.forEach(function (f) { byField[f[0]] = []; });
      opts.forEach(function (o) { (byField[o.field] = byField[o.field] || []).push(o); });
      var warn = fieldErr ? '<div class="card" style="border:1px solid var(--warn);background:rgba(245,158,11,.08)"><b style="color:var(--warn)">⚠️ רשימות השדות לא זמינות</b> — הריצו את <b>field-lists.sql</b> (הרשימות למטה יהיו ריקות עד אז). עורך סרגל הפעולות עובד בכל מקרה.</div>' : '';
      var cards = LIST_FIELDS.map(function (f) {
        var key = f[0], label = f[1];
        var chips = (byField[key] || []).map(function (o) { return '<span class="tag" style="margin:3px">' + esc(o.value) + ' <b data-del="' + o.id + '" data-delfield="' + esc(o.field) + '" data-delval="' + esc(o.value) + '" style="cursor:pointer;color:var(--danger)">✕</b></span>'; }).join('') || '<span class="muted" style="font-size:13px">אין ערכים עדיין</span>';
        return '<div class="card"><div class="row-between"><h3 style="margin:0">' + esc(label) + '</h3>' + (key === 'brand' ? '<span class="muted" style="font-size:12px">מותגי-שיווק (לא יצרנים)</span>' : '') + '</div>' +
          '<div id="chips_' + key + '" style="margin:10px 0;line-height:2.2">' + chips + '</div>' +
          '<div style="display:flex;gap:8px"><input class="inp" data-add="' + key + '" placeholder="ערך חדש…" style="flex:1"><button class="btn btn-sm" data-addbtn="' + key + '">+ הוסף</button></div></div>';
      }).join('');
      view('<h2 style="margin:0 0 6px">הגדרות ורשימות</h2><p class="muted" style="font-size:13px;margin-bottom:12px">ערכי הרשימות שמופיעים כאפשרויות בחירה בשדות (מותג, מקור הגעה, חברת שיווק, utm_source) — בטופס עריכת ליד ובסינון.</p><div style="margin-bottom:16px"><button class="btn btn-sm" id="seedSources">🎯 טען מקורות מומלצים (מצומצם — מקור הגעה + utm_source)</button></div>' + warn + '<div id="integrationsCard"></div><div id="brandMapCard"></div><div id="quickMsgCard"></div><div id="telephonyCard"></div><div id="manychatCard"></div>' + actionEditorCard() + cards);
      bindActionEditor();
      renderIntegrations();
      renderBrandMap();
      renderQuickMsgs();
      renderTelephony();
      renderManychat();
      // מחיקת צ'יפ במקום — בלי לרענן את כל הדף
      function bindDel(bEl) {
        bEl.addEventListener('click', function () {
          var chip = bEl.closest('.tag'), isBrand = bEl.dataset.delfield === 'brand', val = bEl.dataset.delval;
          db.from('field_options').delete().eq('id', bEl.dataset.del).then(function (r) {
            if (r && r.error) return alert('שגיאה: ' + r.error.message);
            if (chip) chip.remove();
            if (isBrand) db.from('brand_companies').delete().eq('brand', val).then(function () { loadLists(); renderBrandMap(); });
            else loadLists();
          });
        });
      }
      $('view').querySelectorAll('[data-del]').forEach(bindDel);
      // הוספת ערך במקום — מוסיף צ'יפ חדש בלי לרענן את כל הדף
      $('view').querySelectorAll('[data-addbtn]').forEach(function (b) {
        b.addEventListener('click', function () {
          var key = b.dataset.addbtn, inp = $('view').querySelector('[data-add="' + key + '"]'), val = (inp.value || '').trim();
          if (!val) return;
          db.from('field_options').insert({ field: key, value: val }).select('id').single().then(function (u) {
            if (u.error) return alert('שגיאה: ' + u.error.message);
            var cont = $('chips_' + key);
            if (cont) {
              var ph = cont.querySelector('.muted'); if (ph) ph.remove();
              var span = document.createElement('span');
              span.className = 'tag'; span.style.margin = '3px';
              span.innerHTML = esc(val) + ' <b data-del="' + u.data.id + '" data-delfield="' + esc(key) + '" data-delval="' + esc(val) + '" style="cursor:pointer;color:var(--danger)">✕</b>';
              cont.appendChild(span);
              bindDel(span.querySelector('[data-del]'));
            }
            inp.value = ''; inp.focus();
            if (key === 'brand') db.from('brand_companies').upsert({ brand: val, company: val }, { onConflict: 'brand' }).then(function () { loadLists(); renderBrandMap(); });
            else loadLists();
          });
        });
      });
      if ($('seedSources')) $('seedSources').addEventListener('click', function () {
        if (!confirm('פעולה זו תחליף את הרשימות "מקור הגעה" ו-"utm_source" בערכים מומלצים ומצומצמים.\nהערכים הקיימים בשני השדות האלה יימחקו. להמשיך?')) return;
        // curated, most-relevant sources — Hebrew display sources + technical utm_source values
        var SRC = ['פייסבוק', 'אינסטגרם', 'טיקטוק', 'גוגל', 'וואטסאפ', 'טופס אתר', 'שיחה נכנסת', 'הפניה', 'יד2', 'ManyChat', 'ידני'];
        var UTM = ['facebook', 'instagram', 'tiktok', 'linkedin', 'taboola', 'outbrain', 'google', 'whatsapp',
                   'email', 'sms', 'call', 'website', 'organic', 'direct', 'referral', 'affiliate',
                   'crm', 'automation', 'kisorit', 'manychat', 'unknown'];
        var rows = SRC.map(function (v) { return { field: 'source', value: v }; }).concat(UTM.map(function (v) { return { field: 'utm_source', value: v }; }));
        db.from('field_options').delete().in('field', ['source', 'utm_source']).then(function (dr) {
          if (dr.error) return alert('שגיאה במחיקה: ' + dr.error.message);
          db.from('field_options').insert(rows).then(function (ir) {
            if (ir.error) return alert('שגיאה בהוספה: ' + ir.error.message);
            loadLists(); renderSettings();
          });
        });
      });
    });
  }

  // ---------- SETTINGS: brand → marketing company mapping (admin) ----------
  // הטבלה brand_companies מוזנת ע"י brand_setup.sql. עריכה כאן מעדכנת מיידית את הלידים
  // הקיימים של אותו מותג; לידים חדשים מתעדכנים ע"י טריגר ב-DB.
  function renderBrandMap() {
    var host = $('brandMapCard'); if (!host) return;
    db.from('brand_companies').select('brand,company').order('brand', { ascending: true }).then(function (r) {
      if (r.error) {
        host.innerHTML = '<div class="card" style="border:1px solid var(--warn);background:rgba(245,158,11,.08)"><b style="color:var(--warn)">⚠️ מיפוי חברות שיווק לא זמין</b> — הריצו את <b>supabase/brand_setup.sql</b> ב-Supabase SQL editor.</div>';
        return;
      }
      var rows = r.data || [];
      var body = rows.map(function (o) {
        return '<div class="bm-row" style="display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">' +
          '<span class="tag bm-brand" style="min-width:130px;text-align:center">' + esc(o.brand) + '</span>' +
          '<button class="btn btn-ghost btn-sm bm-rename" title="שנה שם מותג">✏️</button>' +
          '<button class="btn btn-ghost btn-sm bm-del" title="מחק מותג" style="color:var(--danger)">🗑️</button>' +
          '<span style="color:var(--muted)">→</span>' +
          '<input class="inp bm-co" value="' + esc(o.company || '') + '" placeholder="חברת שיווק…" style="flex:1;min-width:140px">' +
          '<button class="btn btn-sm bm-save">💾</button>' +
          '<span class="bm-msg" style="font-size:12px;min-width:64px"></span></div>';
      }).join('') || '<p class="muted" style="font-size:13px">אין מותגים. הריצו את brand_setup.sql.</p>';
      host.innerHTML = '<div class="card"><div class="row-between"><h3 style="margin:0">🏷️ מותג → חברת שיווק</h3><span class="muted" style="font-size:12px">מתעדכן אוטומטית בדוחות ובפרטי הליד</span></div>' +
        '<p class="muted" style="font-size:13px;margin:6px 0 12px">לכל מותג-שיווקי הגדירו חברת שיווק. ✏️ שינוי שם מעדכן את המותג בכל המקומות (רשימות, לידים). 🗑️ מחיקה מסירה אותו מרשימות הבחירה ומהמיפוי.</p>' +
        '<div>' + body + '</div></div>';
      // עדכון חברת השיווק
      host.querySelectorAll('.bm-save').forEach(function (b) {
        b.addEventListener('click', function () {
          var row = b.closest('.bm-row'), inp = row.querySelector('.bm-co'), msg = row.querySelector('.bm-msg');
          var brand = row.querySelector('.bm-brand').textContent, company = (inp.value || '').trim();
          b.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
          db.from('brand_companies').update({ company: company, updated_at: new Date().toISOString() }).eq('brand', brand).then(function (u) {
            if (u.error) { b.disabled = false; msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה'; return; }
            db.from('leads').update({ marketing_company: company }).eq('brand', brand).then(function (u2) {
              b.disabled = false; msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר'; loadLists();
            });
          });
        });
      });
      // שינוי שם מותג — מתעדכן ב-brand_companies + field_options + כל הלידים
      host.querySelectorAll('.bm-rename').forEach(function (b) {
        b.addEventListener('click', function () {
          var oldN = b.closest('.bm-row').querySelector('.bm-brand').textContent;
          var nn = prompt('שם מותג חדש (יתעדכן בכל המקומות):', oldN);
          if (nn == null) return; nn = nn.trim(); if (!nn || nn === oldN) return;
          db.from('brand_companies').update({ brand: nn }).eq('brand', oldN).then(function (u) {
            if (u.error) { alert('שגיאה: ' + u.error.message); return; }
            db.from('field_options').update({ value: nn }).eq('field', 'brand').eq('value', oldN).then(function () {
              db.from('leads').update({ brand: nn }).eq('brand', oldN).then(function () { loadLists(); renderBrandMap(); });
            });
          });
        });
      });
      // מחיקת מותג — מוסר מ-brand_companies + field_options (לידים קיימים נשמרים היסטורית)
      host.querySelectorAll('.bm-del').forEach(function (b) {
        b.addEventListener('click', function () {
          var brand = b.closest('.bm-row').querySelector('.bm-brand').textContent;
          if (!confirm('למחוק את המותג "' + brand + '"?\nהוא יוסר מרשימות הבחירה וממיפוי חברות השיווק.\nלידים קיימים עם המותג יישארו כפי שהם.')) return;
          db.from('brand_companies').delete().eq('brand', brand).then(function (u) {
            if (u.error) { alert('שגיאה: ' + u.error.message); return; }
            db.from('field_options').delete().eq('field', 'brand').eq('value', brand).then(function () { loadLists(); renderBrandMap(); });
          });
        });
      });
    });
  }

  // ---------- SETTINGS: telephony (SIP / Click-to-Call) ----------
  function renderTelephony() {
    var host = $('telephonyCard'); if (!host) return;
    db.from('app_config').select('value').eq('key', 'telephony').maybeSingle().then(function (r) {
      if (r && r.error) { host.innerHTML = '<div class="card" style="border:1px solid var(--warn);background:rgba(245,158,11,.08)"><b style="color:var(--warn)">⚠️ טלפוניה לא זמינה</b> — הריצו את <b>supabase/telephony.sql</b> ב-Supabase.</div>'; return; }
      var t = (r && r.data && r.data.value) || { mode: 'tel', sip_domain: '', webhook_url: '', country: '972' };
      var modes = [['tel', '📱 חייגן המכשיר / סופטפון (tel:)'], ['sip', '☎️ SIP (sip:)'], ['webhook', '🔌 Click-to-Call API (Webhook)']];
      host.innerHTML = '<div class="card"><div class="row-between"><h3 style="margin:0">☎️ טלפוניה — SIP / Click-to-Call</h3><span class="muted" style="font-size:12px">חיוג בלחיצה על 📞</span></div>' +
        '<p class="muted" style="font-size:13px;margin:6px 0 12px">בחרו כיצד ייפתח חיוג בלחיצה על 📞 ליד מספר טלפון בכל המערכת (רשימת לידים, כרטיס ליד).</p>' +
        '<div class="field" style="margin:0 0 10px"><label>מצב חיוג</label><select class="inp" id="telMode">' + modes.map(function (m) { return '<option value="' + m[0] + '"' + (t.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field" id="telSipWrap" style="margin:0 0 10px"><label>דומיין SIP</label><input class="inp" id="telSip" placeholder="pbx.example.com" value="' + esc(t.sip_domain || '') + '"></div>' +
        '<div class="field" id="telHookWrap" style="margin:0 0 10px"><label>כתובת Webhook ל-Click-to-Call</label><input class="inp" id="telHook" placeholder="https://pbx.example.com/api/click2call" value="' + esc(t.webhook_url || '') + '"></div>' +
        '<div class="field" style="margin:0 0 10px"><label>קידומת מדינה</label><input class="inp" id="telCountry" style="width:110px" value="' + esc(t.country || '972') + '"></div>' +
        '<button class="btn btn-sm" id="telSave">💾 שמור</button> <span id="telMsg" style="font-size:12px;margin-inline-start:8px"></span>' +
        '<p class="muted" style="font-size:12px;margin-top:12px;line-height:1.7">💡 <b>Click-to-Call</b>: המערכת שולחת POST ל-Webhook עם <code style="direction:ltr;display:inline-block">{to, agent, agent_id, lead_id}</code> — המרכזייה מצלצלת לנציג ואז ללקוח. תואם רוב מרכזיות ה-VoIP (3CX, Asterisk/FreePBX, Twilio, ועוד).</p>' +
        '</div>';
      function tog() { var m = $('telMode').value; $('telSipWrap').style.display = m === 'sip' ? '' : 'none'; $('telHookWrap').style.display = m === 'webhook' ? '' : 'none'; }
      $('telMode').addEventListener('change', tog); tog();
      $('telSave').addEventListener('click', function () {
        var val = { mode: $('telMode').value, sip_domain: $('telSip').value.trim(), webhook_url: $('telHook').value.trim(), country: $('telCountry').value.trim() || '972' };
        var msg = $('telMsg'); msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
        db.from('app_config').update({ value: val, updated_at: new Date().toISOString() }).eq('key', 'telephony').then(function (u) {
          if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
          window.C2B.tel = val; msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר';
        });
      });
    });
  }

  // ---------- SETTINGS: quick messages bank (automations) ----------
  function renderQuickMsgs() {
    var host = $('quickMsgCard'); if (!host) return;
    db.from('quick_messages').select('*').order('sort', { ascending: true }).then(function (r) {
      if (r.error) { host.innerHTML = '<div class="card" style="border:1px solid var(--warn);background:rgba(245,158,11,.08)"><b style="color:var(--warn)">⚠️ הודעות מהירות לא זמינות</b> — הריצו את <b>supabase/quick_messages.sql</b>.</div>'; return; }
      var list = r.data || [];
      function itemHtml(m, isNew) {
        return '<div class="qm-edit" data-id="' + (m.id || 'new') + '" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px;background:var(--surface-2)">' +
          '<div class="grid2" style="gap:8px"><div class="field" style="margin:0"><label>כותרת</label><input class="inp qm-title" value="' + esc(m.title || '') + '" placeholder="למשל: פולואפ"></div>' +
          '<div class="field" style="margin:0"><label>נושא מייל</label><input class="inp qm-esub" value="' + esc(m.email_subject || '') + '"></div></div>' +
          '<div class="field" style="margin:8px 0 0"><label>טקסט WhatsApp</label><textarea class="inp qm-wa" rows="3" style="width:100%">' + esc(m.wa_text || '') + '</textarea></div>' +
          '<div class="field" style="margin:8px 0 0"><label>גוף המייל</label><textarea class="inp qm-ebody" rows="3" style="width:100%">' + esc(m.email_body || '') + '</textarea></div>' +
          '<div style="margin-top:8px;display:flex;gap:6px;align-items:center"><button class="btn btn-sm qm-save">💾 שמור</button>' + (isNew ? '' : '<button class="btn btn-ghost btn-sm qm-del" style="color:var(--danger)">🗑 מחק</button>') + '<span class="qm-emsg" style="font-size:12px;margin-inline-start:6px"></span></div>' +
          '<p class="muted" style="font-size:11px;margin:6px 0 0">אפשר להשתמש ב-{firstname} {name} {car} — יוחלפו בפרטי הליד.</p></div>';
      }
      host.innerHTML = '<div class="card"><div class="row-between"><h3 style="margin:0">⚡ הודעות מהירות (אוטומציות)</h3><span class="muted" style="font-size:12px">כפתור "⚡ הודעות מהירות" בכרטיס הליד</span></div>' +
        '<p class="muted" style="font-size:13px;margin:6px 0 12px">הודעות מוכנות לשליחה מהירה ללקוח לאורך הטיפול — בלחיצה נשלחות ב-WhatsApp ובמייל.</p>' +
        list.map(function (m) { return itemHtml(m, false); }).join('') + '<div id="qmNew"></div>' +
        '<button class="btn btn-sm" id="qmAdd">➕ הודעה חדשה</button></div>';
      function bindItem(el) {
        var idv = el.dataset.id;
        el.querySelector('.qm-save').addEventListener('click', function () {
          var rec = { title: el.querySelector('.qm-title').value.trim(), wa_text: el.querySelector('.qm-wa').value.trim() || null, email_subject: el.querySelector('.qm-esub').value.trim() || null, email_body: el.querySelector('.qm-ebody').value.trim() || null };
          var emsg = el.querySelector('.qm-emsg');
          if (!rec.title) { emsg.style.color = 'var(--danger)'; emsg.textContent = 'כותרת חובה'; return; }
          emsg.style.color = 'var(--muted)'; emsg.textContent = 'שומר…';
          var q = (idv === 'new') ? db.from('quick_messages').insert(Object.assign(rec, { sort: list.length + 1 })) : db.from('quick_messages').update(rec).eq('id', idv);
          q.then(function (u) { if (u.error) { emsg.style.color = 'var(--danger)'; emsg.textContent = 'שגיאה: ' + u.error.message; return; } renderQuickMsgs(); });
        });
        var del = el.querySelector('.qm-del');
        if (del) del.addEventListener('click', function () { if (!confirm('למחוק את "' + el.querySelector('.qm-title').value + '"?')) return; db.from('quick_messages').delete().eq('id', idv).then(function () { el.remove(); }); });
      }
      host.querySelectorAll('.qm-edit').forEach(bindItem);
      $('qmAdd').addEventListener('click', function () { var box = $('qmNew'); if (box.querySelector('.qm-edit')) return; box.innerHTML = itemHtml({}, true); bindItem(box.querySelector('.qm-edit')); });
    });
  }

  // ---------- SETTINGS: WhatsApp via ManyChat ----------
  function renderManychat() {
    var host = $('manychatCard'); if (!host) return;
    db.from('admin_config').select('value').eq('key', 'manychat').maybeSingle().then(function (r) {
      if (r && r.error) { host.innerHTML = '<div class="card" style="border:1px solid var(--warn);background:rgba(245,158,11,.08)"><b style="color:var(--warn)">⚠️ ManyChat לא זמין</b> — הריצו את <b>supabase/telephony.sql</b> (טבלת app_config).</div>'; return; }
      var t = (r && r.data && r.data.value) || {};
      var has = !!t.token;
      host.innerHTML = '<div class="card"><div class="row-between"><h3 style="margin:0">📲 WhatsApp דרך ManyChat</h3><span class="muted" style="font-size:12px">שליחת וואטסאפ ללידים</span></div>' +
        '<p class="muted" style="font-size:13px;margin:6px 0 12px">הדביקו את ה-<b>API Token</b> של ManyChat (ב-ManyChat → <b>Settings → API</b>). הוא ישמש לשליחת WhatsApp ללידים — אוטומטית ובכפתור בכרטיס הליד.</p>' +
        '<div class="field" style="margin:0 0 10px"><label>ManyChat API Token</label><input class="inp" id="mcToken" type="password" autocomplete="off" placeholder="' + (has ? '•••••••••• (טוקן שמור — הדביקו חדש כדי להחליף)' : 'הדביקו כאן את הטוקן…') + '" value=""></div>' +
        '<button class="btn btn-sm" id="mcSave">💾 שמור</button> ' + (has ? '<span style="color:var(--ok);font-size:12.5px;font-weight:600;margin-inline-start:6px">✔ טוקן מחובר</span>' : '') + ' <span id="mcMsg" style="font-size:12.5px;margin-inline-start:8px"></span>' +
        '<p class="muted" style="font-size:11.5px;margin-top:10px">🔒 הטוקן נשמר מאובטח ומשמש רק בצד השרת לשליחת ההודעות. דורש ManyChat Pro.</p>' +
        '</div>';
      $('mcSave').addEventListener('click', function () {
        var tok = $('mcToken').value.trim(), msg = $('mcMsg');
        if (!tok) { msg.style.color = 'var(--danger)'; msg.textContent = 'הדביקו טוקן'; return; }
        var b = this; b.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
        db.from('admin_config').upsert({ key: 'manychat', value: { token: tok }, updated_at: new Date().toISOString() }, { onConflict: 'key' }).then(function (u) {
          b.disabled = false;
          if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
          msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר'; renderManychat();
        });
      });
    });
  }

  // ---- מרכז חיבורים · מקורות לידים (integrations) ----
  function renderIntegrations() {
    var host = $('integrationsCard'); if (!host) return;
    var FN = SUPABASE_URL + '/functions/v1/ingest';
    var PLAT = { google: ['🔍', 'Google Ads'], taboola: ['🟠', 'Taboola'], outbrain: ['🔵', 'Outbrain'], kishurit: ['🟢', 'קישורית'], webhook: ['🔗', 'Webhook כללי'], facebook: ['📘', 'פייסבוק'] };
    var HINT = {
      google: 'ב-Google Ads → טופס הליד → "Data integration / Webhook": הדביקו את ה-URL, ובשדה Key את המפתח (החלק שאחרי key= ב-URL).',
      taboola: 'ב-Taboola → Lead Generation → Webhook integration → הדביקו את ה-URL.',
      outbrain: 'ב-Outbrain → Lead generation → Webhook → הדביקו את ה-URL.',
      kishurit: 'בקישורית → הגדרת העברת לידים / postback → הדביקו את ה-URL (POST JSON).',
      webhook: 'כל מערכת (או Zapier / Make) — שלחו POST עם JSON של הליד ל-URL הזה.'
    };
    var CRMF = [['', '—'], ['name', 'שם'], ['phone', 'טלפון'], ['email', 'אימייל'], ['car', 'רכב'], ['city', 'עיר'], ['message', 'הודעה'], ['id_num', 'ת.ז/ח.פ'], ['marketing_company', 'חברת שיווק'], ['utm_source', 'utm_source'], ['utm_campaign', 'utm_campaign']];
    function crmSel(id) { return '<select class="inp" id="' + id + '" style="width:120px;font-size:12px">' + CRMF.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('') + '</select>'; }
    db.from('integrations').select('*').order('created_at').then(function (r) {
      if (r && r.error) { host.innerHTML = '<div class="card" style="border:1px solid var(--warn);background:rgba(245,158,11,.08)"><b style="color:var(--warn)">⚠️ מרכז חיבורים לא זמין</b> — הריצו את <b>supabase/integrations.sql</b> בבסיס הנתונים.</div>'; return; }
      var list = r.data || [];
      var rows = list.map(function (it) {
        var p = PLAT[it.platform] || ['🔗', it.platform], url = FN + '?key=' + it.ingest_key, fm = it.field_map || {};
        var maps = Object.keys(fm).map(function (k) { return '<span class="tag" style="margin:2px">' + esc(k) + ' → ' + esc(fm[k]) + ' <b data-fmdel="' + esc(it.id) + '|' + esc(k) + '" style="cursor:pointer;color:var(--danger)">✕</b></span>'; }).join('') || '<span class="muted" style="font-size:12px">אין מיפוי ידני — זיהוי אוטומטי פעיל (שם/טלפון/מייל/עיר/רכב)</span>';
        return '<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:0 0 10px;padding:14px">' +
          '<div class="row-between" style="margin-bottom:8px"><div style="display:flex;align-items:center;gap:8px;min-width:0"><span style="font-size:20px">' + p[0] + '</span><b>' + esc(it.label || p[1]) + '</b>' + (it.source_label ? ' <span class="muted" style="font-size:12px">· ' + esc(it.source_label) + '</span>' : '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px"><label class="cp-sw" title="פעיל"><input type="checkbox" data-itact="' + esc(it.id) + '"' + (it.active ? ' checked' : '') + '><span class="cp-sl"></span></label><button class="btn btn-ghost btn-sm" data-itdel="' + esc(it.id) + '" style="color:var(--danger)">🗑️</button></div></div>' +
          '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="inp" readonly value="' + esc(url) + '" style="flex:1;font-size:11px;direction:ltr" onclick="this.select()"><button class="btn btn-sm" data-itcopy="' + esc(url) + '">📋 העתק</button></div>' +
          '<p class="muted" style="font-size:11.5px;margin:0 0 8px">' + (HINT[it.platform] || '') + '</p>' +
          '<div style="font-size:12px;margin-bottom:6px">📊 <b>' + (it.lead_count || 0) + '</b> לידים' + (it.last_lead_at ? ' · אחרון: ' + fmtDateTime(it.last_lead_at) : '') + '</div>' +
          '<details><summary style="cursor:pointer;font-size:12.5px;color:var(--brand)">מיפוי שדות (מתקדם — לרוב לא צריך)</summary><div style="margin-top:8px">' + maps +
            '<div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap"><input class="inp" id="fmk_' + esc(it.id) + '" placeholder="שם השדה הנכנס (למשל FULL_NAME)" style="width:190px;font-size:12px"> → ' + crmSel('fmv_' + it.id) + ' <button class="btn btn-sm" data-fmadd="' + esc(it.id) + '">הוסף מיפוי</button></div>' +
          '</div></details>' +
        '</div>';
      }).join('') || '<p class="muted" style="font-size:13px">אין עדיין חיבורים. הוסיפו אחד למטה 👇</p>';
      host.innerHTML = '<div class="card"><div class="row-between"><h3 style="margin:0">🔌 חיבורים · מקורות לידים</h3><span class="muted" style="font-size:12px">Google · Taboola · Outbrain · קישורית · Webhook</span></div>' +
        '<p class="muted" style="font-size:13px;margin:6px 0 14px">כל חיבור מקבל כתובת ייחודית שקולטת לידים ישירות ל-CRM. תומך בריבוי חשבונות — הוסיפו כמה שתרצו. <b>פייסבוק</b> — בקרוב עם משיכת טפסים ובחירה.</p>' +
        rows +
        '<div id="fbSection" style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px"><div class="row-between"><b style="font-size:13.5px">📘 פייסבוק · טפסי לידים <span class="muted" style="font-weight:400;font-size:12px">(כל חשבונות ה-BM)</span></b><button class="btn btn-sm" id="fbLoad">🔄 טען טפסים מפייסבוק</button></div><div id="fbForms" style="margin-top:8px"></div></div>' +
        '<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px"><b style="font-size:13.5px">➕ הוספת חיבור</b>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
            '<select class="inp" id="niPlat" style="width:150px"><option value="google">🔍 Google Ads</option><option value="taboola">🟠 Taboola</option><option value="outbrain">🔵 Outbrain</option><option value="kishurit">🟢 קישורית</option><option value="webhook">🔗 Webhook כללי</option></select>' +
            '<input class="inp" id="niLabel" placeholder="שם החיבור (למשל: גוגל ראשי)" style="width:180px">' +
            '<input class="inp" id="niSource" placeholder="מקור הגעה בליד (source)" style="width:170px">' +
            '<button class="btn btn-sm" id="niAdd">צור חיבור</button>' +
          '</div><span id="niMsg" style="font-size:12px;margin-inline-start:4px"></span></div>' +
      '</div>';
      $('niAdd').addEventListener('click', function () {
        var plat = $('niPlat').value, label = $('niLabel').value.trim(), src = $('niSource').value.trim();
        if (!label) { $('niMsg').style.color = 'var(--danger)'; $('niMsg').textContent = 'הזינו שם לחיבור'; return; }
        var b = this; b.disabled = true; $('niMsg').style.color = 'var(--muted)'; $('niMsg').textContent = 'יוצר…';
        db.from('integrations').insert({ platform: plat, label: label, source_label: src || label }).then(function (u) {
          b.disabled = false; if (u.error) { $('niMsg').style.color = 'var(--danger)'; $('niMsg').textContent = u.error.message; return; } renderIntegrations();
        });
      });
      host.querySelectorAll('[data-itcopy]').forEach(function (b) { b.addEventListener('click', function () { var t = b.dataset.itcopy; function ok() { b.textContent = '✓ הועתק'; setTimeout(function () { b.textContent = '📋 העתק'; }, 1500); } if (navigator.clipboard) { navigator.clipboard.writeText(t).then(ok, function () { prompt('העתיקו:', t); }); } else { prompt('העתיקו:', t); } }); });
      host.querySelectorAll('[data-itdel]').forEach(function (b) { b.addEventListener('click', function () { if (!confirm('למחוק את החיבור? לידים שכבר נכנסו יישארו.')) return; db.from('integrations').delete().eq('id', b.dataset.itdel).then(renderIntegrations); }); });
      host.querySelectorAll('[data-itact]').forEach(function (cb) { cb.addEventListener('change', function () { db.from('integrations').update({ active: cb.checked }).eq('id', cb.dataset.itact).then(function () {}); }); });
      host.querySelectorAll('[data-fmadd]').forEach(function (b) { b.addEventListener('click', function () { var id = b.dataset.fmadd, k = ($('fmk_' + id).value || '').trim(), v = $('fmv_' + id).value; if (!k || !v) return; var it = list.filter(function (x) { return x.id === id; })[0]; var fm = Object.assign({}, it.field_map || {}); fm[k] = v; db.from('integrations').update({ field_map: fm }).eq('id', id).then(renderIntegrations); }); });
      host.querySelectorAll('[data-fmdel]').forEach(function (b) { b.addEventListener('click', function () { var parts = b.dataset.fmdel.split('|'), id = parts[0], key = parts.slice(1).join('|'); var it = list.filter(function (x) { return x.id === id; })[0]; if (!it) return; var fm = Object.assign({}, it.field_map || {}); delete fm[key]; db.from('integrations').update({ field_map: fm }).eq('id', id).then(renderIntegrations); }); });
      // ---- פייסבוק: טעינת דפים+טפסים דרך fb-forms ----
      function loadFb() {
        var box = $('fbForms'); box.innerHTML = '<p class="muted" style="font-size:13px">טוען טפסים מפייסבוק… (עד ~15 שניות)</p>';
        db.functions.invoke('fb-forms', { body: { action: 'list' } }).then(function (r) {
          var d = r.data || {};
          if ((r && r.error) || d.error) { box.innerHTML = '<p style="color:var(--danger);font-size:13px">שגיאה: ' + esc((d && d.error) || (r.error && r.error.message) || 'לא ידוע') + '</p>'; return; }
          var pages = d.pages || [];
          if (!pages.length) { box.innerHTML = '<p class="muted" style="font-size:13px">לא נמצאו טפסים.</p>'; return; }
          function campState(f) { return f.active_campaign ? 'active' : (f.days_ago != null ? 'inactive' : (f.leads_count ? 'unknown' : 'none')); }
          var totalForms = 0, totalNoCamp = 0, totalActive = 0;
          pages.forEach(function (p) { p.forms.forEach(function (f) { totalForms++; var s = campState(f); if (s === 'active') totalActive++; else if (s === 'inactive' || s === 'none') totalNoCamp++; }); });
          var summary = '<div style="font-size:12.5px;margin-bottom:8px;padding:8px 10px;background:var(--surface-2);border-radius:8px">מתוך <b>' + totalForms + '</b> טפסים · <b style="color:var(--ok)">' + totalActive + '</b> עם קמפיין פעיל 🟢 · <b style="color:var(--warn)">' + totalNoCamp + '</b> ללא קמפיין פעיל ⚪ (הפעל רק את הרלוונטיים)</div>';
          box.innerHTML = summary + pages.map(function (p) {
            var conn = p.forms.filter(function (f) { return f.connected; }).length;
            var noCamp = p.forms.filter(function (f) { var s = campState(f); return s === 'inactive' || s === 'none'; }).length;
            return '<details style="margin:6px 0;border:1px solid var(--line);border-radius:10px;padding:8px 12px"><summary style="cursor:pointer;font-weight:700;font-size:13px">' + esc(p.page_name) + ' <span class="muted" style="font-weight:400;font-size:11.5px">· ' + p.forms.length + ' טפסים' + (conn ? ' · ' + conn + ' מחוברים ✓' : '') + (noCamp ? ' · <span style="color:var(--warn)">' + noCamp + ' ללא קמפיין</span>' : '') + '</span></summary><div style="margin-top:8px">' +
              p.forms.map(function (f) {
                var s = campState(f), camp;
                if (s === 'active') camp = '<span style="color:var(--ok);font-weight:600">🟢 קמפיין פעיל</span> <span class="muted">· ליד אחרון לפני ' + f.days_ago + ' ימים</span>';
                else if (s === 'inactive') camp = '<span style="color:var(--warn);font-weight:600">⚪ אין קמפיין פעיל</span> <span class="muted">· ליד אחרון לפני ' + f.days_ago + ' ימים</span>';
                else if (s === 'none') camp = '<span style="color:var(--warn);font-weight:600">⚪ אין קמפיין פעיל</span> <span class="muted">· אף פעם לא היו לידים</span>';
                else camp = '<span class="muted">❓ לא נבדק</span>';
                return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">' +
                  '<label class="cp-sw" style="flex:none"><input type="checkbox" class="fbtog"' + (f.connected ? ' checked' : '') + ' data-pid="' + esc(p.page_id) + '" data-pname="' + esc(p.page_name) + '" data-fid="' + esc(f.id) + '" data-fname="' + esc(f.name) + '"><span class="cp-sl"></span></label>' +
                  '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.name) + '</div><div style="font-size:11px">' + camp + (f.leads_count ? ' <span class="muted">· ' + f.leads_count + ' לידים בסה"כ</span>' : '') + '</div></div></div>';
              }).join('') + '</div></details>';
          }).join('');
          box.querySelectorAll('.fbtog').forEach(function (cb) {
            cb.addEventListener('change', function () {
              cb.disabled = true;
              db.functions.invoke('fb-forms', { body: { action: 'toggle', page_id: cb.dataset.pid, page_name: cb.dataset.pname, form_id: cb.dataset.fid, form_name: cb.dataset.fname, enable: cb.checked } }).then(function (rr) {
                cb.disabled = false; var dd = rr.data || {};
                if ((rr && rr.error) || dd.error) { cb.checked = !cb.checked; alert('שגיאה: ' + ((dd && dd.error) || (rr.error && rr.error.message))); }
              }, function (e) { cb.disabled = false; cb.checked = !cb.checked; alert('שגיאה: ' + e); });
            });
          });
        }, function (e) { box.innerHTML = '<p style="color:var(--danger);font-size:13px">שגיאה: ' + esc(String(e)) + '</p>'; });
      }
      $('fbLoad').addEventListener('click', loadFb);
    });
  }

  // ---- visual editor for the lead-card action bar (order / rename / show-hide) ----
  function actionEditorCard() {
    var cfg = (window.C2B.getActionCfg && window.C2B.getActionCfg()) || [], meta = {};
    (window.C2B.leadActionsMeta || []).forEach(function (m) { meta[m.k] = m; });
    var rows = cfg.map(function (c, i) {
      var m = meta[c.k] || { icon: '', label: c.k };
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)">' +
        '<span style="font-size:18px;width:24px;text-align:center">' + m.icon + '</span>' +
        '<input class="inp ae-label" data-i="' + i + '" value="' + esc(c.label || m.label) + '" style="flex:1">' +
        '<label style="display:flex;gap:5px;align-items:center;font-size:12.5px;white-space:nowrap"><input type="checkbox" class="ae-on" data-i="' + i + '"' + (c.on !== false ? ' checked' : '') + '> מוצג</label>' +
        '<button class="btn btn-ghost btn-sm ae-up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn btn-ghost btn-sm ae-down" data-i="' + i + '"' + (i === cfg.length - 1 ? ' disabled' : '') + '>↓</button></div>';
    }).join('');
    return '<div class="card"><div class="row-between"><h3 style="margin:0">🎛️ עריכת סרגל הפעולות בכרטיס ליד</h3><button class="btn btn-ghost btn-sm" id="aeReset">↺ שחזר ברירת מחדל</button></div>' +
      '<p class="muted" style="font-size:12.5px;margin:4px 0 10px">סדר מחדש (↑↓), שנה שמות, והצג/הסתר את הכפתורים. השינוי נשמר לדפדפן זה ומשפיע על כרטיס הליד.</p>' + rows + '</div>';
  }
  function bindActionEditor() {
    var cfg = (window.C2B.getActionCfg && window.C2B.getActionCfg()) || [];
    function save() { window.C2B.saveActionCfg && window.C2B.saveActionCfg(cfg); }
    $('view').querySelectorAll('.ae-label').forEach(function (inp) { inp.addEventListener('change', function () { cfg[+inp.dataset.i].label = inp.value.trim(); save(); }); });
    $('view').querySelectorAll('.ae-on').forEach(function (cb) { cb.addEventListener('change', function () { cfg[+cb.dataset.i].on = cb.checked; save(); }); });
    $('view').querySelectorAll('.ae-up').forEach(function (b) { b.addEventListener('click', function () { var i = +b.dataset.i; if (i <= 0) return; var t = cfg[i - 1]; cfg[i - 1] = cfg[i]; cfg[i] = t; save(); renderSettings(); }); });
    $('view').querySelectorAll('.ae-down').forEach(function (b) { b.addEventListener('click', function () { var i = +b.dataset.i; if (i >= cfg.length - 1) return; var t = cfg[i + 1]; cfg[i + 1] = cfg[i]; cfg[i] = t; save(); renderSettings(); }); });
    if ($('aeReset')) $('aeReset').addEventListener('click', function () { if (!confirm('לשחזר את סדר ושמות הכפתורים לברירת מחדל?')) return; window.C2B.resetActionCfg && window.C2B.resetActionCfg(); renderSettings(); });
  }

  // ---------- SOON placeholders ----------
  var SOON = {
    quotes: ['📄 הצעות מחיר', 'יצירת הצעות מחיר, שליחה ללקוח ומעקב פתיחה/מענה. חלק מ-Phase 2.'],
    documents: ['✍️ מסמכים והסכמים', 'מילוי אוטומטי של תבנית ההסכם מנתוני הליד, חתימה דיגיטלית בדפדפן ומעקב חתימה. Phase 4.'],
    whatsapp: ['💬 WhatsApp', 'צ\'אט WhatsApp מובנה (הודעות/תמונות/PDF/תבניות) דרך Meta Cloud API. Phase 3.'],
    emails: ['📧 מיילים', 'שליחת מיילים ומעקב, דרך Resend. Phase 2.'],
    sms: ['📱 SMS', 'שליחת SMS עם שם-שולח דרך שער ישראלי. Phase 3.'],
    automations: ['🤖 אוטומציות', 'בונה חוקים ויזואלי: "אם סטטוס X → שלח WhatsApp/מייל/פתח משימה". Phase 2.'],
    reports: ['📈 דוחות', 'דוחות ביצועים מתקדמים וייצוא. Phase 2.'],
    sales: ['👤 אנשי מכירות', 'ניהול משתמשים, שיוך לידים והרשאות. Phase 2.'],
    branches: ['🏢 סניפים', 'ניהול סניפים ושיוך.'],
    settings: ['⚙️ הגדרות', 'הגדרות מערכת, אינטגרציות ומיתוג.']
  };
  function renderSoon(key) {
    var s = SOON[key] || ['בקרוב', ''];
    view('<div class="card" style="text-align:center;padding:60px 24px"><div style="font-size:44px">' + s[0].split(' ')[0] + '</div><h3 style="justify-content:center">' + esc(s[0].replace(/^\S+\s/, '')) + '</h3><p class="muted" style="max-width:520px;margin:0 auto">' + esc(s[1]) + '</p></div>');
  }

  // ---------- CSV export helper (shared) ----------
  window.C2B.exportCsv = function (rows, cols, name) {
    if (!rows.length) { alert('אין נתונים לייצוא'); return; }
    function cell(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
    var csv = cols.join(',') + '\n' + rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
  };
  window.C2B.refreshBadges = refreshBadges;

  // ---------- boot ----------
  db.auth.getSession().then(function (r) { if (r.data.session) showApp(r.data.session); else showLogin(); });
})();
