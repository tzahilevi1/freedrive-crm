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
  // ---------- דיווח שגיאות מרכזי ----------
  // מתוך 164 קריאות למסד, כ-60% לא בדקו r.error — כלומר כשל ברשת או הרשאה
  // פשוט לא קרה כלום והמשתמש לא ידע. במקום לתקן 164 מקומות, מיירטים כאן:
  // כל תשובה שאינה 2xx מהמסד או מפונקציה מוצגת פעם אחת, בשפה של המשתמש.
  var ERR_TEXT = {
    401: 'ההתחברות פגה. רעננו את העמוד והתחברו מחדש.',
    403: 'אין לך הרשאה לפעולה הזאת.',
    404: 'הפעולה לא נמצאה בשרת. ייתכן שצריך לרענן את העמוד.',
    409: 'הרשומה כבר קיימת או שינה אותה מישהו אחר.',
    413: 'הקובץ גדול מדי.',
    429: 'יותר מדי בקשות. נסו שוב בעוד רגע.'
  };
  var errSeen = {}, errBox2 = null;
  function friendlyError(status, body, path) {
    var msg = ERR_TEXT[status];
    if (!msg) {
      var m = (body && (body.message || body.msg || body.error_description || body.error)) || '';
      if (/violates check constraint/i.test(m)) msg = 'הערך שהוזן אינו חוקי עבור השדה הזה.';
      else if (/violates foreign key/i.test(m)) msg = 'הרשומה המקושרת לא קיימת יותר. רעננו את העמוד.';
      else if (/duplicate key/i.test(m)) msg = 'רשומה כזאת כבר קיימת.';
      else if (/כבר קיימת עסקה פעילה/.test(m)) msg = m;
      else msg = 'שגיאה בשרת (' + status + ')' + (m ? ': ' + String(m).slice(0, 120) : '');
    }
    return msg + (path ? ' · ' + path : '');
  }
  function showSysError(text) {
    if (errSeen[text] && Date.now() - errSeen[text] < 15000) return;   // לא מציפים באותה שגיאה
    errSeen[text] = Date.now();
    if (!errBox2) {
      errBox2 = document.createElement('div');
      errBox2.setAttribute('role', 'alert');
      errBox2.style.cssText = 'position:fixed;inset-inline-end:16px;bottom:16px;z-index:9999;max-width:380px;display:flex;flex-direction:column;gap:8px';
      document.body.appendChild(errBox2);
    }
    var el = document.createElement('div');
    el.style.cssText = 'background:var(--surface,#fff);border:1px solid var(--danger,#e2555a);border-inline-start:4px solid var(--danger,#e2555a);' +
      'border-radius:10px;padding:11px 14px;font-size:13px;line-height:1.5;box-shadow:0 8px 24px -12px rgba(0,0,0,.4);cursor:pointer';
    el.textContent = '⚠ ' + text;
    el.addEventListener('click', function () { el.remove(); });
    errBox2.appendChild(el);
    setTimeout(function () { el.remove(); }, 9000);
    if (window.console && console.warn) console.warn('[CRM]', text);
  }
  window.C2B_showError = showSysError;

  (function interceptFetch() {
    var orig = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      return orig.apply(this, arguments).then(function (res) {
        if (res.status >= 400 && url.indexOf(SUPABASE_URL) === 0) {
          // /auth נבדק ומוצג ממילא במסך ההתחברות; storage 400 הוא "לא נמצא" תקין
          var isAuth = url.indexOf('/auth/v1/') > -1;
          var seg = (url.split('/v1/')[1] || '').split('?')[0].split('/')[0];
          if (!isAuth) {
            res.clone().json().catch(function () { return null; }).then(function (b) {
              showSysError(friendlyError(res.status, b, seg));
            });
          }
        }
        return res;
      }, function (err) {
        if (url.indexOf(SUPABASE_URL) === 0) showSysError('אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.');
        throw err;
      });
    };
  })();

  // שגיאות JS שלא נתפסו — מוצגות למשתמש במקום להישאר רק בקונסול
  window.addEventListener('error', function (e) {
    if (e && e.message && !/ResizeObserver|Script error/.test(e.message)) showSysError('תקלה במסך: ' + String(e.message).slice(0, 110));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var m = (e && e.reason && (e.reason.message || e.reason)) || '';
    if (m && !/AbortError/.test(String(m))) showSysError('פעולה נכשלה: ' + String(m).slice(0, 110));
  });

  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDateTime(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); }
  function nis(n) { return n == null || n === '' ? '—' : '₪' + Number(n).toLocaleString('en-US'); }
  function view(html) { $('view').innerHTML = html; }
  function loading() { view('<div class="loading">טוען…</div>'); }
  function errBox(msg) { view('<div class="card"><p class="err">שגיאה: ' + esc(msg) + '</p></div>'); }
  //  key הופך את הכרטיס ללחיצ, והמסך שמציג אותו רושם מה לפתוח.
  function stat(k, v, trend, key) {
    // trend===true נועד רק לסמן כרטיס "היום" (לא טקסט מגמה) — בעבר הודפס "true ▲"; עכשיו מוצג תג "היום".
    var live = trend === true;
    var ts = (trend && !live) ? String(trend) : '';
    var t = ts ? '<div class="t ' + (ts[0] === '-' ? 'down' : 'up') + '">' + (ts[0] === '-' ? '▼ ' : '▲ ') + esc(ts) + '</div>'
              : (live ? '<div class="t up">● היום</div>' : '');
    return '<div class="kpi' + (key ? ' click" data-kpi="' + esc(key) : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + t + '</div>';
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
  function showLogin() { appStartedFor = null; $('login').classList.remove('hidden'); $('app').classList.add('hidden'); }
  //  showApp נקראה פעמיים: פעם מטופס ההתחברות, ופעם מ-getSession של טעינת
  //  העמוד שהבטחתו נפתרת אחרי ההתחברות ומוצאת סשן קיים. התוצאה הייתה 24
  //  קריאות למסד במקום 12 — כל שאילתת פתיחה רצה כפול.
  var appStartedFor = null;
  function showApp(session) {
    if (appStartedFor === session.user.id) return;
    appStartedFor = session.user.id;
    $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('whoami').textContent = session.user.email;
    window.C2B.userId = session.user.id;
    window.C2B.userName = session.user.email;
    window.C2B.lists = {};
    loadLists();
    loadConfig();
    loadBrandCompanies();
    db.from('profiles').select('role,full_name,views,active,sip_ext,phone').eq('user_id', session.user.id).single().then(function (r) {
      window.C2B.userSip = (r.data && r.data.sip_ext) || '';
      //  השם המלא משמש בהודעות המהירות של הווטסאפ ({{נציג}})
      window.C2B.fullName = (r.data && r.data.full_name) || '';
      window.C2B.userPhone = (r.data && r.data.phone) || '';
      // אכיפת השבתה — משתמש לא-פעיל מנותק מיד (בנוסף ל-RLS ו-Cloudflare Access)
      if (r.data && r.data.active === false) {
        db.auth.signOut().then(function () { showLogin(); });
        alert('החשבון שלך הושבת על ידי מנהל המערכת. לפרטים פנה למנהל.');
        return;
      }
      window.C2B.role = (r.data && r.data.role) || 'sales';
      window.C2B.views = (r.data && r.data.views && r.data.views.length) ? r.data.views : (DEFAULT_VIEWS[window.C2B.role] || ['dashboard']);
      // מסך ניהול חדש שנוסף בקוד לא מופיע אצל מי שרשימת המסכים שלו כבר
      // שמורה במסד — והיא נשמרת לכל משתמש שנערך אי פעם. מנהל מערכת
      // חייב לראות את מסכי הניהול תמיד, ולכן הם מתווספים ולא נגזרים.
      if (window.C2B.role === 'admin') {
        (DEFAULT_VIEWS.admin || []).forEach(function (v) {
          if (window.C2B.views.indexOf(v) < 0) window.C2B.views.push(v);
        });
      }
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
            'reports','agents','ai','quotes','documents','whatsapp','heyy','emails','sms','automations','users','branches','trash','audit','ctemplates','settings'],
    // סוכן מכירות: כל התפעול שלו — בלי כספים, בלי דוחות/אנליטיקס, בלי ערוצי הודעות
    sales: ['dashboard', 'leads', 'files', 'cars', 'appointments', 'tasks', 'ai', 'quotes', 'documents', 'heyy'],
    // מנהלת תיקי לקוחות: דשבורד, תיקי לקוחות, רכבים, יומן, משימות, הצעות מחיר, מסמכים והסכמים
    files: ['dashboard', 'files', 'cars', 'appointments', 'tasks', 'quotes', 'documents', 'heyy'],
    // מנהלת חשבונות: דשבורד, הנהלת חשבונות, רכבים, יומן, משימות, דוחות, עוזר AI, הצעות מחיר, מסמכים והסכמים
    accounting: ['dashboard', 'accounting', 'cars', 'appointments', 'tasks', 'reports', 'ai', 'quotes', 'documents', 'heyy'],
    // מנהל סניף: רואה הכל, למעט מסכי הניהול של המערכת (משתמשים, הגדרות, אוטומציות)
    branch: ['dashboard', 'leads', 'files', 'accounting', 'cars', 'appointments', 'tasks', 'analytics',
             'reports', 'agents', 'ai', 'quotes', 'documents', 'whatsapp', 'heyy', 'emails', 'sms', 'users', 'audit']
  };
  // screens the admin can grant when creating a user (label + key)
  var GRANTABLE_VIEWS = [
    ['dashboard', 'דשבורד'], ['leads', 'לידים'], ['files', 'תיקי לקוחות'], ['accounting', 'הנהלת חשבונות'],
    ['cars', 'רכבים'], ['appointments', 'יומן פגישות'], ['tasks', 'משימות'], ['analytics', 'אנליטיקס'], ['reports', 'דוחות'],
    ['ai', 'עוזר AI'], ['quotes', 'הצעות מחיר'], ['documents', 'מסמכים והסכמים'], ['whatsapp', 'WhatsApp'], ['heyy', 'Hey · WhatsApp'], ['emails', 'מיילים'], ['sms', 'SMS'],
    ['audit', 'יומן פעולות']
  ];
  // מסכי ניהול שאינם ניתנים להקצאה (מנהל מערכת בלבד) — כאן רק כדי שיוצגו בעברית
  var ADMIN_ONLY_VIEWS = { users: 'משתמשים והרשאות', settings: 'הגדרות ורשימות', branches: 'סניפים', ctemplates: 'תבניות הסכמים',
                           automations: 'אוטומציות', trash: 'סל מיחזור', agents: 'נציגים' };
  //  מסכים שפתוחים גם למנהל סניף. "משתמשים והרשאות" נפתח לו לצפייה בלבד:
  //  RLS מרשה לכל אנשי הצוות לקרוא פרופילים אבל רק למנהל מערכת לכתוב,
  //  ולכן כפתורי העריכה מוסתרים ממנו במקום להיכשל בשקט.
  var SENIOR_VIEWS = { users: 1, agents: 1 };
  function navAllowed(nav, role) {
    //  לשוניות משנה ("settings:phone") יורשות את ההרשאה של המסך
    if (nav && nav.indexOf(':') > 0) nav = nav.split(':')[0];
    if (role === 'admin' || !role) return true;
    if (nav === 'activity' || nav === 'dashboard') return true;   // always available
    if (nav && nav.indexOf('soon:') === 0) return false;
    if (SENIOR_VIEWS[nav]) return role === 'branch';   // מנהל מערכת כבר חזר true למעלה
    var views = (window.C2B && window.C2B.views) || DEFAULT_VIEWS[role] || ['dashboard'];
    return views.indexOf(nav) >= 0;
  }
  function applyRole(role) {
    $('nav').querySelectorAll('.nav-item, .nav-group-label').forEach(function (it) {
      if (it.classList.contains('nav-group-label')) { it.style.display = role === 'admin' ? '' : 'none'; return; }
      //  פריט שמסומן data-senior הוא תצוגת ניהול בתוך תפריט שפתוח לכולם
      //  (למשל תור החלוקה שבתוך "לידים") — הרשאת האב אינה מספיקה לו.
      if (it.dataset.senior && role !== 'admin' && role !== 'branch') { it.style.display = 'none'; return; }
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
    var redirect = 'https://crm.freedrive.co.il/reset.html';
    db.auth.resetPasswordForEmail(em, { redirectTo: redirect }).then(function (r) {
      $('loginErr').style.color = r.error ? 'var(--danger)' : 'var(--ok)';
      $('loginErr').textContent = r.error ? ('שגיאה: ' + r.error.message) : 'נשלח מייל לאיפוס סיסמה (אם החשבון קיים). בדקו את תיבת הדואר.';
    });
  });
  // activity screen now lives in the header (next to the bell)
  $('activityBtn').addEventListener('click', function () { go('activity'); });

  // ---------- routing ----------
  function setActive(nav, status) {
    //  פריט האב נשאר מודגש גם כשנמצאים בלשונית משנה שלו
    var g = subGroup(nav); if (g) nav = g; else nav = navBase(nav);
    var items = $('nav').querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      it.classList.toggle('active', it.dataset.nav === nav && (status == null || it.dataset.status === status || (it.dataset.status === undefined && !it.dataset.status)));
    }
    var sub = $('leadSub'); if (sub) sub.classList.toggle('open', nav === 'leads');
  }

  //  ---------- לשוניות משנה ----------
  //  המסכים הפנימיים מחליפים את כל #view, וחלקם עושים זאת
  //  אחרי שליפת נתונים. לכן סרגל הלשוניות יושב באלמנט נפרד
  //  מעליו — אחרת הוא היה נמחק בכל רינדור אסינכרוני.
  var SUBTABS = {
    automations: [
      ['automations', '\u2699\ufe0f כללי אוטומציה'],
      ['whatsapp', '\ud83d\udcac WhatsApp'],
      ['emails', '\ud83d\udce7 מיילים'],
      ['sms', '\ud83d\udcf1 SMS']
    ],
    settings: [
      ['settings', '\ud83d\udccb רשימות ובחירות'],
      ['settings:integrations', '\ud83d\udd0c חיבורים'],
      ['settings:brands', '\ud83c\udff7\ufe0f מותגים'],
      ['settings:quick', '\ud83d\udcac הודעות מהירות'],
      ['settings:phone', '\u260e\ufe0f טלפוניה'],
      ['settings:actions', '\u26a1 פעולות'],
      ['branches', '\ud83c\udfe2 סניפים'],
      ['ctemplates', '\ud83d\udcdc תבניות הסכמים']
    ]
  };
  function subGroup(nav) {
    for (var g in SUBTABS) if (SUBTABS[g].some(function (t) { return t[0] === nav; })) return g;
    return null;
  }
  //  שם המסך לניווט, בלי סיומת הלשונית
  function navBase(nav) { return nav && nav.indexOf(':') > 0 ? nav.split(':')[0] : nav; }
  function drawSubnav(nav) {
    var el = $('subnav'); if (!el) return;
    var g = subGroup(nav);
    if (!g) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = SUBTABS[g].filter(function (t) { return navAllowed(t[0], (window.C2B && window.C2B.role) || ''); })
      .map(function (t) {
        return '<button data-sub="' + t[0] + '"' + (nav === t[0] ? ' class="active"' : '') + '>' + t[1] + '</button>';
      }).join('');
  }

  function go(nav, opts) {
    opts = opts || {};
    if (window.C2B && window.C2B.role && !navAllowed(nav, window.C2B.role)) { nav = 'dashboard'; opts = {}; }
    drawSubnav(nav);
    if (nav === 'users') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderUsers(); }
    if (nav === 'heyy') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderHeyy(); }
    if (nav === 'agents') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderAgents(); }
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
    if (navBase(nav) === 'settings') return renderSettings(nav.indexOf(':') > 0 ? nav.split(':')[1] : 'lists');
    if (nav === 'quotes') return window.C2B_renderQuotes && window.C2B_renderQuotes();
    if (nav === 'documents') return window.C2B_renderDocuments && window.C2B_renderDocuments();
    if (nav === 'whatsapp') return window.C2B_renderComms && window.C2B_renderComms('whatsapp');
    if (nav === 'emails') return window.C2B_renderComms && window.C2B_renderComms('emails');
    if (nav === 'sms') return window.C2B_renderComms && window.C2B_renderComms('sms');
    if (nav === 'automations') return window.C2B_renderAutomations && window.C2B_renderAutomations();
    if (nav === 'branches') return window.C2B_renderBranches && window.C2B_renderBranches();
    if (nav === 'trash') return window.C2B_renderTrash && window.C2B_renderTrash();
    if (nav === 'audit') return window.C2B_renderAudit && window.C2B_renderAudit();
    if (nav === 'ctemplates') return window.C2B_renderContractTemplates && window.C2B_renderContractTemplates();
    if (nav.indexOf('soon:') === 0) return renderSoon(nav.slice(5));
    return window.C2B_renderDashboard && window.C2B_renderDashboard();
  }
  $('nav').addEventListener('click', function (e) {
    var it = e.target.closest('.nav-item'); if (!it) return;
    go(it.dataset.nav, { status: it.dataset.status });
  });
  //  לשוניות המשנה. המאזין על המיכל שנשאר בדף, ולכן שורד כל רינדור.
  $('subnav').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sub]'); if (!b) return;
    go(b.dataset.sub);
  });

  function refreshBadges() {
    db.from('leads').select('id', { count: 'exact', head: true }).is('deleted_at', null).then(function (r) { if (r.count != null) $('bLeads').textContent = r.count; });
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('done', false).then(function (r) { if (r.count != null) $('bTasks').textContent = r.count; }).catch(function () {});
    loadBell();
  }

  // ---------- global search ----------
  var gsT;
  $('gsearch').addEventListener('input', function () {
    var q = this.value.trim().replace(/[(),*]/g, ' ').trim(); clearTimeout(gsT);   // strip PostgREST filter-grammar chars
    if (q.length < 2) { $('gsres').classList.add('hidden'); return; }
    gsT = setTimeout(function () {
      db.from('leads').select('id,name,phone,car,status').is('deleted_at', null).or('name.ilike.%' + q + '%,phone.ilike.%' + q + '%,car.ilike.%' + q + '%').limit(8).then(function (r) {
        var rows = (r.data || []).map(function (l) { return '<div class="sr" data-lead="' + l.id + '"><b>' + esc(l.name) + '</b> <span class="muted">· ' + esc(l.phone) + (l.car ? ' · ' + esc(l.car) : '') + '</span></div>'; }).join('');
        $('gsres').innerHTML = rows || '<div class="sr muted">אין תוצאות</div>';
        $('gsres').classList.remove('hidden');
        $('gsres').querySelectorAll('.sr[data-lead]').forEach(function (el) { el.addEventListener('click', function () { $('gsres').classList.add('hidden'); $('gsearch').value = ''; window.C2B_openLeadCard(el.dataset.lead); }); });
      });
    }, 250);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) $('gsres').classList.add('hidden'); });

  // ---------- generic field filter (used on leads / files / cars) ----------
  var OPS = { contains: 'מכיל', eq: 'שווה ל', ne: 'שונה מ', gt: 'גדול מ', lt: 'קטן מ', between: 'בין', empty: 'ריק', nempty: 'לא ריק' };
  // לשדה תאריך המילים אחרות — "גדול מ־31.8" לא אומר כלום, "אחרי" כן.
  // "מכיל" נעדר בכוונה: אין לו משמעות על תאריך.
  var DATE_OPS = { eq: 'הוא', between: 'בין', gt: 'אחרי', lt: 'לפני', ne: 'שונה מ', empty: 'ריק', nempty: 'לא ריק' };

  // תקופות מוכנות, מהקצרה לארוכה. נשמרות כאסימון ולא כתאריך מחושב —
  // מסנן "היום" חייב להישאר היום גם מחר, ולא להיתקע על התאריך שבו נוצר.
  var PERIODS = [
    { v: '@today', l: 'היום' },
    { v: '@yesterday', l: 'אתמול' },
    { v: '@last3', l: '3 הימים האחרונים' },
    { v: '@last7', l: '7 הימים האחרונים' },
    { v: '@thisweek', l: 'השבוע הנוכחי' },
    { v: '@last14', l: '14 הימים האחרונים' },
    { v: '@thismonth', l: 'החודש הנוכחי' },
    { v: '@last30', l: '30 הימים האחרונים' },
    { v: '@lastmonth', l: 'החודש שעבר' },
    { v: '@last90', l: '90 הימים האחרונים' },
    { v: '@thisyear', l: 'השנה' },
    { v: '@custom', l: 'תאריך מסוים…' }
  ];
  var PERIOD_LBL = {}; PERIODS.forEach(function (p) { PERIOD_LBL[p.v] = p.l; });

  var DAY_MS = 86400000;
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  // כל תקופה מוחזרת כטווח [מ, עד) בזמן מקומי — הגבול העליון פתוח,
  // כדי שרשומה בשנייה האחרונה של היום לא תיפול בין הכיסאות.
  function periodRange(v) {
    var t0 = startOfToday(), n = new Date();
    if (v === '@today') return [t0, t0 + DAY_MS];
    if (v === '@yesterday') return [t0 - DAY_MS, t0];
    if (v === '@last3') return [t0 - 2 * DAY_MS, t0 + DAY_MS];
    if (v === '@last7') return [t0 - 6 * DAY_MS, t0 + DAY_MS];
    if (v === '@last14') return [t0 - 13 * DAY_MS, t0 + DAY_MS];
    if (v === '@last30') return [t0 - 29 * DAY_MS, t0 + DAY_MS];
    if (v === '@last90') return [t0 - 89 * DAY_MS, t0 + DAY_MS];
    if (v === '@thisweek') return [t0 - new Date(t0).getDay() * DAY_MS, t0 + DAY_MS];
    if (v === '@thismonth') return [new Date(n.getFullYear(), n.getMonth(), 1).getTime(), t0 + DAY_MS];
    if (v === '@lastmonth') return [new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), new Date(n.getFullYear(), n.getMonth(), 1).getTime()];
    if (v === '@thisyear') return [new Date(n.getFullYear(), 0, 1).getTime(), t0 + DAY_MS];
    return null;
  }

  // fields: [{key,label,options?:[{v,l}],type?:'date',get?:fn(row)}]  onApply: fn() → caller redraws
  function makeFilter(fields, onApply) {
    var byKey = {}; fields.forEach(function (f) { byKey[f.key] = f; });
    var state = [];

    function opsOf(f) { return (f && f.type === 'date') ? DATE_OPS : OPS; }
    function opSel(f, cur) {
      var o = opsOf(f);
      return '<select id="fbOp">' + Object.keys(o).map(function (k) {
        return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(o[k]) + '</option>';
      }).join('') + '</select>';
    }
    function valCtl(f, op) {
      if (op === 'empty' || op === 'nempty') return '<span id="fbVal" data-noval></span>';
      if (f && f.options) return '<select id="fbVal">' + f.options.map(function (o) { return '<option value="' + esc(o.v) + '">' + esc(o.l) + '</option>'; }).join('') + '</select>';
      if (f && f.type === 'date') {
        if (op === 'between') return '<input id="fbVal" type="date" style="width:140px"> <span class="muted" style="font-size:12px">עד</span> <input id="fbVal2" type="date" style="width:140px">';
        if (op === 'eq' || op === 'ne') {
          // בורר התקופות; "תאריך מסוים" חושף שדה תאריך לצידו במקום להחליף אותו,
          // כדי שאפשר יהיה לחזור לתקופה בלי לאבד את הבחירה
          return '<select id="fbVal">' + PERIODS.map(function (p) { return '<option value="' + p.v + '">' + esc(p.l) + '</option>'; }).join('') + '</select>' +
                 '<input id="fbValD" type="date" class="hidden" style="width:140px">';
        }
        return '<input id="fbVal" type="date" style="width:150px">';
      }
      if (op === 'between') return '<input id="fbVal" placeholder="מ…" style="width:90px"> <input id="fbVal2" placeholder="עד…" style="width:90px">';
      return '<input id="fbVal" placeholder="ערך…" style="width:150px">';
    }
    //  תאריך נשמר כ-timestamp מלא. השוואה מתבצעת על גבולות היום המקומי,
    //  אחרת "שווה ל-31.8" היה מפספס כל ליד שלא נוצר בדיוק בחצות.
    function dayRange(v) {
      var d = new Date(v + 'T00:00:00');
      if (isNaN(d)) return null;
      return [d.getTime(), d.getTime() + DAY_MS];
    }
    function heDate(v) { var d = new Date(v + 'T00:00:00'); return isNaN(d) ? v : d.toLocaleDateString('he-IL'); }
    function get(f, row) { var d = byKey[f.field]; return d && d.get ? d.get(row) : row[f.field]; }

    function chipText(f) {
      var d = byKey[f.field];
      if (d && d.type === 'date') {
        if (f.op === 'between') return heDate(f.val) + ' — ' + heDate(f.val2);
        if (PERIOD_LBL[f.val]) return PERIOD_LBL[f.val];
        return heDate(f.val);
      }
      if (f.op === 'between') return f.val + ' — ' + f.val2;
      if (d && d.options) return (d.options.filter(function (o) { return String(o.v) === String(f.val); })[0] || {}).l || f.val;
      return f.val;
    }

    var api = {
      render: function () {
        var f0 = fields[0], first0 = Object.keys(opsOf(f0))[0];
        var chips = state.map(function (f, i) {
          var d = byKey[f.field], o = opsOf(d);
          return '<span class="chip">' + esc(d ? d.label : f.field) + ' ' + esc(o[f.op] || f.op) + ' ' +
            esc(chipText(f) || '') + ' <b data-rmf="' + i + '">✕</b></span>';
        }).join('');
        return '<div class="filterbar" id="fbar"><span class="muted" style="font-size:12px">🧲 סינון לפי שדה:</span>' +
          '<select id="fbField">' + fields.map(function (f) { return '<option value="' + f.key + '">' + esc(f.label) + '</option>'; }).join('') + '</select>' +
          '<span id="fbCtl">' + opSel(f0, first0) + ' ' + valCtl(f0, first0) + '</span>' +
          '<button class="btn btn-sm" id="fbAdd">+ הוסף</button>' +
          (state.length ? '<button class="btn btn-ghost btn-sm" id="fbClear">נקה הכל</button>' : '') + chips + '</div>';
      },
      bind: function () {
        var bar = $('fbar'); if (!bar || !$('fbAdd')) return;
        // האזנה על המיכל: הפקדים נבנים מחדש בכל שינוי שדה או אופרטור,
        // ומאזין ישיר עליהם היה הולך לאיבוד ברינדור השני
        bar.addEventListener('change', function (e) {
          var f = byKey[$('fbField').value];
          if (e.target.id === 'fbField') {
            var first = Object.keys(opsOf(f))[0];
            $('fbCtl').innerHTML = opSel(f, first) + ' ' + valCtl(f, first);
          } else if (e.target.id === 'fbOp') {
            var keep = e.target.value;
            $('fbCtl').innerHTML = opSel(f, keep) + ' ' + valCtl(f, keep);
          } else if (e.target.id === 'fbVal' && $('fbValD')) {
            $('fbValD').classList.toggle('hidden', e.target.value !== '@custom');
          }
        });
        $('fbAdd').addEventListener('click', function () {
          var field = $('fbField').value, op = $('fbOp').value, f = byKey[field];
          var el = $('fbVal'), val = (el && !el.hasAttribute('data-noval') && el.value || '').trim();
          if (val === '@custom') val = ($('fbValD') && $('fbValD').value || '').trim();
          var val2 = ($('fbVal2') && $('fbVal2').value || '').trim();
          if (op === 'empty' || op === 'nempty') val = '';
          else if (!val || (op === 'between' && !val2)) return;
          // טווח הפוך הוא טעות הקלדה ולא כוונה — מסדרים במקום להחזיר רשימה ריקה
          if (op === 'between' && f && f.type === 'date' && val > val2) { var tmp = val; val = val2; val2 = tmp; }
          state.push({ field: field, op: op, val: val, val2: val2 }); onApply();
        });
        if ($('fbClear')) $('fbClear').addEventListener('click', function () { state = []; onApply(); });
        bar.querySelectorAll('[data-rmf]').forEach(function (b) { b.addEventListener('click', function () { state.splice(+b.dataset.rmf, 1); onApply(); }); });
      },
      match: function (row) {
        return state.every(function (f) {
          var raw = get(f, row); var s = (raw == null ? '' : String(raw)).toLowerCase(), q = String(f.val).toLowerCase();
          var def = byKey[f.field];
          if (def && def.type === 'date' && f.op !== 'empty' && f.op !== 'nempty') {
            var t = raw ? new Date(raw).getTime() : NaN;
            if (isNaN(t)) return false;
            var r = periodRange(f.val) || dayRange(f.val);
            if (f.op === 'between') {
              var r2 = dayRange(f.val2);
              if (!r || !r2) return false;
              return t >= r[0] && t < r2[1];
            }
            if (!r) return false;
            if (f.op === 'eq') return t >= r[0] && t < r[1];
            if (f.op === 'ne') return !(t >= r[0] && t < r[1]);
            if (f.op === 'gt') return t >= r[1];    // אחרי אותו יום במלואו
            if (f.op === 'lt') return t < r[0];
          }
          if (f.op === 'between') { var n = parseFloat(raw); return n >= parseFloat(f.val) && n <= parseFloat(f.val2); }
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
      m.innerHTML = '<div class="cp-head">בחירת עמודות · גררו לשינוי סדר</div><div class="cp-list">' +
        state.order.map(function (k) { var c = byKey[k], on = state.hidden.indexOf(k) < 0;
          return '<div class="cp-row" data-k="' + esc(k) + '"><span class="cp-mv" data-cpdrag tabindex="0" role="button" title="גררו לשינוי סדר (או חצים במקלדת)" aria-label="גררו לשינוי סדר">⠿</span><span class="cp-lbl">' + esc(c.label) + (c.fixed ? ' 🔒' : '') + '</span><label class="cp-sw"><input type="checkbox" data-cptg ' + (on ? 'checked' : '') + (c.fixed ? ' disabled' : '') + '><span class="cp-sl"></span></label></div>';
        }).join('') + '</div><button class="btn btn-ghost btn-sm" data-cpreset style="width:100%;margin-top:8px">איפוס לברירת מחדל</button>';
      document.body.appendChild(m);
      var r = anchor.getBoundingClientRect();
      m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      //  התפריט נפתח מתחת לכפתור, ואם אין שם מקום — מעליו.
      //  בשני המקרים הגובה מוגבל למקום שבאמת נשאר, כדי
      //  שהרשימה תגלול במקום להיחתך בקצה המסך.
      var below = window.innerHeight - r.bottom - 14, above = r.top - 14;
      if (below >= 220 || below >= above) {
        m.style.top = (r.bottom + 6) + 'px'; m.style.bottom = 'auto';
        m.style.maxHeight = Math.max(160, below) + 'px';
      } else {
        m.style.bottom = (window.innerHeight - r.top + 6) + 'px'; m.style.top = 'auto';
        m.style.maxHeight = Math.max(160, above) + 'px';
      }
      m.addEventListener('click', function (e) { e.stopPropagation(); });
      m.querySelectorAll('[data-cptg]').forEach(function (cb) { cb.addEventListener('change', function () { var k = cb.closest('.cp-row').dataset.k, i = state.hidden.indexOf(k); if (cb.checked) { if (i >= 0) state.hidden.splice(i, 1); } else if (i < 0) state.hidden.push(k); save(); onChange(); }); });
      // ---- גרירה לשינוי סדר ----
      //  Pointer Events ולא HTML5 drag-and-drop: אותו קוד עובד בעכבר ובמגע,
      //  ו-DnD המובנה פשוט לא קיים במסכי מגע. השורה הנגררת מורמת ויזואלית,
      //  והשורות סביבה מפנות לה מקום לפי נקודת האמצע שלהן.
      var listEl = m.querySelector('.cp-list');
      var drag = null;
      function rowsOf() { return [].slice.call(listEl.querySelectorAll('.cp-row')); }

      listEl.addEventListener('pointerdown', function (e) {
        var handle = e.target.closest('[data-cpdrag]'); if (!handle) return;
        var row = handle.closest('.cp-row'); if (!row) return;
        e.preventDefault(); e.stopPropagation();
        var rect = row.getBoundingClientRect();
        drag = { row: row, startY: e.clientY, offset: e.clientY - rect.top, moved: false };
        row.setPointerCapture && row.setPointerCapture(e.pointerId);
        handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
        row.classList.add('cp-dragging');
        listEl.classList.add('cp-reordering');
      });

      listEl.addEventListener('pointermove', function (e) {
        if (!drag) return;
        e.preventDefault();
        var dy = e.clientY - drag.startY;
        if (Math.abs(dy) > 2) drag.moved = true;
        drag.row.style.transform = 'translateY(' + dy + 'px)';
        // מחליפים מקום כשחוצים את אמצע השורה השכנה
        var rows = rowsOf(), me = rows.indexOf(drag.row), y = e.clientY;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] === drag.row) continue;
          var r = rows[i].getBoundingClientRect(), mid = r.top + r.height / 2;
          if ((i < me && y < mid) || (i > me && y > mid)) {
            listEl.insertBefore(drag.row, i < me ? rows[i] : rows[i].nextSibling);
            drag.startY = e.clientY - (drag.row.getBoundingClientRect().top + drag.offset - e.clientY + drag.offset);
            drag.startY = e.clientY; drag.row.style.transform = '';
            break;
          }
        }
      });

      function endDrag() {
        if (!drag) return;
        drag.row.style.transform = '';
        drag.row.classList.remove('cp-dragging');
        listEl.classList.remove('cp-reordering');
        var moved = drag.moved; drag = null;
        if (!moved) return;
        state.order = rowsOf().map(function (r) { return r.dataset.k; });
        save(); onChange();          // הפאנל נשאר פתוח — אפשר לסדר כמה עמודות ברצף
      }
      listEl.addEventListener('pointerup', endDrag);
      listEl.addEventListener('pointercancel', endDrag);

      // מקלדת: נגישות ותאימות לאחור לשינוי סדר בלי עכבר
      listEl.addEventListener('keydown', function (e) {
        var h = e.target.closest('[data-cpdrag]'); if (!h) return;
        var d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0; if (!d) return;
        e.preventDefault();
        var k = h.closest('.cp-row').dataset.k, i = state.order.indexOf(k), j = i + d;
        if (j < 0 || j >= state.order.length) return;
        var t = state.order[i]; state.order[i] = state.order[j]; state.order[j] = t;
        save(); onChange(); openPanel(anchor);
        var again = document.querySelector('.cp-row[data-k="' + k + '"] [data-cpdrag]');
        if (again) again.focus();
      });
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
        //  בלי רוחב מוצהר, table-layout:fixed מחלק את הרוחב שווה בשווה
        //  — ואז טלפון ושם רכב נחתכים בעוד "סטטוס" מבזבז מקום.
        var wDef = resizable ? (state.widths[c.key] || c.w) : null;
        var extra = c.th || '', stW = wDef ? 'width:' + wDef + 'px' : '';
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
    //  כל שאר שדות הפגישה — מוסתרים כברירת מחדל כדי שהמסך הקיים
    //  לא ישתנה לאף אחד, ומי שצריך מדליק אותם בבורר העמודות.
    { key: 'email', label: 'אימייל', def: false, w: 210,
      cell: function (a) { return '<td class="muted ltr" title="' + esc(a.email || '') + '">' + esc(a.email || '—') + '</td>'; } },
    { key: 'branch', label: 'סניף', def: false, w: 130,
      cell: function (a) { return '<td>' + esc(a.branch || '—') + '</td>'; } },
    { key: 'created', label: 'נקבעה בתאריך', def: false, w: 150,
      sort: function (a) { return a.created_at || ''; },
      cell: function (a) { return '<td class="muted">' + esc(a.created_at ? fmt(a.created_at) : '—') + '</td>'; } },
    { key: 'lead', label: 'קשור לליד', def: false, w: 110,
      sort: function (a) { return a._lid ? 1 : 0; },
      cell: function (a) { return '<td>' + (a._lid ? '<span class="tag">✓ מקושר</span>' : '<span class="muted">—</span>') + '</td>'; } },
    { key: 'appt_id', label: 'מזהה פגישה', def: false, w: 130, sortable: false,
      cell: function (a) { return '<td class="muted ltr" style="font-size:11px;user-select:all">' + esc(String(a.id).slice(0, 8)) + '</td>'; } },
    { key: 'action', label: 'פעולה', cell: function (a) { return '<td><button class="btn btn-sm ' + (a._handled ? 'btn-ghost' : '') + '" data-appt="' + a.id + '" data-to="' + (a._handled ? 'new' : 'handled') + '" onclick="event.stopPropagation()">' + (a._handled ? 'החזר' : 'סמן כבוצעה') + '</button></td>'; } }
  ];
  var apptCols = null;
  var apptFilter = 'all';
  function renderAppointments() {
    loading();
    db.from('appointments').select('*').order('appt_at', { ascending: true }).limit(2000).then(function (ar) {
      if (ar.error) return errBox(ar.error.message);
      // מיפוי טלפון→ליד נדרש רק לפגישות שהגיעו בלי lead_id (טופס ציבורי)
      var phones = [];
      (ar.data || []).forEach(function (a) { if (!a.lead_id && a.phone && phones.indexOf(a.phone) < 0) phones.push(a.phone); });
      var leadsQ = phones.length
        ? db.from('leads').select('id,phone').in('phone', phones.slice(0, 900))
        : Promise.resolve({ data: [] });
      return Promise.all([Promise.resolve(ar), leadsQ]);
    }).then(function (res) {
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
    // שתי מנות: קודם המשימות, ואז רק הלידים שהן באמת מצביעות עליהם.
    // קודם ירדה כל טבלת הלידים לכל פתיחה של המסך.
    db.from('tasks').select('*').order('due_at', { ascending: true }).limit(2000).then(function (tr) {
      if (tr.error) return errBox(tr.error.message);
      var ids = [];
      (tr.data || []).forEach(function (t) { if (t.lead_id && ids.indexOf(t.lead_id) < 0) ids.push(t.lead_id); });
      var leadsQ = ids.length
        ? db.from('leads').select('id,name,phone,car').in('id', ids.slice(0, 900))
        : Promise.resolve({ data: [] });
      return Promise.all([Promise.resolve(tr), leadsQ]);
    }).then(function (res) {
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
  function refDomain(r) { if (!r) return '(ישיר / הקלדה)'; try { var h = new URL(r).hostname.replace(/^www\./, ''); if (/google\./.test(h)) return 'Google (אורגני)'; if (/facebook|fb\.com|instagram/.test(h)) return 'Meta (פייסבוק/אינסטגרם)'; if (/t\.co|twitter|x\.com/.test(h)) return 'X/Twitter'; if (/youtube/.test(h)) return 'YouTube'; if (h.indexOf('crm.freedrive.co.il') >= 0) return '(פנימי)'; return h; } catch (e) { return '(אחר)'; } }
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

  //  ---------- בורר טווח התאריכים של הדוחות ----------
  //  כל טווח מוגדר כפונקציה שמחזירה [מ, עד) במילישניות. גבול עליון פתוח
  //  כדי שרשומה בשנייה האחרונה של היום לא תיפול בין הכיסאות.
  var DAY_MS_R = 86400000;
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function monthStart(y, m) { return new Date(y, m, 1).getTime(); }
  var REP_RANGES = [
    { k: 'today', l: 'היום', g: function () { var t = dayStart(new Date()); return [t, t + DAY_MS_R]; } },
    { k: 'yday', l: 'אתמול', g: function () { var t = dayStart(new Date()); return [t - DAY_MS_R, t]; } },
    { k: 'wk', l: 'השבוע הנוכחי', g: function () { var t = dayStart(new Date()); return [t - new Date(t).getDay() * DAY_MS_R, t + DAY_MS_R]; } },
    { k: 'wk1', l: 'השבוע שעבר', g: function () { var t = dayStart(new Date()), a = t - new Date(t).getDay() * DAY_MS_R; return [a - 7 * DAY_MS_R, a]; } },
    { k: 'd7', l: '7 הימים האחרונים', g: function () { var t = dayStart(new Date()); return [t - 6 * DAY_MS_R, t + DAY_MS_R]; } },
    { k: 'd14', l: '14 הימים האחרונים', g: function () { var t = dayStart(new Date()); return [t - 13 * DAY_MS_R, t + DAY_MS_R]; } },
    { k: 'd30', l: '30 הימים האחרונים', g: function () { var t = dayStart(new Date()); return [t - 29 * DAY_MS_R, t + DAY_MS_R]; } },
    { k: 'd90', l: '90 הימים האחרונים', g: function () { var t = dayStart(new Date()); return [t - 89 * DAY_MS_R, t + DAY_MS_R]; } },
    { k: 'mo', l: 'החודש הנוכחי', g: function () { var n = new Date(); return [monthStart(n.getFullYear(), n.getMonth()), dayStart(n) + DAY_MS_R]; } },
    { k: 'mo1', l: 'החודש שעבר', g: function () { var n = new Date(); return [monthStart(n.getFullYear(), n.getMonth() - 1), monthStart(n.getFullYear(), n.getMonth())]; } },
    { k: 'q', l: 'הרבעון הנוכחי', g: function () { var n = new Date(), q = Math.floor(n.getMonth() / 3) * 3; return [monthStart(n.getFullYear(), q), dayStart(n) + DAY_MS_R]; } },
    { k: 'q1', l: 'הרבעון שעבר', g: function () { var n = new Date(), q = Math.floor(n.getMonth() / 3) * 3; return [monthStart(n.getFullYear(), q - 3), monthStart(n.getFullYear(), q)]; } },
    { k: 'yr', l: 'השנה', g: function () { var n = new Date(); return [monthStart(n.getFullYear(), 0), dayStart(n) + DAY_MS_R]; } },
    { k: 'yr1', l: 'השנה שעברה', g: function () { var n = new Date(); return [monthStart(n.getFullYear() - 1, 0), monthStart(n.getFullYear(), 0)]; } },
    { k: 'all', l: 'כל הזמנים', g: function () { return [0, Date.now() + DAY_MS_R]; } }
  ];
  //  הטווח נשמר בדפדפן: מנהל שבודק "החודש שעבר" לא רוצה שהמסך יחזור
  //  ל"כל הזמנים" בכל רענון.
  var repRange = (function () {
    try { return JSON.parse(localStorage.getItem('c2b_rep_range') || 'null') || { k: 'all' }; }
    catch (e) { return { k: 'all' }; }
  })();
  function repRangeDef() { return REP_RANGES.filter(function (r) { return r.k === repRange.k; })[0]; }
  function repBounds() {
    if (repRange.k === 'custom') {
      var a = repRange.from ? dayStart(new Date(repRange.from + 'T00:00:00')) : 0;
      var b = repRange.to ? dayStart(new Date(repRange.to + 'T00:00:00')) + DAY_MS_R : Date.now() + DAY_MS_R;
      return [a, b];
    }
    var d = repRangeDef(); return d ? d.g() : [0, Date.now() + DAY_MS_R];
  }
  function repRangeLabel() {
    if (repRange.k === 'custom') {
      var he = function (v) { var d = new Date(v + 'T00:00:00'); return isNaN(d) ? v : d.toLocaleDateString('he-IL'); };
      return (repRange.from ? he(repRange.from) : '…') + ' — ' + (repRange.to ? he(repRange.to) : 'היום');
    }
    var d = repRangeDef(); return d ? d.l : 'כל הזמנים';
  }
  function inRepRange(ts) {
    if (repRange.k === 'all') return true;
    var t = new Date(ts || 0).getTime();
    if (!t) return false;
    var b = repBounds(); return t >= b[0] && t < b[1];
  }
  //  לוח השיווק שולף מ-Meta לפי date_preset. ממפים את הטווח לערך הקרוב
  //  ביותר שיש ל-Meta; טווח שאין לו מקבילה נופל ל-maximum, וזה מצוין במסך.
  function repMetaPreset() {
    return ({ today: 'today', yday: 'yesterday', d7: 'last_7d', d14: 'last_14d', d30: 'last_30d',
              d90: 'last_90d', mo: 'this_month', mo1: 'last_month' })[repRange.k] || 'maximum';
  }
  function repRangeBar() {
    return '<div class="rr-wrap">' +
      '<button class="btn btn-ghost btn-sm" id="rrBtn" aria-haspopup="true">📅 טווח תאריכים · <b>' + esc(repRangeLabel()) + '</b> ▾</button>' +
      '</div>';
  }
  function openRepRange(anchor) {
    var old = document.getElementById('rrMenu'); if (old) { old.remove(); return; }
    var m = document.createElement('div');
    m.id = 'rrMenu'; m.className = 'rr-menu';
    m.innerHTML = '<div class="rr-head">בחירת טווח</div>' +
      '<div class="rr-grid">' + REP_RANGES.map(function (r) {
        return '<button data-rr="' + r.k + '"' + (repRange.k === r.k ? ' class="on"' : '') + '>' + esc(r.l) + '</button>';
      }).join('') + '</div>' +
      '<div class="rr-head" style="margin-top:4px">טווח מותאם</div>' +
      '<div class="rr-custom">' +
        '<input type="date" id="rrFrom" value="' + esc(repRange.from || '') + '">' +
        '<span class="muted">עד</span>' +
        '<input type="date" id="rrTo" value="' + esc(repRange.to || '') + '">' +
        '<button class="btn btn-sm" id="rrApply">החל</button>' +
      '</div>';
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = (r.bottom + window.scrollY + 6) + 'px';
    // ממקמים לפי הקצה הימני בגלל RTL, ומונעים חריגה מהמסך
    var right = Math.max(8, window.innerWidth - r.right);
    m.style.right = right + 'px';
    function pick(v) { repRange = v; try { localStorage.setItem('c2b_rep_range', JSON.stringify(v)); } catch (e) {} m.remove(); renderReports(); }
    m.querySelectorAll('[data-rr]').forEach(function (b) {
      b.addEventListener('click', function () { pick({ k: b.dataset.rr }); });
    });
    m.querySelector('#rrApply').addEventListener('click', function () {
      var f = m.querySelector('#rrFrom').value, t = m.querySelector('#rrTo').value;
      if (!f && !t) return;
      if (f && t && f > t) { var x = f; f = t; t = x; }   // הוזן הפוך — מסדרים
      pick({ k: 'custom', from: f, to: t });
    });
    m.addEventListener('click', function (e) { e.stopPropagation(); });
    setTimeout(function () {
      document.addEventListener('click', function h() { var el = document.getElementById('rrMenu'); if (el) el.remove(); document.removeEventListener('click', h); }, { once: true });
    }, 0);
  }

  function renderReports() {
    loading();
    Promise.all([
      db.from('leads').select('id,name,phone,car,status,source,created_at,first_response_at,assigned_to,brand,utm_campaign,utm_source,utm_medium,utm_term,utm_content,campaign,medium,adset_name,ad_name,ad_group,ad_id,marketing_company,city').is('deleted_at', null),
      db.from('appointments').select('status'),
      db.from('events').select('type,session_id,created_at'),
      db.from('tasks').select('done'),
      db.from('profiles').select('user_id,full_name'),
      db.from('deals').select('id,lead_id,brand,stage,status,car_make,car_model,total,car_price,commission,discount_amt,salesperson,created_at,signed_at,financing,tradein,has_signature').is('deleted_at', null),
      db.from('payments').select('amount,kind,deal_id'),
      db.from('agent_targets').select('user_id,deals,revenue,profit')
    ]).then(function (res) {
      //  הכל מסונן לפי הטווח שנבחר. לידים ואירועים לפי מועד היצירה,
      //  עסקאות לפי מועד החתימה — עסקה שנפתחה בחודש שעבר ונחתמה החודש
      //  שייכת לחודש הזה.
      var leads = (res[0].data || []).filter(function (l) { return inRepRange(l.created_at); });
      var appts = res[1].data || [];
      var events = (res[2].data || []).filter(function (e) { return inRepRange(e.created_at); });
      var tasks = res[3].data || [];
      var prof = {}; (res[4].data || []).forEach(function (p) { prof[p.user_id] = p.full_name; });
      var allDeals = res[5].data || [], pays = (res[6] && res[6].data) || [];
      //  יעדים לנציג. טבלה חסרה או ללא הרשאה מחזירה שגיאה — ואז פשוט
      //  אין יעדים, ולא נופלים על כל הדוח.
      var tgt = {}; ((res[7] && res[7].data) || []).forEach(function (t) { tgt[t.user_id] = t; });
      var ST = window.C2B_STATUSES || [], bdg = window.C2B_badge || function (k) { return k; };
      //  מפת הייחוס נבנית מכל הלידים ולא מהמסוננים: כשהטווח הוא "היום",
      //  עסקה שנחתמה היום מליד של שבוע שעבר עדיין צריכה לדעת מאיזה
      //  קמפיין הגיעה. הסינון חל על ספירת הלידים, לא על מקור העסקה.
      var leadById = {}; (res[0].data || []).forEach(function (l) { leadById[l.id] = l; });

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
      //  ביטול יכול להירשם בסטטוס או בשלב — עסקה שבוטלה בכרטיס העסקה
      //  מקבלת stage='cancelled' בעוד הסטטוס נשאר 'quote'. בדיקה על
      //  סטטוס בלבד ספרה אותה כעסקה והציגה הכנסה שלא קיימת.
      var deals = allDeals.filter(function (d) {
        return !!d.has_signature && d.status !== 'cancelled' && d.stage !== 'cancelled'
               && inRepRange(d.signed_at || d.created_at);
      });
      var cancelled = allDeals.filter(function (d) { return d.status === 'cancelled' || d.stage === 'cancelled'; }).length;
      function isDone(d) { return d.status === 'ordered' || !!d.has_signature; }
      var doneDeals = deals.filter(isDone);
      //  הכנסה = מחיר הרכב. total כולל תוספות, מקדמה והנחות, ולכן הוא
      //  מספר שלא מייצג את מה שנכנס על הרכב עצמו.
      var revenue = deals.reduce(function (a, d) { return a + (+d.car_price || 0); }, 0);
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
        var rev = +d.car_price || 0, pf = +d.commission || 0, dn = isDone(d) ? 1 : 0;
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
        //  שם הקמפיין לפני המזהה: utm_campaign מכיל את מזהה הקמפיין
        //  בפייסבוק (120251728118780071), ואי אפשר לזהות לפיו כלום.
        //  חברת השיווק היא נפילה אחרונה — היא לא קמפיין, אבל עדיף
        //  לשייך ליד ידני אליה מאשר לאבד אותו מהטבלה.
        var camp = l.campaign || l.utm_campaign || l.marketing_company;
        if (camp) bump(byCampaign, camp, function (o) { o.leads++; if (l.status === 'won') o.done++; });
      });
      // attribute deal revenue back to source / campaign
      deals.forEach(function (d) { var l = leadById[d.lead_id] || {}; var s = l.source || 'לא ידוע'; bump(bySource, s, function (o) { o.revenue += (+d.car_price || 0); o.count++; }); var camp = l.campaign || l.utm_campaign || l.marketing_company; if (camp) bump(byCampaign, camp, function (o) { o.revenue += (+d.car_price || 0); o.count++; }); });

      // monthly series (chronological, last 12 with data)
      var months = Object.keys(byMonth).map(Number).sort(function (a, b) { return a - b; }).slice(-12).map(function (k) { var o = byMonth[k]; o.label = HEB_MONTHS[k % 12] + ' ' + Math.floor(k / 12); return o; });

      // ---------- MANAGER (executive) ----------
      var mgrProfitMonths = barRows(months.map(function (m) { return { label: m.label, v: m.profit }; }), M);
      var mgrTopAgents = rankRows(repTop(byAgent, 'profit', 5), M, function (i) { return i.o.done + ' עסקאות'; });
      var mgrTopBrands = rankRows(repTop(byBrand, 'profit', 5), M, function (i) { return i.o.count + ' עסקאות'; });
      //  ---------- לוח המנהל ----------
      //  השאלה שמנהל שואל היא "כמה נכנס, כמה יצא, ועל מה" \u2014 ולכן ההוצאה
      //  האמיתית מ-Meta יושבת כאן לצד ההכנסה, ולא כמציין מקום. העמלות ירדו
      //  לשורה משנית: הן נגזרת של העסקאות ולא תמונת המצב.
      var agentRowsMgr = repTop(byAgent, 'revenue', 12).map(function (i) {
        var o = i.o, cr = o.leads ? o.done / o.leads * 100 : 0;
        return '<tr><td><b>' + esc(i.label) + '</b></td><td>' + (o.leads || 0) + '</td><td>' + (o.done || 0) +
          '</td><td>' + M(o.revenue) + '</td><td>' + (o.leads ? P1(cr) : '<span class="muted">\u2014</span>') +
          '</td><td class="muted">' + M(o.profit) + '</td></tr>';
      }).join('');
      var brandRowsMgr = repTop(byBrand, 'revenue', 12).map(function (i) {
        var o = i.o, av = o.count ? o.revenue / o.count : 0;
        return '<tr><td><b>' + esc(i.label) + '</b></td><td>' + o.count + '</td><td>' + (o.done || 0) +
          '</td><td>' + M(o.revenue) + '</td><td>' + M(av) + '</td></tr>';
      }).join('');
      var managerPanel =
        '<div class="cards">' +
          kpi('הכנסות', M(revenue), deals.length + ' עסקאות חתומות \u00b7 לפי מחיר הרכב', true) +
          kpi('הוצאות פרסום', '<span id="mgSpend">\u2026</span>', 'Meta \u00b7 הטווח הנבחר') +
          kpi('הפרש (הכנסות פחות פרסום)', '<span id="mgNet">\u2026</span>', 'לא רווח נקי \u2014 אין כאן עלות רכב') +
          kpi('ROAS מהפרסום', '<span id="mgRoas">\u2026</span>', 'רק הכנסה שמיוחסת למודעות') +
        '</div>' +
        '<div class="cards">' +
          kpi('הכנסות מפרסום', '<span id="mgPaidRev">\u2026</span>', 'עסקאות שנולדו מקמפיין') +
          kpi('עלות לליד', '<span id="mgCpl">\u2026</span>', leads.length + ' לידים בטווח') +
          kpi('עלות לעסקה מפרסום', '<span id="mgCac">\u2026</span>', 'הוצאה חלקי עסקאות מקמפיין') +
          kpi('אחוז סגירה', P1(closeRate), doneDeals.length + ' מתוך ' + leads.length + ' לידים') +
          kpi('נגבה בפועל', M(collected), 'מתוך ' + M(revenue) + ' שווי עסקאות') +
          kpi('עמלות סוכן', M(profit), 'סכום שדה "עמלת סוכן"') +
        '</div>' +
        '<div class="sec-note" id="mgNote">\ud83d\udce1 טוען את נתוני ההוצאה מ-Meta\u2026</div>' +
        secCard('\ud83d\udcb8 על מה יצא הכסף \u2014 הוצאה לפי קמפיין',
                '<div id="mgCamps" class="muted" style="font-size:13px">טוען\u2026</div>') +
        '<div class="rep-grid">' +
          secCard('\ud83d\udcc8 הכנסות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.revenue }; }), M)) +
          secCard('\ud83e\udd1d עסקאות חתומות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.done }; }), function (v) { return v; })) +
        '</div>' +
        secCard('\ud83e\uddd1\u200d\ud83d\udcbc ביצועי נציגים',
                repTable(['נציג', 'לידים', 'עסקאות חתומות', 'הכנסות', 'אחוז סגירה', 'עמלות'], agentRowsMgr)) +
        secCard('\ud83d\ude97 ביצועי מותגים',
                repTable(['מותג', 'עסקאות', 'מתוכן הושלמו', 'הכנסות', 'ערך ממוצע לעסקה'], brandRowsMgr));

      // ---------- SALES — sub-tabs ----------
      // overview
      var salesOverview =
        '<div class="cards">' +
          kpi('סה״כ הכנסות', M(revenue), 'לפי מחיר הרכב בעסקאות החתומות', true) +
          kpi('סה״כ עסקאות', deals.length) +
          kpi('עסקאות שהושלמו', doneDeals.length) +
          kpi('אחוז סגירה', P1(closeRate), doneDeals.length + ' / ' + leads.length + ' לידים') +
          kpi('עמלה ממוצעת לעסקה', M(avgProfit)) +
          kpi('זמן ממוצע לסגירה', (Math.round(avgTtc * 10) / 10) + ' ימים') +
        '</div>' +
        '<div class="rep-grid">' +
          secCard('💵 הכנסות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.revenue }; }), M)) +
          secCard('📊 עסקאות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.count }; }), function (v) { return v; })) +
          secCard('🔀 עסקאות לפי שלב', barRows(Object.keys(byStage).map(function (k) { var sd = (window.C2B_stageDef && window.C2B_stageDef(k)) || { label: k }; return { label: sd.label || k, v: byStage[k] }; }).sort(function (a, b) { return b.v - a.v; }), function (v) { return v; })) +
          secCard('🏢 הכנסות לפי חברה/מותג', barRows(repTop(byCompany, 'revenue', 10), M)) +
        '</div>';
      // trends
      var salesTrends =
        '<div class="cards">' + kpi('סה״כ הכנסות', M(revenue), null, true) + kpi('סה״כ עמלות סוכן', M(profit)) + kpi('עסקאות שהושלמו', doneDeals.length) + kpi('זמן ממוצע לסגירה', (Math.round(avgTtc * 10) / 10) + ' ימים') + '</div>' +
        '<div class="rep-grid">' +
          secCard('📈 הכנסות לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.revenue }; }), M)) +
          secCard('💎 עמלות סוכן לפי חודש', barRows(months.map(function (m) { return { label: m.label, v: m.profit }; }), M)) +
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
      //  היעד נשמר לפי משתמש, ולכן הטבלה נבנית מרשימת אנשי הצוות ולא
      //  מאלה שכבר יש להם ביצועים — אחרת אי אפשר לקבוע יעד לנציג חדש.
      // ב-admin.js אין משתנה C — העוזרים יושבים על window.C2B
      var myRole = (window.C2B && window.C2B.role) || '';
      var canEditTargets = myRole === 'admin' || myRole === 'branch';
      var pct = function (act, goal) {
        if (!goal) return '<span class="muted">—</span>';
        var p = Math.round(act / goal * 100);
        var col = p >= 100 ? 'var(--ok)' : p >= 70 ? 'var(--warn)' : 'var(--danger)';
        return '<b style="color:' + col + '">' + p + '%</b>';
      };
      var tin = function (uid, f, v) {
        return canEditTargets
          ? '<input class="inp tgt-in" data-tu="' + esc(uid) + '" data-tf="' + f + '" type="number" min="0" ' +
            'value="' + (v == null ? '' : esc(String(v))) + '" placeholder="—" style="width:104px;padding:5px 8px;font-size:13px">'
          : '<span class="muted">' + (v == null ? '—' : Number(v).toLocaleString('en-US')) + '</span>';
      };
      var tgtRows = Object.keys(prof).map(function (uid) {
        var o = byAgent[prof[uid]] || { done: 0, revenue: 0, profit: 0 };
        var t = tgt[uid] || {};
        return '<tr><td><b>' + esc(prof[uid]) + '</b></td>' +
          '<td>' + (o.done || 0) + '</td><td>' + tin(uid, 'deals', t.deals) + '</td><td>' + pct(o.done || 0, t.deals) + '</td>' +
          '<td>' + M(o.revenue || 0) + '</td><td>' + tin(uid, 'revenue', t.revenue) + '</td><td>' + pct(o.revenue || 0, t.revenue) + '</td>' +
          '<td>' + M(o.profit || 0) + '</td><td>' + tin(uid, 'profit', t.profit) + '</td><td>' + pct(o.profit || 0, t.profit) + '</td></tr>';
      }).join('');
      var sumT = Object.keys(tgt).reduce(function (a, k) {
        return { deals: a.deals + (+tgt[k].deals || 0), revenue: a.revenue + (+tgt[k].revenue || 0), profit: a.profit + (+tgt[k].profit || 0) };
      }, { deals: 0, revenue: 0, profit: 0 });
      var salesTargets =
        '<div class="cards">' +
          kpi('עסקאות בפועל', doneDeals.length, sumT.deals ? 'יעד ' + sumT.deals : null) +
          kpi('הכנסות בפועל', M(revenue), sumT.revenue ? 'יעד ' + M(sumT.revenue) : null, true) +
          kpi('עמלות סוכן בפועל', M(profit), sumT.profit ? 'יעד ' + M(sumT.profit) : null) +
        '</div>' +
        '<div class="sec-note">🎯 ' + (canEditTargets
          ? 'הקלידו יעד בשדות ולחצו <b>שמור יעדים</b>. שדה ריק = ללא יעד.'
          : 'היעדים נקבעים ע״י מנהל מערכת או מנהל סניף.') +
          ' <b>הכנסות</b> = סכום מחיר הרכב בעסקאות החתומות · <b>עמלת סוכן</b> = סכום שדה העמלה שהוזן בעסקה.</div>' +
        secCard('📊 ביצועים מול יעד לפי נציג',
          '<div class="table-scroll"><table><thead><tr>' +
            ['שם נציג', 'עסקאות', 'יעד עסקאות', '% עמידה', 'הכנסות', 'יעד הכנסות', '% עמידה', 'עמלת סוכן', 'יעד עמלות', '% עמידה']
              .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
          '</tr></thead><tbody>' + (tgtRows || '<tr><td colspan="10" class="muted">אין אנשי צוות</td></tr>') + '</tbody></table></div>' +
          (canEditTargets ? '<div style="margin-top:12px;display:flex;gap:10px;align-items:center">' +
            '<button class="btn btn-sm" id="tgtSave">שמור יעדים</button>' +
            '<span id="tgtMsg" class="muted" style="font-size:12.5px"></span></div>' : ''));

      // ---------- מקורות הגעה ----------
      //  מסע ההגעה נקרא מלמעלה למטה: ערוץ ← מקור ← קמפיין ← קבוצת מודעות ← מודעה.
      //  רובד ה"ערוץ" הוא התוספת המהותית: בלעדיו כל ליד שאינו מפרסום נפל
      //  ל"ללא ייחוס" בטבלת הקמפיינים, וזה ערבב שני דברים הפוכים — ליד
      //  ששותף עסקי הביא (מקור ידוע לחלוטין) וליד שהמקור שלו באמת אבד.
      //  שותף אינו קמפיין, ולכן הוא לא אמור להופיע בטבלת הקמפיינים בכלל.
      var UNATTR = 'ללא ייחוס';
      //  אינדקס שטוח של הרשומות מאחורי כל תא לחיץ. נשמר על window כדי
      //  שהמאזין ימצא אותו גם אחרי שהלוח נצבע מחדש.
      var repKeys = []; window.C2B_repKeys = repKeys;
      //  utm_term מגיע מפייסבוק כקוד מיקום ולא כשם קריא
      var PLACEMENTS = { fb: 'פייסבוק', ig: 'אינסטגרם', an: 'Audience Network', msg: 'מסנג\u05f3ר', fb_ig: 'פייסבוק + אינסטגרם' };
      //  הערכים האלה מתארים איך הליד נכנס למערכת ולא מאיפה הוא הגיע, ולכן
      //  אינם נחשבים מקור. כל ערך אחר ברשימת "מקור הגעה" שבהגדרות נחשב
      //  מקור אמיתי — כך שהוספת שותף חדש שם נכנסת לדוח מעצמה.
      var NO_ORIGIN = { 'ידני': 1, 'ייבוא / קובץ': 1, 'ייבוא': 1, 'לא ידוע': 1, 'אחר': 1 };
      var CH_PAID = 'פרסום ממומן', CH_PARTNER = 'שותפים והפניות', CH_NONE = 'ללא מקור מתועד';
      function namedSource(l) { var v = String((l && l.source) || '').trim(); return v && !NO_ORIGIN[v] ? v : ''; }
      function isPaid(l) { return !!(l && (l.utm_source || l.campaign || l.utm_campaign)); }
      function isPartner(l) { return !isPaid(l) && !!namedSource(l); }
      function channelOf(l) { return isPaid(l) ? CH_PAID : (namedSource(l) ? CH_PARTNER : CH_NONE); }

      //  only — מסננת אופציונלית, כדי שטבלאות הפרסום יכילו רק לידים מפרסום
      function attrBy(get, only) {
        var m = {};
        //  שומרים גם את הרשומות עצמן ולא רק ספירה: כל מספר בדוח לחיץ
        //  ופותח את הלידים או העסקאות שמאחוריו.
        function cell(l) { var k = String(get(l) || '').trim() || UNATTR; m[k] = m[k] || { leads: 0, count: 0, revenue: 0, L: [], D: [] }; return m[k]; }
        leads.forEach(function (l) { if (only && !only(l)) return; var o = cell(l); o.leads++; o.L.push(l); });
        deals.forEach(function (d) {
          var l = leadById[d.lead_id]; if (!l || (only && !only(l))) return;
          var o = cell(l); o.count++; o.revenue += (+d.car_price || 0); o.D.push({ d: d, l: l });
        });
        return m;
      }
      var byChannel = attrBy(channelOf);
      var bySrcName = attrBy(function (l) { return l.source; });
      var byPartner = attrBy(function (l) { return l.source; }, isPartner);
      var byPlatform = attrBy(function (l) { return l.utm_source; }, isPaid);
      //  סוג התנועה מלא לכל הלידים ולא רק לפרסום: ליד שאינו ממומן מקבל
      //  'seo' אוטומטית בטריגר (organic-medium.sql), ולכן הגרף מראה את
      //  התמהיל האמיתי — cpc מול seo — ולא רק את הצד הממומן.
      var byMedium = attrBy(function (l) { return l.utm_medium || l.medium; });
      var byPlacement = attrBy(function (l) { var t = String(l.utm_term || '').toLowerCase(); return PLACEMENTS[t] || l.utm_term; }, isPaid);
      var byMktCo = attrBy(function (l) { return l.marketing_company; });
      var byCampName = attrBy(function (l) { return l.campaign || l.utm_campaign; }, isPaid);
      var byAdset = attrBy(function (l) { return l.adset_name || l.ad_group; }, isPaid);
      var byAdName = attrBy(function (l) { return l.ad_name; }, isPaid);

      var chSum = function (ch, k) { return (byChannel[ch] || {})[k] || 0; };
      var tracked = chSum(CH_PAID, 'leads'), partnerLeads = chSum(CH_PARTNER, 'leads'), noneLeads = chSum(CH_NONE, 'leads');
      var paidDeals = deals.filter(function (d) { return isPaid(leadById[d.lead_id]); });
      var paidRev = chSum(CH_PAID, 'revenue'), partnerRev = chSum(CH_PARTNER, 'revenue');

      //  אותה טבלה משרתת שתי שאלות: השיווק שואל כמה לידים המקור הביא,
      //  והמכירות שואלות כמה כסף הוא סגר. לכן המיון וסדר העמודות משתנים
      //  לפי המצב, והנתונים עצמם זהים.
      function attrTable(map, head, byDeals) {
        var rows = Object.keys(map).map(function (k) { return { label: k, o: map[k] }; })
          .sort(byDeals
            ? function (a, b) { return (b.o.revenue - a.o.revenue) || (b.o.count - a.o.count) || (b.o.leads - a.o.leads); }
            : function (a, b) { return (b.o.leads - a.o.leads) || (b.o.revenue - a.o.revenue); })
          .map(function (i) {
            var o = i.o, cr = o.leads ? P1(o.count / o.leads * 100) : '<span class="muted">\u2014</span>';
            var key = repKeys.push({ label: i.label, o: o }) - 1;
            var nL = o.leads ? '<a class="drill-n" data-rk="' + key + '" data-what="leads">' + o.leads + '</a>' : '<span class="muted">0</span>';
            var nD = o.count ? '<a class="drill-n" data-rk="' + key + '" data-what="deals">' + o.count + '</a>' : '<span class="muted">0</span>';
            var cells = byDeals
              ? ['<td>' + nD + '</td>', '<td>' + M(o.revenue) + '</td>', '<td>' + nL + '</td>', '<td>' + cr + '</td>']
              : ['<td>' + nL + '</td>', '<td>' + nD + '</td>', '<td>' + M(o.revenue) + '</td>', '<td>' + cr + '</td>'];
            return '<tr><td><b>' + esc(i.label) + '</b></td>' + cells.join('') + '</tr>';
          }).join('');
        return repTable(byDeals
          ? [head, 'עסקאות חתומות', 'הכנסות', 'לידים', 'אחוז המרה']
          : [head, 'לידים', 'עסקאות חתומות', 'הכנסות', 'אחוז המרה'], rows);
      }
      var journeyRows = deals.map(function (d) {
        var l = leadById[d.lead_id] || {};
        var pl = String(l.utm_term || '').toLowerCase();
        return { t: new Date(d.signed_at || d.created_at || 0).getTime(),
          h: '<tr><td><b>' + esc(l.name || '\u2014') + '</b></td><td>' + esc(channelOf(l)) + '</td><td>' +
             esc(l.source || UNATTR) + '</td><td>' + esc(l.campaign || l.utm_campaign || '\u2014') + '</td><td>' +
             esc(l.adset_name || '\u2014') + '</td><td>' + esc(l.ad_name || '\u2014') + '</td><td>' +
             esc(PLACEMENTS[pl] || l.utm_term || '\u2014') + '</td><td>' + M(+d.car_price || 0) + '</td></tr>' };
      }).sort(function (a, b) { return b.t - a.t; }).map(function (x) { return x.h; }).join('');

      //  mode='deals' — הלוח שבמכירות: מה כל מקור סגר בפועל.
      //  mode='leads' — הלוח שבשיווק: כמה פניות כל מקור הביא.
      function sourcesPanel(mode) {
        var byDeals = mode === 'deals';
        var avgDeal = deals.length ? revenue / deals.length : 0;
        var pctOf = function (n, tot) { return tot ? P1(n / tot * 100) : null; };
        var kpis = byDeals
          ? kpi('סה\u05f4כ הכנסות', M(revenue), 'לפי מחיר הרכב בעסקאות החתומות', true) +
            kpi('עסקאות חתומות', deals.length, 'לא כולל מבוטלות') +
            kpi('הכנסות מפרסום ממומן', M(paidRev), pctOf(paidRev, revenue) ? pctOf(paidRev, revenue) + ' מההכנסות · ' + paidDeals.length + ' עסקאות' : null) +
            kpi('הכנסות משותפים והפניות', M(partnerRev), pctOf(partnerRev, revenue) ? pctOf(partnerRev, revenue) + ' מההכנסות · ' + chSum(CH_PARTNER, 'count') + ' עסקאות' : null) +
            kpi('הכנסה ממוצעת לעסקה', M(avgDeal))
          : kpi('סה\u05f4כ לידים', leads.length.toLocaleString('en-US'), null, true) +
            kpi('מפרסום ממומן', tracked, pctOf(tracked, leads.length)) +
            kpi('משותפים והפניות', partnerLeads, pctOf(partnerLeads, leads.length)) +
            kpi('ללא מקור מתועד', noneLeads, 'הוקלדו ידנית בלי לציין מקור') +
            kpi('הכנסות מיוחסות לפרסום', M(paidRev), 'לפי מחיר הרכב');
        //  הגרפים מודדים את מה שהלשונית שואלת עליו: כסף במכירות, פניות בשיווק
        var bar = function (title, map) {
          return byDeals
            ? secCard(title, barRows(repTop(map, 'revenue', 12), M))
            : secCard(title, barRows(repTop(map, 'leads', 12), function (v) { return v; }));
        };
        var grid = byDeals
          ? bar('\ud83e\udded הכנסות לפי ערוץ', byChannel) +
            bar('\ud83d\udcb0 הכנסות לפי מקור הליד', bySrcName) +
            secCard('\ud83e\udd1d עסקאות לפי מקור הליד', barRows(repTop(bySrcName, 'count', 12), function (v) { return v; })) +
            bar('\ud83c\udf10 הכנסות לפי פלטפורמה', byPlatform) +
            bar('\ud83d\udce3 הכנסות לפי קמפיין', byCampName) +
            bar('\ud83d\uddbc\ufe0f הכנסות לפי מודעה', byAdName)
          : bar('\ud83e\udded ערוצי הגעה', byChannel) +
            bar('\ud83d\udce5 מקור הליד', bySrcName) +
            bar('\ud83c\udf10 פלטפורמה (utm_source)', byPlatform) +
            bar('\ud83d\udccd מיקום הצגה (utm_term)', byPlacement) +
            bar('\ud83e\udded סוג תנועה (utm_medium)', byMedium) +
            secCard('\ud83d\udcb0 הכנסות לפי מקור', barRows(repTop(bySrcName, 'revenue', 12), M));
        var note = byDeals
          ? 'כל עסקה חתומה נספרת למקור של הליד שממנו נולדה, גם אם הליד נפתח לפני הטווח שנבחר. ההכנסה נמדדת לפי <b>מחיר הרכב</b>, ועסקה מבוטלת אינה נספרת.'
          : 'הייחוס נשמר על הליד ברגע הקליטה מפייסבוק (מקור, קמפיין, קבוצת מודעות ומודעה). ההכנסה מיוחסת לפי <b>מחיר הרכב</b> בעסקה החתומה.';
        return '<div class="cards">' + kpis + '</div>' +
          '<div class="rep-grid">' + grid + '</div>' +
          secCard('\ud83e\udded ערוצי הגעה', attrTable(byChannel, 'ערוץ', byDeals)) +
          secCard('\ud83e\udd1d שותפים ומקורות שאינם פרסום', attrTable(byPartner, 'מקור', byDeals)) +
          secCard('\ud83d\udce3 קמפיינים <span class="muted" style="font-size:12px;font-weight:400">\u00b7 פרסום ממומן בלבד</span>', attrTable(byCampName, 'קמפיין', byDeals)) +
          secCard('\ud83c\udf9b\ufe0f קבוצות מודעות', attrTable(byAdset, 'קבוצת מודעות', byDeals)) +
          secCard('\ud83d\uddbc\ufe0f מודעות', attrTable(byAdName, 'מודעה', byDeals)) +
          secCard('\ud83e\uddfe מסלול ההגעה של העסקאות החתומות',
            repTable(['לקוח', 'ערוץ', 'מקור', 'קמפיין', 'קבוצת מודעות', 'מודעה', 'מיקום', 'הכנסה'], journeyRows)) +
          '<div class="sec-note">\u2139\ufe0f ' + note + ' טבלאות הפרסום מכילות <b>רק</b> לידים שהגיעו מקמפיין; שותפים והפניות מרוכזים בטבלה נפרדת, ולידים שהוקלדו בלי מקור נספרים כ\u05f4' + CH_NONE + '\u05f4. רשימת המקורות נערכת ב<b>הגדרות ורשימות \u2190 מקור הגעה</b>, וכל מקור חדש שתוסיפו שם נכנס לדוח מעצמו.</div>';
      }
      var dealSources = sourcesPanel('deals'), leadSources = sourcesPanel('leads');

      //  ROAS מול ההכנסה הכוללת הוא מספר משקר: ההכנסה של פרי דרייב הגיעה
      //  עד כה משותף עסקי ולא מהמודעות, וחלוקה שלה בהוצאת הפרסום החזירה
      //  198x. לכן דוח המנהל משווה הוצאה מול ההכנסה **המיוחסת לפרסום**
      //  בלבד, ואת ההכנסה הכוללת מציג בנפרד.
      //  חיבור בין שני העולמות נעשה לפי **מזהים** ולא לפי שמות: שם קמפיין
      //  משתנה בלחיצה אחת ב-Meta ואז כל ההיסטוריה מתנתקת, בעוד המזהה קבוע.
      //  הליד נושא את utm_campaign (מזהה קמפיין), ad_group (סדרה) ו-ad_id.
      function crmIndex(field) {
        var m = {};
        function cell(k) { if (!k) return null; m[k] = m[k] || { leads: [], deals: [] }; return m[k]; }
        leads.forEach(function (l) { var c = cell(String(l[field] || '')); if (c) c.leads.push(l); });
        deals.forEach(function (d) {
          var l = leadById[d.lead_id]; if (!l) return;
          var c = cell(String(l[field] || '')); if (!c) return;
          c.deals.push({ d: d, l: l });
        });
        return m;
      }
      repCtx = { revenue: revenue, paidRevenue: paidRev, leads: leads.length,
                 crm: { campaign: crmIndex('utm_campaign'), adset: crmIndex('ad_group'), ad: crmIndex('ad_id') },
                 deals: deals.length, paidDeals: paidDeals.length,
                 rangeLabel: repRangeLabel(),
                 metaMatches: repMetaPreset() !== 'maximum' || repRange.k === 'all' };

      var salesPanels = { overview: salesOverview, trends: salesTrends, sources: dealSources, agents: salesAgents, cars: salesCars, quality: salesQuality, targets: salesTargets };
      var salesSubs = [['overview', 'סקירה כללית'], ['trends', 'מגמות מכירות'], ['sources', 'מקורות הגעה'], ['agents', 'חברה ונציגים'], ['cars', 'ניתוח רכבים'], ['quality', 'איכות עסקאות'], ['targets', 'יעדים']];
      function salesNav() { return '<nav class="tabs" id="repSalesTabs" style="margin-bottom:14px;flex-wrap:wrap">' + salesSubs.map(function (s) { return '<button data-ssub="' + s[0] + '"' + (salesSub === s[0] ? ' class="active"' : '') + '>' + s[1] + '</button>'; }).join('') + '</nav>'; }
      var salesPanel = salesNav() + '<div id="repSalesPanel">' + salesPanels[salesSub] + '</div>';

      // ---------- MARKETING ----------
      var netByBrand = repTop(byBrand, 'revenue', 5);
      var campRows = repTop(byCampaign, 'revenue', 60).map(function (i) { var o = i.o; var cr = o.leads ? Math.round(o.done / o.leads * 100) : 0; return '<tr><td><b>' + esc(i.label) + '</b></td><td>' + o.leads + '</td><td>' + (o.count || 0) + '</td><td>' + o.done + '</td><td>' + M(o.revenue) + '</td><td>' + cr + '%</td><td class="muted">—</td><td class="muted">—</td></tr>'; }).join('');
      //  ROAS משווה הכנסה מול הוצאה, ולכן שתיהן חייבות להימדד באותו חלון.
      //  קודם הועברה כל ההכנסה ההיסטורית מול הוצאה של 30 יום, וזה החזיר
      //  יחס חסר משמעות (537x).
      revenueAt = function (preset) {
        var DAY = 86400000, now = Date.now(), from = 0;
        if (preset === 'today') { var d0 = new Date(); d0.setHours(0, 0, 0, 0); from = d0.getTime(); }
        else if (preset === 'last_7d') from = now - 7 * DAY;
        else if (preset === 'last_30d') from = now - 30 * DAY;
        else if (preset === 'last_90d') from = now - 90 * DAY;
        return allDeals.reduce(function (a, d) {
          if (!d.has_signature || d.status === 'cancelled' || d.stage === 'cancelled') return a;
          var t = new Date(d.signed_at || d.created_at || 0).getTime();
          return t >= from ? a + (+d.car_price || 0) : a;
        }, 0);
      };
      //  המדדים מ-Meta נטענים אחרי הציור (קריאה חיצונית), ולכן כאן רק
      //  מקומות שמורים. הכנסה, לידים ופגישות מגיעים מה-CRM ומוצגים מיד.
      var marketingPanel =
        '<div class="row-between" style="margin-bottom:8px"><span class="muted" style="font-size:12.5px">טווח נתוני הפרסום:</span>' +
          '<nav class="tabs" id="mkRange">' +
            [['today', 'היום'], ['last_7d', '7 ימים'], ['last_30d', '30 יום'], ['last_90d', '90 יום'], ['maximum', 'הכל']]
              .map(function (p) { return '<button data-mkr="' + p[0] + '"' + (adPreset === p[0] ? ' class="active"' : '') + '>' + p[1] + '</button>'; }).join('') +
          '</nav></div>' +
        '<div class="cards" id="mktKpis">' +
          kpi('הכנסה (מעסקאות)', M(revenue), 'כל ההיסטוריה · עסקאות חתומות', true) +
          kpi('הוצאת פרסום', '<span id="mkSpend">…</span>', 'Meta · הטווח הנבחר') +
          kpi('ROAS', '<span id="mkRoas">…</span>', 'באותו טווח') +
          kpi('עלות לליד (CPL)', '<span id="mkCpl">…</span>', 'לידים מ-Meta') +
          kpi('CTR', '<span id="mkCtr">…</span>', 'הקלקות / חשיפות') +
          kpi('CPC', '<span id="mkCpc">…</span>', 'עלות להקלקה') +
          kpi('CPM', '<span id="mkCpm">…</span>', 'עלות ל-1,000 חשיפות') +
          kpi('קמפיינים פעילים', '<span id="mkActive">…</span>') +
          kpi('אחוז המרה', P1(closeRate), doneDeals.length + ' עסקאות חתומות') +
          kpi('לידים ב-CRM', leads.length.toLocaleString('en-US'), wonL + ' נסגרו') +
          kpi('פגישות שנקבעו', appts.length) +
        '</div>' +
        '<div class="sec-note" id="mkNote">📡 טוען מדדים מ-Meta…</div>' +
        secCard('📣 קמפיינים ב-Meta <span class="muted" style="font-size:12px;font-weight:400">· לחצו על קמפיין כדי לפתוח את הסדרות והמודעות שלו \u00b7 לצפייה בלבד</span>',
                '<div id="mkCamps" class="muted" style="font-size:13px">טוען…</div>') +
        secCard('📊 נתוני מדיה מלאים <span class="muted" style="font-size:12px;font-weight:400">· חשיפות, הקלקות, CTR ו-CPC ברמת קמפיין</span>',
                '<div id="mkMedia" class="muted" style="font-size:13px">טוען…</div>') +
        '<div class="rep-grid">' +
          secCard('📣 לידים לפי מקור', barRows(repTop(bySource, 'leads', 12), function (v) { return v; })) +
          secCard('🏆 חמשת המותגים המובילים בהכנסות', rankRows(netByBrand, M, function (i) { return i.o.count + ' עסקאות'; })) +
          secCard('🌐 צפיות באתר הציבורי <span class="muted" style="font-size:12px;font-weight:400">· crm.freedrive.co.il</span>', '<div class="cards" style="margin:0">' + kpi('צפיות בעמודים', pv.toLocaleString('en-US')) + kpi('מבקרים ייחודיים', Object.keys(sess).length.toLocaleString('en-US')) + '</div>') +
        '</div>' +
        secCard('📋 ביצועי קמפיינים <span class="muted" style="font-size:12px;font-weight:400">· ייחוס מה-CRM: כל ליד משויך לקמפיין שממנו הגיע, ולידים ידניים לחברת השיווק</span>', repTable(['קמפיין', 'לידים', 'עסקאות', 'נסגרו', 'הכנסה', 'המרה', 'הוצאה', 'CPL'], campRows));

      var mktPanels = { overview: marketingPanel, sources: leadSources };
      var mktSubs = [['overview', '📣 סקירת פרסום'], ['sources', '📥 מקורות הגעה']];
      function mktNav() { return '<nav class="tabs" id="repMktTabs" style="margin-bottom:14px;flex-wrap:wrap">' + mktSubs.map(function (s) { return '<button data-msub="' + s[0] + '"' + (mktSub === s[0] ? ' class="active"' : '') + '>' + s[1] + '</button>'; }).join('') + '</nav>'; }
      var marketingWrap = mktNav() + '<div id="repMktPanel">' + mktPanels[mktSub] + '</div>';

      var panels = { manager: managerPanel, sales: salesPanel, marketing: marketingWrap };
      function tab(k, label) { return '<button data-rep="' + k + '"' + (repTab === k ? ' class="active"' : '') + '>' + label + '</button>'; }
      view('<div class="row-between" style="align-items:center;flex-wrap:wrap;gap:10px">' +
          '<div><h2 style="margin:0 0 2px">📊 דוחות וניתוח</h2>' +
            '<p class="muted" style="margin:0;font-size:13px">שלוש תצוגות: מנהל · מכירות · שיווק — כל הנתונים בטווח <b>' + esc(repRangeLabel()) + '</b></p></div>' +
          repRangeBar() +
        '</div>' +
        '<nav class="tabs" id="repTabs">' + tab('manager', '👔 מנהל') + tab('sales', '💼 מכירות') + tab('marketing', '📣 שיווק') + '</nav>' +
        '<div id="repPanel">' + panels[repTab] + '</div>');
      if ($('rrBtn')) $('rrBtn').addEventListener('click', function (e) { e.stopPropagation(); openRepRange(this); });
      loadAdMetrics();
      //  שמירה אחת לכל השורות: upsert לכל נציג שיש לו לפחות ערך אחד.
      //  שדה ריק נשמר כ-null ולא כאפס, אחרת "אין יעד" היה נראה כיעד 0
      //  ואחוז העמידה היה קופץ ל-100% על כלום.
      //  האזנה מואצלת: הלשוניות המשניות מחליפות את תוכן repPanel, ומאזין
      //  ישיר על הכפתור נמחק ברגע שעוברים ללשונית "יעדים" — הכפתור נראה
      //  ולא עשה כלום.
      $('repPanel').addEventListener('click', function (e) {
        var btn = e.target.closest('#tgtSave'); if (!btn) return;
        var byU = {};
        $('repPanel').querySelectorAll('.tgt-in').forEach(function (i) {
          var u = i.dataset.tu; byU[u] = byU[u] || { user_id: u, deals: null, revenue: null, profit: null };
          var v = i.value.trim();
          //  שדה ריק נשמר כ-null ולא כאפס: "אין יעד" מול "יעד אפס" הם
          //  שני דברים שונים, ואפס היה מקפיץ את אחוז העמידה ל-100% על כלום.
          byU[u][i.dataset.tf] = v === '' ? null : Number(v);
        });
        var rows = Object.keys(byU).map(function (u) { return byU[u]; });
        btn.disabled = true; btn.textContent = 'שומר…';
        db.from('agent_targets').upsert(rows, { onConflict: 'user_id' }).then(function (r) {
          btn.disabled = false; btn.textContent = 'שמור יעדים';
          var m = $('tgtMsg'); if (!m) return;
          if (r.error) { m.style.color = 'var(--danger)'; m.textContent = 'שגיאה: ' + r.error.message; return; }
          m.style.color = 'var(--ok)'; m.textContent = '✓ נשמר';
        });
      });
      //  אותה מלכודת כמו כפתור היעדים: בורר הטווח נבנה מחדש בכל מעבר
      //  לשונית, ומאזין ישיר עליו נמחק — הכפתורים נראו ולא הגיבו.
      $('repPanel').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-mkr]'); if (!b) return;
        adPreset = b.dataset.mkr;
        b.parentElement.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
        loadAdMetrics();
      });
      //  מאזין אחד לכל המספרים הלחיצים בדוחות, על המכל שנשאר בין ציורים
      $('repPanel').onclick = function (e) {
        var a = e.target.closest('a.drill-n[data-rk]'); if (!a) return;
        var it = (window.C2B_repKeys || [])[+a.dataset.rk]; if (!it) return;
        var what = a.dataset.what;
        repDetail((what === 'deals' ? 'עסקאות \u00b7 ' : 'לידים \u00b7 ') + it.label, what,
                  what === 'deals' ? it.o.D : it.o.L);
      };
      $('repTabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-rep]'); if (!b) return; repTab = b.dataset.rep; $('repTabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.rep === repTab); }); $('repPanel').innerHTML = panels[repTab];  loadAdMetrics(); });
      // sales sub-tab switching (delegated on the persistent repPanel)
      $('repPanel').addEventListener('click', function (e) { var b = e.target.closest('button[data-ssub]'); if (!b) return; salesSub = b.dataset.ssub; var nav = $('repSalesTabs'); if (nav) nav.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.ssub === salesSub); }); var sp = $('repSalesPanel'); if (sp) sp.innerHTML = salesPanels[salesSub]; });
      // marketing sub-tab switching — loadAdMetrics מזהה לבד אם הוא בלשונית הנכונה
      $('repPanel').addEventListener('click', function (e) { var b = e.target.closest('button[data-msub]'); if (!b) return; mktSub = b.dataset.msub; var nav = $('repMktTabs'); if (nav) nav.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.msub === mktSub); }); var mp = $('repMktPanel'); if (mp) mp.innerHTML = mktPanels[mktSub]; loadAdMetrics(); });
    }).catch(function (e) { errBox(e.message || e); });
  }
  //  ---------- מדדי הפרסום מ-Meta (קריאה בלבד) ----------
  //  נטענים בנפרד מהדוח: זו קריאה חיצונית לגרף של Meta, ואין סיבה
  //  להשהות את כל המסך בגללה. המדדים נכנסים למקומות השמורים כשהם מגיעים.
  //  adPreset — הטווח שנבחר בלוח השיווק; revenueAt — ההכנסה מהעסקאות
  //  החתומות באותו טווח, לחישוב ROAS מול הוצאת הפרסום.
  var adCache = {}, adPreset = 'last_30d', revenueAt = function () { return 0; };
  //  דוח המנהל מציג הכנסה מול הוצאה באותו מסך, ולכן טעינת המדדים מ-Meta
  //  צריכה גישה למספרים של הטווח שכבר חושבו בציור הדוח.
  var repCtx = { revenue: 0, leads: 0, deals: 0, rangeLabel: '', metaMatches: true };
  //  שם עברי לחלון שמטא באמת החזירה, כדי שאפשר יהיה לראות אי-התאמה
  var META_WINDOW = { today: 'היום', yesterday: 'אתמול', last_7d: '7 הימים האחרונים',
    last_14d: '14 הימים האחרונים', last_30d: '30 הימים האחרונים', last_90d: '90 הימים האחרונים',
    this_month: 'החודש הנוכחי', last_month: 'החודש שעבר', maximum: 'כל הזמנים' };
  //  יעד הקמפיין כפי שהוא מוגדר ב-Meta. שם היעד לבדו לא מספיק כדי לדעת
  //  מה נספר: קמפיין ווטסאפ וקמפיין טופס לידים חולקים את אותו OUTCOME_LEADS,
  //  וההבדל ביניהם מתגלה רק בסוג התוצאה שחוזר בפועל.
  var OBJECTIVES = {
    OUTCOME_LEADS: 'לידים', LEAD_GENERATION: 'לידים',
    OUTCOME_SALES: 'מכירות', CONVERSIONS: 'המרות',
    OUTCOME_TRAFFIC: 'תנועה', LINK_CLICKS: 'הקלקות',
    OUTCOME_ENGAGEMENT: 'מעורבות', POST_ENGAGEMENT: 'מעורבות', MESSAGES: 'הודעות',
    OUTCOME_AWARENESS: 'מודעות', BRAND_AWARENESS: 'מודעות', REACH: 'חשיפה',
    OUTCOME_APP_PROMOTION: 'קידום אפליקציה', VIDEO_VIEWS: 'צפיות בווידאו'
  };

  //  ---------- פירוט מאחורי מספר בדוח ----------
  //  מספר בדוח בלי דרך לראות ממה הוא מורכב מכריח את המנהל להאמין לו.
  //  כל ספירה כאן פותחת את הרשומות עצמן, ומשם אפשר לקפוץ לכרטיס הליד.
  function repDetail(title, kind, list) {
    var bg = document.createElement('div');
    bg.className = 'adm-bg';
    var head, rows;
    if (kind === 'deals') {
      head = ['לקוח', 'רכב', 'מחיר הרכב', 'נחתם', 'נציג'];
      rows = list.map(function (x) {
        return '<tr data-replead="' + esc(x.l.id) + '" style="cursor:pointer">' +
          '<td><b>' + esc(x.l.name || '\u2014') + '</b></td>' +
          '<td>' + esc([x.d.car_make, x.d.car_model].filter(Boolean).join(' ') || '\u2014') + '</td>' +
          '<td>' + M(+x.d.car_price || 0) + '</td>' +
          '<td class="muted">' + esc(fmtDateTime(x.d.signed_at || x.d.created_at)) + '</td>' +
          '<td class="muted">' + esc(x.d.salesperson || '\u2014') + '</td></tr>';
      }).join('');
    } else {
      head = ['שם', 'טלפון', 'סטטוס', 'רכב', 'נכנס בתאריך'];
      rows = list.map(function (l) {
        var sd = (window.C2B_STATUSES || []).filter(function (x) { return x.k === (l.status || 'new'); })[0] || { label: l.status, color: 'var(--muted)', icon: '' };
        return '<tr data-replead="' + esc(l.id) + '" style="cursor:pointer">' +
          '<td><b>' + esc(l.name || '\u2014') + '</b></td>' +
          '<td class="ltr"><bdi>' + esc(l.phone || '\u2014') + '</bdi></td>' +
          '<td style="color:' + sd.color + ';font-weight:600">' + esc(sd.icon + ' ' + sd.label) + '</td>' +
          '<td>' + esc(l.car || '\u2014') + '</td>' +
          '<td class="muted">' + esc(fmtDateTime(l.created_at)) + '</td></tr>';
      }).join('');
    }
    bg.innerHTML = '<div class="adm"><div class="adm-hd"><h3>' + esc(title) + ' \u00b7 ' + list.length + '</h3>' +
      '<button class="adm-x" data-admx title="סגור">\u2715</button></div>' +
      '<div class="adm-body">' +
        (rows ? '<div class="table-scroll"><table><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>'
              : '<p class="empty">אין רשומות</p>') +
      '</div><div class="adm-meta"><span>לחיצה על שורה פותחת את כרטיס הליד</span></div></div>';
    document.body.appendChild(bg);
    function close() { bg.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return close();
      var tr = e.target.closest('tr[data-replead]');
      if (tr && window.C2B_openLeadCard) { close(); window.C2B_openLeadCard(tr.dataset.replead); }
    });
  }

  function loadAdMetrics() {
    //  אותה קריאה משרתת את לוח השיווק ואת לוח המנהל \u2014 שניהם מציגים
    //  את ההוצאה מ-Meta, ואין סיבה למשוך אותה פעמיים.
    if (!$('mkCamps') && !$('mgSpend')) return;
    var preset = repMetaPreset();
    var setAll = function (v) {
      ['mkSpend', 'mkRoas', 'mkCpl', 'mkCtr', 'mkCpc', 'mkCpm', 'mkActive',
       'mgSpend', 'mgNet', 'mgRoas', 'mgCpl', 'mgCac', 'mgPaidRev'].forEach(function (id) {
        if ($(id)) $(id).textContent = v;
      });
    };
    var paint = function (d) {
      //  שני לוחות צורכים את הנתונים האלה. שומר שבודק רק את לוח השיווק
      //  גרם ללוח המנהל להישאר על "טוען" למרות שהקריאה הצליחה.
      if (!$('mkCamps') && !$('mgSpend')) return;
      if (!d || d.error) {
        setAll('\u2014');
        var msg = '\ud83d\udce1 לא ניתן לטעון מדדים מ-Meta: ' + esc((d && d.error) || 'שגיאה');
        ['mkNote', 'mgNote'].forEach(function (id) { if ($(id)) $(id).innerHTML = msg; });
        ['mkCamps', 'mgCamps'].forEach(function (id) { if ($(id)) $(id).innerHTML = '<span class="muted">אין נתונים להצגה.</span>'; });
        return;
      }
      var t = d.totals || {}, sp = t.spend || 0;
      var nis0 = function (n) { return '₪' + Math.round(n || 0).toLocaleString('en-US'); };
      if ($('mkSpend')) $('mkSpend').textContent = nis0(sp);
      var rev = revenueAt(preset);
      if ($('mkRoas')) $('mkRoas').textContent = sp ? (Math.round(rev / sp * 10) / 10) + 'x' : '—';
      if ($('mkCpl')) $('mkCpl').textContent = t.cpl ? nis0(t.cpl) : '—';
      //  ה-sub של kpi עובר esc, ולכן אי אפשר לשתול בו span. מעדכנים את
      //  הרמז עצמו אחרי הציור.
      var hint = function (id, txt) {
        var el = $(id); if (!el) return;
        var card = el.closest('.kpi'); if (!card) return;
        var sub = card.querySelector('.sub'); if (sub) sub.textContent = txt;
      };
      //  המספר הכולל מאחד סוגי תוצאה שונים (ליד מטופס, התחלת התכתבות
      //  בווטסאפ), ולכן הרמז מפרט ממה הוא מורכב.
      var kinds = (t.results || []).map(function (x) { return x.n.toLocaleString('en-US') + ' ' + x.label; }).join(' \u00b7 ');
      hint('mkCpl', (t.leads || 0).toLocaleString('en-US') + ' לידים מ-Meta' + (kinds ? ' (' + kinds + ')' : ''));
      hint('mkRoas', 'הכנסה ' + nis0(rev) + ' / הוצאה ' + nis0(sp));
      if ($('mkCtr')) $('mkCtr').textContent = (Math.round((t.ctr || 0) * 100) / 100) + '%';
      if ($('mkCpc')) $('mkCpc').textContent = t.cpc ? '₪' + (Math.round(t.cpc * 100) / 100) : '—';
      if ($('mkCpm')) $('mkCpm').textContent = t.cpm ? nis0(t.cpm) : '—';
      if ($('mkActive')) $('mkActive').textContent = t.active || 0;
      if ($('mkNote')) $('mkNote').innerHTML = '📡 הנתונים מ-Meta · חשבון ' + esc(d.account || '') +
        ' · ' + (t.impressions || 0).toLocaleString('en-US') + ' חשיפות · ' +
        (t.clicks || 0).toLocaleString('en-US') + ' הקלקות · <b>לצפייה בלבד</b> — שינוי תקציב או סטטוס נעשה ב-Meta.';

      //  ---------- לוח המנהל ----------
      if ($('mgSpend')) {
        var rv = repCtx.revenue || 0, prv = repCtx.paidRevenue || 0, pdl = repCtx.paidDeals || 0;
        $('mgSpend').textContent = nis0(sp);
        if ($('mgNet')) $('mgNet').textContent = nis0(rv - sp);
        if ($('mgPaidRev')) $('mgPaidRev').textContent = nis0(prv);
        //  אין עסקאות מפרסום \u2014 ROAS הוא 0, לא "אין נתונים". זו התשובה
        //  האמיתית: הקמפיינים עדיין לא החזירו שקל.
        if ($('mgRoas')) $('mgRoas').textContent = sp ? (Math.round(prv / sp * 10) / 10) + 'x' : '\u2014';
        if ($('mgCpl')) $('mgCpl').textContent = t.leads ? nis0(sp / t.leads) : '\u2014';
        if ($('mgCac')) $('mgCac').textContent = pdl ? nis0(sp / pdl) : '\u2014';
        hint('mgSpend', 'Meta \u00b7 ' + (META_WINDOW[d.preset] || d.preset));
        hint('mgNet', nis0(rv) + ' פחות ' + nis0(sp));
        hint('mgPaidRev', pdl + ' מתוך ' + repCtx.deals + ' עסקאות \u00b7 השאר ממקורות אחרים');
        hint('mgRoas', prv ? nis0(prv) + ' חלקי ' + nis0(sp) : 'הקמפיינים עדיין לא החזירו הכנסה');
        hint('mgCpl', (t.leads || 0) + ' תוצאות ב-Meta \u00b7 ' + repCtx.leads + ' לידים ב-CRM');
        hint('mgCac', pdl ? pdl + ' עסקאות מקמפיין' : 'אין עדיין עסקה שנולדה מקמפיין');
        if ($('mgNote')) {
          //  כשהטווח שנבחר אינו קיים כמסנן של Meta, ההוצאה מגיעה מחלון אחר.
          //  שתיקה כאן הייתה גורמת למנהל להשוות הכנסה של רבעון להוצאה של תמיד.
          $('mgNote').innerHTML = repCtx.metaMatches
            ? '\ud83d\udce1 הכנסות מה-CRM מול הוצאה אמיתית מ-Meta \u00b7 חשבון ' + esc(d.account || '') +
              ' \u00b7 שניהם בטווח <b>' + esc(repCtx.rangeLabel) + '</b>.'
            : '\u26a0\ufe0f ההכנסות בטווח <b>' + esc(repCtx.rangeLabel) + '</b>, אבל ל-Meta אין מסנן תואם ולכן ההוצאה היא של <b>' +
              esc(META_WINDOW[d.preset] || d.preset) + '</b>. ל-ROAS ולעלות לעסקה בחרו טווח כמו 7 / 30 / 90 יום או חודש.';
        }
        var mrows = (d.campaigns || []).slice().sort(function (a, b) { return b.spend - a.spend; }).map(function (c) {
          var share = sp ? c.spend / sp * 100 : 0;
          return '<tr><td><b>' + esc(c.name || '\u2014') + '</b></td>' +
            '<td class="muted">' + esc(OBJECTIVES[c.objective] || c.objective || '\u2014') + '</td>' +
            '<td>' + nis0(c.spend) + '</td>' +
            '<td>' + (Math.round(share * 10) / 10) + '%</td>' +
            '<td>' + (c.leads || 0) + (c.result_type && c.result_type !== 'לידים'
              ? '<div class="muted" style="font-size:11px;font-weight:400">' + esc(c.result_type) + '</div>' : '') + '</td>' +
            '<td>' + (c.cpl ? nis0(c.cpl) : '\u2014') + '</td>' +
            '<td class="muted">' + (c.status === 'ACTIVE' ? 'פעיל' : esc(c.status || '\u2014')) + '</td></tr>';
        }).join('');
        if ($('mgCamps')) $('mgCamps').innerHTML = mrows
          ? '<div class="table-scroll"><table><thead><tr>' +
              ['קמפיין', 'יעד', 'הוצאה', '% מהתקציב', 'לידים', 'עלות לליד', 'סטטוס']
                .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
            '</tr></thead><tbody>' + mrows + '</tbody></table></div>'
          : '<span class="muted">לא הייתה הוצאה בטווח שנבחר.</span>';
      }
      if (!$('mkCamps')) return;                      // לוח המנהל בלבד

      //  ---------- טבלה נפתחת: קמפיין \u2192 סדרה \u2192 מודעה ----------
      //  שלוש הרמות יושבות באותה טבלה ולא בטבלאות נפרדות, כדי שהמנהל
      //  יראה את הסדרות בהקשר של הקמפיין שמעליהן ולא יאבד את המקום.
      var crm = (repCtx.crm || {});
      function cellOf(level, id) { return ((crm[level] || {})[String(id)] || { leads: [], deals: [] }); }
      function metrRow(level, id, name, indent, kids, extra) {
        var o = cellOf(level, id), nl = o.leads.length, nd = o.deals.length;
        var rev = o.deals.reduce(function (a, x) { return a + (+x.d.car_price || 0); }, 0);
        var conv = nl ? nd / nl * 100 : null;
        var cac = nd ? extra.spend / nd : null;
        var arrow = kids ? '<span class="drill-x">\u25b8</span> ' : '';
        return '<tr data-lvl="' + level + '" data-id="' + esc(id) + '" data-parent="' + esc(extra.parent || '') + '"' +
            (level !== 'campaign' ? ' class="hidden"' : '') + (kids ? ' data-kids="1"' : '') + '>' +
          '<td style="padding-inline-start:' + (10 + indent * 22) + 'px' + (kids ? ';cursor:pointer' : '') + '"' +
             (kids ? ' data-drill="1"' : '') + '>' + arrow + '<b>' + esc(name || '\u2014') + '</b>' +
             (extra.sub ? '<div class="muted" style="font-size:11px;font-weight:400">' + esc(extra.sub) + '</div>' : '') + '</td>' +
          '<td>' + nis0(extra.spend) + '</td>' +
          '<td>' + (extra.leads || 0) + (extra.result_type && extra.result_type !== 'לידים'
            ? '<div class="muted" style="font-size:11px">' + esc(extra.result_type) + '</div>' : '') + '</td>' +
          '<td>' + (nl ? '<a class="drill-n" data-open="leads" data-lvl2="' + level + '" data-id2="' + esc(id) + '">' + nl + '</a>' : '<span class="muted">0</span>') + '</td>' +
          '<td>' + (nd ? '<a class="drill-n" data-open="deals" data-lvl2="' + level + '" data-id2="' + esc(id) + '">' + nd + '</a>' : '<span class="muted">0</span>') + '</td>' +
          '<td>' + (rev ? M(rev) : '<span class="muted">\u2014</span>') + '</td>' +
          '<td>' + (conv === null ? '<span class="muted">\u2014</span>' : P1(conv)) + '</td>' +
          '<td>' + (cac === null ? '<span class="muted">\u2014</span>' : nis0(cac)) + '</td>' +
          '<td>' + (extra.cpl ? nis0(extra.cpl) : '<span class="muted">\u2014</span>') + '</td></tr>';
      }
      var adsets = d.adsets || [], ads = d.ads || [];
      var drill = (d.campaigns || []).slice().sort(function (a, b) { return b.spend - a.spend; }).map(function (c) {
        var myAdsets = adsets.filter(function (a) { return a.campaign_id === String(c.id); });
        var out = metrRow('campaign', c.id, c.name, 0, myAdsets.length, {
          spend: c.spend, leads: c.leads, cpl: c.cpl, result_type: c.result_type, parent: '',
          sub: (OBJECTIVES[c.objective] || c.objective || '') + (c.status === 'ACTIVE' ? ' \u00b7 פעיל' : c.status ? ' \u00b7 ' + c.status : '')
        });
        myAdsets.forEach(function (a) {
          var myAds = ads.filter(function (x) { return x.adset_id === String(a.id); });
          out += metrRow('adset', a.id, a.name, 1, myAds.length, {
            spend: a.spend, leads: a.leads, cpl: a.cpl, result_type: a.result_type, parent: String(c.id)
          });
          myAds.forEach(function (x) {
            out += metrRow('ad', x.id, x.name, 2, 0, {
              spend: x.spend, leads: x.leads, cpl: x.cpl, result_type: x.result_type, parent: String(a.id)
            });
          });
        });
        return out;
      }).join('');
      $('mkCamps').innerHTML = drill
        ? '<div class="table-scroll"><table id="drillTbl"><thead><tr>' +
            ['קמפיין / סדרה / מודעה', 'הוצאה', 'תוצאות ב-Meta', 'לידים ב-CRM', 'עסקאות', 'הכנסות', 'שיעור המרה', 'עלות לעסקה', 'עלות לתוצאה']
              .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
          '</tr></thead><tbody>' + drill + '</tbody></table></div>'
        : '<span class="muted">אין קמפיינים בטווח שנבחר.</span>';

      //  פתיחה וסגירה של רמה. סגירת הורה מקפלת גם את הנכדים, אחרת נשארות
      //  מודעות תלויות באוויר בלי הסדרה שלהן.
      //  שיוך ל-onclick ולא addEventListener: paint רצה מחדש בכל שינוי
      //  טווח או מעבר לשונית, ומאזין מצטבר גרם ל-toggle כפול שביטל את
      //  עצמו — הלחיצה נראתה כאילו אינה עושה כלום.
      $('mkCamps').onclick = function (e) {
        var num = e.target.closest('a.drill-n');
        if (num) {
          var o = cellOf(num.dataset.lvl2, num.dataset.id2);
          var nm = (num.closest('tr').querySelector('td b') || {}).textContent || '';
          return repDetail((num.dataset.open === 'deals' ? 'עסקאות \u00b7 ' : 'לידים \u00b7 ') + nm,
                           num.dataset.open, num.dataset.open === 'deals' ? o.deals : o.leads);
        }
        var cell = e.target.closest('td[data-drill]'); if (!cell) return;
        var tr = cell.closest('tr'), id = tr.dataset.id, tb = tr.parentNode;
        var open = tr.classList.toggle('drill-open');
        var mark = tr.querySelector('.drill-x'); if (mark) mark.textContent = open ? '\u25be' : '\u25b8';
        [].forEach.call(tb.querySelectorAll('tr[data-parent="' + id + '"]'), function (k) {
          k.classList.toggle('hidden', !open);
          if (!open) {
            k.classList.remove('drill-open');
            var m2 = k.querySelector('.drill-x'); if (m2) m2.textContent = '\u25b8';
            [].forEach.call(tb.querySelectorAll('tr[data-parent="' + k.dataset.id + '"]'), function (g) { g.classList.add('hidden'); });
          }
        });
      };

      var rows = (d.campaigns || []).map(function (c) {
        var st = c.status === 'ACTIVE'
          ? '<span style="color:var(--ok);font-weight:600">● פעיל</span>'
          : '<span class="muted">● ' + esc(c.status || '—') + '</span>';
        return '<tr>' +
          '<td><b>' + esc(c.name || '—') + '</b></td>' +
          '<td class="muted">' + esc(OBJECTIVES[c.objective] || c.objective || '—') + '</td>' +
          '<td>' + st + '</td>' +
          '<td class="muted">' + (c.budget ? nis0(c.budget) + ' ' + esc(c.budget_kind || '') : '—') + '</td>' +
          '<td>' + nis0(c.spend) + '</td>' +
          '<td>' + (c.impressions || 0).toLocaleString('en-US') + '</td>' +
          '<td>' + (c.clicks || 0).toLocaleString('en-US') + '</td>' +
          '<td>' + (Math.round((c.ctr || 0) * 100) / 100) + '%</td>' +
          '<td>' + (c.cpc ? '₪' + (Math.round(c.cpc * 100) / 100) : '—') + '</td>' +
          '<td>' + (c.leads || 0) +
            (c.result_type && c.result_type !== 'לידים'
              ? '<div class="muted" style="font-size:11px;font-weight:400">' + esc(c.result_type) + '</div>' : '') + '</td>' +
          '<td>' + (c.cpl ? nis0(c.cpl) : '—') + '</td></tr>';
      }).join('');
      //  טבלת המדיה המפורטת (חשיפות/הקלקות/CTR) יורדת אל מתחת לטבלה
      //  הנפתחת, כדי ששתיהן ייראו בלי להתחרות על אותו מקום.
      if ($('mkMedia')) $('mkMedia').innerHTML = rows
        ? '<div class="table-scroll"><table><thead><tr>' +
            ['קמפיין', 'יעד', 'סטטוס', 'תקציב', 'הוצאה', 'חשיפות', 'הקלקות', 'CTR', 'CPC', 'לידים', 'CPL']
              .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<span class="muted">אין קמפיינים בטווח שנבחר.</span>';
    };
    if (adCache[preset]) return paint(adCache[preset]);
    setAll('…');
    db.functions.invoke('fb-insights', { body: { preset: preset } }).then(function (r) {
      var d = (r && r.data) || { error: (r && r.error && r.error.message) || 'שגיאה' };
      adCache[preset] = d; paint(d);
    }, function (e) { paint({ error: (e && e.message) || 'שגיאה' }); });
  }

  var repTab = 'manager', salesSub = 'overview', mktSub = 'overview';

  // ---------- USERS & ROLES (admin only) ----------
  var ROLES = [['admin', 'מנהל מערכת'], ['sales', 'סוכן מכירות'], ['files', 'מנהלת תיקי לקוחות'], ['accounting', 'מנהלת חשבונות'], ['branch', 'מנהל סניף']];
  function roleName(k) { var x = ROLES.filter(function (r) { return r[0] === k; })[0]; return x ? x[1] : k; }
  function viewsLabel(v, role) {
    var isDefault = !(v && v.length);
    var eff = isDefault ? (DEFAULT_VIEWS[role] || ['dashboard']) : v;
    var tags = eff.map(function (k) {
      var g = GRANTABLE_VIEWS.filter(function (x) { return x[0] === k; })[0];
      // בלי המפה הזאת מסך ניהול הוצג כמפתח אנגלי גולמי ("audit") בטבלת המשתמשים
      var label = g ? g[1] : (ADMIN_ONLY_VIEWS[k] || k);
      return '<span class="tag" style="margin:2px">' + esc(label) + '</span>';
    }).join('');
    return (isDefault ? '<span class="muted" style="font-size:10.5px;display:block;margin-bottom:3px">ברירת מחדל לתפקיד (מה שהם רואים):</span>' : '') + tags;
  }
  function viewChecks(idPrefix, checked) {
    return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">' + GRANTABLE_VIEWS.map(function (g) {
      return '<label style="display:flex;gap:5px;align-items:center;font-size:13px"><input type="checkbox" data-' + idPrefix + '="' + g[0] + '"' + (checked.indexOf(g[0]) >= 0 ? ' checked' : '') + '> ' + g[1] + '</label>';
    }).join('') + '</div>';
  }

  //  ---------- נציגים ----------
  //  מנהל שואל שתי שאלות על נציג: כמה לידים יש לו, ואיפה הם תקועים.
  //  לכן התצוגה הראשית היא מטריצה של נציג מול סטטוס, ותת-התצוגה של כל
  //  נציג פורסת את הלידים שלו לפי אותם סטטוסים בדיוק.
  var agentTab = 'all';
  function renderAgents() {
    loading();
    Promise.all([
      db.from('profiles').select('user_id,full_name,role,active').order('full_name'),
      db.from('leads').select('id,name,phone,car,status,assigned_to,created_at,source,campaign')
        .is('deleted_at', null).order('created_at', { ascending: false }).limit(5000)
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      if (res[1].error) return errBox(res[1].error.message);
      var profs = res[0].data || [], leads = res[1].data || [];
      var ST = window.C2B_STATUSES || [];
      var stDef = function (k) { for (var i = 0; i < ST.length; i++) if (ST[i].k === k) return ST[i]; return { k: k, label: k, icon: '•', color: 'var(--muted)' }; };
      var byId = {}; profs.forEach(function (p) { byId[p.user_id] = p; });

      //  נציג ללא לידים חייב להופיע \u2014 אחרת אי אפשר לראות שהוא לא מקבל
      var buckets = {};
      profs.forEach(function (p) { if (p.active) buckets[p.user_id] = { p: p, leads: [] }; });
      var UNASSIGNED = '\u2014none\u2014';
      leads.forEach(function (l) {
        var k = l.assigned_to && buckets[l.assigned_to] ? l.assigned_to : UNASSIGNED;
        if (!buckets[k]) buckets[k] = { p: byId[l.assigned_to] || { full_name: 'לא משויך', role: '' }, leads: [] };
        buckets[k].leads.push(l);
      });
      var keys = Object.keys(buckets).sort(function (a, b) {
        if (a === UNASSIGNED) return 1; if (b === UNASSIGNED) return -1;
        return buckets[b].leads.length - buckets[a].leads.length;
      });
      var cnt = function (arr, k) { return arr.filter(function (l) { return (l.status || 'new') === k; }).length; };

      // ---------- טבלת כל הנציגים ----------
      var head = ['נציג', 'תפקיד', 'סה\u05f4כ'].concat(ST.map(function (s) { return s.icon + ' ' + s.label; })).concat(['אחוז סגירה']);
      var rows = keys.map(function (k) {
        var b = buckets[k], n = b.leads.length, won = cnt(b.leads, 'won');
        return '<tr><td><b>' + esc(k === UNASSIGNED ? 'לא משויך' : (b.p.full_name || '\u2014')) + '</b></td>' +
          '<td class="muted">' + esc(k === UNASSIGNED ? '' : roleLabel(b.p.role)) + '</td>' +
          '<td><b>' + n + '</b></td>' +
          ST.map(function (s) {
            var c = cnt(b.leads, s.k);
            return '<td' + (c ? ' style="color:' + s.color + ';font-weight:700"' : ' class="muted"') + '>' + (c || '\u2014') + '</td>';
          }).join('') +
          '<td>' + (n ? (Math.round(won / n * 1000) / 10) + '%' : '<span class="muted">\u2014</span>') + '</td></tr>';
      }).join('');
      var totals = { n: leads.length, won: leads.filter(function (l) { return l.status === 'won'; }).length };
      var overview =
        '<div class="cards">' +
          kpi('סה\u05f4כ לידים', leads.length.toLocaleString('en-US'), keys.length + ' נציגים', true) +
          kpi('נסגרו', totals.won, totals.n ? (Math.round(totals.won / totals.n * 1000) / 10) + '% מהלידים' : null) +
          kpi('פתוחים', leads.filter(function (l) { return ['won', 'lost'].indexOf(l.status) < 0; }).length, 'לא נסגרו ולא נפסלו') +
          kpi('לא משויכים', (buckets[UNASSIGNED] || { leads: [] }).leads.length, 'ממתינים לשיוך') +
        '</div>' +
        secCardA('\ud83d\udcca לידים לפי נציג וסטטוס', repTableA(head, rows)) +
        '<div class="sec-note">לחיצה על שם נציג בשורת הלשוניות למעלה פותחת את הלידים שלו לפי סטטוס.</div>';

      // ---------- תת-תצוגה של נציג ----------
      function agentPanel(k) {
        var b = buckets[k]; if (!b) return '<p class="empty">לא נמצא</p>';
        var n = b.leads.length, won = cnt(b.leads, 'won'), open = b.leads.filter(function (l) { return ['won', 'lost'].indexOf(l.status) < 0; }).length;
        var sections = ST.map(function (s) {
          var ls = b.leads.filter(function (l) { return (l.status || 'new') === s.k; });
          if (!ls.length) return '';
          var trs = ls.map(function (l) {
            return '<tr data-agentlead="' + esc(l.id) + '" style="cursor:pointer">' +
              '<td><b>' + esc(l.name || '\u2014') + '</b></td>' +
              '<td class="ltr"><bdi>' + esc(l.phone || '\u2014') + '</bdi></td>' +
              '<td>' + esc(l.car || '\u2014') + '</td>' +
              '<td class="muted">' + esc(l.source || '\u2014') + '</td>' +
              '<td class="muted">' + esc(l.campaign || '\u2014') + '</td>' +
              '<td class="muted">' + fmtDateTime(l.created_at) + '</td></tr>';
          }).join('');
          return secCardA('<span style="color:' + s.color + '">' + s.icon + ' ' + esc(s.label) + '</span> <span class="muted" style="font-weight:400;font-size:12px">\u00b7 ' + ls.length + '</span>',
            repTableA(['שם', 'טלפון', 'רכב', 'מקור', 'קמפיין', 'נכנס בתאריך'], trs));
        }).join('');
        return '<div class="cards">' +
            kpi('סה\u05f4כ לידים', n, esc(k === UNASSIGNED ? 'ללא שיוך' : roleLabel(b.p.role)), true) +
            kpi('פתוחים', open) +
            kpi('נסגרו', won, n ? (Math.round(won / n * 1000) / 10) + '% סגירה' : null) +
            kpi('לא רלוונטי', cnt(b.leads, 'lost')) +
          '</div>' + (sections || '<div class="card"><p class="empty">אין לידים לנציג הזה</p></div>');
      }

      var tabs = [['all', 'כל הנציגים']].concat(keys.map(function (k) {
        return [k, (k === UNASSIGNED ? 'לא משויך' : (buckets[k].p.full_name || '\u2014')) + ' (' + buckets[k].leads.length + ')'];
      }));
      if (!buckets[agentTab] && agentTab !== 'all') agentTab = 'all';
      var nav = '<nav class="tabs" id="agTabs" style="margin-bottom:14px;flex-wrap:wrap">' + tabs.map(function (t) {
        return '<button data-ag="' + esc(t[0]) + '"' + (agentTab === t[0] ? ' class="active"' : '') + '>' + esc(t[1]) + '</button>';
      }).join('') + '</nav>';

      view('<h2 style="margin:0 0 4px">🧑\u200d💼 נציגים</h2>' +
        '<p class="muted" style="margin:0 0 14px;font-size:13px">כל הלידים של כל נציג, לפי סטטוס. תצוגה למנהלים בלבד.</p>' +
        nav + '<div id="agPanel">' + (agentTab === 'all' ? overview : agentPanel(agentTab)) + '</div>');

      $('agTabs').addEventListener('click', function (e) {
        var b2 = e.target.closest('button[data-ag]'); if (!b2) return;
        agentTab = b2.dataset.ag;
        $('agTabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.ag === agentTab); });
        $('agPanel').innerHTML = agentTab === 'all' ? overview : agentPanel(agentTab);
      });
      //  פתיחת כרטיס ליד מתוך הרשימה, באותה דרך שבה נפתח ליד ממסך הלידים
      $('agPanel').addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-agentlead]'); if (!tr) return;
        if (window.C2B_openLeadCard) window.C2B_openLeadCard(tr.dataset.agentlead);
      });
    }).catch(function (e) { errBox(e.message || e); });
  }
  function secCardA(title, inner) { return '<div class="card"><div class="sec-title">' + title + '</div>' + inner + '</div>'; }
  function repTableA(headers, rows) {
    return '<div class="table-scroll"><table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + (rows || '<tr><td class="empty" colspan="' + headers.length + '">אין נתונים</td></tr>') + '</tbody></table></div>';
  }


  //  ---------- Hey \u00b7 WhatsApp ----------
  //  Heyy מנהל את תיבת הווטסאפ ושולח webhook על כל הודעה. המסך קורא
  //  בלבד: שליחה תתווסף כשיהיה API שליחה מהספק.
  //
  //  כלל הגישה: מנהל מערכת רואה את כל הערוצים, וכל שאר המשתמשים רואים
  //  אך ורק את הערוץ שמוגדר להם בפרופיל. האכיפה במסד (RLS) והממשק רק
  //  משקף אותה. ניהול הערוצים והשיוך יושבים ב"משתמשים והרשאות".
  var heyyNum = '', heyyThread = '', heyyQ = '';
  function renderHeyy() {
    loading();
    var isAdm = (window.C2B && window.C2B.role) === 'admin';
    Promise.all([
      db.from('wa_numbers').select('id,phone,label,channel_id,active').order('created_at'),
      db.from('profiles').select('user_id,full_name,wa_number_id').eq('user_id', (window.C2B && window.C2B.userId) || '00000000-0000-0000-0000-000000000000'),
      db.from('wa_threads').select('id,number_id,contact_phone,contact_name,lead_id,last_at,last_text,last_dir,unread')
        .order('last_at', { ascending: false, nullsFirst: false }).limit(500),
      db.from('wa_templates').select('id,title,body,category,sort_order').eq('active', true).order('sort_order'),
      //  רק השדות שמותר להראות ללקוח. רשימת היתר ולא רשימת חסימה:
      //  extra מכיל buy_price, ושליפה גורפת הייתה חושפת את הרווח.
      db.from('cars').select('id,brand,name,trim,year,fuel,cat,condition,price,monthly,img,extra')
        .eq('active', true).order('brand').limit(400)
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var nums = res[0].data || [], me = (res[1].data || [])[0] || {}, threads = res[2].data || [];
      waTpl = res[3].data || []; waCars = res[4].data || [];
      //  הסטטוס אינו משוכפל לטבלת השיחות: הליד הוא מקור האמת
      //  היחיד, והמסך קורא וכותב אליו. כך אין סיכוי לחוסר התאמה
      //  בין מסך הלידים למסך הווטסאפ — זה אותו שדה.
      var lids = threads.map(function (x) { return x.lead_id; }).filter(Boolean);
      if (lids.length) {
        db.from('leads').select('id,status,name,car,assigned_to').in('id', lids.slice(0, 400)).then(function (lr) {
          waLeads = {}; (lr.data || []).forEach(function (l) { waLeads[l.id] = l; });
          if ($('waList')) {
            $('waList').innerHTML = heyyList(shown);
            if (heyyThread) { var cur = shown.filter(function (x) { return x.id === heyyThread; })[0]; if (cur) openThread(cur); }
          }
        });
      } else { waLeads = {}; }
      var numById = {}; nums.forEach(function (n) { numById[n.id] = n; });
      if (!isAdm) heyyNum = me.wa_number_id || '';

      //  מצב שדורש הסבר ולא מסך ריק
      if (!isAdm && !me.wa_number_id) {
        return view(heyyHead(nums, numById, isAdm, 0) +
          '<div class="card"><p class="empty">\ud83d\udd12 לא הוגדר לך מספר ווטסאפ.<br>' +
          'מנהל המערכת משייך מספר למשתמש במסך <b>משתמשים והרשאות</b>, ואז השיחות של אותו מספר יופיעו כאן.</p></div>');
      }

      var shown = threads.filter(function (t) {
        if (heyyNum && t.number_id !== heyyNum) return false;
        if (!heyyQ) return true;
        var q = heyyQ.toLowerCase();
        return ((t.contact_name || '') + ' ' + t.contact_phone + ' ' + (t.last_text || '')).toLowerCase().indexOf(q) >= 0;
      });
      view(heyyHead(nums, numById, isAdm, shown.length) +
        '<div class="wa-wrap">' +
          '<div class="card wa-side">' +
            '<div class="wa-search"><input class="inp" id="waQ" placeholder="\ud83d\udd0d חיפוש שיחה\u2026" value="' + esc(heyyQ) + '"></div>' +
            '<div class="wa-list" id="waList">' + heyyList(shown) + '</div>' +
          '</div>' +
          '<div class="card wa-pane" id="waPane">' + heyyEmpty() + '</div>' +
        '</div>');

      if ($('heyyNum')) $('heyyNum').addEventListener('change', function () { heyyNum = this.value; heyyThread = ''; renderHeyy(); });
      if ($('waNewChat')) $('waNewChat').addEventListener('click', function () { newChatBox(nums, isAdm); });
      var q = $('waQ');
      if (q) {
        //  שמירת מיקום הסמן: renderHeyy נקרא מחדש בכל הקלדה, ובלי זה
        //  הסמן קופץ לתחילת השדה אחרי כל אות.
        q.addEventListener('input', function () { heyyQ = this.value; renderHeyy(); });
        if (heyyQ) { q.focus(); q.setSelectionRange(heyyQ.length, heyyQ.length); }
      }
      $('waList').addEventListener('click', function (e) {
        var el = e.target.closest('[data-th]'); if (!el) return;
        heyyThread = el.dataset.th;
        $('waList').querySelectorAll('.wa-th').forEach(function (x) { x.classList.toggle('on', x.dataset.th === heyyThread); });
        var b2 = el.querySelector('.wa-unread'); if (b2) b2.remove();
        openThread(threads.filter(function (t) { return t.id === heyyThread; })[0]);
      });
      if (heyyThread) openThread(shown.filter(function (t) { return t.id === heyyThread; })[0]);
    }).catch(function (e) { errBox(e.message || e); });
  }

  //  ---------- כלי הסוכן בשיחה ----------
  //  אין עדיין API שליחה מ-Heyy, ולכן כל הודעה שנבנית כאן עושה שני דברים:
  //  נכנסת לתור (wa_outbox) לכשהחיבור יעלה, **וגם** מועתקת ללוח כדי
  //  שהסוכן יוכל להדביק ב-Heyy כבר עכשיו. כפתור שליחה שלא שולח באמת
  //  היה גרוע יותר מכלי שאומר בדיוק מה הוא עושה.
  var waTpl = [], waCars = [], waDraft = '', waPickedCar = null, waLeads = {};
  //  השיחה שעבורה כבר נפתח בוחר התבניות אוטומטית
  var waAutoTpl = null;

  //  ---------- כרטיס הרכב ----------
  //  רשימת היתר מפורשת. extra מכיל buy_price ו-list_price, ושליפה
  //  גורפת שלו ללקוח הייתה חושפת בדיוק כמה הרווח שלנו על הרכב.
  //  ערך שנראה כמו תאריך אספקה ולא כמו רשימת צבעים
  var MONTHS_RE = /ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|\d{1,2}\/\d/;
  function carCard(c, brandName) {
    var x = c.extra || {};
    var nis = function (n) { return Number(n).toLocaleString('en-US') + ' \u20aa'; };
    var L = [];
    L.push('*' + [c.brand, c.name].filter(Boolean).join(' ') + (c.trim ? ' ' + c.trim : '') + '*');
    var sub = [c.year, c.condition, c.fuel, x.hand ? 'יד ' + x.hand : null]
      .filter(Boolean).map(String)
      //  condition \u05d4\u05d5\u05d0 "\u05d9\u05d3 2" \u05d5-extra.hand \u05d4\u05d5\u05d0 "2" \u2014 \u05e9\u05e0\u05d9\u05d4\u05dd \u05de\u05d9\u05d9\u05e6\u05e8\u05d9\u05dd \u05d0\u05d5\u05ea\u05d5
      //  \u05d8\u05e7\u05e1\u05d8, \u05d5\u05d4\u05e9\u05d5\u05e8\u05d4 \u05d9\u05e6\u05d0\u05d4 "2024 \u00b7 \u05d9\u05d3 2 \u00b7 \u05d3\u05d9\u05d6\u05dc \u00b7 \u05d9\u05d3 2".
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .join(' \u00b7 ');
    if (sub) L.push(sub);
    L.push('');
    if (c.monthly) L.push('\ud83d\udcb0 החל מ-*' + nis(c.monthly) + ' לחודש*');
    if (c.price) L.push('\ud83c\udff7\ufe0f מחיר הרכב: ' + nis(c.price));
    if (x.seats) L.push('\ud83d\udc65 ' + x.seats + ' מקומות ישיבה');
    //  ברכב יד שנייה יש צבע אחד בפועל; ברכב חדש הרשימה היא מה שאפשר
    //  להזמין. שדה colors בגיליון מכיל לעיתים תאריך אספקה במקום צבעים
    //  ("אפריל - מאי"), ולכן ערך שנראה כמו חודש נפסל במקום להישלח ללקוח.
    if (x.color) L.push('\ud83c\udfa8 צבע: ' + x.color);
    else if (x.colors && !MONTHS_RE.test(String(x.colors))) {
      var cl = String(x.colors).split(/\s*,\s*/).map(function (v) { return v.trim(); })
        .filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; });
      if (cl.length) L.push('\ud83c\udfa8 צבעים זמינים: ' + cl.join(', '));
    }
    if (x.security) L.push('\ud83d\udd10 מיגון: ' + x.security);
    if (x.accessories) L.push('\u2728 אביזרים: ' + x.accessories);
    if (x.km) L.push('\ud83d\udee3\ufe0f ' + Number(x.km).toLocaleString('en-US') + ' ק\u05f4מ');
    L.push('');
    L.push('\u2705 טיפולים, רישוי וצמיגים');
    L.push('\u2705 עד 100% מימון');
    L.push('');
    L.push('אשמח לענות על כל שאלה \ud83d\ude42');
    L.push('_' + (brandName || 'פרי דרייב') + '_');
    return L.join('\n');
  }

  //  ---------- הצעת מחיר ----------
  //  הנוסח של העסק. המספרים נשאבים מהמלאי ונשארים ניתנים
  //  לעריכה לפני השליחה: הצעה שיוצאת ללקוח חייבת לעבור
  //  דרך עין אנושית, ולא להישלח אוטומטית מהמאגר.
  function quoteText(c) {
    var x = c.extra || {};
    var nis = function (n) { return n ? Number(n).toLocaleString('en-US') + ' \u20aa' : ''; };
    var L = [];
    L.push('\ud83d\ude97 *הצעת מחיר: ' + [c.brand, c.name].filter(Boolean).join(' ') + '*');
    L.push('-----------------------------------------');
    L.push('*רמת גימור: ' + (c.trim || '\u2014') + '*');
    L.push('-----------------------------------------');
    //  רכב חדש מגיע מהגיליון בלי שנה, והשורה יצאה עם קו מפריד
    //  מיותם בתחילה. בונים מהחלקים שקיימים בפועל.
    var kmTxt = x.km ? Number(x.km).toLocaleString('en-US') + ' ק״מ' : '0 ק״מ';
    var yLine = [c.year, kmTxt].filter(Boolean).join(' | ');
    if (yLine) L.push(yLine);
    L.push('-----------------------------------------');
    L.push('');
    L.push('*## \ud83d\udcb0 פרטי העסקה . ##*');
    L.push('');
    L.push('\ud83d\udcb5 *מחיר מיוחד:* ' + nis(x.deal_price || c.price));
    L.push('');
    L.push('\ud83d\udcb3 *מקדמה חד-פעמית:* ' + nis(x.down_payment));
    L.push('');
    L.push('\ud83d\udcc6 *החזר חודשי משוער ל-36 חודשים:*');
    L.push('*החל מ\u05be* ' + nis(c.monthly));
    L.push('');
    L.push('---');
    L.push('');
    L.push('*## \ud83c\udf81 מה כלול בעסקה \u2013 ללא תוספת תשלום##*');
    L.push('');
    L.push('\u2705 חבילת אבזור במתנה');
    L.push('\u2705 אספקה מהירה \ud83d\ude9a');
    L.push('\u2705 עד 40% הנחה בביטוח חובה ומקיף \ud83d\udee1\ufe0f');
    L.push('\u2705 אגרת רישוי ראשונה כלולה \ud83e\uddfe');
    L.push('\u2705 פתיחת תיק ב-פרי דרייב \ud83d\udcc2');
    L.push('\u2705 איש מימון צמוד שידאג להשיג עבורך את הריביות הנמוכות ביותר \ud83e\udd1d');
    L.push('\u2705 אביזרים ומיגונים בהתאם לדרישות חברת הביטוח \ud83e\uddf0');
    L.push('\u2705 מערכת איתור לרכב \ud83d\udce1');
    L.push('\u2705 כל האפשרויות בתום התקופה \u2013 כפי שסוכם מראש \u2714\ufe0f');
    L.push('');
    L.push('---');
    L.push('');
    L.push('*## \ud83d\udcc9 תנאי המימון##*');
    L.push('');
    L.push('\ud83d\udcca *ריבית לעסקה: החל מ\u05be3.9%*');
    L.push('(בהתחייבות לריבית מהנמוכות בשוק הרכב)');
    L.push('');
    L.push('---');
    L.push('');
    L.push('*## \ud83d\udd04 האפשרויות בתום 36 חודשים##*');
    L.push('');
    L.push('*1\ufe0f\u20e3 להתחדש ברכב חדש* \ud83d\ude97\u2728');
    L.push('למכור לנו את הרכב, בכפוף לתקנון ולמחירון לוי יצחק.');
    L.push('*ללא מקדמה נוספת!*');
    L.push('');
    L.push('*2\ufe0f\u20e3 להחזיר את הרכב* \ud83d\udd01');
    L.push('בכפוף לתקנון ולמחירון לוי יצחק.');
    L.push('');
    L.push('*3\ufe0f\u20e3 לפרוס את יתרת התשלום* \ud83d\udcc6');
    L.push('מתשלום 1 עד 60 תשלומים נוספים.');
    L.push('');
    L.push('*4\ufe0f\u20e3 יציאה מוקדמת מהעסקה* \u23f3');
    L.push('החזרת הרכב בכפוף למחירון לוי יצחק ותשלום עבור 3 חודשי שימוש.');
    L.push('');
    L.push('---');
    L.push('');
    L.push('*## \ud83d\udcdd חשוב לדעת##*');
    L.push('');
    L.push('\u2714\ufe0f הרכב נרשם על שם הלקוח.');
    L.push('\u2714\ufe0f ניתן למכור את הרכב בשוק הפרטי בכל עת.');
    L.push('\u2714\ufe0f ניתן לפרוע את המימון באופן עצמאי בכל שלב.');
    L.push('\u2714\ufe0f ברכישת רכב נוסף מאיתנו בעוד 3 שנים \u2013 *לא תידרש מקדמה נוספת.* \ud83c\udfaf');
    L.push('');
    L.push('---');
    L.push('');
    L.push('לפרטים נוספים ולהתקדמות בתהליך, אני כאן לכל שאלה.');
    return L.join('\n');
  }

  //  גרסה מעוצבת ל-PDF. הטקסט זהה — רק סימוני ה-* של
  //  ווטסאפ מומרים להדגשה אמיתית.
  function quoteHtml(c, txt) {
    var body = esc(txt)
      .replace(/^-{5,}$/gm, '<hr>')
      .replace(/^---$/gm, '<hr>')
      .replace(/\*\*?##\s*(.+?)\s*##\*\*?/g, '<h3>$1</h3>')
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
      .split('\n').join('<br>');
    return '<div class="q-doc">' +
      (c.img ? '<img class="q-img" src="' + esc(carImg(c.img)) + '" alt="">' : '') +
      '<div class="q-body">' + body + '</div>' +
      '<div class="q-foot">פרי דרייב</div></div>';
  }

  //  ---------- עוזר המכירות ----------
  //  שולח ל-Claude את כל השיחה, את פרטי הליד ואת המלאי הרלוונטי,
  //  ומבקש ניסוחים מוכנים לשליחה. המלאי נשלח בלי מחיר קנייה
  //  ובלי עמלות — אותה רשימת היתר של כרטיס הרכב, כדי שגם הצעה
  //  שהסוכן מעתיק ישירות לא תחשוף נתונים פנימיים.
  var COACH_SYS = 'אתה איש מכירות בכיר ומנוסה בתחום ליסינג ומימון רכב בישראל. '
    + 'אתה מלווה נציג מכירות בשיחת ווטסאפ חיה עם לקוח. '
    + 'ענה תמיד בעברית. '
    + 'החזר שלוש הצעות לניסוח הודעה הבאה, כל אחת מוכנה לשליחה כמות שהיא. '
    + 'פורמט התשובה, בדיוק: שורה שמתחילה ב-### ואחריה כותרת קצרה (עד 4 מילים) שמסבירה את הגישה, '
    + 'ובשורות שמתחת נוסח ההודעה עצמה. בלי מרכאות ובלי הסברים נוספים. '
    + 'אחרי שלוש ההצעות הוסף שורה אחת שמתחילה ב-@@ עם קריאת מצב קצרה של השיחה ומה הצעד הבא. '
    + 'אל תמציא מחירים, דגמים או תנאים שלא נמסרו לך. '
    + 'אל תבטיח אישור מימון, ריבית סופית או מועד אספקה כוודאי. '
    + 'כשהנציג מציג את עצמו — השתמש בשם הנציג שנמסר לך, ולעולם אל תמציא שם אחר.';

  function salesCoach(t, body, btn) {
    var old = btn.textContent; btn.disabled = true; btn.textContent = 'חושב\u2026';
    db.from('wa_messages').select('direction,body,sent_at').eq('thread_id', t.id)
      .order('sent_at', { ascending: false }).limit(40).then(function (r) {
      var msgs = (r.data || []).reverse();
      var lead = t.lead_id && waLeads[t.lead_id];
      var hist = msgs.map(function (m) {
        return (m.direction === 'in' ? 'לקוח' : 'נציג') + ': ' + String(m.body || '[קובץ]');
      }).join('\n') || '(אין עדיין הודעות)';
      //  מלאי מקוצר ובלי שדות פנימיים
      var stock = waCars.slice(0, 90).map(function (c) {
        var x = c.extra || {};
        return '- ' + [c.brand, c.name, c.trim].filter(Boolean).join(' ') +
          (c.monthly ? ' | חודשי מ-' + c.monthly + ' \u20aa' : '') +
          (c.price ? ' | מחיר ' + c.price + ' \u20aa' : '') +
          (x.seats ? ' | ' + x.seats + ' מקומות' : '') +
          (c.fuel ? ' | ' + c.fuel : '');
      }).join('\n');
      //  הנציג מציג את עצמו בשמו האמיתי. בלי זה המודל ממציא שם.
      var me = (window.C2B && (window.C2B.fullName || window.C2B.userName)) || '';
      var ctx = (me ? 'שם הנציג שכותב עכשיו: ' + me + '\n\n' : '') +
        'פרטי הלקוח:\nשם: ' + (t.contact_name || 'לא ידוע') +
        (lead ? '\nסטטוס במערכת: ' + waStDef(lead.status || 'new').label +
                (lead.car ? '\nהתעניין ב: ' + lead.car : '') : '\n(אין עדיין ליד במערכת)') +
        '\n\nהשיחה עד כה:\n' + hist +
        '\n\nמלאי זמין (חלקי):\n' + stock;
      db.functions.invoke('ai-assistant', {
        body: { system: COACH_SYS, prompt: ctx + '\n\nמה כדאי לכתוב ללקוח עכשיו?' }
      }).then(function (rr) {
        btn.disabled = false; btn.textContent = old;
        var d = rr.data || {};
        var txt = d.text || d.answer || d.content || '';
        if (rr.error || d.error || !txt) {
          var msg = (d && d.error) || (rr.error && rr.error.message) || 'לא התקבלה תשובה';
          return coachBox('<p class="err">' + esc(/ANTHROPIC/.test(msg) ? 'חסר מפתח Claude בהגדרות' : msg) + '</p>', body);
        }
        coachBox(coachHtml(txt), body);
      }, function (e) {
        btn.disabled = false; btn.textContent = old;
        coachBox('<p class="err">' + esc(e.message || e) + '</p>', body);
      });
    });
  }

  //  פיצול לפי ### ו-@@. אם המודל חרג מהפורמט — מציגים
  //  את הטקסט כמות שהוא ולא מסכים מסך ריק.
  function coachHtml(txt) {
    var read = (String(txt).match(/^@@\s*(.+)$/m) || [])[1] || '';
    var parts = String(txt).split(/^###\s*/m).slice(1);
    if (!parts.length) return '<div class="coach-raw">' + esc(txt) + '</div>';
    window.__coach = [];
    var html = (read ? '<div class="coach-read">\ud83d\udd0e ' + esc(read) + '</div>' : '') +
      parts.map(function (p) {
        var lines = p.split('\n'), title = (lines.shift() || '').trim();
        var msgTxt = lines.join('\n').replace(/^@@.*$/m, '').trim();
        var i = window.__coach.push(msgTxt) - 1;
        return '<div class="coach-s"><div class="coach-t">' + esc(title) + '</div>' +
          '<div class="coach-m">' + esc(msgTxt) + '</div>' +
          '<button class="btn btn-sm" data-coachuse="' + i + '">השתמש בזה</button></div>';
      }).join('');
    return html;
  }

  function coachBox(html, body) {
    var bg = document.createElement('div'); bg.className = 'adm-bg';
    bg.innerHTML = '<div class="adm" style="max-width:560px"><div class="adm-hd">' +
      '<h3>\ud83e\udd16 עוזר מכירות</h3><button class="adm-x" data-admx>\u2715</button></div>' +
      '<div class="adm-body">' + html + '</div>' +
      '<div class="adm-meta"><span>הצעות בלבד — עברו על הנוסח לפני שליחה</span></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
      var u = e.target.closest('[data-coachuse]');
      if (u && body) {
        waPut(body, (window.__coach || [])[+u.dataset.coachuse]);
        bg.remove();
      }
    });
  }

  //  \u05d4\u05ea\u05d9\u05d1\u05d4 \u05e0\u05de\u05e6\u05d0\u05ea \u05de\u05d7\u05d3\u05e9 \u05d1\u05db\u05dc \u05d4\u05d6\u05e8\u05e7\u05d4 \u05d5\u05dc\u05d0 \u05de\u05d4\u05e4\u05e0\u05d9\u05d4 \u05e9\u05e0\u05ea\u05e4\u05e1\u05d4
  //  \u05db\u05e9\u05d4\u05e1\u05e8\u05d2\u05dc \u05e0\u05d1\u05e0\u05d4: \u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05de\u05d7\u05d3\u05e9 \u05e9\u05dc \u05d4\u05e9\u05d9\u05d7\u05d4 \u05de\u05d7\u05dc\u05d9\u05e3 \u05d0\u05ea \u05d4-textarea,
  //  \u05d5\u05db\u05ea\u05d9\u05d1\u05d4 \u05dc\u05d0\u05dc\u05de\u05e0\u05d8 \u05d4\u05de\u05e0\u05d5\u05ea\u05e7 \u05e0\u05e2\u05dc\u05de\u05ea \u05d1\u05dc\u05d9 \u05e9\u05d5\u05dd \u05e1\u05d9\u05de\u05df.
  function waPut(fallback, txt, sep) {
    var el = $('waBody') || fallback;
    if (!el) return false;
    el.value = (el.value ? el.value + (sep || '\n') : '') + txt;
    waDraft = el.value;
    el.focus();
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* \u05dc\u05d0 \u05e7\u05e8\u05d9\u05d8\u05d9 */ }
    return true;
  }

  function waTools(t, winLeft) {
    var cats = [];
    waTpl.forEach(function (x) { if (cats.indexOf(x.category || 'כללי') < 0) cats.push(x.category || 'כללי'); });
    var chips = waTpl.map(function (x) {
      return '<button class="wa-chip" data-tpl="' + esc(x.id) + '" title="' + esc(x.body.slice(0, 90)) + '">' + esc(x.title) + '</button>';
    }).join('');
    //  \u05de\u05d7\u05d5\u05e5 \u05dc\u05d7\u05dc\u05d5\u05df \u05d4\u05d8\u05e7\u05e1\u05d8 \u05d4\u05d7\u05d5\u05e4\u05e9\u05d9 \u05d7\u05e1\u05d5\u05dd \u05e2"\u05d9 Meta.
    //  \u05e2\u05d3\u05d9\u05e3 \u05dc\u05d4\u05e1\u05d1\u05d9\u05e8 \u05de\u05e8\u05d0\u05e9 \u05de\u05d0\u05e9\u05e8 \u05dc\u05e7\u05d1\u05dc \u05e9\u05d2\u05d9\u05d0\u05d4 \u05d0\u05d7\u05e8\u05d9 \u05dc\u05d7\u05d9\u05e6\u05d4.
    var open24 = winLeft > 0;
    var hrs = Math.floor(winLeft / 3600e3), mins = Math.round((winLeft % 3600e3) / 60000);
    var banner = open24
      ? (winLeft < 3 * 3600e3
          ? '<div class="wa-win">\u23f3 \u05e0\u05d5\u05ea\u05e8\u05d5 ' + hrs + ':' + String(mins).padStart(2, '0') +
            ' \u05e9\u05e2\u05d5\u05ea \u05dc\u05e9\u05dc\u05d9\u05d7\u05d4 \u05d7\u05d5\u05e4\u05e9\u05d9\u05ea. \u05d0\u05d7\u05e8 \u05db\u05da \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05dc\u05d5\u05d7 \u05e8\u05e7 \u05ea\u05d1\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05ea.</div>'
          : '')
      : '<div class="wa-win">\ud83d\udd12 \u05d7\u05dc\u05d5\u05df 24 \u05d4\u05e9\u05e2\u05d5\u05ea \u05e1\u05d2\u05d5\u05e8 \u2014 \u05d4\u05dc\u05e7\u05d5\u05d7 \u05dc\u05d0 \u05db\u05ea\u05d1 \u05d1-24 \u05d4\u05e9\u05e2\u05d5\u05ea \u05d4\u05d0\u05d7\u05e8\u05d5\u05e0\u05d5\u05ea.<br>' +
        '\u05d0\u05e4\u05e9\u05e8 \u05dc\u05e9\u05dc\u05d5\u05d7 \u05dc\u05d5 \u05e8\u05e7 <b>\u05ea\u05d1\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05ea</b>. \u05d6\u05d5 \u05de\u05d2\u05d1\u05dc\u05d4 \u05e9\u05dc Meta \u05d5\u05dc\u05d0 \u05e9\u05dc \u05d4\u05de\u05e2\u05e8\u05db\u05ea.</div>';
    return '<div class="wa-tools">' + banner +
      '<div class="wa-chips">' + (chips || '<span class="muted" style="font-size:12px">אין הודעות מהירות</span>') + '</div>' +
      '<div class="wa-compose">' +
        '<div class="wa-line">' +
        '<textarea class="inp" id="waBody" rows="2" placeholder="כתבו הודעה, או בחרו הודעה מהירה למעלה\u2026">' + esc(waDraft) + '</textarea>' +
          '<div class="wa-go">' +
          '<button class="btn' + (open24 ? ' btn-ghost btn-sm' : '') + '" id="waTplBtn" title="\u05e9\u05dc\u05d9\u05d7\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05ea">\ud83d\udce8 \u05ea\u05d1\u05e0\u05d9\u05ea</button>' +
          '<button class="btn btn-ghost btn-sm" id="waSched" title="תזמון לשעה מאוחרת יותר">\u23f0 תזמון</button>' +
          '<button class="btn btn-sm" id="waSend"' + (open24 ? '' : ' disabled title="\u05d7\u05dc\u05d5\u05df 24 \u05d4\u05e9\u05e2\u05d5\u05ea \u05e1\u05d2\u05d5\u05e8"') + '>\u05e9\u05dc\u05d7 \u27a4</button>' +
          '</div>' +
        '</div>' +
        '<div class="wa-btns">' +
          '<button class="btn btn-ghost btn-sm" id="waCoach" title="הצעות מעוזר המכירות לפי השיחה">\ud83e\udd16 עוזר מכירות</button>' +
          '<button class="btn btn-ghost btn-sm" id="waCarBtn" title="שליחת דגם מהמלאי">\ud83d\ude97 דגם</button>' +
          '<button class="btn btn-ghost btn-sm" id="waQuoteBtn" title="הצעת מחיר מלאה">\ud83d\udcb0 הצעת מחיר</button>' +
          '<button class="btn btn-ghost btn-sm" id="waContract" title="\u05de\u05d9\u05dc\u05d5\u05d9 \u05d4\u05e1\u05db\u05dd \u05dc\u05dc\u05e7\u05d5\u05d7">\ud83d\udcc4 \u05d4\u05e1\u05db\u05dd \u05dc\u05d7\u05ea\u05d9\u05de\u05d4</button>' +
          '<button class="btn btn-ghost btn-sm" id="waFileBtn" title="\u05e6\u05e8\u05d5\u05e3 \u05e7\u05d5\u05d1\u05e5 \u05de\u05d4\u05de\u05d7\u05e9\u05d1">\ud83d\udcce \u05e7\u05d5\u05d1\u05e5</button>' +
          '<button class="btn btn-ghost btn-sm" id="waApptBtn" title="\u05e7\u05d1\u05d9\u05e2\u05ea \u05e4\u05d2\u05d9\u05e9\u05d4 \u05e2\u05dd \u05d4\u05dc\u05e7\u05d5\u05d7">\ud83d\udcc5 \u05e4\u05d2\u05d9\u05e9\u05d4</button>' +
          '<button class="btn btn-ghost btn-sm" id="waTaskBtn" title="\u05de\u05e9\u05d9\u05de\u05d4 \u05dc\u05de\u05e2\u05e7\u05d1">\u2705 \u05de\u05e9\u05d9\u05de\u05d4</button>' +
          '<input type="file" id="waFileIn" style="display:none">' +
        '</div>' +
      '</div>' +
      '<div id="waOut" class="wa-out"></div>' +
    '</div>';
  }

  function wireTools(t, open24) {
    var body = $('waBody'), msg = null;
    var say = function (txt, good) {
      var o = $('waOut'); if (!o) return;
      o.innerHTML = '<span style="color:' + (good ? 'var(--ok)' : 'var(--danger)') + '">' + esc(txt) + '</span>';
    };
    //  {{שם}} מוחלף בשם איש הקשר, {{נציג}} בשם המשתמש המחובר
    var fill = function (s2) {
      return String(s2 || '')
        .split('{{שם}}').join((t.contact_name || '').split(' ')[0] || 'שלום')
        .split('{{נציג}}').join((window.C2B && window.C2B.fullName) || '')
        .split('{{רכב}}').join(t.lead_car || 'הרכב');
    };
    $('waPane').querySelectorAll('[data-tpl]').forEach(function (b) {
      b.onclick = function () {
        var x = waTpl.filter(function (y) { return y.id === this.dataset.tpl; }.bind(this))[0];
        if (!x) return;
        waPut(body, fill(x.body));
      };
    });
    if (body) body.oninput = function () { waDraft = this.value; };

    if ($('waCoach')) $('waCoach').onclick = function () { salesCoach(t, body, this); };
    if ($('waCarBtn')) $('waCarBtn').onclick = function () { carPicker(t, body, false); };
    if ($('waQuoteBtn')) $('waQuoteBtn').onclick = function () { carPicker(t, body, true); };
    if ($('waContract')) $('waContract').onclick = function () { waContract(t, this, say); };
    if ($('waTplBtn')) $('waTplBtn').onclick = function () { tplPicker(t, this, say); };
    if ($('waFileBtn')) $('waFileBtn').onclick = function () { $('waFileIn').click(); };
    if ($('waFileIn')) $('waFileIn').onchange = function () { waSendFile(t, this, say); };
    if ($('waApptBtn')) $('waApptBtn').onclick = function () { waAppt(t, this, say); };
    if ($('waTaskBtn')) $('waTaskBtn').onclick = function () { waTask(t, this, say); };
    if ($('waSched')) $('waSched').onclick = function () { schedBox(t, body, say); };
    if ($('waSend')) $('waSend').onclick = function () {
      sendMsg(t, body.value, null, waPickedCar, say, this);
    };
    //  Ctrl+Enter שולח, כמו בכל לקוח ווטסאפ שולחני
    if (body) body.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && $('waSend')) $('waSend').click();
    });
    loadOutbox(t);
    //  מחוץ לחלון 24 השעות אין מה לעשות עם תיבת הטקסט, ולכן
    //  רשימת התבניות נפתחת מעצמה במקום לחכות שהנציג יגלה את הכפתור.
    //  פעם אחת לשיחה, כדי שלא ייפתח שוב בכל רינדור.
    if (!open24 && $('waTplBtn') && waAutoTpl !== t.id) {
      waAutoTpl = t.id;
      setTimeout(function () { if ($('waTplBtn')) $('waTplBtn').click(); }, 400);
    }
  }

  //  השליחה עוברת דרך edge function ולא ישירות מהדפדפן: מפתח
  //  ה-API של Heyy הוא מפתח כתיבה לכל חשבון הווטסאפ, ובצד-לקוח
  //  הוא היה גלוי לכל מי שפותח את המסך.
  function sendMsg(t, text, when, car, say, btn) {
    text = String(text || '').trim();
    if (!text && !car) return say('ההודעה ריקה', false);
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'שולח\u2026'; }
    db.functions.invoke('heyy-send', {
      body: {
        thread_id: t.id, body: text,
        media_url: (car && car.img) ? carImg(car.img) : null,
        scheduled_at: when || null,
      }
    }).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = old; }
      var d = r.data || {};
      if (r.error || d.error) {
        var m = d.error || (r.error && r.error.message) || 'השליחה נכשלה';
        return say(/HEYY_API_KEY/.test(m) ? 'חסר מפתח API של Heyy בהגדרות' : m, false);
      }
      say(when ? '\u2714 תוזמן ל-' + fmtDateTime(when) : '\u2714 נשלח' + (d.note ? ' · ' + d.note : ''), true);
      var b = $('waBody'); if (b) { b.value = ''; waDraft = ''; }
      waPickedCar = null;
      openThread(t);
    }, function (e) {
      if (btn) { btn.disabled = false; btn.textContent = old; }
      say('שגיאת רשת: ' + (e && e.message || e), false);
    });
  }

  function queueMsg(t, text, when, car, say) {
    if (!String(text || '').trim()) return say('ההודעה ריקה', false);
    db.from('wa_outbox').insert({
      thread_id: t.id, body: text, kind: car ? 'car' : 'text', car_id: (car && car.id) || null,
      media_url: (car && car.img) || null,
      scheduled_at: when || null, created_by: (window.C2B && window.C2B.userId) || null,
    }).then(function (r) {
      if (r.error) return say(r.error.message, false);
      say(when ? '\u2714 תוזמן ל-' + fmtDateTime(when) : '\u2714 נוסף לתור', true);
      var b = $('waBody'); if (b) { b.value = ''; waDraft = ''; }
      waPickedCar = null;
      loadOutbox(t);
    });
  }

  //  \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea \u05de\u05ea\u05d5\u05d6\u05de\u05e0\u05d5\u05ea \u05de\u05de\u05ea\u05d9\u05e0\u05d5\u05ea \u05d0\u05e6\u05dc\u05e0\u05d5 \u05d5\u05dc\u05d0 \u05d0\u05e6\u05dc Heyy, \u05db\u05d3\u05d9
  //  \u05e9\u05d0\u05e4\u05e9\u05e8 \u05d9\u05d4\u05d9\u05d4 \u05dc\u05e8\u05d0\u05d5\u05ea \u05d5\u05dc\u05d1\u05d8\u05dc \u05e2\u05d3 \u05e8\u05d2\u05e2 \u05d4\u05e9\u05dc\u05d9\u05d7\u05d4 \u2014 \u05dc-Heyy \u05d0\u05d9\u05df endpoint
  //  \u05dc\u05d1\u05d9\u05d8\u05d5\u05dc \u05d4\u05d5\u05d3\u05e2\u05d4 \u05e9\u05db\u05d1\u05e8 \u05ea\u05d5\u05d6\u05de\u05e0\u05d4 \u05d0\u05e6\u05dc\u05dd.
  function loadOutbox(t) {
    var box = $('waOut'); if (!box) return;
    db.from('wa_outbox').select('id,body,scheduled_at,status,created_at,kind,error')
      .eq('thread_id', t.id).in('status', ['queued', 'failed'])
      .order('scheduled_at', { ascending: true }).limit(20)
      .then(function (r) {
        var rows = r.data || [];
        if (!rows.length) { box.innerHTML = ''; return; }
        var q = rows.filter(function (x) { return x.status === 'queued'; });
        box.innerHTML = '<div class="wa-queue"><b>\u23f0 ' + q.length + ' \u05de\u05ea\u05d5\u05d6\u05de\u05e0\u05d5\u05ea</b>' +
          (rows.length > q.length ? '<span class="muted"> \u00b7 \u05d5-' + (rows.length - q.length) + ' \u05e9\u05e0\u05db\u05e9\u05dc\u05d5</span>' : '') +
          rows.map(function (x) {
            var late = x.status === 'queued' && x.scheduled_at && new Date(x.scheduled_at) < new Date();
            return '<div class="wa-q' + (x.status === 'failed' ? ' bad' : '') + '">' +
              '<span>' + (x.kind === 'car' ? '\ud83d\ude97 ' : x.kind === 'template' ? '\ud83d\udce8 ' : '') +
                esc(String(x.body || '\u05ea\u05d1\u05e0\u05d9\u05ea').replace(/\n/g, ' ').slice(0, 70)) + '</span>' +
              '<span class="muted">' + (x.status === 'failed'
                  ? '\u26a0 ' + esc(String(x.error || '\u05e0\u05db\u05e9\u05dc\u05d4').slice(0, 40))
                  : (x.scheduled_at ? (late ? '\u05e0\u05e9\u05dc\u05d7\u05ea\u2026 ' : '') + esc(fmtDateTime(x.scheduled_at)) : '\u05de\u05d9\u05d3')) + '</span>' +
              '<button class="btn btn-ghost btn-sm" data-qdel="' + esc(x.id) + '">\u05de\u05d7\u05e7</button></div>';
          }).join('') + '</div>';
        box.querySelectorAll('[data-qdel]').forEach(function (b) {
          b.onclick = function () {
            var self = this; self.disabled = true; self.textContent = '\u05de\u05d5\u05d7\u05e7\u2026';
            //  \u05de\u05d7\u05d9\u05e7\u05d4 \u05d5\u05dc\u05d0 \u05e1\u05d9\u05de\u05d5\u05df \u05db\u05de\u05d1\u05d5\u05d8\u05dc: \u05d4\u05e9\u05d5\u05e8\u05d4 \u05dc\u05d0 \u05e0\u05e9\u05dc\u05d7\u05d4 \u05de\u05e2\u05d5\u05dc\u05dd \u05d5\u05d0\u05d9\u05df
            //  \u05dc\u05d4 \u05e2\u05e8\u05da \u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9. \u05e9\u05d5\u05e8\u05d4 \u05e9\u05db\u05df \u05e0\u05e9\u05dc\u05d7\u05d4 \u05db\u05d1\u05e8 \u05d0\u05d9\u05e0\u05d4 queued.
            db.from('wa_outbox').delete().eq('id', self.dataset.qdel).in('status', ['queued', 'failed'])
              .then(function () { loadOutbox(t); });
          };
        });
      });
  }

  function schedBox(t, body, say) {
    if (!body.value.trim()) return say('כתבו הודעה לפני התזמון', false);
    var bg = document.createElement('div'); bg.className = 'adm-bg';
    var d = new Date(Date.now() + 3600000);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var val = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    bg.innerHTML = '<div class="adm" style="max-width:420px"><div class="adm-hd"><h3>\u23f0 תזמון הודעה</h3>' +
      '<button class="adm-x" data-admx>\u2715</button></div><div class="adm-body">' +
      '<div class="field"><label>מתי לשלוח</label><input class="inp" type="datetime-local" id="waWhen" value="' + val + '"></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<button class="btn btn-ghost btn-sm" data-in="60">בעוד שעה</button>' +
        '<button class="btn btn-ghost btn-sm" data-in="180">בעוד 3 שעות</button>' +
        '<button class="btn btn-ghost btn-sm" data-in="1440">מחר באותה שעה</button>' +
        '<button class="btn btn-ghost btn-sm" data-morning="1">מחר ב-9:00</button></div>' +
      '<div class="sec-note" style="margin:0 0 12px">' + esc(String(body.value).slice(0, 160)) + '</div>' +
      '<button class="btn" id="waSchedOk">תזמן</button></div></div>';
    document.body.appendChild(bg);
    var close = function () { bg.remove(); };
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return close();
      var q = e.target.closest('[data-in]');
      if (q) { var n = new Date(Date.now() + (+q.dataset.in) * 60000);
        bg.querySelector('#waWhen').value = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + 'T' + pad(n.getHours()) + ':' + pad(n.getMinutes()); }
      if (e.target.closest('[data-morning]')) { var m = new Date(); m.setDate(m.getDate() + 1); m.setHours(9, 0, 0, 0);
        bg.querySelector('#waWhen').value = m.getFullYear() + '-' + pad(m.getMonth() + 1) + '-' + pad(m.getDate()) + 'T09:00'; }
      if (e.target.id === 'waSchedOk') {
        var v = bg.querySelector('#waWhen').value;
        if (!v) return;
        close(); sendMsg(t, body.value, new Date(v).toISOString(), waPickedCar, say, null);
      }
    });
  }

  //  ---------- בורר הדגמים ----------
  function carPicker(t, body, quoteMode) {
    var bg = document.createElement('div'); bg.className = 'adm-bg';
    var render = function (q) {
      var list = waCars.filter(function (c) {
        if (!q) return true;
        return ((c.brand || '') + ' ' + (c.name || '') + ' ' + (c.trim || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      }).slice(0, 60);
      return list.map(function (c) {
        return '<div class="wa-car" data-car="' + esc(c.id) + '">' +
          (c.img ? '<img src="' + esc(carImg(c.img)) + '" alt="">' : '<span class="noimg">\ud83d\ude97</span>') +
          '<span class="mid"><b>' + esc([c.brand, c.name].filter(Boolean).join(' ')) + '</b>' +
            '<span class="muted">' + esc([c.trim, c.year, c.condition].filter(Boolean).join(' \u00b7 ')) + '</span></span>' +
          '<span class="pr">' + (c.monthly ? Number(c.monthly).toLocaleString('en-US') + ' \u20aa/ח' : (c.price ? Number(c.price).toLocaleString('en-US') + ' \u20aa' : '')) + '</span></div>';
      }).join('') || '<p class="empty">לא נמצא דגם</p>';
    };
    bg.innerHTML = '<div class="adm" style="max-width:620px"><div class="adm-hd"><h3>' +
      (quoteMode ? '\ud83d\udcb0 הצעת מחיר' : '\ud83d\ude97 שליחת דגם מהמלאי') + '</h3>' +
      '<button class="adm-x" data-admx>\u2715</button></div><div class="adm-body">' +
      '<input class="inp" id="waCarQ" placeholder="חיפוש דגם\u2026" style="margin-bottom:10px">' +
      '<div class="wa-cars" id="waCarList">' + render('') + '</div>' +
      '<div id="waCarPrev"></div></div></div>';
    document.body.appendChild(bg);
    bg.querySelector('#waCarQ').addEventListener('input', function () {
      bg.querySelector('#waCarList').innerHTML = render(this.value);
    });
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
      var row = e.target.closest('[data-car]');
      if (row) {
        var c = waCars.filter(function (x) { return x.id === row.dataset.car; })[0];
        if (!c) return;
        var txt = quoteMode ? quoteText(c) : carCard(c, null);
        bg.querySelector('#waCarPrev').innerHTML =
          '<div class="sec-title" style="margin-top:14px">תצוגה מקדימה</div>' +
          '<div class="wa-preview">' + (c.img ? '<img src="' + esc(carImg(c.img)) + '" alt="">' : '') +
            '<div class="wa-m out" style="max-width:100%">' + esc(txt) + '</div></div>' +
          '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">' +
            '<button class="btn btn-sm" id="waCarUse">הוספה להודעה</button>' +
            '<button class="btn btn-ghost btn-sm" id="waCarCopy">\ud83d\udccb העתקה</button>' +
            (quoteMode ? '<button class="btn btn-ghost btn-sm" id="waQuotePdf">\ud83d\udcc4 הורדה כ-PDF</button>' : '') +
            '<span class="muted" style="font-size:12px">בלי מחיר קנייה ובלי נתונים פנימיים</span></div>' +
          (quoteMode ? '<div id="waQDoc" style="position:fixed;left:-9999px;top:0">' + quoteHtml(c, txt) + '</div>' : '');
        bg.querySelector('#waCarUse').onclick = function () {
          waPut(body, txt, '\n\n');
          //  נשמר כדי שהתור יקבל גם את מזהה הרכב ואת התמונה: כשחיבור
          //  השליחה יעלה, הכרטיס צריך לצאת עם התמונה ולא כטקסט בלבד.
          waPickedCar = { id: c.id, img: c.img || null };
          bg.remove(); body.focus();
        };
        bg.querySelector('#waCarCopy').onclick = function () {
          //  הכתובת המקורית מחזירה 403 מחוץ לאתר המקור; ה-proxy פתוח.
          navigator.clipboard.writeText(txt + (c.img ? '\n' + carImg(c.img) : ''));
          this.textContent = '\u2714 הועתק';
        };
        var pdfBtn = bg.querySelector('#waQuotePdf');
        if (pdfBtn) pdfBtn.onclick = function () {
          if (!window.C2B_pdf) return alert('מנגנון ה-PDF לא נטען');
          window.C2B_pdf(bg.querySelector('.q-doc'),
            'הצעת מחיר - ' + [c.brand, c.name].filter(Boolean).join(' '), this);
        };
      }
    });
  }

  function heyyHead(nums, numById, isAdm, n) {
    var pick = nums.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (heyyNum === x.id ? ' selected' : '') + '>' +
        esc(x.label || x.phone || 'ערוץ') + (x.phone ? ' \u00b7 ' + esc(x.phone) : '') + (x.active ? '' : ' (כבוי)') + '</option>';
    }).join('');
    return '<div class="row-between" style="align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">' +
      '<div><h2 style="margin:0 0 2px">\ud83d\udfe2 Hey \u00b7 WhatsApp</h2>' +
        '<p class="muted" style="margin:0;font-size:13px">' +
          (isAdm ? 'כל הערוצים המנוהלים' : 'הערוץ שלך: <b>' + esc((numById[heyyNum] || {}).label || (numById[heyyNum] || {}).phone || '\u2014') + '</b>') +
          ' \u00b7 ' + n + ' שיחות</p></div>' +
      '<div class="row" style="gap:8px;align-items:center">' +
      (isAdm ? '<select class="inp" id="heyyNum" style="width:auto;min-width:210px">' +
        '<option value="">כל הערוצים</option>' + pick + '</select>' : '') +
      '<button class="btn btn-sm" id="waNewChat">\u2795 \u05e9\u05d9\u05d7\u05d4 \u05d7\u05d3\u05e9\u05d4</button></div></div>';
  }
  //  ---------- סטטוס הליד בתוך השיחה ----------
  //  אותו שדה בדיוק שמוצג במסך הלידים. שינוי כאן עובר
  //  דרך changeStatus של מסך הלידים, ולכן נרשם בציר הזמן ומריץ
  //  אוטומציות בדיוק כמו שינוי משם.
  //  שיחה שלא התאימה לשום ליד — פתיחת ליד מתוך השיחה,
  //  כדי שלפונה בווטסאפ יהיה סטטוס, בעלים והיסטוריה כמו לכל ליד.
  //  \u05dc\u05d9\u05d3 \u05e9\u05e0\u05d5\u05dc\u05d3 \u05d1\u05d5\u05d5\u05d8\u05e1\u05d0\u05e4 \u05e0\u05d5\u05e9\u05d0 \u05d9\u05d9\u05d7\u05d5\u05e1 \u05de\u05dc\u05d0
  //  \u05db\u05d1\u05e8 \u05d1\u05e8\u05d2\u05e2 \u05d4\u05d9\u05e6\u05d9\u05e8\u05d4. \u05d1\u05dc\u05e2\u05d3\u05d9\u05d5 \u05d4\u05d5\u05d0 \u05e0\u05d5\u05e4\u05dc \u05d1\u05d3\u05d5\u05d7\u05d5\u05ea
  //  \u05dc\u05ea\u05d5\u05da "\u05dc\u05dc\u05d0 \u05d9\u05d9\u05d7\u05d5\u05e1". \u05d4\u05e2\u05e8\u05db\u05d9\u05dd \u05d1\u05d0\u05d5\u05ea\u05d9\u05d5\u05ea \u05e7\u05d8\u05e0\u05d5\u05ea
  //  \u05db\u05de\u05d5 \u05d1\u05e9\u05d0\u05e8 \u05d4\u05de\u05e2\u05e8\u05db\u05ea (seo, facebook), \u05d0\u05d7\u05e8\u05ea \u05d4\u05e7\u05d9\u05d1\u05d5\u05e5
  //  \u05d1\u05d3\u05d5\u05d7\u05d5\u05ea \u05de\u05e4\u05e6\u05dc \u05d0\u05d5\u05ea\u05dd \u05dc\u05e9\u05ea\u05d9 \u05e9\u05d5\u05e8\u05d5\u05ea \u05e0\u05e4\u05e8\u05d3\u05d5\u05ea.
  function waNewLead(t, cb) {
    var phone = String(t.contact_phone || '');
    if (phone.indexOf('972') === 0) phone = '0' + phone.slice(3);
    db.from('leads').insert({
      name: t.contact_name || '\u05e4\u05d5\u05e0\u05d4 \u05d1\u05d5\u05d5\u05d8\u05e1\u05d0\u05e4', phone: phone,
      source: '\u05d5\u05d5\u05d0\u05d8\u05e1\u05d0\u05e4', status: 'new',
      brand: 'פרי דרייב', marketing_company: '\u05e9\u05d9\u05d5\u05d5\u05e7 \u05e4\u05e0\u05d9\u05de\u05d9',
      utm_source: 'whatsapp', utm_medium: 'seo',
    }).select('id,status,name,car').single().then(function (r) {
      if (r.error) return cb(null, r.error.message);
      db.from('wa_threads').update({ lead_id: r.data.id }).eq('id', t.id).then(function () {
        t.lead_id = r.data.id; waLeads[r.data.id] = r.data; cb(r.data.id, null);
      });
    });
  }

  function waCreateLead(t, btn) {
    btn.disabled = true; btn.textContent = '\u05d9\u05d5\u05e6\u05e8\u2026';
    waNewLead(t, function (id, err) {
      if (err) { btn.disabled = false; btn.textContent = '\u2795 \u05e6\u05d5\u05e8 \u05dc\u05d9\u05d3'; return alert('\u05e9\u05d2\u05d9\u05d0\u05d4: ' + err); }
      renderHeyy();
    });
  }

  //  \u05d4\u05d4\u05e1\u05db\u05dd \u05e0\u05e9\u05e2\u05df \u05e2\u05dc \u05dc\u05d9\u05d3, \u05d5\u05dc\u05db\u05df \u05e9\u05d9\u05d7\u05d4 \u05d1\u05dc\u05d9 \u05dc\u05d9\u05d3
  //  \u05de\u05e7\u05d1\u05dc\u05ea \u05d0\u05d7\u05d3 \u05e2\u05db\u05e9\u05d9\u05d5, \u05d1\u05de\u05e7\u05d5\u05dd \u05dc\u05d4\u05e6\u05d9\u05d2 \u05e9\u05d2\u05d9\u05d0\u05d4 \u05d5\u05dc\u05d4\u05e9\u05d0\u05d9\u05e8
  //  \u05d0\u05ea \u05d4\u05e0\u05e6\u05d9\u05d2 \u05dc\u05d7\u05e4\u05e9 \u05d0\u05ea \u05d4\u05db\u05e4\u05ea\u05d5\u05e8 \u05d4\u05e0\u05db\u05d5\u05df \u05d1\u05de\u05e1\u05da \u05d0\u05d7\u05e8.
  function waContract(t, btn, say) {
    if (!window.C2B_openContract) return say('\u05de\u05e1\u05da \u05d4\u05d4\u05e1\u05db\u05de\u05d9\u05dd \u05dc\u05d0 \u05e0\u05d8\u05e2\u05df', false);
    if (t.lead_id) return window.C2B_openContract(t.lead_id);
    btn.disabled = true; btn.textContent = '\u05d9\u05d5\u05e6\u05e8 \u05dc\u05d9\u05d3\u2026';
    waNewLead(t, function (leadId, err) {
      btn.disabled = false; btn.textContent = '\ud83d\udcc4 \u05d4\u05e1\u05db\u05dd \u05dc\u05d7\u05ea\u05d9\u05de\u05d4';
      if (err) return say(err, false);
      window.C2B_openContract(leadId);
    });
  }

  //  \u05d4\u05ea\u05d1\u05e0\u05d9\u05d5\u05ea \u05e0\u05de\u05e9\u05db\u05d5\u05ea \u05de-Heyy \u05d1\u05db\u05dc \u05e4\u05ea\u05d9\u05d7\u05d4 \u05d5\u05dc\u05d0 \u05e0\u05e9\u05de\u05e8\u05d5\u05ea \u05d0\u05e6\u05dc\u05e0\u05d5:
  //  \u05d0\u05d9\u05e9\u05d5\u05e8 \u05e9\u05dc Meta \u05e0\u05e9\u05dc\u05dc \u05d5\u05de\u05ea\u05d7\u05d3\u05e9 \u05d1\u05dc\u05d9 \u05e9\u05e0\u05d3\u05e2, \u05d5\u05e8\u05e9\u05d9\u05de\u05d4 \u05de\u05d9\u05d5\u05e9\u05e0\u05ea
  //  \u05d4\u05d9\u05d9\u05ea\u05d4 \u05de\u05e6\u05d9\u05d2\u05d4 \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05ea\u05d9\u05e4\u05d5\u05dc \u05d1\u05e9\u05dc\u05d9\u05d7\u05d4.
  function tplPicker(t, btn, say) {
    var old = btn.textContent; btn.disabled = true; btn.textContent = '\u05d8\u05d5\u05e2\u05df\u2026';
    db.functions.invoke('heyy-send', { body: { action: 'templates', thread_id: t.id } }).then(function (r) {
      btn.disabled = false; btn.textContent = old;
      var d = r.data || {};
      if (r.error || d.error) return say(d.error || (r.error && r.error.message) || '\u05d8\u05e2\u05d9\u05e0\u05ea \u05d4\u05ea\u05d1\u05e0\u05d9\u05d5\u05ea \u05e0\u05db\u05e9\u05dc\u05d4', false);
      var list = d.templates || [];
      var bg = document.createElement('div'); bg.className = 'adm-bg';
      bg.innerHTML = '<div class="adm" style="max-width:520px"><div class="adm-hd">' +
        '<h3>\ud83d\udce8 \u05e9\u05dc\u05d9\u05d7\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea</h3><button class="adm-x" data-admx>\u2715</button></div>' +
        '<div class="adm-body">' + (list.length
          ? list.map(function (x, i) {
              return '<div class="tpl-row" data-tpl-i="' + i + '"><b>' + esc(x.name || '\u05ea\u05d1\u05e0\u05d9\u05ea') + '</b>' +
                (x.language ? ' <span class="muted" style="font-size:11.5px">' + esc(x.language) + '</span>' : '') +
                '<div class="bd">' + esc(String(x.body || '').slice(0, 240)) + '</div></div>';
            }).join('')
          : '<p class="empty">\u05d0\u05d9\u05df \u05ea\u05d1\u05e0\u05d9\u05d5\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05d5\u05ea \u05dc\u05e2\u05e8\u05d5\u05e5 \u05d4\u05d6\u05d4.<br>' +
            '\u05d9\u05d5\u05e6\u05e8\u05d9\u05dd \u05d0\u05d5\u05ea\u05df \u05d1-Heyy \u05ea\u05d7\u05ea Message templates \u05d5\u05e9\u05d5\u05dc\u05d7\u05d9\u05dd \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8 Meta.</p>') +
        '</div></div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', function (e) {
        if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
        var row = e.target.closest('[data-tpl-i]'); if (!row) return;
        var tpl = list[+row.dataset.tplI]; bg.remove(); tplVars(t, tpl, say);
      });
    });
  }

  //  \u05dc\u05ea\u05d1\u05e0\u05d9\u05ea \u05d9\u05db\u05d5\u05dc\u05d9\u05dd \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05e9\u05ea\u05e0\u05d9\u05dd. \u05de\u05de\u05dc\u05d0\u05d9\u05dd \u05de\u05e8\u05d0\u05e9 \u05de\u05d4 \u05e9\u05d9\u05d3\u05d5\u05e2
  //  \u05dc\u05e0\u05d5 \u2014 \u05e9\u05dd \u05d4\u05dc\u05e7\u05d5\u05d7 \u05d5\u05e9\u05dd \u05d4\u05e0\u05e6\u05d9\u05d2 \u05d4\u05de\u05d7\u05d5\u05d1\u05e8 \u2014 \u05db\u05d3\u05d9 \u05dc\u05d0 \u05dc\u05d4\u05e7\u05dc\u05d9\u05d3 \u05e9\u05d5\u05d1.
  function tplVars(t, tpl, say) {
    var vars = tpl.variables || [];
    var me = (window.C2B && (window.C2B.fullName || window.C2B.userName)) || '';
    var lead = t.lead_id && waLeads[t.lead_id];
    var bodyTxt = String(tpl.body || '');
    //  ההקשר: 24 התווים שלפני המשתנה בתבנית. "\u05e9\u05dc\u05d5\u05dd {{1}}" \u2190 "\u05e9\u05dc\u05d5\u05dd"
    var ctxOf = function (v) {
      var i = bodyTxt.indexOf('{{' + v + '}}');
      if (i < 0) i = bodyTxt.search(new RegExp('\\\\{\\\\{\\\\s*' + v + '\\\\s*\\\\}\\\\}'));
      if (i < 0) return '';
      var before = bodyTxt.slice(Math.max(0, i - 24), i).trim();
      var after = bodyTxt.slice(i).replace(/^\{\{[^}]*\}\}/, '').slice(0, 14).trim();
      return (before ? '\u2026' + before + ' ' : '') + '[' + v + ']' + (after ? ' ' + after + '\u2026' : '');
    };
    //  ניחוש לפי המיקום בתבניות שלנו: הראשון הוא הלקוח, השני הנציג
    var guess = function (v, i) {
      var k = String(v).toLowerCase();
      if (/agent|rep|\u05e0\u05e6\u05d9\u05d2|\u05e1\u05d5\u05db\u05df/.test(k)) return me;
      if (/phone|\u05d8\u05dc\u05e4\u05d5\u05df/.test(k)) return t.contact_phone || '';
      if (/name|\u05e9\u05dd|first/.test(k)) return t.contact_name || '';
      var c = ctxOf(v);
      if (/\u05db\u05d0\u05df$|\u05db\u05d0\u05df \[/.test(c)) return me;
      if (i === 0) return t.contact_name || '';
      if (i === 1) return me;
      if (i === 2 && lead && lead.car) return lead.car;
      return '';
    };
    if (!vars.length) return tplSend(t, tpl, {}, say);
    var bg = document.createElement('div'); bg.className = 'adm-bg';
    bg.innerHTML = '<div class="adm" style="max-width:440px"><div class="adm-hd">' +
      '<h3>' + esc(tpl.name || '\u05ea\u05d1\u05e0\u05d9\u05ea') + '</h3><button class="adm-x" data-admx>\u2715</button></div>' +
      '<div class="adm-body"><div class="sec-note" id="tplPrev" style="margin:0 0 12px">' + esc(String(tpl.body || '')) + '</div>' +
      vars.map(function (v, i) {
        return '<div class="field"><label>' + esc(ctxOf(v) || v) + '</label>' +
          '<input class="inp" data-var="' + esc(v) + '" value="' + esc(guess(v, i)) + '"></div>';
      }).join('') +
      '<button class="btn" id="tplGo">\u05e9\u05dc\u05d7</button></div></div>';
    document.body.appendChild(bg);
    //  תצוגה מקדימה חיה: הנציג רואה בדיוק מה הלקוח יקבל
    var paintPrev = function () {
      var out = bodyTxt;
      bg.querySelectorAll('[data-var]').forEach(function (i) {
        out = out.split('{{' + i.dataset.var + '}}').join(i.value || '[' + i.dataset.var + ']');
      });
      bg.querySelector('#tplPrev').textContent = out;
    };
    bg.querySelectorAll('[data-var]').forEach(function (i) { i.addEventListener('input', paintPrev); });
    paintPrev();
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
      if (!e.target.closest('#tplGo')) return;
      var vals = {}, missing = 0;
      bg.querySelectorAll('[data-var]').forEach(function (i) {
        var v = String(i.value || '').trim();
        if (!v) { missing++; i.style.borderColor = 'var(--danger)'; }
        vals[i.dataset.var] = v;
      });
      //  משתנה ריק נשלח ללקוח כשם המשתנה עצמו ("שלום 1") — עוצרים כאן
      if (missing) { var e2 = bg.querySelector('.err') || bg.querySelector('.adm-body');
        var w = bg.querySelector('#tplWarn');
        if (!w) { w = document.createElement('p'); w.id = 'tplWarn'; w.className = 'err'; e2.appendChild(w); }
        w.textContent = '\u05d9\u05e9 \u05dc\u05de\u05dc\u05d0 \u05d0\u05ea \u05db\u05dc \u05d4\u05e9\u05d3\u05d5\u05ea \u2014 \u05e9\u05d3\u05d4 \u05e8\u05d9\u05e7 \u05d9\u05d9\u05e9\u05dc\u05d7 \u05dc\u05dc\u05e7\u05d5\u05d7 \u05db\u05de\u05e1\u05e4\u05e8';
        return; }
      bg.remove(); tplSend(t, tpl, vals, say);
    });
  }

  function tplSend(t, tpl, vals, say) {
    say('\u05e9\u05d5\u05dc\u05d7 \u05ea\u05d1\u05e0\u05d9\u05ea\u2026', true);
    db.functions.invoke('heyy-send', {
      body: { thread_id: t.id, template_id: tpl.id, variables: vals }
    }).then(function (r) {
      var d = r.data || {};
      if (r.error || d.error) return say(d.error || (r.error && r.error.message) || '\u05d4\u05e9\u05dc\u05d9\u05d7\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4', false);
      say('\u2714 \u05d4\u05ea\u05d1\u05e0\u05d9\u05ea \u05e0\u05e9\u05dc\u05d7\u05d4', true);
      openThread(t);
    });
  }

  //  \u05e4\u05ea\u05d9\u05d7\u05ea \u05e9\u05d9\u05d7\u05d4 \u05d9\u05d6\u05d5\u05de\u05d4: \u05e0\u05d5\u05e6\u05e8 \u05dc\u05d9\u05d3 \u05e2\u05dd \u05d0\u05d5\u05ea\u05d5 \u05d9\u05d9\u05d7\u05d5\u05e1 \u05e9\u05dc \u05dc\u05d9\u05d3 \u05e0\u05db\u05e0\u05e1
  //  \u05de\u05d5\u05d5\u05d8\u05e1\u05d0\u05e4, \u05d5\u05e9\u05d9\u05d7\u05d4 \u05e8\u05d9\u05e7\u05d4 \u05e9\u05de\u05d7\u05db\u05d4 \u05dc\u05d4\u05d5\u05d3\u05e2\u05d4 \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d4. \u05de\u05db\u05d9\u05d5\u05d5\u05df \u05e9\u05d4\u05dc\u05e7\u05d5\u05d7
  //  \u05e2\u05d5\u05d3 \u05dc\u05d0 \u05db\u05ea\u05d1 \u2014 \u05d7\u05dc\u05d5\u05df 24 \u05d4\u05e9\u05e2\u05d5\u05ea \u05e1\u05d2\u05d5\u05e8, \u05d5\u05d4\u05e4\u05ea\u05d9\u05d7\u05d4 \u05d7\u05d9\u05d9\u05d1\u05ea \u05dc\u05d4\u05d9\u05d5\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea.
  function newChatBox(nums, isAdm) {
    var usable = nums.filter(function (n) { return n.channel_id && n.active !== false; });
    if (!usable.length) return alert('\u05d0\u05d9\u05df \u05de\u05e1\u05e4\u05e8 \u05de\u05d7\u05d5\u05d1\u05e8 \u05dc-Heyy');
    var bg = document.createElement('div'); bg.className = 'adm-bg';
    bg.innerHTML = '<div class="adm" style="max-width:420px"><div class="adm-hd">' +
      '<h3>\u2795 \u05e9\u05d9\u05d7\u05d4 \u05d5\u05dc\u05d9\u05d3 \u05d7\u05d3\u05e9</h3><button class="adm-x" data-admx>\u2715</button></div>' +
      '<div class="adm-body">' +
      (usable.length > 1 ? '<div class="field"><label>\u05de\u05d0\u05d9\u05d6\u05d4 \u05de\u05e1\u05e4\u05e8</label><select class="inp" id="ncNum">' +
        usable.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.label || n.phone) + '</option>'; }).join('') +
        '</select></div>' : '') +
      '<div class="field"><label>\u05d8\u05dc\u05e4\u05d5\u05df \u05d4\u05dc\u05e7\u05d5\u05d7</label><input class="inp ltr" id="ncPhone" placeholder="0501234567" inputmode="tel"></div>' +
      '<div class="field"><label>\u05e9\u05dd (\u05dc\u05d0 \u05d7\u05d5\u05d1\u05d4)</label><input class="inp" id="ncName"></div>' +
      '<div class="sec-note" style="margin:0 0 12px">\u05d9\u05d9\u05d5\u05d5\u05e6\u05e8 \u05d2\u05dd \u05dc\u05d9\u05d3 \u05e2\u05dd \u05de\u05e7\u05d5\u05e8 \u05d4\u05d2\u05e2\u05d4 \u05d5\u05d5\u05d0\u05d8\u05e1\u05d0\u05e4. \u05dc\u05dc\u05e7\u05d5\u05d7 \u05e9\u05dc\u05d0 \u05db\u05ea\u05d1 \u05e7\u05d5\u05d3\u05dd \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05dc\u05d5\u05d7 \u05e8\u05e7 \u05ea\u05d1\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05ea.</div>' +
      '<button class="btn" id="ncGo">\u05e6\u05d5\u05e8 \u05d5\u05e4\u05ea\u05d7 \u05e9\u05d9\u05d7\u05d4</button>' +
      '<p class="err" id="ncErr"></p></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
      if (!e.target.closest('#ncGo')) return;
      var raw = String(($('ncPhone') || {}).value || '').replace(/[^0-9+]/g, '');
      //  \u05de\u05e0\u05e8\u05de\u05dc\u05d9\u05dd \u05dc-E.164 \u05d1\u05dc\u05d9 \u05e4\u05dc\u05d5\u05e1: \u05d6\u05d4 \u05d4\u05e4\u05d5\u05e8\u05de\u05d8 \u05e9\u05d1\u05d5 \u05e9\u05de\u05d5\u05e8\u05d5\u05ea \u05db\u05dc \u05d4\u05e9\u05d9\u05d7\u05d5\u05ea,
      //  \u05d5\u05d1\u05dc\u05e2\u05d3\u05d9\u05d5 \u05d4\u05d5\u05d5\u05d1\u05d4\u05d5\u05e7 \u05d4\u05d9\u05d4 \u05e4\u05d5\u05ea\u05d7 \u05e9\u05d9\u05d7\u05d4 \u05e9\u05e0\u05d9\u05d9\u05d4 \u05dc\u05d0\u05d5\u05ea\u05d5 \u05d0\u05d3\u05dd.
      var e164 = raw.replace(/^\+/, '');
      if (/^0/.test(e164)) e164 = '972' + e164.slice(1);
      if (!/^9725\d{8}$/.test(e164) && !/^\d{10,15}$/.test(e164)) {
        return ($('ncErr').textContent = '\u05de\u05e1\u05e4\u05e8 \u05dc\u05d0 \u05ea\u05e7\u05d9\u05df');
      }
      var numId = $('ncNum') ? $('ncNum').value : usable[0].id;
      var nm = String(($('ncName') || {}).value || '').trim();
      var go = e.target.closest('#ncGo'); go.disabled = true; go.textContent = '\u05d9\u05d5\u05e6\u05e8\u2026';
      db.from('wa_threads').select('id').eq('number_id', numId).eq('contact_phone', e164).maybeSingle().then(function (ex) {
        if (ex.data) { bg.remove(); heyyThread = ex.data.id; return renderHeyy(); }
        db.from('wa_threads').insert({
          number_id: numId, contact_phone: e164, contact_name: nm || null,
          last_at: new Date().toISOString(), last_text: null, last_dir: 'out', unread: 0,
        }).select('id,contact_name,contact_phone,number_id,lead_id,provider_chat_id').single().then(function (r) {
          if (r.error) { go.disabled = false; go.textContent = '\u05e6\u05d5\u05e8 \u05d5\u05e4\u05ea\u05d7 \u05e9\u05d9\u05d7\u05d4'; return ($('ncErr').textContent = r.error.message); }
          waNewLead(r.data, function (leadId, err) {
            bg.remove();
            if (err) alert('\u05d4\u05e9\u05d9\u05d7\u05d4 \u05e0\u05e4\u05ea\u05d7\u05d4 \u05d0\u05d1\u05dc \u05d4\u05dc\u05d9\u05d3 \u05dc\u05d0 \u05e0\u05d5\u05e6\u05e8: ' + err);
            heyyThread = r.data.id; renderHeyy();
          });
        });
      });
    });
  }

  //  ---------- \u05e7\u05d5\u05d1\u05e5 \u05de\u05d4\u05de\u05d7\u05e9\u05d1 ----------
  //  \u05d4\u05e7\u05d5\u05d1\u05e5 \u05e2\u05d5\u05d1\u05e8 \u05d1-base64 \u05dc-edge function \u05e9\u05de\u05e2\u05dc\u05d4 \u05d0\u05d5\u05ea\u05d5 \u05dc-Heyy.
  //  \u05dc\u05d0 \u05de\u05e2\u05dc\u05d9\u05dd \u05d9\u05e9\u05d9\u05e8\u05d5\u05ea \u05de\u05d4\u05d3\u05e4\u05d3\u05e4\u05df \u05db\u05d3\u05d9 \u05e9\u05de\u05e4\u05ea\u05d7 \u05d4-API \u05dc\u05d0 \u05d9\u05d7\u05e9\u05e3.
  var WA_MAX_MB = 15;
  function waSendFile(t, input, say) {
    var f = input.files && input.files[0]; if (!f) return;
    input.value = '';
    if (f.size > WA_MAX_MB * 1024 * 1024) return say('\u05d4\u05e7\u05d5\u05d1\u05e5 \u05d2\u05d3\u05d5\u05dc \u05de-' + WA_MAX_MB + 'MB', false);
    say('\u05de\u05e2\u05dc\u05d4 \u05d0\u05ea ' + f.name + '\u2026', true);
    var fr = new FileReader();
    fr.onload = function () {
      var b64 = String(fr.result).split(',')[1] || '';
      db.functions.invoke('heyy-send', {
        body: { thread_id: t.id, body: ($('waBody') || {}).value || '',
                file_b64: b64, file_name: f.name, file_type: f.type || 'application/octet-stream' }
      }).then(function (r) {
        var d = r.data || {};
        if (r.error || d.error) return say(d.error || (r.error && r.error.message) || '\u05d4\u05e2\u05dc\u05d0\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4', false);
        say('\u2714 \u05d4\u05e7\u05d5\u05d1\u05e5 \u05e0\u05e9\u05dc\u05d7', true);
        var b = $('waBody'); if (b) { b.value = ''; waDraft = ''; }
        openThread(t);
      });
    };
    fr.readAsDataURL(f);
  }

  //  ---------- \u05e4\u05d2\u05d9\u05e9\u05d4 \u05d5\u05de\u05e9\u05d9\u05de\u05d4 \u05de\u05ea\u05d5\u05da \u05d4\u05e9\u05d9\u05d7\u05d4 ----------
  //  \u05e9\u05e0\u05d9\u05d4\u05dd \u05e0\u05e9\u05e2\u05e0\u05d9\u05dd \u05e2\u05dc \u05dc\u05d9\u05d3, \u05d5\u05dc\u05db\u05df \u05e9\u05d9\u05d7\u05d4 \u05d1\u05dc\u05d9 \u05dc\u05d9\u05d3 \u05de\u05e7\u05d1\u05dc\u05ea \u05d0\u05d7\u05d3 \u05e7\u05d5\u05d3\u05dd.
  function withLead(t, btn, label, say, cb) {
    if (t.lead_id) return cb(t.lead_id);
    var old = btn.textContent; btn.disabled = true; btn.textContent = '\u05d9\u05d5\u05e6\u05e8 \u05dc\u05d9\u05d3\u2026';
    waNewLead(t, function (id, err) {
      btn.disabled = false; btn.textContent = old;
      if (err) return say(err, false);
      cb(id);
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function localVal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function waAppt(t, btn, say) {
    withLead(t, btn, '\ud83d\udcc5', say, function (leadId) {
      var d = new Date(Date.now() + 864e5); d.setHours(10, 0, 0, 0);
      var branches = (window.C2B && window.C2B.lists && window.C2B.lists.branch) || [];
      var bg = document.createElement('div'); bg.className = 'adm-bg';
      bg.innerHTML = '<div class="adm" style="max-width:430px"><div class="adm-hd">' +
        '<h3>\ud83d\udcc5 \u05e7\u05d1\u05d9\u05e2\u05ea \u05e4\u05d2\u05d9\u05e9\u05d4</h3><button class="adm-x" data-admx>\u2715</button></div>' +
        '<div class="adm-body">' +
        '<div class="field"><label>\u05de\u05ea\u05d9</label><input class="inp" type="datetime-local" id="apWhen" value="' + localVal(d) + '"></div>' +
        '<div class="field"><label>\u05d0\u05d5\u05e4\u05df</label><select class="inp" id="apMode">' +
          '<option value="\u05d1\u05e1\u05e0\u05d9\u05e3">\u05d1\u05e1\u05e0\u05d9\u05e3</option><option value="\u05d8\u05dc\u05e4\u05d5\u05e0\u05d9\u05ea">\u05d8\u05dc\u05e4\u05d5\u05e0\u05d9\u05ea</option>' +
          '<option value="\u05d5\u05d9\u05d3\u05d0\u05d5">\u05d5\u05d9\u05d3\u05d0\u05d5</option></select></div>' +
        (branches.length ? '<div class="field"><label>\u05e1\u05e0\u05d9\u05e3</label><select class="inp" id="apBranch"><option value="">\u2014</option>' +
          branches.map(function (x) { var v = x.value || x; return '<option>' + esc(v) + '</option>'; }).join('') + '</select></div>' : '') +
        '<div class="field"><label>\u05d4\u05e2\u05e8\u05d4</label><input class="inp" id="apNote"></div>' +
        '<label style="display:flex;gap:7px;align-items:center;font-size:13px;margin-bottom:12px">' +
          '<input type="checkbox" id="apRemind" checked> \u05ea\u05d6\u05db\u05d5\u05e8\u05ea \u05dc\u05d9 \u05e9\u05e2\u05d4 \u05dc\u05e4\u05e0\u05d9 \u05d5-4 \u05d3\u05e7\u05d5\u05ea \u05dc\u05e4\u05e0\u05d9</label>' +
        '<button class="btn" id="apGo">\u05e7\u05d1\u05e2 \u05e4\u05d2\u05d9\u05e9\u05d4</button><p class="err" id="apErr"></p></div></div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', function (e) {
        if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
        if (!e.target.closest('#apGo')) return;
        var v = $('apWhen').value; if (!v) return ($('apErr').textContent = '\u05d7\u05e1\u05e8 \u05de\u05d5\u05e2\u05d3');
        var at = new Date(v); if (isNaN(at.getTime())) return ($('apErr').textContent = '\u05de\u05d5\u05e2\u05d3 \u05dc\u05d0 \u05ea\u05e7\u05d9\u05df');
        var go = e.target.closest('#apGo'); go.disabled = true; go.textContent = '\u05e7\u05d5\u05d1\u05e2\u2026';
        var l = waLeads[leadId] || {};
        var disp = pad2(at.getDate()) + '/' + pad2(at.getMonth() + 1) + '/' + at.getFullYear();
        var hhmm = pad2(at.getHours()) + ':' + pad2(at.getMinutes());
        db.from('appointments').insert({
          lead_id: leadId, name: l.name || t.contact_name || null, phone: t.contact_phone || null,
          type: l.car || '\u05e4\u05d2\u05d9\u05e9\u05d4', brand: l.brand || null,
          appt_mode: $('apMode').value, branch: ($('apBranch') ? $('apBranch').value : '') || null,
          note: ($('apNote').value || '').trim() || null,
          appt_date: disp, appt_time: hhmm, appt_at: at.toISOString(), status: 'new',
        }).then(function (r) {
          if (r.error) { go.disabled = false; go.textContent = '\u05e7\u05d1\u05e2 \u05e4\u05d2\u05d9\u05e9\u05d4'; return ($('apErr').textContent = r.error.message); }
          //  \u05d4\u05ea\u05d6\u05db\u05d5\u05e8\u05d5\u05ea \u05e0\u05e8\u05e9\u05de\u05d5\u05ea \u05db\u05de\u05e9\u05d9\u05de\u05d5\u05ea: \u05d4\u05e4\u05e2\u05de\u05d5\u05df \u05db\u05d1\u05e8 \u05e7\u05d5\u05e8\u05d0 \u05de\u05e9\u05d9\u05de\u05d5\u05ea
          //  \u05e4\u05ea\u05d5\u05d7\u05d5\u05ea \u05d5\u05de\u05d0\u05d3\u05d9\u05dd \u05d0\u05d5\u05ea\u05df \u05db\u05e9\u05e2\u05d1\u05e8 \u05d4\u05de\u05d5\u05e2\u05d3 \u2014 \u05d0\u05d9\u05df \u05e6\u05d5\u05e8\u05da \u05d1\u05de\u05e0\u05d2\u05e0\u05d5\u05df \u05e0\u05d5\u05e1\u05e3.
          var rows = [];
          if ($('apRemind').checked) {
            var who = (window.C2B && window.C2B.userId) || null;
            var nm = l.name || t.contact_name || t.contact_phone;
            [[60, '\u05e9\u05e2\u05d4'], [4, '4 \u05d3\u05e7\u05d5\u05ea']].forEach(function (x) {
              var due = new Date(at.getTime() - x[0] * 60000);
              if (due > new Date()) rows.push({ lead_id: leadId, assigned_to: who, done: false,
                title: '\u23f0 \u05e4\u05d2\u05d9\u05e9\u05d4 \u05e2\u05dd ' + nm + ' \u05d1\u05e2\u05d5\u05d3 ' + x[1] + ' (' + hhmm + ')', due_at: due.toISOString() });
            });
          }
          var done = function () { bg.remove(); say('\u2714 \u05d4\u05e4\u05d2\u05d9\u05e9\u05d4 \u05e0\u05e7\u05d1\u05e2\u05d4 \u05dc-' + disp + ' ' + hhmm, true); };
          if (rows.length) db.from('tasks').insert(rows).then(done); else done();
        });
      });
    });
  }

  function waTask(t, btn, say) {
    withLead(t, btn, '\u2705', say, function (leadId) {
      var d = new Date(Date.now() + 36e5);
      var bg = document.createElement('div'); bg.className = 'adm-bg';
      bg.innerHTML = '<div class="adm" style="max-width:400px"><div class="adm-hd">' +
        '<h3>\u2705 \u05de\u05e9\u05d9\u05de\u05d4 \u05d7\u05d3\u05e9\u05d4</h3><button class="adm-x" data-admx>\u2715</button></div>' +
        '<div class="adm-body">' +
        '<div class="field"><label>\u05de\u05d4 \u05dc\u05e2\u05e9\u05d5\u05ea</label><input class="inp" id="tkTitle" value="\u05dc\u05d7\u05d6\u05d5\u05e8 \u05dc' +
          esc(t.contact_name || '\u05dc\u05e7\u05d5\u05d7') + '"></div>' +
        '<div class="field"><label>\u05dc\u05de\u05ea\u05d9</label><input class="inp" type="datetime-local" id="tkWhen" value="' + localVal(d) + '"></div>' +
        '<button class="btn" id="tkGo">\u05e6\u05d5\u05e8 \u05de\u05e9\u05d9\u05de\u05d4</button><p class="err" id="tkErr"></p></div></div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', function (e) {
        if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
        if (!e.target.closest('#tkGo')) return;
        var title = ($('tkTitle').value || '').trim();
        if (!title) return ($('tkErr').textContent = '\u05d7\u05e1\u05e8\u05d4 \u05db\u05d5\u05ea\u05e8\u05ea');
        var w = $('tkWhen').value ? new Date($('tkWhen').value).toISOString() : null;
        var go = e.target.closest('#tkGo'); go.disabled = true; go.textContent = '\u05d9\u05d5\u05e6\u05e8\u2026';
        db.from('tasks').insert({ lead_id: leadId, title: title, due_at: w, done: false,
          assigned_to: (window.C2B && window.C2B.userId) || null }).then(function (r) {
          if (r.error) { go.disabled = false; go.textContent = '\u05e6\u05d5\u05e8 \u05de\u05e9\u05d9\u05de\u05d4'; return ($('tkErr').textContent = r.error.message); }
          bg.remove(); say('\u2714 \u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05e0\u05d5\u05e6\u05e8\u05d4', true);
        });
      });
    });
  }

  function waStDef(k) {
    var L = window.C2B_STATUSES || [];
    for (var i = 0; i < L.length; i++) if (L[i].k === k) return L[i];
    return { k: k, label: k || '\u2014', icon: '', color: 'var(--muted)' };
  }
  function waStatusChip(t, small) {
    var l = t.lead_id && waLeads[t.lead_id];
    if (!l) return small ? '' : '<span class="muted" style="font-size:12px">\u05d0\u05d9\u05df \u05dc\u05d9\u05d3 \u05de\u05e7\u05d5\u05e9\u05e8</span>';
    var d = waStDef(l.status || 'new');
    return '<span class="wa-st' + (small ? ' sm' : '') + '"' + (small ? '' : ' data-wast="' + esc(t.id) + '"') +
      ' style="color:' + d.color + ';border-color:' + d.color + '">' + esc(d.icon + ' ' + d.label) +
      (small ? '' : ' \u25be') + '</span>';
  }

  function heyyEmpty() {
    return '<div class="wa-blank"><div style="font-size:44px">\ud83d\udcac</div>' +
      '<p class="muted" style="margin:10px 0 0">בחרו שיחה מהרשימה</p></div>';
  }
  //  היום, אתמול, או תאריך — בדיוק כמו ברשימת השיחות של ווטסאפ
  function waWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var day = function (x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
    if (day(d) === day(now)) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (day(d) === day(y)) return 'אתמול';
    return d.toLocaleDateString('he-IL');
  }
  function heyyList(rows) {
    if (!rows.length) return '<p class="empty">אין שיחות' + (heyyQ ? ' שתואמות לחיפוש' : ' עדיין') + '</p>';
    return rows.map(function (t) {
      var nm = t.contact_name || t.contact_phone;
      return '<div class="wa-th' + (heyyThread === t.id ? ' on' : '') + '" data-th="' + esc(t.id) + '">' +
        '<span class="av">' + esc(String(nm).charAt(0)) + '</span>' +
        '<span class="mid"><span class="top"><span class="nm">' + esc(nm) + '</span>' +
          '<span class="rt">' + esc(waWhen(t.last_at)) + '</span></span>' +
          '<span class="top"><span class="pv">' +
            (t.last_dir === 'out' ? '<span class="tick">\u2713\u2713</span> ' : '') + esc(t.last_text || '\u2014') + '</span>' +
          waStatusChip(t, true) +
          (t.unread ? '<span class="wa-unread">' + t.unread + '</span>' : '') + '</span></span></div>';
    }).join('');
  }

  function openThread(t) {
    if (!t) { $('waPane').innerHTML = heyyEmpty(); return; }
    $('waPane').innerHTML = '<div class="loading">טוען\u2026</div>';
    db.from('wa_messages').select('id,direction,body,media_url,media_type,author,sent_at')
      .eq('thread_id', t.id).order('sent_at').limit(500).then(function (r) {
      if (r.error) return ($('waPane').innerHTML = '<p class="err">' + esc(r.error.message) + '</p>');
      var last = '', html = (r.data || []).map(function (m) {
        //  מפריד תאריך בין ימים, כמו בווטסאפ
        var d = new Date(m.sent_at), key = d.toDateString(), sep = '';
        if (key !== last) { last = key; sep = '<div class="wa-day">' + esc(waDay(d)) + '</div>'; }
        var media = m.media_url
          ? (/image/i.test(m.media_type || '') ? '<img src="' + esc(m.media_url) + '" alt="">'
             : '<a href="' + esc(m.media_url) + '" target="_blank" rel="noopener">\ud83d\udcce קובץ מצורף</a>')
          : '';
        return sep + '<div class="wa-m ' + esc(m.direction) + '">' + media +
          (m.body ? esc(m.body) : (media ? '' : '\u2014')) +
          '<span class="t">' + esc(d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })) +
          (m.direction === 'out' ? ' <span class="tick">\u2713\u2713</span>' : '') +
          (m.author ? ' \u00b7 ' + esc(m.author) : '') + '</span></div>';
      }).join('');
      //  מטא מגבילה טקסט חופשי ל-24 שעות מההודעה האחרונה של
      //  הלקוח. מחוץ לחלון ניתן לשלוח רק תבנית מאושרת.
      var ins = (r.data || []).filter(function (m) { return m.direction === 'in'; });
      var lastIn = ins.length ? new Date(ins[ins.length - 1].sent_at).getTime() : 0;
      var winLeft = lastIn ? Math.max(0, 24 * 3600e3 - (Date.now() - lastIn)) : 0;
      var nm = t.contact_name || t.contact_phone;
      $('waPane').innerHTML =
        '<div class="wa-top">' +
          '<span class="av">' + esc(String(nm).charAt(0)) + '</span>' +
          '<div style="flex:1;min-width:0"><b style="font-size:14.5px">' + esc(nm) + '</b>' +
            '<div class="muted ltr" style="font-size:12px"><bdi>+' + esc(t.contact_phone) + '</bdi></div></div>' +
          waStatusChip(t, false) +
          (t.lead_id ? '<button class="btn btn-ghost btn-sm" data-waopen="' + esc(t.lead_id) + '">\ud83d\udc64 כרטיס הליד</button>'
                     : '<button class="btn btn-sm" data-wanew="' + esc(t.id) + '">\u2795 צור ליד</button>') +
        '</div>' +
        '<div class="wa-msgs" id="waMsgs">' + (html || '<p class="empty">אין הודעות</p>') + '</div>' +
        waTools(t, winLeft);
      var el = $('waMsgs'); if (el) el.scrollTop = el.scrollHeight;
      var bt = $('waPane').querySelector('[data-waopen]');
      if (bt) bt.addEventListener('click', function () { window.C2B_openLeadCard && window.C2B_openLeadCard(this.dataset.waopen); });
      wireTools(t, winLeft > 0);
      var chip = $('waPane').querySelector('[data-wast]');
      if (chip) chip.addEventListener('click', function (e) {
        e.stopPropagation();
        var l = waLeads[t.lead_id]; if (!l || !window.C2B_openStatusMenu) return;
        window.C2B_openStatusMenu(chip, l.status || 'new', function (to) {
          window.C2B_changeStatus(l.id, to, l, function () {
            l.status = to; renderHeyy();
          });
        });
      });
      var mk = $('waPane').querySelector('[data-wanew]');
      if (mk) mk.addEventListener('click', function () { waCreateLead(t, this); });
      db.rpc('wa_mark_read', { p_thread: t.id }).then(function () {}, function () {});
    });
  }
  function waDay(d) {
    var now = new Date(), day = function (x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
    if (day(d) === day(now)) return 'היום';
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (day(d) === day(y)) return 'אתמול';
    return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  //  ---------- ערוצי Hey \u00b7 WhatsApp ----------
  //  יושב כאן ולא במסך השיחות: זו הגדרת הרשאות, ומקומה הטבעי לצד שאר
  //  ההרשאות של המשתמשים. הרשימה נטענת אסינכרונית ומוזרקת למקומה.
  function waNumbersCard(profs) {
    window.__waProfs = profs;
    setTimeout(function () {
      db.from('wa_numbers').select('id,phone,label,channel_id,active').order('created_at').then(function (r) {
        var box = $('waNumsBox'); if (!box) return;
        if (r.error) { box.innerHTML = '<p class="err">' + esc(r.error.message) + '</p>'; return; }
        var nums = r.data || [];
        var rows = nums.map(function (n) {
          var who = (window.__waProfs || []).filter(function (p) { return p.wa_number_id === n.id; })
            .map(function (p) { return p.full_name; });
          return '<tr><td class="ltr"><bdi><b>' + esc(n.phone || '\u2014') + '</b></bdi></td>' +
            '<td>' + esc(n.label || '\u2014') + '</td>' +
            '<td class="muted" style="font-size:11px">' + esc(n.channel_id || 'יתמלא מההודעה הראשונה') + '</td>' +
            '<td>' + (n.active ? '<span style="color:var(--ok);font-weight:600">פעיל</span>' : '<span class="muted">כבוי</span>') + '</td>' +
            '<td>' + (who.length ? esc(who.join(', ')) : '<span class="muted">לא שויך</span>') + '</td>' +
            '<td><button class="btn btn-ghost btn-sm" data-numtog="' + esc(n.id) + '" data-on="' + (n.active ? '0' : '1') + '">' +
              (n.active ? 'כיבוי' : 'הפעלה') + '</button></td></tr>';
        }).join('');
        var opts = function (cur) {
          return '<option value="">\u2014 ללא \u2014</option>' + nums.map(function (n) {
            return '<option value="' + esc(n.id) + '"' + (cur === n.id ? ' selected' : '') + '>' +
              esc(n.label || n.phone || 'ערוץ') + '</option>';
          }).join('');
        };
        var assign = (window.__waProfs || []).filter(function (p) { return p.active; }).map(function (p) {
          return '<tr><td><b>' + esc(p.full_name || '\u2014') + '</b> <span class="muted" style="font-size:12px">' + esc(roleLabel(p.role)) + '</span></td>' +
            '<td><select class="inp" data-waassign="' + esc(p.user_id) + '" style="width:200px">' + opts(p.wa_number_id) + '</select></td></tr>';
        }).join('');
        box.innerHTML =
          repTable(['מספר', 'שם', 'מזהה ערוץ ב-Heyy', 'מצב', 'משויך ל', ''], rows) +
          '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">' +
            '<input class="inp" id="waNewPhone" placeholder="972500000000" style="width:180px">' +
            '<input class="inp" id="waNewLabel" placeholder="שם לתצוגה" style="width:180px">' +
            '<button class="btn btn-sm" id="waAdd">הוספת ערוץ</button>' +
            '<span id="waMsg" class="muted" style="font-size:12.5px"></span></div>' +
          '<div class="sec-note" style="margin-top:14px">כל משתמש רואה אך ורק את השיחות של הערוץ שמשויך אליו. מנהל מערכת רואה את כולם.</div>' +
          repTable(['משתמש', 'ערוץ מנוהל'], assign);
        wireWaNumbers();
      });
    }, 0);
    return '<div class="card"><div class="sec-title">\ud83d\udfe2 ערוצי Hey \u00b7 WhatsApp</div>' +
      '<div id="waNumsBox" class="muted" style="font-size:13px">טוען\u2026</div></div>';
  }
  function wireWaNumbers() {
    var box = $('waNumsBox'); if (!box) return;
    var msg = $('waMsg');
    if ($('waAdd')) $('waAdd').onclick = function () {
      var ph = ($('waNewPhone').value || '').replace(/\D/g, '');
      if (ph.indexOf('0') === 0) ph = '972' + ph.slice(1);
      if (ph && ph.length < 9) { msg.style.color = 'var(--danger)'; msg.textContent = 'מספר לא תקין'; return; }
      db.from('wa_numbers').insert({ phone: ph || null, label: ($('waNewLabel').value || '').trim() || null }).then(function (r) {
        if (r.error) { msg.style.color = 'var(--danger)'; msg.textContent = r.error.message; return; }
        renderUsers();
      });
    };
    box.querySelectorAll('[data-numtog]').forEach(function (b) {
      b.onclick = function () {
        db.from('wa_numbers').update({ active: this.dataset.on === '1' }).eq('id', this.dataset.numtog)
          .then(function () { renderUsers(); });
      };
    });
    box.querySelectorAll('[data-waassign]').forEach(function (sel) {
      sel.onchange = function () {
        var self = this;
        db.from('profiles').update({ wa_number_id: this.value || null }).eq('user_id', this.dataset.waassign)
          .then(function (r) {
            var m = $('waMsg');
            if (m) { m.style.color = r.error ? 'var(--danger)' : 'var(--ok)'; m.textContent = r.error ? r.error.message : '\u2714 השיוך נשמר'; }
            self.blur();
          });
      };
    });
  }

  function renderUsers() {
    loading();
    db.from('profiles').select('*').order('created_at', { ascending: true }).then(function (r) {
      if (r.error) return errBox(r.error.message);
      var ps = r.data || [];
      //  מנהל סניף מנהל את הצוות שלו ולכן עורך משתמשים, אבל המסד חוסם
      //  ממנו שורה של מנהל מערכת ואת קידום מישהו לתפקיד הזה. הממשק מציג
      //  בדיוק את מה שמותר — כפתור שנכשל ב-RLS גרוע מכפתור שלא קיים.
      var myRoleU = (window.C2B && window.C2B.role) || '';
      var isAdminU = myRoleU === 'admin';
      var canEditUsers = isAdminU || myRoleU === 'branch';
      var canEditRow = function (p) { return isAdminU || p.role !== 'admin'; };
      var roleOpts = ROLES.filter(function (x) { return isAdminU || x[0] !== 'admin'; });
      var rows = ps.map(function (p) {
        var reset = !canEditRow(p) ? '' : (p.email ? '<button class="btn btn-ghost btn-sm" data-reset="' + esc(p.email) + '">🔑 אפס סיסמה</button>' : '<span class="muted" style="font-size:12px">אין אימייל</span>');
        if (!canEditRow(p)) {
          return '<tr><td><span class="avatar" style="margin-inline-end:8px">' + esc((p.full_name || '?').charAt(0)) + '</span>' + esc(p.full_name || '—') +
            (p.email ? '<div class="muted" style="font-size:11px">' + esc(p.email) + '</div>' : '') + '</td>' +
            '<td>' + esc(roleLabel(p.role)) + '</td>' +
            '<td style="white-space:normal;max-width:260px">' + (p.role === 'admin' ? '<span class="muted" style="font-size:12.5px">👑 רואה את הכל</span>' : viewsLabel(p.views, p.role)) + '</td>' +
            '<td>' + (p.active ? '<span style="color:var(--ok);font-weight:700">✓ פעיל</span>' : '<span style="color:var(--danger);font-weight:700">✕ לא פעיל</span>') + '</td>' +
            '<td class="muted" style="font-size:12px">🔒 מנהל מערכת</td></tr>';
        }
        var seg = '<div style="display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden">' +
          '<button data-actset="' + p.user_id + '" data-on="1" style="border:none;padding:6px 12px;font-size:12.5px;cursor:pointer;font-weight:600;background:' + (p.active ? 'var(--ok)' : 'transparent') + ';color:' + (p.active ? '#fff' : 'var(--muted)') + '">✓ פעיל</button>' +
          '<button data-actset="' + p.user_id + '" data-on="0" style="border:none;border-inline-start:1px solid var(--line);padding:6px 12px;font-size:12.5px;cursor:pointer;font-weight:600;background:' + (!p.active ? 'var(--danger)' : 'transparent') + ';color:' + (!p.active ? '#fff' : 'var(--muted)') + '">✕ לא פעיל</button></div>';
        return '<tr><td><span class="avatar" style="margin-inline-end:8px">' + esc((p.full_name || '?').charAt(0)) + '</span><span class="uname-txt" data-nameuid="' + p.user_id + '">' + esc(p.full_name || '—') + '</span> <button class="btn btn-ghost btn-sm" data-edituser="' + p.user_id + '" title="ערוך את כל פרטי המשתמש">✏️ ערוך</button>' + (p.email ? '<div class="muted" style="font-size:11px">' + esc(p.email) + '</div>' : '') + '</td>' +
          '<td><select class="inp" data-role="' + p.user_id + '">' + roleOpts.map(function (x) { return '<option value="' + x[0] + '"' + (p.role === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></td>' +
          '<td style="white-space:normal;max-width:260px">' + (p.role === 'admin' ? '<span class="muted" style="font-size:12.5px">👑 מנהל מערכת — רואה את הכל (תצוגות לא חלות על מנהל)</span>' : viewsLabel(p.views, p.role) + ' <button class="btn btn-ghost btn-sm" data-editviews="' + p.user_id + '">✏️</button><div class="hidden" id="ev_' + p.user_id + '"></div>') + '</td>' +
          '<td>' + seg + '</td>' +
          '<td>' + reset + '</td></tr>' +
          '<tr class="hidden" id="uedit_' + p.user_id + '"><td colspan="5" style="padding:0 8px"></td></tr>';
      }).join('');
      var addForm = '<div class="card"><h3>➕ הוספת משתמש</h3><p class="muted" style="font-size:13px">נשלח אליו מייל עם קישור, אימייל וסיסמה זמנית — הוא נכנס מיד ויכול לאפס סיסמה בעצמו.</p>' +
        '<div class="grid2"><div class="field" style="margin:0"><label>שם מלא</label><input class="inp" id="nuName" placeholder="למשל: דנה כהן"></div>' +
        '<div class="field" style="margin:0"><label>אימייל</label><input class="inp" id="nuEmail" type="email" placeholder="name@email.com"></div></div>' +
        '<div class="grid2" style="margin-top:12px"><div class="field" style="margin:0"><label>טלפון</label><input class="inp" id="nuPhone" type="tel" placeholder="050-0000000"></div>' +
        '<div class="field" style="margin:0"><label>תפקיד</label><select class="inp" id="nuRole">' + roleOpts.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div></div>' +
        '<label style="font-size:13px;color:var(--muted);margin-top:12px;display:block">תצוגות שהמשתמש יראה (מוגדר לפי התפקיד — אפשר להוסיף/להוריד):</label><div id="nuViews">' + viewChecks('nv', DEFAULT_VIEWS.sales) + '</div>' +
        '<div style="margin-top:14px"><button class="btn" id="nuCreate">צור משתמש ושלח הזמנה</button> <span id="nuMsg" style="font-size:13px;margin-inline-start:10px"></span></div><div id="nuResult" style="margin-top:12px"></div></div>';
      view('<h2 style="margin:0 0 14px">משתמשים והרשאות</h2>' +
        (isAdminU ? waNumbersCard(ps) : '') +
        (isAdminU ? '' : '<div class="sec-note">🔑 אתם יכולים ליצור משתמשים, לשנות תפקידים והרשאות ולהפעיל או לכבות אנשי צוות. תפקיד <b>מנהל מערכת</b> שמור לבעל המערכת — אי אפשר ליצור אותו או לערוך משתמש שכבר מוגדר כך.</div>') +
        (canEditUsers ? addForm : '') +
        '<div class="card"><h3>משתמשים קיימים (' + ps.length + ')</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>שם</th><th>תפקיד</th><th>תצוגות מותרות</th><th>פעיל</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">אין משתמשים</td></tr>') + '</tbody></table></div>' +
        '<div class="muted" style="font-size:12.5px;margin-top:10px">מנהל מערכת רואה הכל. שאר המשתמשים רואים רק את הלידים <b>שהוקצו להם</b> ואת התצוגות שסומנו כאן.</div></div>');

      if (isAdminU) wireWaNumbers();
      if (!canEditUsers) return;                 // אין מאזיני עריכה בתצוגת הצפייה
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
          $('nuResult').innerHTML = '<div class="card" id="nuBox" style="box-shadow:none;border:1px solid var(--line);margin:0">' +
            '<b id="nuTitle">⏳ יוצר משתמש…</b>' +
            '<div id="nuCreds" class="hidden" style="margin-top:8px;font-family:monospace;font-size:13px;background:var(--surface);padding:10px;border-radius:8px">אימייל: ' + esc(d.email || email) + '<br>סיסמה זמנית: <b>' + esc(d.password || '') + '</b></div>' +
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
          var email = b.dataset.reset, redirect = 'https://crm.freedrive.co.il/reset.html';
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
    //  מנהל שמוריד לעצמו את התפקיד ננעל מחוץ למערכת ואין מי שיחזיר אותו.
    var isSelf = (uid === window.C2B.userId);
    function fld(label, id, val, type) { return '<div class="field" style="margin:0"><label>' + label + '</label><input class="inp" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" style="width:100%"></div>'; }
    td.innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--line);background:var(--surface-2);margin:8px 0">' +
      '<div class="row-between" style="margin-bottom:10px"><b>✏️ עריכת פרטי משתמש</b><span class="muted" style="font-size:11.5px">' + roleLabel(p.role) + '</span></div>' +
      '<div class="grid2">' +
        fld('שם מלא', 'ue_name', p.full_name) +
        fld('מייל', 'ue_email', p.email, 'email') +
        fld('טלפון', 'ue_phone', p.phone, 'tel') +
        fld('נייד', 'ue_mobile', p.mobile, 'tel') +
        // התפקיד קובע מה המשתמש רואה ומה מותר לו. עד עכשיו אפשר היה לשנות אותו
        // רק מהתפריט הקטן בטבלה — כאן הוא במקום שבו באמת עורכים משתמש.
        '<div class="field" style="margin:0"><label>תפקיד במערכת</label>' +
          '<select class="inp" id="ue_role" style="width:100%"' + (isSelf ? ' disabled' : '') + '>' +
          ROLES.filter(function (r) { return (window.C2B && window.C2B.role) === 'admin' || r[0] !== 'admin'; })
            .map(function (r) { return '<option value="' + r[0] + '"' + (p.role === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') +
          '</select>' +
          (isSelf ? '<span class="muted" style="font-size:11px">אי אפשר לשנות את התפקיד של עצמך</span>' : '') +
        '</div>' +
        fld('שלוחת SIP', 'ue_sip', p.sip_ext) +
        fld('סניף', 'ue_branch', p.branch) +
      '</div>' +
      (isSelf ? '' :
        '<label id="ue_viewsWrap" class="hidden" style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px">' +
          '<input type="checkbox" id="ue_resetViews" checked> עדכן גם את המסכים לברירת המחדל של התפקיד החדש' +
        '</label>') +
      '<div class="field" style="margin-top:10px"><label>הערות</label><textarea class="inp" id="ue_notes" style="height:64px;width:100%">' + esc(p.notes || '') + '</textarea></div>' +
      '<div style="margin-top:12px"><button class="btn btn-sm" id="ue_save">💾 שמור פרטים</button> <button class="btn btn-ghost btn-sm" id="ue_close">✕ סגור</button> <span id="ue_msg" style="font-size:12.5px;margin-inline-start:8px"></span></div>' +
      '<p class="muted" style="font-size:11px;margin-top:8px">שדות אלו (שלוחת SIP, טלפון, סניף…) זמינים לחיבור אוטומציות, חיוג וניתוב בהמשך.</p>' +
    '</div>';
    $('ue_close').addEventListener('click', function () { tr.classList.add('hidden'); td.innerHTML = ''; });
    if ($('ue_role')) $('ue_role').addEventListener('change', function () {
      var w = $('ue_viewsWrap'); if (w) w.classList.toggle('hidden', this.value === p.role);
    });
    function newRoleValue() { return ($('ue_role') && !isSelf) ? $('ue_role').value : p.role; }
    $('ue_save').addEventListener('click', function () {
      var patch = {
        full_name: ($('ue_name').value || '').trim() || null,
        email: ($('ue_email').value || '').trim() || null,
        phone: ($('ue_phone').value || '').trim() || null,
        mobile: ($('ue_mobile').value || '').trim() || null,
        sip_ext: ($('ue_sip').value || '').trim() || null,
        title: roleLabel(newRoleValue()),   // נגזר מהתפקיד — אין יותר שדה נפרד
        branch: ($('ue_branch').value || '').trim() || null,
        notes: ($('ue_notes').value || '').trim() || null
      };
      var newRole = newRoleValue();
      if (!isSelf && newRole && newRole !== p.role) {
        patch.role = newRole;
        // המסכים נגזרים מהתפקיד. בלי העדכון הזה מנהל סניף חדש היה נשאר
        // עם ההרשאות של סוכן, ולהפך — ומסכים היו נפתחים ריקים.
        if ($('ue_resetViews') && $('ue_resetViews').checked) patch.views = DEFAULT_VIEWS[newRole] || null;
        if (!confirm('לשנות את התפקיד של ' + (p.full_name || '') + '\nמ־' + roleLabel(p.role) + ' ל־' + roleLabel(newRole) + '?')) return;
      }
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
  // ---------- עוזר AI מותאם לתפקיד ----------
  //  עוזר גנרי אחד לכולם נותן לכל אחד תשובות שלא רלוונטיות לו: הסוכן מקבל ניתוח
  //  רווחיות, והנהלת החשבונות מקבלת עצות מכירה. כל תפקיד מקבל כאן פרסונה משלו —
  //  ידע, נתונים ושאלות מוצעות — כך שהתשובה נוגעת במה שהוא באמת אחראי עליו.
  //
  //  הערה על פרטיות: ההקשר נבנה מהנתונים שהמשתמש רשאי לקרוא. RLS כבר מגביל
  //  סוכן ללידים שלו בלבד, ולכן "כל הלידים" עבורו = הלידים שלו.
  var AI_BASE = 'אתה עוזר AI בתוך מערכת CRM של סוכנות רכב ישראלית בשם פרי דרייב ' +
    '(ליסינג מימוני פרטי, עבודה מול כל היבואנים, מימון עד 100%, טרייד-אין, מעטפת מלאה). ' +
    'ענה תמיד בעברית תקנית, תמציתי וברור, ומבוסס אך ורק על הנתונים שקיבלת. ' +
    'אם נתון חסר או לא ניתן להסיק אותו — אמור זאת במפורש ואל תמציא מספרים. דיוק לפני הכל. ' +
    'סיים תמיד ב-2–4 המלצות פעולה קונקרטיות שאפשר לבצע כבר היום.';

  var AI_PERSONAS = {
    admin: {
      title: '🤖 עוזר AI — מנכ"ל',
      lead: 'תמונת מצב עסקית: רווחיות, מקורות, ביצועי צוות וצווארי בקבוק.',
      system: 'אתה יועץ אסטרטגי לבעל העסק. אתה מסתכל על התמונה הרחבה: מאיפה מגיע הכסף, ' +
        'איזה מקור לידים משתלם ואיזה שורף תקציב, איפה המשפך דולף, ואיך הצוות מתפקד. ' +
        'תעדף לפי השפעה כספית. אל תחשוש לומר שמשהו לא עובד.',
      qs: ['מהם המקורות הכי משתלמים ואיפה לבזבז פחות?',
           'איפה המשפך דולף הכי הרבה ומה לתקן ראשון?',
           'תן לי סיכום מנהלים של השבוע ו-3 פעולות',
           'מי מהסוכנים מוביל ומי צריך עזרה?']
    },
    branch: {
      title: '🤖 עוזר AI — מנהל סניף',
      lead: 'תפעול הסניף: תיקים תקועים, זמני תגובה, עומס על הצוות והתקדמות המשפך.',
      system: 'אתה יד ימינו של מנהל הסניף. אתה אחראי על התפעול היומיומי: לידים שנתקעו, ' +
        'זמן תגובה ראשון, תיקים שלא זזים בין שלבים, ומשימות שעברו את המועד. ' +
        'התמקד במה שאפשר לתקן היום עם הצוות הקיים, לא באסטרטגיה ארוכת טווח.',
      qs: ['אילו תיקים תקועים ולמה?',
           'איך זמן התגובה שלנו ומה זה עולה לנו?',
           'מה צריך לקרות השבוע כדי לסגור יותר?',
           'איפה יש עומס או פערים בצוות?']
    },
    sales: {
      title: '🤖 עוזר AI — הסוכן שלי',
      lead: 'מאמן אישי: על מי להתקשר עכשיו, מה תקוע אצלי ואיך לסגור יותר.',
      system: 'אתה מאמן מכירות אישי של סוכן אחד. הנתונים שאתה רואה הם שלו בלבד. ' +
        'דבר אליו בגוף שני ("כדאי שתתקשר…"). התמקד בפעולות שהוא יכול לעשות בעצמו היום: ' +
        'למי להתקשר עכשיו, איזה ליד מתקרר, מה לשלוח, ואיך לנסח. ' +
        'אל תדבר על רווחיות החברה, על סוכנים אחרים או על תקציבי שיווק — זה לא בתחומו.',
      qs: ['על מי כדאי שאתקשר עכשיו ולמה?',
           'אילו לידים שלי מתקררים ואיך להחזיר אותם?',
           'מה תקוע אצלי ומה הצעד הבא בכל תיק?',
           'איך אני יכול לסגור יותר החודש?']
    },
    files: {
      title: '🤖 עוזר AI — ניהול תיקים',
      lead: 'מצב התיקים: מסמכים חסרים, תיקים שלא זזים ומה צריך לרדוף אחריו.',
      system: 'אתה עוזר למנהלת תיקי הלקוחות. אתה אחראי על התקדמות התיק אחרי החתימה: ' +
        'איסוף מסמכים, שלבי מימון, ומה חוסם כל תיק. ' +
        'התמקד בתיקים ספציפיים ובמה חסר בהם, לא במכירות ולא בשיווק.',
      qs: ['אילו תיקים חסרים מסמכים?',
           'מה תקוע הכי הרבה זמן ומה חוסם?',
           'מה סדר העדיפויות שלי היום?',
           'אילו תיקים קרובים למסירה?']
    },
    accounting: {
      title: '🤖 עוזר AI — כספים',
      lead: 'כסף: גבייה פתוחה, יתרות, עמלות והכנסה צפויה.',
      system: 'אתה עוזר להנהלת החשבונות. אתה מסתכל רק על הכסף: מה נגבה, מה פתוח, ' +
        'אילו עסקאות ממתינות לתשלום, מה צפוי להיכנס, ומה מצב העמלות. ' +
        'אל תיתן עצות מכירה. אם חסר מידע פיננסי — אמור מה חסר.',
      qs: ['מה מצב הגבייה הפתוחה?',
           'אילו עסקאות ממתינות לתשלום הכי הרבה זמן?',
           'מה ההכנסה הצפויה מהתיקים הפתוחים?',
           'סכם את העמלות לתקופה']
    }
  };
  function aiPersona() {
    var r = (window.C2B && window.C2B.role) || 'admin';
    return AI_PERSONAS[r] || AI_PERSONAS.admin;
  }

  function renderAI() {
    loading();
    var per = aiPersona(), role = (window.C2B && window.C2B.role) || 'admin';
    var since = new Date(Date.now() - 90 * 864e5).toISOString();   // חלון של 90 יום — מספיק לכל שאלה תפעולית
    Promise.all([
      db.from('leads').select('id,name,status,source,created_at,first_response_at,status_changed_at,city,brand,car,assigned_to')
        .is('deleted_at', null).gte('created_at', since).limit(3000),
      db.from('deals').select('id,lead_id,order_no,client_name,total,commission,stage,status,created_at,updated_at,car_make,car_model,has_signature,checklist'),
      db.from('payments').select('amount,kind,created_at,deal_id'),
      db.from('tasks').select('done,due_at,title,lead_id'),
      db.from('appointments').select('status,appt_at'),
      db.from('profiles').select('user_id,full_name')
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var leads = res[0].data || [], deals = res[1].data || [], pays = res[2].data || [],
          tasks = res[3].data || [], appts = res[4].data || [], profs = res[5].data || [];
      var pmap = {}; profs.forEach(function (p) { pmap[p.user_id] = p.full_name; });
      var ST = window.C2B_STATUSES || [];
      var stLabel = function (k) { for (var i = 0; i < ST.length; i++) if (ST[i].k === k) return ST[i].label; return k || '—'; };
      var now = Date.now(), days = function (t) { return t ? Math.round((now - new Date(t)) / 864e5) : null; };
      var money = function (n) { return nis(Math.round(n || 0)); };

      // ---- אבני בניין משותפות ----
      var by = {}; leads.forEach(function (l) { by[l.status || 'new'] = (by[l.status || 'new'] || 0) + 1; });
      var won = by.won || 0, lost = by.lost || 0, conv = (won + lost) ? Math.round(won / (won + lost) * 100) : 0;
      var rts = leads.filter(function (l) { return l.first_response_at; })
                     .map(function (l) { return (new Date(l.first_response_at) - new Date(l.created_at)) / 60000; });
      var avgRt = rts.length ? Math.round(rts.reduce(function (a, b) { return a + b; }, 0) / rts.length) : 0;
      var noResp = leads.filter(function (l) { return !l.first_response_at && l.status === 'new'; });
      var openLeads = leads.filter(function (l) { return ['won', 'lost'].indexOf(l.status) < 0; });
      var cold = openLeads.filter(function (l) { return days(l.status_changed_at || l.created_at) >= 7; })
                          .sort(function (a, b) { return new Date(a.status_changed_at || a.created_at) - new Date(b.status_changed_at || b.created_at); });
      var overdue = tasks.filter(function (t) { return !t.done && t.due_at && new Date(t.due_at) < now; });
      var head = 'נתוני פרי דרייב · ' + new Date().toLocaleDateString('he-IL') + ' · 90 הימים האחרונים' + '\n';

      var ctx;
      if (role === 'sales') {
        // ---- הסוכן: רק התיקים שלו, ובשפה של "מה לעשות עכשיו" ----
        var mine = openLeads.slice().sort(function (a, b) {
          return new Date(a.status_changed_at || a.created_at) - new Date(b.status_changed_at || b.created_at); });
        ctx = head +
          '- הלידים שלי: ' + leads.length + ' (פתוחים: ' + openLeads.length + '). נסגרו ' + won + ', לא רלוונטי ' + lost +
            (conv ? ', אחוז סגירה ' + conv + '%' : '') + '.\n' +
          '- פילוח סטטוס: ' + ST.map(function (s) { return s.label + '=' + (by[s.k] || 0); }).filter(function (x) { return !/=0$/.test(x); }).join(', ') + '.\n' +
          '- טרם נענו: ' + noResp.length + ' לידים חדשים.' + (avgRt ? ' זמן תגובה ממוצע שלי: ' + avgRt + ' דק\'.' : '') + '\n' +
          '- משימות פתוחות: ' + tasks.filter(function (t) { return !t.done; }).length + ', מתוכן ' + overdue.length + ' באיחור.\n' +
          '- לידים שלא זזו הכי הרבה זמן (עד 12):\n' +
            (mine.slice(0, 12).map(function (l) {
              return '   · ' + (l.name || 'ללא שם') + ' — ' + stLabel(l.status) + ', ' + (days(l.status_changed_at || l.created_at) || 0) + ' ימים ללא שינוי' +
                     (l.car ? ', מתעניין ב' + l.car : '') + (l.source ? ', מקור ' + l.source : ''); }).join('\n') || '   (אין)') + '\n' +
          '- העסקאות שלי: ' + deals.length + (deals.length ? ', שווי ' + money(deals.reduce(function (a, d) { return a + (+d.total || 0); }, 0)) : '') + '.';

      } else if (role === 'accounting') {
        // ---- כספים: גבייה, יתרות, עמלות ----
        var revenue = deals.reduce(function (a, d) { return a + (+d.total || 0); }, 0);
        var comm = deals.reduce(function (a, d) { return a + (+d.commission || 0); }, 0);
        var paidBy = {}; pays.forEach(function (p) { if (p.kind !== 'invoice') paidBy[p.deal_id] = (paidBy[p.deal_id] || 0) + (+p.amount || 0); });
        var collected = Object.keys(paidBy).reduce(function (a, k) { return a + paidBy[k]; }, 0);
        var openDeals = deals.filter(function (d) { return (d.stage || '') !== 'cancelled'; });
        var owing = openDeals.map(function (d) { return { d: d, bal: (+d.total || 0) - (paidBy[d.id] || 0) }; })
                             .filter(function (x) { return x.bal > 0; })
                             .sort(function (a, b) { return b.bal - a.bal; });
        ctx = head +
          '- עסקאות פעילות: ' + openDeals.length + ' · שווי כולל ' + money(revenue) + '.\n' +
          '- נגבה בפועל: ' + money(collected) + ' · יתרה פתוחה: ' + money(revenue - collected) + '.\n' +
          '- עמלות סוכן מצטברות: ' + money(comm) + '.\n' +
          '- תנועות שנרשמו: ' + pays.length + ' (' + ['payment', 'receipt', 'invoice'].map(function (k) {
              return k + '=' + pays.filter(function (p) { return p.kind === k; }).length; }).join(', ') + ').\n' +
          '- עסקאות עם יתרה לתשלום (עד 15, מהגדולה):\n' +
            (owing.slice(0, 15).map(function (x) {
              return '   · הזמנה #' + (x.d.order_no || '?') + ' — ' + (x.d.client_name || '') + ', יתרה ' + money(x.bal) +
                     ', שלב ' + (x.d.stage || '—') + ', נפתחה לפני ' + (days(x.d.created_at) || 0) + ' ימים'; }).join('\n') || '   (אין)') + '\n' +
          '- עסקאות חתומות שממתינות: ' + openDeals.filter(function (d) { return d.has_signature && (paidBy[d.id] || 0) === 0; }).length + '.';

      } else if (role === 'files') {
        // ---- תיקים: מה חסר ומה תקוע ----
        var stuck = deals.filter(function (d) { return (d.stage || '') !== 'cancelled' && (d.stage || '') !== 'delivered'; })
                         .sort(function (a, b) { return new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at); });
        var byStage = {}; deals.forEach(function (d) { byStage[d.stage || 'ללא שלב'] = (byStage[d.stage || 'ללא שלב'] || 0) + 1; });
        var missDocs = stuck.filter(function (d) { var c = d.checklist || {}; return Object.keys(c).filter(function (k) { return k[0] !== '_' && c[k]; }).length < 3; });
        ctx = head +
          '- תיקים פעילים: ' + stuck.length + ' מתוך ' + deals.length + '.\n' +
          '- פילוח לפי שלב: ' + Object.keys(byStage).map(function (k) { return k + '=' + byStage[k]; }).join(', ') + '.\n' +
          '- תיקים עם פחות מ-3 מסמכים בצ\'קליסט: ' + missDocs.length + '.\n' +
          '- התיקים שלא זזו הכי הרבה זמן (עד 15):\n' +
            (stuck.slice(0, 15).map(function (d) {
              var c = d.checklist || {}, have = Object.keys(c).filter(function (k) { return k[0] !== '_' && c[k]; }).length;
              return '   · הזמנה #' + (d.order_no || '?') + ' — ' + (d.client_name || '') + ', שלב ' + (d.stage || '—') +
                     ', ' + (days(d.updated_at || d.created_at) || 0) + ' ימים ללא עדכון, ' + have + ' מסמכים סומנו' +
                     (d.has_signature ? ', חתום' : ', טרם נחתם'); }).join('\n') || '   (אין)') + '\n' +
          '- משימות פתוחות: ' + tasks.filter(function (t) { return !t.done; }).length + ', מתוכן ' + overdue.length + ' באיחור.';

      } else {
        // ---- מנכ"ל / מנהל סניף: תמונה מלאה, בדגש שונה ----
        var src = {}; leads.forEach(function (l) { var k = l.source || 'לא ידוע';
          src[k] = src[k] || { t: 0, w: 0 }; src[k].t++; if (l.status === 'won') src[k].w++; });
        var agents = {}; leads.forEach(function (l) { var k = pmap[l.assigned_to] || 'לא משויך';
          agents[k] = agents[k] || { t: 0, w: 0, r: 0 }; agents[k].t++;
          if (l.status === 'won') agents[k].w++; if (l.first_response_at) agents[k].r++; });
        var revenue2 = deals.reduce(function (a, d) { return a + (+d.total || 0); }, 0);
        var stageC = {}; deals.forEach(function (d) { stageC[d.stage || 'ללא שלב'] = (stageC[d.stage || 'ללא שלב'] || 0) + 1; });
        var collected2 = pays.filter(function (p) { return p.kind !== 'invoice'; }).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
        ctx = head +
          '- לידים: ' + leads.length + ' · פילוח: ' + ST.map(function (s) { return s.label + '=' + (by[s.k] || 0); }).filter(function (x) { return !/=0$/.test(x); }).join(', ') + '.\n' +
          '- אחוז סגירה: ' + conv + '% (נסגרו ' + won + ', אבודים ' + lost + ').\n' +
          '- זמן תגובה ראשון ממוצע: ' + (avgRt ? avgRt + ' דק\'' : 'לא ידוע') + ' · לידים חדשים שטרם נענו: ' + noResp.length + '.\n' +
          '- לידים פתוחים שלא זזו 7+ ימים: ' + cold.length + ' · משימות באיחור: ' + overdue.length + '.\n' +
          '- לפי מקור: ' + Object.keys(src).sort(function (a, b) { return src[b].t - src[a].t; }).slice(0, 12)
              .map(function (k) { return k + ' (' + src[k].t + ' לידים, ' + src[k].w + ' סגירות' +
                   (src[k].t ? ', ' + Math.round(src[k].w / src[k].t * 100) + '%' : '') + ')'; }).join('; ') + '.\n' +
          '- לפי סוכן: ' + Object.keys(agents).sort(function (a, b) { return agents[b].t - agents[a].t; }).slice(0, 12)
              .map(function (k) { return k + ' (' + agents[k].t + ' לידים, ' + agents[k].w + ' סגירות, ' +
                   agents[k].r + ' נענו)'; }).join('; ') + '.\n' +
          '- עסקאות: ' + deals.length + ' · שווי ' + money(revenue2) + ' · נגבה ' + money(collected2) +
              ' · יתרה ' + money(revenue2 - collected2) + '.\n' +
          '- שלבי תיקים: ' + Object.keys(stageC).map(function (k) { return k + '=' + stageC[k]; }).join(', ') + '.\n' +
          '- פגישות: ' + appts.length + ' · משימות פתוחות: ' + tasks.filter(function (t) { return !t.done; }).length + '.';
      }

      view('<div class="card"><h3>' + per.title + '</h3>' +
        '<p class="muted" style="font-size:13px;margin:0 0 12px">' + esc(per.lead) + '</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          per.qs.map(function (q) { return '<button class="btn btn-ghost btn-sm" data-sug="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
        '<textarea class="inp" id="aiQ" rows="3" style="width:100%" placeholder="כתוב כאן שאלה…"></textarea>' +
        '<div style="margin-top:10px"><button class="btn" id="aiAsk">שאל את ה-AI</button> <span class="muted" id="aiState" style="font-size:13px;margin-inline-start:10px"></span></div>' +
        '<div id="aiAns" style="margin-top:16px"></div>' +
        '<details style="margin-top:16px"><summary class="muted" style="font-size:12px;cursor:pointer">הנתונים שנשלחים למודל</summary>' +
        '<pre style="white-space:pre-wrap;font-size:11.5px;background:var(--surface-2);padding:12px;border-radius:8px;margin-top:8px">' + esc(ctx) + '</pre></details></div>');
      $('view').querySelectorAll('[data-sug]').forEach(function (b) {
        b.addEventListener('click', function () { $('aiQ').value = b.dataset.sug; $('aiAsk').click(); }); });
      $('aiAsk').addEventListener('click', function () { askAI(ctx, per.system); });
    }).catch(function (e) { errBox(e.message || e); });
  }
  function askAI(ctx, sysPrompt) {
    var q = ($('aiQ').value || '').trim(); if (!q) return;
    var state = $('aiState'), ans = $('aiAns'), btn = $('aiAsk');
    state.style.color = 'var(--muted)'; state.textContent = 'חושב… (עד ~30 שניות)'; ans.innerHTML = ''; btn.disabled = true;
    db.functions.invoke('ai-assistant', {
      body: { prompt: ctx + '\n\nהשאלה: ' + q, system: sysPrompt ? (AI_BASE + ' ' + sysPrompt) : undefined }
    }).then(function (r) {
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
        var good = (r.data.status >= 200 && r.data.status < 300);
        createTxt = good ? '<span style="color:var(--ok)">✔ הצליחה</span>' : '<span style="color:var(--danger)">✖ נכשלה (' + r.data.status + '): ' + esc(b.msg || b.error_description || b.message || b.error || '') + '</span>';
        var box = $('nuBox'), title = $('nuTitle'), creds = $('nuCreds');
        if (title) { title.innerHTML = good ? '<span style="color:var(--ok)">✅ המשתמש נוצר</span>' : '<span style="color:var(--danger)">❌ המשתמש לא נוצר</span>'; }
        if (box) { box.style.borderColor = good ? 'var(--ok)' : 'var(--danger)'; box.style.background = good ? 'rgba(22,163,74,.06)' : 'rgba(226,85,90,.06)'; }
        if (creds && good) creds.classList.remove('hidden');   // סיסמה מוצגת רק כשהיא באמת תקפה
        paint();
      });
      if (!emailDone) db.rpc('admin_net_result', { p_id: d.email_req }).then(function (r) {
        if (r.error || !r.data) return; emailDone = true; var b = netParse(r.data.content) || {};
        emailTxt = (r.data.status >= 200 && r.data.status < 300) ? '<span style="color:var(--ok)">✔ נשלח בהצלחה</span>' : '<span style="color:var(--danger)">✖ נכשל (' + r.data.status + '): ' + esc(b.message || b.error || '') + '</span> — כנראה הדומיין ב-Resend לא מאומת'; paint();
      });
    }, 1500);
  }

  // ---------- SETTINGS: managed field lists (admin) ----------
  //  המסך החזיק שבע קבוצות בגלילה אחת ארוכה. כל אחת מוצגת
  //  עכשיו בלשונית משלה, ורק המרנדר הרלוונטי רץ — מסך הטלפוניה
  //  לא מושך נתונים כשמסתכלים על רשימות.
  function renderSettings(sec) {
    sec = sec || 'lists';
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
      var HEAD = {
        lists: ['\ud83d\udccb רשימות ובחירות', 'הערכים שמופיעים כאפשרויות בחירה בשדות הליד ובסינון.'],
        integrations: ['\ud83d\udd0c חיבורים', 'מקורות הלידים החיצוניים והקליטה האוטומטית.'],
        brands: ['\ud83c\udff7\ufe0f מותגים', 'שיוך כל מותג לחברת השיווק שלו.'],
        quick: ['\ud83d\udcac הודעות מהירות', 'תבניות לשליחה מהירה מכרטיס הליד.'],
        phone: ['\u260e\ufe0f טלפוניה', 'חיוג מהמערכת וחיבור ManyChat.'],
        actions: ['\u26a1 פעולות', 'סרגל הפעולות שמופיע בכרטיס הליד.']
      };
      var hd = HEAD[sec] || HEAD.lists, mid = '';
      if (sec === 'lists') mid = '<div style="margin-bottom:16px"><button class="btn btn-sm" id="seedSources">\ud83c\udfaf טען מקורות מומלצים</button></div>' + warn + cards;
      else if (sec === 'integrations') mid = '<div id="integrationsCard"></div>';
      else if (sec === 'brands') mid = '<div id="brandMapCard"></div>';
      else if (sec === 'quick') mid = '<div id="quickMsgCard"></div>';
      else if (sec === 'phone') mid = '<div id="telephonyCard"></div><div id="manychatCard"></div>';
      else if (sec === 'actions') mid = actionEditorCard();
      view('<h2 style="margin:0 0 4px">' + hd[0] + '</h2>' +
        '<p class="muted" style="font-size:13px;margin-bottom:14px">' + hd[1] + '</p>' + mid);
      if (sec === 'actions') bindActionEditor();
      if (sec === 'integrations') renderIntegrations();
      if (sec === 'brands') renderBrandMap();
      if (sec === 'quick') renderQuickMsgs();
      if (sec === 'phone') { renderTelephony(); renderManychat(); }
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
    var PLAT = { google: ['🔍', 'Google Ads'], taboola: ['🟠', 'Taboola'], outbrain: ['🔵', 'Outbrain'], kishurit: ['🟢', 'קישורית'], webhook: ['🔗', 'Webhook כללי'], facebook: ['📘', 'פייסבוק'],
                 website: ['🌐', 'אתר / דף נחיתה'] };
    var HINT = {
      google: 'ב-Google Ads → טופס הליד → "Data integration / Webhook": הדביקו את ה-URL, ובשדה Key את המפתח (החלק שאחרי key= ב-URL).',
      taboola: 'ב-Taboola → Lead Generation → Webhook integration → הדביקו את ה-URL.',
      outbrain: 'ב-Outbrain → Lead generation → Webhook → הדביקו את ה-URL.',
      kishurit: 'בקישורית → הגדרת העברת לידים / postback → הדביקו את ה-URL (POST JSON).',
      webhook: 'כל מערכת (או Zapier / Make) — שלחו POST עם JSON של הליד ל-URL הזה.',
      website: 'בטופס באתר: action="<הכתובת שלמעלה>" method="POST". שמות השדות בעברית או באנגלית — המערכת מזהה לבד (שם, טלפון, מייל, עיר, רכב). אפשר גם POST עם JSON.'
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
        '<div id="fbSection" style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px"><div class="row-between"><b style="font-size:13.5px">📘 פייסבוק · טפסי לידים <span class="muted" style="font-weight:400;font-size:12px">(הדפים של המותג בלבד)</span></b><button class="btn btn-sm" id="fbLoad">🔄 טען טפסים מפייסבוק</button></div><div id="fbForms" style="margin-top:8px"></div></div>' +
        '<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px"><b style="font-size:13.5px">➕ הוספת חיבור</b>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
            '<select class="inp" id="niPlat" style="width:150px"><option value="google">🔍 Google Ads</option><option value="taboola">🟠 Taboola</option><option value="website">🌐 אתר / דף נחיתה</option><option value="outbrain">🔵 Outbrain</option><option value="kishurit">🟢 קישורית</option><option value="webhook">🔗 Webhook כללי</option></select>' +
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
            // דף שהוגדר למותג אך הטוקן לא מגיע אליו — הסיבה מוצגת במפורש,
            // אחרת המסך נראה תקין בזמן שהלידים בכלל לא נמשכים.
            if (p.no_access) {
              return '<div style="margin:6px 0;border:1px solid var(--warn);border-radius:10px;padding:10px 12px;background:rgba(240,180,40,.06)">' +
                '<b style="font-size:13px">' + esc(p.page_name) + '</b> <span class="muted" style="font-size:11.5px">· ' + esc(p.page_id) + '</span>' +
                '<div style="font-size:12px;color:var(--warn);margin-top:4px">⚠️ אין הרשאה לדף — לא ניתן לקרוא ממנו טפסים או לידים.</div>' +
                '<div class="muted" style="font-size:11.5px;margin-top:2px">שייכו את משתמש המערכת לדף בהגדרות הביזנס (הרשאת ניהול דף / גישה ללידים).</div></div>';
            }
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
