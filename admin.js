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
  //  hint — שורת הבהרה קטנה מתחת למספר. שני כרטיסים סמוכים יכולים
  //  להציג אותו מספר במקרה, ואז אי אפשר לדעת מה ההבדל ביניהם בלעדיה.
  function stat(k, v, trend, key, hint) {
    // trend===true נועד רק לסמן כרטיס "היום" (לא טקסט מגמה) — בעבר הודפס "true ▲"; עכשיו מוצג תג "היום".
    var live = trend === true;
    var ts = (trend && !live) ? String(trend) : '';
    var t = ts ? '<div class="t ' + (ts[0] === '-' ? 'down' : 'up') + '">' + (ts[0] === '-' ? '▼ ' : '▲ ') + esc(ts) + '</div>'
              : (live ? '<div class="t up">● היום</div>' : '');
    return '<div class="kpi' + (key ? ' click" data-kpi="' + esc(key) : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' +
      (hint ? '<div class="kh">' + esc(hint) + '</div>' : '') + t + '</div>';
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

  //  הורדה ישירה של מסמך. ה-download attribute לבדו לא עובד על כתובת
  //  ממקור אחר (Supabase Storage), ולכן מוסיפים ?download= \u2014 השרת מחזיר
  //  Content-Disposition: attachment והדפדפן שומר במקום לנווט.
  function downloadDoc(path, name) {
    db.storage.from('lead-docs').createSignedUrl(path, 3600).then(function (r) {
      var url = r && r.data && r.data.signedUrl;
      if (!url) { alert('לא ניתן להוריד את המסמך'); return; }
      url += (url.indexOf('?') < 0 ? '?' : '&') + 'download=' + encodeURIComponent(name || 'document');
      var a = document.createElement('a');
      a.href = url; a.download = name || ''; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
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
  window.C2B = { db: db, $: $, esc: esc, carImg: carImg, fmt: fmtDateTime, nis: nis, view: view, loading: loading, errBox: errBox, stat: stat, openDrawer: openDrawer, closeDrawer: closeDrawer, viewDoc: viewDoc, downloadDoc: downloadDoc, go: function (n, o) { return go(n, o); } };

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
  //  שתי לשוניות: מה שכבר עבר המועד ומה שעוד לפנינו. חלוקה לפי due_at
  //  ולא לפי סדר הכנסה — משימה באיחור היא הדבר היחיד שדורש פעולה עכשיו.
  var bellTab = 'late';
  function loadBell() {
    db.from('tasks').select('id,title,due_at,done,lead_id').eq('done', false).order('due_at', { ascending: true }).then(function (r) {
      var tasks = r.data || [], now = Date.now();
      var isLate = function (t) { return t.due_at && new Date(t.due_at).getTime() < now; };
      var late = tasks.filter(isLate), soon = tasks.filter(function (t) { return !isLate(t); });
      var b = $('bellBadge');
      if (tasks.length) { b.textContent = tasks.length; b.classList.remove('hidden'); b.style.background = late.length ? 'var(--danger)' : 'var(--ok)'; } else b.classList.add('hidden');
      //  אם אין משימות באיחור אין טעם לפתוח על לשונית ריקה
      if (bellTab === 'late' && !late.length && soon.length) bellTab = 'soon';
      var list = bellTab === 'late' ? late : soon;
      $('bellMenu').innerHTML =
        '<div class="bell-tabs">' +
          '<button class="late' + (bellTab === 'late' ? ' on' : '') + '" data-btab="late">\u23f0 עבר המועד (' + late.length + ')</button>' +
          '<button class="soon' + (bellTab === 'soon' ? ' on' : '') + '" data-btab="soon">\u2705 עוד לפנינו (' + soon.length + ')</button>' +
        '</div>' +
        (list.map(function (t) {
          var over = isLate(t);
          return '<div class="bt ' + (over ? 'over' : 'up') + '"' + (t.lead_id ? ' data-lead="' + t.lead_id + '"' : '') + '><span class="d"></span><div style="flex:1"><div>' + esc(t.title) + '</div><div class="muted" style="font-size:12px">' + (t.due_at ? fmtDateTime(t.due_at) : 'ללא מועד') + '</div></div></div>';
        }).join('') || '<div class="bt muted">' + (bellTab === 'late' ? 'אין משימות באיחור \ud83c\udf89' : 'אין משימות קרובות') + '</div>');
      $('bellMenu').querySelectorAll('[data-btab]').forEach(function (el) {
        el.addEventListener('click', function (e) { e.stopPropagation(); bellTab = el.dataset.btab; loadBell(); });
      });
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
    db.from('profiles').select('role,full_name,views,active,sip_ext,phone,agent_phone,is_super,org_id,super_acting_org').eq('user_id', session.user.id).single().then(function (r) {
      window.C2B.userSip = (r.data && r.data.sip_ext) || '';
      //  השם המלא משמש בהודעות המהירות של הווטסאפ ({{נציג}})
      window.C2B.fullName = (r.data && r.data.full_name) || '';
      window.C2B.userPhone = (r.data && r.data.phone) || '';
      //  מספר הנציג בוויס סנטר — קובע (יחד עם ה-RLS) אילו שיחות המשתמש רואה.
      window.C2B.agentPhone = (r.data && r.data.agent_phone) || '';
      // אכיפת השבתה — משתמש לא-פעיל מנותק מיד (בנוסף ל-RLS ו-Cloudflare Access)
      if (r.data && r.data.active === false) {
        db.auth.signOut().then(function () { showLogin(); });
        alert('החשבון שלך הושבת על ידי מנהל המערכת. לפרטים פנה למנהל.');
        return;
      }
      window.C2B.role = (r.data && r.data.role) || 'sales';
      //  סופר-אדמין = בעל הפלטפורמה (גישה חוצה-ארגונים + פתיחת ארגונים). נטען מ-profiles.is_super.
      window.C2B.isSuper = !!(r.data && r.data.is_super);
      //  מיתוג בזמן ריצה: כל ארגון רואה את השם/הצבע/הלוגו שלו (orgs.branding),
      //  במקום המיתוג המוטמע בבנייה. org 1 (פרי דרייב) נשאר כברירת מחדל.
      //  הארגון הפעיל: לסופר-אדמין — הארגון שבחר להיכנס אליו (super_acting_org),
      //  אחרת ארגון הבית. כך המיתוג/הנתונים משקפים את הארגון שרואים כרגע.
      window.C2B.homeOrgId = (r.data && r.data.org_id) || 1;
      window.C2B.orgId = (window.C2B.isSuper && r.data && r.data.super_acting_org) ? r.data.super_acting_org : window.C2B.homeOrgId;
      db.from('orgs').select('name,branding').eq('id', window.C2B.orgId).maybeSingle().then(function (o) {
        if (o && o.data) { var br = o.data.branding || {}; window.C2B.brand = { name: o.data.name, color: br.color, colorDeep: br.color_deep, logo: br.logo }; applyBranding(); }
        initOrgSwitcher();
      }, function () { initOrgSwitcher(); });
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

  // ---------- שעות פעילות המשרד וזמן תגובה ----------
  //  זמן תגובה נמדד בשעות שבהן אפשר בכלל לענות. ליד שנכנס בשישי אחר
  //  הצהריים ונענה בראשון ב-09:15 חיכה רבע שעת עבודה ולא יומיים; ספירת
  //  שעון קיר מדדה את לוח השנה במקום את הנציג, ועיוותה 24% מהלידים.
  window.C2B.office = { fromDow: 5, fromTime: '13:00', toDow: 0, toTime: '09:00' };
  //  היום והשעה נקבעים לפי אזור הזמן של המשרד ולא של הדפדפן, כדי שהחישוב
  //  לא יזוז למשתמש או לבדיקה שרצים במחשב עם שעון אחר.
  function ilShift(d) {
    return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })) -
           new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  }
  function hhmm(s) { var p = String(s || '0:0').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  //  סך הזמן שבו המשרד היה סגור בתוך הטווח [a,b], במילישניות
  function closedMs(a, b) {
    var o = window.C2B.office || {};
    var fd = +o.fromDow, td = +o.toDow, fm = hhmm(o.fromTime), tm = hhmm(o.toTime);
    if (isNaN(fd) || isNaN(td)) return 0;
    var span = ((td - fd + 7) % 7) * 864e5 + (tm - fm) * 60000;
    if (span <= 0) return 0;
    var A = a.getTime(), B = b.getTime(), sh = ilShift(a), WEEK = 7 * 864e5;
    var il = new Date(A + sh);
    //  מתחילים מהחלון הסגור האחרון שנפתח לפני תחילת הטווח, ומדלגים שבוע-שבוע
    var back = (il.getUTCDay() - fd + 7) % 7;
    var s = Date.UTC(il.getUTCFullYear(), il.getUTCMonth(), il.getUTCDate() - back) + fm * 60000 - sh;
    var out = 0;
    for (; s < B; s += WEEK) out += Math.max(0, Math.min(B, s + span) - Math.max(A, s));
    return out;
  }
  //  דקות תגובה בשעות פעילות. raw=true מחזיר שעון קיר מלא.
  window.C2B.respMins = function (from, to, raw) {
    var a = new Date(from), b = new Date(to), ms = b - a;
    if (!(ms > 0)) return 0;
    return Math.max(0, Math.round((raw ? ms : ms - closedMs(a, b)) / 60000));
  };
  window.C2B.respTxt = function (m) {
    if (m == null) return '—';
    if (m < 60) return Math.round(m) + ' דק\'';
    var h = Math.floor(m / 60), r = Math.round(m % 60);
    if (h >= 24) return Math.floor(h / 24) + ' ימים ' + (h % 24) + ' ש\'';
    return h + ' ש\'' + (r ? ' ' + r + ' דק\'' : '');
  };

  //  עורך שעות הפעילות — נפתח מגלגל השיניים שבבלוק "זמן תגובה" בדשבורד
  //  (במקום מסך הגדרות נפרד). שומר ל-app_config ומרענן את הדשבורד כדי
  //  שהמדד יחושב מחדש עם החלון החדש.
  window.C2B.editOfficeHours = function () {
    var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    var o = Object.assign({ fromDow: 5, fromTime: '13:00', toDow: 0, toTime: '09:00' }, window.C2B.office || {});
    function daySel(id, cur) {
      return '<select class="inp" id="' + id + '" style="width:120px">' + DAYS.map(function (d, i) {
        return '<option value="' + i + '"' + (+cur === i ? ' selected' : '') + '>' + d + '</option>';
      }).join('') + '</select>';
    }
    openDrawer('<div class="dw-head"><h3 style="margin:0">🕒 שעות פעילות המשרד</h3></div>' +
      '<div class="dw-body">' +
      '<p class="muted" style="font-size:13px;margin:0 0 14px;line-height:1.7">הזמן שבתוך החלון הסגור אינו נספר במדד <b>זמן תגובה</b>. ליד שנכנס בשישי אחר הצהריים ונענה בראשון בבוקר ייספר לפי דקות העבודה בפועל ולא לפי יומיים של לוח שנה.</p>' +
      '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">' +
        '<div class="field" style="margin:0"><label>סגור מיום</label>' + daySel('ohFromD', o.fromDow) + '</div>' +
        '<div class="field" style="margin:0"><label>בשעה</label><input class="inp" type="time" id="ohFromT" value="' + esc(o.fromTime) + '" style="width:120px"></div>' +
        '<div class="field" style="margin:0"><label>עד יום</label>' + daySel('ohToD', o.toDow) + '</div>' +
        '<div class="field" style="margin:0"><label>בשעה</label><input class="inp" type="time" id="ohToT" value="' + esc(o.toTime) + '" style="width:120px"></div>' +
      '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:12px" id="ohPreview"></p>' +
      '<div style="margin-top:16px;display:flex;gap:8px;align-items:center"><button class="btn" id="ohSave">💾 שמור</button><button class="btn btn-ghost" id="ohCancel">סגור</button><span id="ohMsg" style="font-size:12px"></span></div>' +
      '</div>');
    function preview() {
      var span = ((+$('ohToD').value - +$('ohFromD').value + 7) % 7) * 24 * 60 + (hhmm($('ohToT').value) - hhmm($('ohFromT').value));
      $('ohPreview').innerHTML = span > 0
        ? 'ℹ️ החלון נמשך <b>' + Math.floor(span / 60) + ' שעות</b> בכל שבוע.'
        : '<span style="color:var(--danger)">⚠ שעת הסיום מוקדמת מההתחלה — החלון ריק ושום דבר לא ינוכה.</span>';
    }
    ['ohFromD', 'ohFromT', 'ohToD', 'ohToT'].forEach(function (id) { $(id).addEventListener('change', preview); });
    preview();
    $('ohCancel').addEventListener('click', closeDrawer);
    $('ohSave').addEventListener('click', function () {
      var val = { fromDow: +$('ohFromD').value, fromTime: $('ohFromT').value, toDow: +$('ohToD').value, toTime: $('ohToT').value };
      var msg = $('ohMsg'); msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
      db.from('app_config').upsert({ org_id: window.C2B.orgId, key: 'office_hours', value: val, updated_at: new Date().toISOString() }, { onConflict: 'org_id,key' })
        .then(function (u) {
          if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
          window.C2B.office = val; msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר';
          if (window.C2B_renderDashboard) window.C2B_renderDashboard();
          setTimeout(closeDrawer, 700);
        });
    });
  };

  // ---------- Telephony (SIP / Click-to-Call) ----------
  window.C2B.tel = { mode: 'tel', sip_domain: '', webhook_url: '', country: '972' };
  //  הגדרות ההתראות (אילו סוגים פעילים) נשמרות בצד-שרת כדי שיחולו על כל
  //  הפרויקט — כל משתמש, המונה, ה-KPI והדוח — ולא רק על הדפדפן שבו הוגדרו.
  window.C2B.alertSettings = {};
  function loadConfig() {
    db.from('app_config').select('value').eq('key', 'telephony').maybeSingle().then(function (r) {
      if (r && r.data && r.data.value) window.C2B.tel = Object.assign({ mode: 'tel', sip_domain: '', webhook_url: '', country: '972' }, r.data.value);
    }, function () {});
    db.from('app_config').select('value').eq('key', 'office_hours').maybeSingle().then(function (r) {
      if (r && r.data && r.data.value) window.C2B.office = Object.assign({}, window.C2B.office, r.data.value);
    }, function () {});
    db.from('app_config').select('value').eq('key', 'alert_settings').maybeSingle().then(function (r) {
      if (r && r.data && r.data.value) { window.C2B.alertSettings = r.data.value; if (window.C2B.refreshBadges) refreshAlertBadge(); }
    }, function () {});
  }
  window.C2B.toast = function (msg, bad) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:' + (bad ? '#dc2626' : 'var(--brand,#c74e12)') + ';color:#fff;padding:10px 18px;border-radius:10px;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.22);font-size:14px;font-weight:600';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 420); }, 2600);
  };
  //  מיישם את מיתוג הארגון בזמן ריצה: כותרת הדף, צבע המותג, ולוגו/שם
  //  בסיידבר. ארגון 1 (פרי דרייב) עם מיתוג ריק → נשאר כמו שהוטמע בבנייה.
  //  קישור לוגו: קישור שיתוף של Google Drive אינו כתובת-תמונה ישירה ולכן
  //  לא נטען ב-<img>. ממירים אותו ל-lh3.googleusercontent.com/d/<id> שמגיש
  //  תמונות Drive ציבוריות ישירות. כל כתובת אחרת עוברת as-is.
  function logoUrl(raw) {
    if (!raw) return '';
    var s = String(raw).trim();
    var m = s.match(/drive\.google\.com\/file\/d\/([^/?]+)/) || s.match(/[?&]id=([^&]+)/) || s.match(/lh3\.googleusercontent\.com\/d\/([^=?&]+)/);
    if (m) return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w256';   // =w256 = רזולוציה טובה במקום תמונה זעירה
    return s;
  }
  //  חילוץ צבע המותג מהלוגו: טוענים דרך img-proxy (מגיש עם CORS) לתוך canvas
  //  ומוצאים את הצבע הרווח והרווי ביותר; deep = גרסה כהה שלו.
  function extractLogoColor(rawUrl, cb) {
    var url = logoUrl(rawUrl); if (!url) { cb(null); return; }
    var prox = 'https://gfwopgoydfqiouratcpc.supabase.co/functions/v1/img-proxy?u=' + encodeURIComponent(url);
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () {
      try {
        var s = 48, cv = document.createElement('canvas'); cv.width = s; cv.height = s;
        var ctx = cv.getContext('2d'); ctx.drawImage(im, 0, 0, s, s);
        var d = ctx.getImageData(0, 0, s, s).data, buckets = {};
        for (var i = 0; i < d.length; i += 4) {
          var r = d[i], g = d[i + 1], bl = d[i + 2], a = d[i + 3];
          if (a < 128) continue;
          var mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
          var sat = mx === 0 ? 0 : (mx - mn) / mx, lum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
          if (sat < 0.25 || lum < 0.12 || lum > 0.93) continue;   // דילוג על אפור/כמעט-שחור/כמעט-לבן
          var key = (r >> 5) + ',' + (g >> 5) + ',' + (bl >> 5);
          var bk = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
          bk.n++; bk.r += r; bk.g += g; bk.b += bl;
        }
        var best = null, bestScore = -1;
        Object.keys(buckets).forEach(function (k) {
          var bk = buckets[k], r = bk.r / bk.n, g = bk.g / bk.n, b = bk.b / bk.n;
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx;
          var score = bk.n * (0.5 + sat);
          if (score > bestScore) { bestScore = score; best = { r: Math.round(r), g: Math.round(g), b: Math.round(b) }; }
        });
        if (!best) { cb(null); return; }
        var hx = function (n) { return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2); };
        cb({ color: '#' + hx(best.r) + hx(best.g) + hx(best.b), deep: '#' + hx(Math.round(best.r * 0.68)) + hx(Math.round(best.g * 0.68)) + hx(Math.round(best.b * 0.68)) });
      } catch (e) { cb(null); }
    };
    im.onerror = function () { cb(null); };
    im.src = prox;
  }
  function applyBranding() {
    var b = window.C2B.brand || {};
    if (b.name) { try { document.title = b.name + ' · CRM'; } catch (e) { } }
    var root = document.documentElement;
    //  גוזרים את *כל* משתני המותג מצבע הארגון כדי שכל התצוגות ייצבעו לפיו
    //  (לא רק כפתורים): --brand-hi (היילייט/אקטיב-נאב), --brand-soft (רקעים
    //  רכים), --brand-ink (טקסט על רקע המותג, בניגודיות אוטומטית).
    if (b.color) {
      var hx = String(b.color).replace('#', '');
      var rgb = hx.length >= 6 ? { r: parseInt(hx.slice(0, 2), 16), g: parseInt(hx.slice(2, 4), 16), b: parseInt(hx.slice(4, 6), 16) } : null;
      var lum = rgb ? (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 : 0.4;
      root.style.setProperty('--brand-hi', b.color);
      //  לכפתורים (טקסט לבן) — אם המותג בהיר מדי, משתמשים בגוון הכהה שלו
      root.style.setProperty('--brand', (lum > 0.62 && b.colorDeep) ? b.colorDeep : b.color);
      if (rgb) root.style.setProperty('--brand-soft', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.12)');
      root.style.setProperty('--brand-ink', lum > 0.55 ? '#14180A' : '#ffffff');
    }
    if (b.colorDeep) root.style.setProperty('--brand-deep', b.colorDeep);
    var sb = document.querySelector('.side-brand'); if (!sb) return;
    var isDefault = !window.C2B.orgId || window.C2B.orgId === 1;
    if (isDefault) return;   // פרי דרייב — נשאר כפי שהוטמע (logo.png + CRM)
    var img = sb.querySelector('img'), crm = sb.querySelector('span:not(.brand-nm)');
    //  שם הארגון ליד ה-CRM (לפניו), מוצג גם כשיש לוגו.
    function ensureName() {
      var nm = sb.querySelector('.brand-nm');
      if (!nm) { nm = document.createElement('span'); nm.className = 'brand-nm'; nm.style.cssText = 'font-weight:800;font-size:16px;color:var(--side-txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px'; if (crm) sb.insertBefore(nm, crm); else sb.appendChild(nm); }
      nm.textContent = b.name || '';
    }
    //  לוגו על צ'יפ לבן מעוגל — נראה נקי על הסיידבר הכהה, בגודל אחיד.
    function niceLogo() { if (img) img.style.cssText = 'height:46px;width:auto;max-width:150px;object-fit:contain;background:#fff;border-radius:10px;padding:6px 10px;display:block;box-shadow:0 1px 3px rgba(0,0,0,.25)'; }
    var url = logoUrl(b.logo);
    if (url && img) {
      img.onerror = function () { img.style.display = 'none'; ensureName(); };  // לוגו שנכשל → שם בלבד
      img.onload = niceLogo;
      niceLogo(); img.src = url;
      ensureName();
    } else {
      if (img) img.style.display = 'none';
      ensureName();
    }
  }
  //  מחליף ארגונים בהדר — לסופר-אדמין בלבד. מציג את שם הארגון הנוכחי;
  //  לחיצה פותחת את רשימת הארגונים, ובחירה נכנסת אל ה-CRM של אותו ארגון.
  function initOrgSwitcher() {
    var wrap = document.getElementById('orgSwitch'); if (!wrap) return;
    if (!window.C2B.isSuper) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    var nameEl = document.getElementById('orgSwitchName');
    if (nameEl) nameEl.textContent = (window.C2B.brand && window.C2B.brand.name) || ('ארגון ' + window.C2B.orgId);
    var btn = document.getElementById('orgSwitchBtn'), menu = document.getElementById('orgSwitchMenu');
    if (!btn || !menu || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
      menu.innerHTML = '<div class="muted" style="padding:10px">טוען…</div>'; menu.classList.remove('hidden');
      db.from('orgs').select('id,name').order('id', { ascending: true }).then(function (r) {
        var orgs = (r && r.data) || [];
        menu.innerHTML = orgs.map(function (o) {
          var cur = o.id === window.C2B.orgId;
          return '<div data-sworg="' + o.id + '" style="cursor:pointer;padding:10px 13px;display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line)"' +
            ' onmouseover="this.style.background=\'var(--surface-2)\'" onmouseout="this.style.background=\'\'">' +
            esc(o.name) + (cur ? ' <b style="color:var(--brand)">✓</b>' : '') + '</div>';
        }).join('') || '<div class="muted" style="padding:10px">אין ארגונים</div>';
        menu.querySelectorAll('[data-sworg]').forEach(function (it) {
          it.addEventListener('click', function () {
            var oid = Number(it.dataset.sworg);
            if (oid === window.C2B.orgId) { menu.classList.add('hidden'); return; }
            it.textContent = 'עובר…';
            db.rpc('set_acting_org', { p_org: oid }).then(function (u) {
              if (u.error) { alert('שגיאה במעבר ארגון: ' + u.error.message); return; }
              location.reload();
            });
          });
        });
      });
    });
    document.addEventListener('click', function () { menu.classList.add('hidden'); });
  }
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
    admin: ['dashboard','leads','files','accounting','calls','cars','appointments','tasks','analytics',
            'reports','agents','ai','quotes','documents','whatsapp','heyy','emails','sms','automations','users','branches','trash','audit','ctemplates','settings'],
    // סוכן מכירות: כל התפעול שלו — בלי כספים, בלי דוחות/אנליטיקס, בלי ערוצי הודעות
    sales: ['dashboard', 'leads', 'files', 'calls', 'cars', 'appointments', 'tasks', 'ai', 'quotes', 'documents', 'heyy'],
    // מנהלת תיקי לקוחות: דשבורד, תיקי לקוחות, רכבים, יומן, משימות, הצעות מחיר, מסמכים והסכמים
    files: ['dashboard', 'files', 'calls', 'cars', 'appointments', 'tasks', 'quotes', 'documents', 'heyy'],
    // מנהלת חשבונות: דשבורד, הנהלת חשבונות, רכבים, יומן, משימות, דוחות, עוזר AI, הצעות מחיר, מסמכים והסכמים
    accounting: ['dashboard', 'accounting', 'calls', 'cars', 'appointments', 'tasks', 'reports', 'ai', 'quotes', 'documents', 'heyy'],
    // מנהל סניף: רואה הכל, למעט מסכי הניהול של המערכת (משתמשים, הגדרות, אוטומציות)
    branch: ['dashboard', 'leads', 'files', 'accounting', 'calls', 'cars', 'appointments', 'tasks', 'analytics',
             'reports', 'agents', 'ai', 'quotes', 'documents', 'whatsapp', 'heyy', 'emails', 'sms', 'users', 'audit']
  };
  // screens the admin can grant when creating a user (label + key)
  var GRANTABLE_VIEWS = [
    ['dashboard', 'דשבורד'], ['leads', 'לידים'], ['files', 'תיקי לקוחות'], ['accounting', 'הנהלת חשבונות'],
    ['calls', 'שיחות'], ['cars', 'רכבים'], ['appointments', 'יומן פגישות'], ['tasks', 'משימות'], ['analytics', 'אנליטיקס'], ['reports', 'דוחות'],
    ['ai', 'עוזר AI'], ['quotes', 'הצעות מחיר'], ['documents', 'מסמכים והסכמים'], ['whatsapp', 'WhatsApp'], ['heyy', 'Hey · WhatsApp'], ['emails', 'מיילים'], ['sms', 'SMS'],
    ['audit', 'יומן פעולות']
  ];
  // מסכי ניהול שאינם ניתנים להקצאה (מנהל מערכת בלבד) — כאן רק כדי שיוצגו בעברית
  var ADMIN_ONLY_VIEWS = { users: 'משתמשים והרשאות', settings: 'הגדרות ורשימות', branches: 'סניפים', ctemplates: 'תבניות הסכמים',
                           automations: 'אוטומציות', trash: 'סל מיחזור', agents: 'נציגים' };
  //  מסכים שפתוחים גם למנהל סניף. "משתמשים והרשאות" נפתח לו לצפייה בלבד:
  //  RLS מרשה לכל אנשי הצוות לקרוא פרופילים אבל רק למנהל מערכת לכתוב,
  //  ולכן כפתורי העריכה מוסתרים ממנו במקום להיכשל בשקט.
  var SENIOR_VIEWS = { users: 1, agents: 1, nurture: 1 };
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
      //  פריט סופר-אדמין (ניהול ארגונים) — רק לבעל הפלטפורמה, לא למנהל ארגון רגיל.
      if (it.dataset.super) { it.style.display = (window.C2B && window.C2B.isSuper) ? '' : 'none'; return; }
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
    calls: [
      ['calls', '\ud83d\udcca סקירה'], 
      ['calls:list', '\ud83d\udccb כל השיחות'], 
      ['calls:agents', '\ud83d\udc65 ביצועי נציגים'], 
      ['calls:todo', '\u26a0\ufe0f דורש חזרה'], 
      ['calls:ai', '\ud83e\udd16 ניתוח שיחות'],
      ['calls:reports', '📈 דוחות תקופתיים'],
      ['calls:objections', '⚠️ התנגדויות'],
      ['calls:alerts', '🔔 התראות'],
      ['calls:customers', '👤 לקוחות'],
      ['calls:trends', '📈 מגמות']
    ],
    settings: [
      ['settings', '\ud83d\udccb רשימות ובחירות'],
      ['settings:integrations', '\ud83d\udd0c חיבורים'],
      ['settings:connections', '🔗 חיבורי פלטפורמה'],
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

  //  אסימון תצוגה: כל ניווט מגדיל אותו; רינדור אסינכרוני מיושן (שנטען
  //  לפני שעברת מסך) מבוטל ולא דורס את המסך החדש.
  var viewToken = 0;
  function go(nav, opts) {
    opts = opts || {};
    viewToken++;
    if (window.C2B && window.C2B.role && !navAllowed(nav, window.C2B.role)) { nav = 'dashboard'; opts = {}; }
    drawSubnav(nav);
    if (nav === 'users') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderUsers(); }
    if (nav === 'orgs') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderOrgs(); }
    if (nav !== 'heyy') waUnwatch();
    if (nav === 'heyy') { waWatch(); setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderHeyy(); }
    if (nav === 'agents') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderAgents(); }
    if (nav === 'nurture') { setActive(nav); if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); } return renderNurture(); }
    setActive(nav, opts.status);
    if (window.innerWidth <= 820) { $('side').classList.remove('open'); $('overlay').classList.remove('open'); }
    if (nav === 'dashboard') return window.C2B_renderDashboard && window.C2B_renderDashboard();
    if (nav === 'leads') return window.C2B_renderLeads && window.C2B_renderLeads(opts.status);
    if (nav === 'files') return window.C2B_renderFiles && window.C2B_renderFiles();
    if (nav === 'accounting') return window.C2B_renderAccounting && window.C2B_renderAccounting();
    if (nav === 'activity') return window.C2B_renderActivity && window.C2B_renderActivity();
    if (navBase(nav) === 'calls') return renderCalls(nav.indexOf(':') > 0 ? nav.split(':')[1] : 'overview');
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
    refreshAlertBadge();
  }
  //  מונה התראות חדשות שלא נפתחו: שיחות שנותחו מאז הפעם האחרונה שנכנסת
  //  ל"התראות", שיש בהן דגל אדום / ציון נמוך / סנטימנט שלילי / רצון לבטל.
  //  ה-RLS כבר מסנן לפי המשתמש, אז נציג יראה רק את ההתראות שלו.
  function refreshAlertBadge() {
    var seen = '2000-01-01T00:00:00Z'; try { seen = localStorage.getItem('fdAlertsSeen') || seen; } catch (e) { }
    //  שולפים רק את תתי-השדות הדרושים מתוך crm_analysis (jsonb כבד) ולא את
    //  כל האובייקט — מוריד את המטען מ-~1.15MB ל-~73KB ומאיץ את טעינת הדף.
    db.from('calls').select('sc:crm_analysis->>score,se:crm_analysis->>sentiment,st:crm_analysis->>status_suggestion,rf:crm_analysis->red_flags,al:alert_sent_at').or(CALL_AGENT_OR).gt('crm_at', seen).not('crm_analysis', 'is', null).limit(500).then(function (r) {
      var n = 0;
      (r.data || []).forEach(function (c) {
        if (!c) return;
        var score = c.sc == null ? null : parseFloat(c.sc);
        //  סופרים רק סוגי התראה שפעילים בהגדרות (חל על כל הפרויקט).
        var hit = (alertOn('redflag') && Array.isArray(c.rf) && c.rf.length) ||
                  (alertOn('lowscore') && score != null && !isNaN(score) && score < 40) ||
                  (alertOn('negsent') && c.se === 'שלילי') ||
                  (alertOn('cancel') && c.st === 'lost') ||
                  (alertOn('legal') && !!c.al);
        if (hit) n++;
      });
      var el = $('bAlerts'); if (el) { el.textContent = n; el.classList.toggle('hidden', n === 0); }
    }, function () { });
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

  //  עמודה פשוטה לשדה שעד היום לא הוצג בטבלה. כולן כבויות כברירת מחדל
  //  כדי שהמסך הקיים לא ישתנה לאף אחד — מי שצריך מדליק אותן בבורר.
  //  o: { f: שם השדה במסד אם שונה מהמפתח, w, ltr, fmt }
  window.C2B.txtCol = function (key, label, o) {
    o = o || {};
    var f = o.f || key;
    return { key: key, label: label, w: o.w || 150, def: false,
      sort: function (r) { return r[f] == null ? '' : r[f]; },
      cell: function (r) {
        var v = r[f];
        if (o.fmt && v != null && v !== '') v = o.fmt(v);
        var t = (v == null || v === '') ? '' : String(v);
        return '<td class="muted' + (o.ltr ? ' ltr' : '') + '" title="' + esc(t) + '">' + esc(t || '—') + '</td>';
      } };
  };

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
      m.innerHTML = '<div class="cp-head">בחירת עמודות · גררו לשינוי סדר</div>' +
        '<input class="cp-find" type="search" placeholder="חיפוש שדה…" aria-label="חיפוש שדה" autocomplete="off">' +
        '<div class="cp-list">' +
        state.order.map(function (k) { var c = byKey[k], on = state.hidden.indexOf(k) < 0;
          return '<div class="cp-row" data-k="' + esc(k) + '"><span class="cp-mv" data-cpdrag tabindex="0" role="button" title="גררו לשינוי סדר (או חצים במקלדת)" aria-label="גררו לשינוי סדר">⠿</span><span class="cp-lbl">' + esc(c.label) + (c.fixed ? ' 🔒' : '') + '</span><label class="cp-sw"><input type="checkbox" data-cptg ' + (on ? 'checked' : '') + (c.fixed ? ' disabled' : '') + '><span class="cp-sl"></span></label></div>';
        }).join('') + '</div>' +
        '<div class="cp-empty" hidden>לא נמצא שדה בשם הזה</div>' +
        '<button class="btn btn-ghost btn-sm" data-cpreset style="width:100%;margin-top:8px">איפוס לברירת מחדל</button>';
      document.body.appendChild(m);
      var r = anchor.getBoundingClientRect();
      //  התפריט מיושר לקצה הימני של הכפתור, אבל לא מעבר לגבולות החלון:
      //  כשהכפתור יושב בצד שמאל של הסרגל היישור הזה דחף חלק ניכר מהתפריט
      //  אל מחוץ למסך, והוא נראה חתוך.
      var mw = m.offsetWidth || 280;
      m.style.right = Math.min(Math.max(8, window.innerWidth - r.right),
                               Math.max(8, window.innerWidth - mw - 8)) + 'px';
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
      //  חיפוש שדה. ברשימה של עשרות עמודות מהיר יותר להקליד "utm" מאשר
      //  לגלול. הסינון מסתיר שורות ואינו בונה את הרשימה מחדש, כך שמצב
      //  המתגים והסדר נשמרים ברגע שמנקים את החיפוש.
      var findEl = m.querySelector('.cp-find'), emptyEl = m.querySelector('.cp-empty');
      var findList = m.querySelector('.cp-list');
      findEl.addEventListener('input', function () {
        var q = findEl.value.trim().toLowerCase(), n = 0;
        findList.querySelectorAll('.cp-row').forEach(function (r) {
          var c = byKey[r.dataset.k] || {};
          var hit = !q || ((c.label || '') + ' ' + (c.key || '')).toLowerCase().indexOf(q) >= 0;
          r.classList.toggle('cp-off', !hit); if (hit) n++;
        });
        //  בזמן סינון אין גרירה: הסדר שנראה על המסך אינו הסדר האמיתי,
        //  וגרירה בתוכו הייתה מזיזה עמודה למקום שגוי.
        findList.classList.toggle('cp-filtered', !!q);
        emptyEl.hidden = n > 0;
      });
      findEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (findEl.value) { findEl.value = ''; findEl.dispatchEvent(new Event('input')); }
        else closeColPanel();
      });
      setTimeout(function () { findEl.focus(); }, 0);
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
        if (listEl.classList.contains('cp-filtered')) return;
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
      //  עמודות תאריך (descFirst) מתחילות ביורד — חדש→ישן — הסדר
      //  הטבעי למועד; שאר העמודות מתחילות בעולה (א→ת / קטן→גדול).
      var col = byKey[k], first = (col && col.descFirst) ? 'desc' : 'asc', second = first === 'asc' ? 'desc' : 'asc';
      if (!s || s.key !== k) state.sort = { key: k, dir: first };
      else if (s.dir === first) state.sort = { key: k, dir: second };
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

  // ---------- CALLS (שיחות טלפון מ-Voicenter) ----------
  //  המסך מחולק לתתי-תצוגות, בדומה למה שראינו אצל Nivision. ההבדל
  //  המהותי: כל מה שמבוסס על תמלול (סיכום, ציוני שיחה, סנטימנט, דגלים
  //  אדומים) אינו ניתן לחישוב כאן כל עוד ההקלטות נעולות מאחורי התחברות
  //  ו-aiData מגיע ריק. לכן נבנה כאן מה שאפשר לחשב באמת מנתוני ה-CDR,
  //  והשאר ממתין בלשונית משלו עם הסבר מה חסם אותו — במקום כרטיסים ריקים
  //  שנראים כמו תקלה.
  var CALL_COLS = [
    { key: 'when', label: 'מועד', w: 150, fixed: true, descFirst: true,
      sort: function (c) { return c.started_at || c.created_at || ''; },
      cell: function (c) { return '<td class="muted">' + esc(c.started_at ? fmtDateTime(c.started_at) : '—') + '</td>'; } },
    { key: 'dir', label: 'כיוון', w: 90,
      sort: function (c) { return c.direction || ''; },
      cell: function (c) {
        var d = c.direction === 'out' ? ['cl-out', '↗ יוצאת'] : c.direction === 'in' ? ['cl-in', '↙ נכנסת'] : ['', '—'];
        return '<td><span class="cl-dir ' + d[0] + '">' + d[1] + '</span></td>';
      } },
    { key: 'customer', label: 'מספר הלקוח', w: 150,
      sort: function (c) { return callPhone(c) || ''; },
      cell: function (c) {
        var p = callPhone(c);
        return '<td class="ltr">' + (p ? '<a class="call-ic" data-call="' + esc(p) + '">' + esc(p) + '</a>' : '—') + '</td>';
      } },
    { key: 'lead', label: 'ליד מקושר', w: 170,
      sort: function (c) { return c._lead ? c._lead.name || '' : ''; },
      cell: function (c) {
        return '<td>' + (c._lead
          ? '<a href="#" data-golead="' + esc(c.lead_id) + '"><b>' + esc(c._lead.name || 'ליד') + '</b></a>'
          : '<span class="muted">—</span>') + '</td>';
      } },
    { key: 'agent', label: 'נציג', w: 130,
      sort: function (c) { return agentOf(c); },
      cell: function (c) { return '<td>' + esc(agentOf(c)) + '</td>'; } },
    { key: 'dept', label: 'מחלקה / מותג', w: 150,
      sort: function (c) { return c.department || ''; },
      cell: function (c) { return '<td>' + (c.department ? '<span class="tag">' + esc(c.department) + '</span>' : '—') + '</td>'; } },
    { key: 'answered', label: 'נענתה', w: 100,
      sort: function (c) { return c.answered ? 1 : 0; },
      cell: function (c) {
        return '<td>' + (c.answered === true ? '<span class="cl-yes">✓ נענתה</span>'
          : c.answered === false ? '<span class="cl-no">✗ לא נענתה</span>' : '<span class="muted">—</span>') + '</td>';
      } },
    { key: 'talk', label: 'זמן שיחה', w: 110,
      sort: function (c) { return c.talk_sec || 0; },
      cell: function (c) { return '<td>' + (c.talk_sec ? esc(mmss(c.talk_sec)) : '<span class="muted">—</span>') + '</td>'; } },
    { key: 'rec', label: 'הקלטה', w: 240, sortable: false,
      //  נגן מוטמע רק כשהקובץ כבר בדלי שלנו. כתובת ההקלטה של Voicenter
      //  מוגנת בהתחברות ומחזירה דף כניסה במקום שמע — שם הנגן הציג 0:00.
      cell: function (c) {
        if (c.recording_path) return '<td><span data-recplay="' + esc(c.recording_path) + '" class="muted" style="font-size:11px">טוען…</span></td>';
        if (c.recording_url) return '<td><a class="btn btn-ghost btn-sm" href="' + esc(c.recording_url) + '" target="_blank" rel="noopener" title="' +
          esc(c.recording_err || 'הקובץ עדיין לא הורד אלינו') + '">🎧 ב-Voicenter</a></td>';
        return '<td><span class="muted">—</span></td>';
      } },
    { key: 'summary', label: 'סיכום השיחה', w: 300,
      sort: function (c) { return (c.crm_analysis && c.crm_analysis.summary) || c.ai_summary || ''; },
      cell: function (c) {
        var s = (c.crm_analysis && c.crm_analysis.summary) || c.ai_summary;
        return '<td>' + (s
          ? '<span class="cl-sum" title="' + esc(s) + '">' + esc(s) + '</span>'
          : (c.transcript ? '<span class="muted" style="font-size:11px">ממתין לניתוח</span>' : '<span class="muted">—</span>')) + '</td>';
      } },
    { key: 'suggest', label: 'סטטוס מומלץ', w: 140,
      sort: function (c) { return (c.crm_analysis && c.crm_analysis.status_suggestion) || ''; },
      cell: function (c) {
        var a = c.crm_analysis;
        if (!a || !a.status_suggestion) return '<td><span class="muted">—</span></td>';
        return '<td>' + badgeFor(a.status_suggestion, a.status_reason) + '</td>';
      } },
    { key: 'ai', label: 'תמלול', w: 90, def: false, sortable: false,
      cell: function (c) { return '<td>' + (c.transcript ? '<span class="cl-yes">✓</span>' : '<span class="muted">—</span>') + '</td>'; } },
    { key: 'status', label: 'סטטוס', w: 110, def: false,
      sort: function (c) { return c.status || ''; },
      cell: function (c) { return '<td class="muted ltr">' + esc(c.status || '—') + '</td>'; } },
    { key: 'did', label: 'מספר הארגון', w: 140, def: false,
      sort: function (c) { return c.did || ''; },
      cell: function (c) { return '<td class="muted ltr">' + esc(c.did || '—') + '</td>'; } },
    { key: 'ring', label: 'זמן צלצול', w: 110, def: false,
      sort: function (c) { return c.ring_sec || 0; },
      cell: function (c) { return '<td class="muted">' + (c.ring_sec != null ? c.ring_sec + ' ש\'' : '—') + '</td>'; } },
    { key: 'total', label: 'משך כולל', w: 110, def: false,
      sort: function (c) { return c.duration_sec || 0; },
      cell: function (c) { return '<td class="muted">' + (c.duration_sec ? esc(mmss(c.duration_sec)) : '—') + '</td>'; } },
    { key: 'company', label: 'חברה', w: 170, def: false,
      sort: function (c) { return c.top_department || ''; },
      cell: function (c) { return '<td class="muted">' + esc(c.top_department || '—') + '</td>'; } },
    { key: 'from', label: 'מאת', w: 140, def: false,
      cell: function (c) { return '<td class="muted ltr">' + esc(c.from_number || '—') + '</td>'; } },
    { key: 'to', label: 'אל', w: 140, def: false,
      cell: function (c) { return '<td class="muted ltr">' + esc(c.to_number || '—') + '</td>'; } },
    { key: 'open', label: '', w: 90, sortable: false,
      cell: function (c) { return '<td><button class="btn btn-ghost btn-sm" data-callinfo="' + esc(c.id) + '">פרטים</button></td>'; } }
  ];
  //  טווח התאריכים של מסך השיחות. callDays הוא פריסט (מספר ימים, או
  //  'today'/'yesterday'); callFrom/callTo הם טווח מותאם שגובר עליו.
  //  החישוב לפי שעון הדפדפן (ישראל), כי started_at נשמר כ-UTC אמיתי.
  var callCols = null, callDays = 7, callFrom = "", callTo = "";
  function callRange() {
    var now = new Date(), until = now.toISOString(), since;
    if (callFrom && callTo) {
      since = new Date(callFrom + "T00:00:00").toISOString();
      var u = new Date(callTo + "T00:00:00"); u.setDate(u.getDate() + 1);
      until = u.toISOString();
    } else if (callDays === "today") {
      var t = new Date(); t.setHours(0, 0, 0, 0); since = t.toISOString();
    } else if (callDays === "yesterday") {
      var y = new Date(); y.setHours(0, 0, 0, 0);
      until = y.toISOString(); y.setDate(y.getDate() - 1); since = y.toISOString();
    } else {
      since = new Date(Date.now() - (+callDays) * 864e5).toISOString();
    }
    return { since: since, until: until };
  }
  function callRangeLabel() {
    if (callFrom && callTo) return callFrom + " עד " + callTo;
    var L = { today: "היום", yesterday: "אתמול", 3650: "כל הזמן" };
    return L[callDays] || (callDays + " הימים האחרונים");
  }
  //  המסך מציג רק שיחות של שני נציגי פרי דרייב, לפי המספרים המדויקים.
  //  שיחה נכללת אם אחד המספרים מעורב בה (מתקשר או יעד).
  var CALL_AGENTS = ['533945097', '534493184', '534494707', '534495185', '534495197', '535463720', '539295952'];
  var CALL_AGENT_OR = CALL_AGENTS.map(function (n) { return 'from_number.ilike.*' + n + ',to_number.ilike.*' + n; }).join(',');
  //  Voicenter מחזירה ב-agent_name תוויות פנימיות (תור/רכז/DID) ולא את
  //  שם הנציג. לכן מזהים את הנציג לפי המספר (אחד מ-7) וממפים לשם הנכון.
  //  ליאור לוי מחזיק שני מספרים — שניהם ממופים אליו (איחוד).
  var AGENT_NAMES = { '534494707': 'שון', '539295952': 'עילאי', '534493184': 'אור', '535463720': 'נדב', '533945097': 'ליאור לוי (5097)', '534495197': 'ליאור לוי (5197)', '534495185': 'אילעי' };
  function agentOf(c) {
    var f = last9(c.from_number), t = last9(c.to_number);
    return AGENT_NAMES[f] || AGENT_NAMES[t] || (c.agent_name || '—');
  }
  //  המספר בן 9 הספרות של הנציג שדיבר (הצד שמזוהה בטבלת השמות) — לשיוך
  //  משימה לנציג הנכון דרך profiles.agent_phone.
  function agentNumOf(c) {
    var f = last9(c.from_number), t = last9(c.to_number);
    return AGENT_NAMES[f] ? f : (AGENT_NAMES[t] ? t : '');
  }
  //  Voicenter מפיקה רשומת CDR לכל צלצול; שיחה נכנסת שלא נענתה מופיעה
  //  עשרות פעמים בשניות. מכווצים רצף כזה (אותו לקוח+נציג+כיוון, לא נענו,
  //  בפער < 2 דק') לאירוע אחד עם ספירת ניסיונות (_attempts).
  function dedupeCalls(list) {
    var srt = list.slice().sort(function (a, b) {
      var ka = last9(callPhone(a)) + '|' + agentOf(a) + '|' + a.direction;
      var kb = last9(callPhone(b)) + '|' + agentOf(b) + '|' + b.direction;
      if (ka !== kb) return ka < kb ? -1 : 1;
      return new Date(a.started_at) - new Date(b.started_at);
    });
    var out = [], prev = null;
    srt.forEach(function (c) {
      if (c.answered !== true && prev && prev.answered !== true &&
          last9(callPhone(c)) === last9(callPhone(prev)) && agentOf(c) === agentOf(prev) &&
          c.direction === prev.direction &&
          Math.abs(new Date(c.started_at) - new Date(prev.started_at)) < 120000) {
        prev._attempts = (prev._attempts || 1) + 1; return;
      }
      c._attempts = 1; out.push(c); prev = c;
    });
    return out.sort(function (a, b) { return new Date(b.started_at) - new Date(a.started_at); });
  }
  //  כל מספר במסך מוביל לרשימה המסוננת שמאחוריו. הסינון מוחזק כאן ולא
  //  בכתובת, כדי שחזרה ללשונית תשמור את ההקשר שממנו הגעת.
  var callFilter = { dept: '', dir: '', ans: '', q: '', agent: '', hour: '', phone: '', rec: '', today: '', sentiment: '', ctype: '', scoreband: '', analyzed: '' };
  var CF_LABELS = { dept: 'מחלקה', dir: 'כיוון', ans: 'מענה', q: 'חיפוש', agent: 'נציג',
                    hour: 'שעה', phone: 'מספר', rec: 'הקלטה', today: 'תקופה',
                    sentiment: 'סנטימנט', ctype: 'סוג שיחה', scoreband: 'ציון', analyzed: 'ניתוח' };
  function cfText(k, v) {
    if (k === 'dir') return v === 'in' ? 'נכנסות' : 'יוצאות';
    if (k === 'ans') return v === 'y' ? 'נענו' : 'לא נענו';
    if (k === 'hour') return v + ':00';
    if (k === 'rec') return v === 'y' ? 'עם הקלטה' : 'בלי הקלטה';
    if (k === 'today') return 'היום בלבד';
    if (k === 'scoreband') return v === 'low' ? 'ציון נמוך (<40)' : v;
    if (k === 'analyzed') return 'נותחו בלבד';
    return v;
  }
  function cfClear() { Object.keys(callFilter).forEach(function (k) { callFilter[k] = ''; }); }
  //  מעבר לרשימה עם סינון. patch מחליף את הסינון הקיים ולא מצטבר עליו —
  //  לחיצה על מספר אחרת הייתה מחזירה תוצאה ריקה בגלל סינון קודם ששכחת.
  function goList(patch) {
    cfClear();
    Object.keys(patch || {}).forEach(function (k) { callFilter[k] = patch[k]; });
    go('calls:list');
  }
  function clickable(attrs, inner) { return '<a href="#" class="cl-go" ' + attrs + '>' + inner + '</a>'; }

  //  בניית הנגן ב-DOM ולא בהצבת HTML: הכתובת החתומה היא נתון חיצוני,
  //  ו-src שנקבע כתכונה אמיתית אינו יכול להימלט להקשר של תגית.
  function swapPlayer(el, url, cls) {
    var node;
    if (url) {
      node = document.createElement('audio');
      node.className = cls; node.controls = true;
      //  עמוד השיחה (cl-wide) טוען מראש את הקובץ הקטן (~120KB) כדי שהמשך
      //  יוצג ואפשר לנגן מיד; ברשימה טוענים רק מטא-דאטה לקִלוּת.
      node.preload = (cls === 'cl-wide') ? 'auto' : 'metadata'; node.src = url;
    } else {
      node = document.createElement('span');
      node.className = 'muted'; node.style.fontSize = '11px';
      node.textContent = 'ההקלטה לא נמצאה';
    }
    if (el.parentNode) el.parentNode.replaceChild(node, el);
  }

  //  ההמלצה היא המלצה בלבד ואינה משנה את הליד. תמלול אוטומטי שמשנה
  //  סטטוס לבד יעשה יותר נזק מתועלת ברגע שיטעה, ואיש לא יסמוך עליו אחר כך.
  var SUGGEST = {
    in_progress: ['בטיפול', 'var(--brand)'], meeting: ['נקבעה פגישה', '#0ea5e9'],
    quote: ['הצעת מחיר', '#a855f7'], no_answer: ['אין מענה', 'var(--warn)'],
    lost: ['לא רלוונטי', 'var(--danger)'], won: ['נסגרה', 'var(--ok)']
  };
  function badgeFor(k, why) {
    var s = SUGGEST[k] || [k, 'var(--muted)'];
    return '<span class="tag" style="background:' + s[1] + '18;color:' + s[1] + ';font-weight:700"' +
      (why ? ' title="' + esc(why) + '"' : '') + '>' + esc(s[0]) + '</span>';
  }

  function mmss(s) {
    s = Math.max(0, Math.round(+s || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function hms(s) {
    s = Math.round(+s || 0);
    var h = Math.floor(s / 3600);
    return h ? h + ' ש\' ' + Math.floor((s % 3600) / 60) + ' דק\'' : Math.floor(s / 60) + ' דק\'';
  }
  //  בשיחה נכנסת הלקוח הוא המתקשר; ביוצאת הוא היעד
  function callPhone(c) { return c.direction === 'out' ? c.to_number : c.from_number; }
  function last9(p) { return String(p || '').replace(/\D/g, '').slice(-9); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

  //  עמודות מיני — אותו רעיון של הגרפים בדוחות, בלי ספרייה חיצונית
  function miniBars(items, fmt) {
    var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1]));
    var H = 92;
    return '<div style="display:flex;align-items:flex-end;gap:4px;height:' + (H + 22) + 'px;direction:ltr;border-bottom:1px solid var(--line);padding-bottom:2px">' +
      items.map(function (i) {
        var barPx = i[1] ? Math.max(4, Math.round(i[1] / max * H)) : 0;
        return '<div class="cl-bar" ' + (i[1] ? 'data-go="{&quot;hour&quot;:&quot;' + (+i[0]) + '&quot;}" ' : '') +
          'style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;' + (i[1] ? 'cursor:pointer' : '') + '" title="' +
          esc(i[0] + ':00 · ' + (fmt ? fmt(i[1]) : i[1]) + (i[1] ? ' — לחצו לרשימה' : '')) + '">' +
          '<div style="font-size:9.5px;color:var(--muted);margin-bottom:2px">' + (i[1] || '') + '</div>' +
          '<div style="width:70%;max-width:24px;background:var(--brand);border-radius:3px 3px 0 0;height:' + barPx + 'px"></div></div>';
      }).join('') + '</div>' +
      '<div style="display:flex;gap:3px;direction:ltr;margin-top:4px">' +
        items.map(function (i, n) {
          return '<div style="flex:1;min-width:0;text-align:center;font-size:9.5px;color:var(--muted)">' +
            (n % 2 === 0 ? esc(i[0]) : '') + '</div>';
        }).join('') + '</div>';
  }


  //  שליפה מלאה בעמודים: PostgREST מגביל את מספר השורות לכל בקשה, ולכן
  //  שולפים עד שעמוד חוזר קטן מהמבוקש — כך לא מחסירים אף שיחה בטווח.
  function fetchAll(build) {
    return new Promise(function (resolve, reject) {
      var out = [], size = 1000;
      (function page(from) {
        build().range(from, from + size - 1).then(function (r) {
          if (r.error) return reject(r.error);
          var rows = r.data || [];
          out = out.concat(rows);
          if (rows.length < size) resolve(out); else page(from + size);
        }, reject);
      })(0);
    });
  }

  function renderCalls(sub) {
    sub = sub || 'overview';
    var myTok = ++viewToken;
    //  כניסה ל"התראות" מסמנת אותן כנקראו — מאפסת את מונה ההתראות בתפריט.
    if (sub === 'alerts') { try { localStorage.setItem('fdAlertsSeen', new Date().toISOString()); } catch (e) { } var _ab = $('bAlerts'); if (_ab) { _ab.textContent = '0'; _ab.classList.add('hidden'); } }
    loading();
    var rng = callRange();
    Promise.all([
      fetchAll(function () { return db.from('calls').select('*').or(CALL_AGENT_OR).gte('started_at', rng.since).lte('started_at', rng.until).order('started_at', { ascending: false }); }),
      fetchAll(function () { return db.from('leads').select('id,name,phone,status').is('deleted_at', null); })
    ]).then(function (res) {
      if (myTok !== viewToken) return;
      var all = dedupeCalls(res[0] || []), leads = res[1] || [], lmap = {}, byPhone = {};
      leads.forEach(function (l) { lmap[l.id] = l; if (l.phone) byPhone[last9(l.phone)] = l; });
      all.forEach(function (c) { c._lead = c.lead_id ? lmap[c.lead_id] : (byPhone[last9(callPhone(c))] || null); });

      var custom = !!(callFrom && callTo);
      var head = '<div class="row-between" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">' +
        '<h3 style="margin:0">📞 שיחות טלפון <span class="muted" style="font-size:12px;font-weight:400">· ' +
          all.length + ' שיחות · ' + esc(callRangeLabel()) + ' · מתעדכן אוטומטית</span></h3>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<select class="inp" id="clDays" style="width:150px"' + (custom ? ' disabled' : '') + '>' +
            [['today', 'היום'], ['yesterday', 'אתמול'], [7, '7 ימים אחרונים'], [30, '30 יום אחרונים'], [90, '90 יום אחרונים'], [180, 'חצי שנה אחרונה'], [365, 'שנה אחרונה'], [3650, 'כל הזמן']]
              .map(function (d) { return '<option value="' + d[0] + '"' + (String(callDays) === String(d[0]) ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') +
          '</select>' +
          '<span class="muted" style="font-size:12px">או טווח:</span>' +
          '<input class="inp" type="date" id="clFrom" value="' + esc(callFrom) + '" style="width:145px" title="מתאריך">' +
          '<input class="inp" type="date" id="clTo" value="' + esc(callTo) + '" style="width:145px" title="עד תאריך">' +
          (custom ? '<button class="btn btn-ghost btn-sm" id="clClear">נקה טווח</button>' : '') +
        '</div></div>';

      if (sub === 'list') paintList(all, head);
      else if (sub === 'agents') paintAgents(all, head);
      else if (sub === 'todo') paintTodo(all, head);
      else if (sub === 'ai') paintAi(all, head);
      else if (sub === 'reports') paintReports(all, head);
      else if (sub === 'objections') paintObjections(all, head);
      else if (sub === 'alerts') paintAlerts(all, head);
      else if (sub === 'customers') renderCustomers(all, head);
      else if (sub === 'trends') paintTrends(all, head);
      else paintOverview(all, head);

      if ($('clDays')) $('clDays').addEventListener('change', function () {
        var v = this.value; callDays = /^\d+$/.test(v) ? +v : v; callFrom = ""; callTo = ""; renderCalls(sub);
      });
      //  טווח מותאם: מחילים ברגע ששני התאריכים מלאים
      function onRange() {
        var f = $('clFrom').value, t = $('clTo').value;
        if (f && t) { if (f > t) { var x = f; f = t; t = x; } callFrom = f; callTo = t; renderCalls(sub); }
      }
      if ($('clFrom')) $('clFrom').addEventListener('change', onRange);
      if ($('clTo')) $('clTo').addEventListener('change', onRange);
      if ($('clClear')) $('clClear').addEventListener('click', function () { callFrom = ""; callTo = ""; renderCalls(sub); });
      wireCalls(all);
    }).catch(function (e) { errBox(e.message || e); });
  }

  // ---------- סקירה ----------
  //  צ'יפ ציון, נקודת סנטימנט, דונאט וסוגי שיחה — לוח מחוונים בסגנון
  //  שהלקוח ביקש: ציון שיחה, סנטימנט, סוגי שיחה והתראות ציון-נמוך.
  function scoreChip(n) {
    var col = n >= 70 ? 'var(--ok)' : n >= 40 ? 'var(--warn)' : 'var(--danger)';
    return '<span class="score-chip" style="background:' + col + '1f;color:' + col + '">' + n + '</span>';
  }
  function sentDot(s) {
    var m = { 'חיובי': 'var(--ok)', 'ניטרלי': 'var(--warn)', 'שלילי': 'var(--danger)' };
    return '<span style="color:' + (m[s] || 'var(--muted)') + ';font-weight:700">● ' + esc(s) + '</span>';
  }
  function sentDonut(pos, neu, neg) {
    var t = pos + neu + neg;
    if (!t) return '<div class="ai-empty">אין עדיין נתוני סנטימנט — יופיעו כשהשיחות ינותחו.</div>';
    var pa = pos / t * 360, na = neu / t * 360, P = function (x) { return Math.round(x / t * 100); };
    return '<div class="donut-wrap">' +
      '<div class="donut" style="background:conic-gradient(var(--ok) 0 ' + pa + 'deg,var(--warn) ' + pa + 'deg ' + (pa + na) + 'deg,var(--danger) ' + (pa + na) + 'deg 360deg)">' +
        '<div class="donut-hole"><div class="donut-num">' + P(pos) + '%</div><div class="donut-lbl">חיובי</div></div></div>' +
      '<div class="donut-leg">' +
        '<div class="cl-legrow" data-go="{&quot;sentiment&quot;:&quot;חיובי&quot;}"><span class="sdot" style="background:var(--ok)"></span>חיובי <b>' + pos + '</b> · ' + P(pos) + '%</div>' +
        '<div class="cl-legrow" data-go="{&quot;sentiment&quot;:&quot;ניטרלי&quot;}"><span class="sdot" style="background:var(--warn)"></span>ניטרלי <b>' + neu + '</b> · ' + P(neu) + '%</div>' +
        '<div class="cl-legrow" data-go="{&quot;sentiment&quot;:&quot;שלילי&quot;}"><span class="sdot" style="background:var(--danger)"></span>שלילי <b>' + neg + '</b> · ' + P(neg) + '%</div>' +
      '</div></div>';
  }
  function typeBars(types) {
    var keys = Object.keys(types).filter(function (k) { return types[k] > 0; });
    if (!keys.length) return '<div class="ai-empty">אין עדיין נתוני סוג שיחה.</div>';
    var max = Math.max.apply(null, keys.map(function (k) { return types[k]; }).concat([1]));
    var COL = { 'מכירה ראשונית': '#6366f1', 'המשך מכירה': 'var(--brand)', 'שירות': '#0ea5e9', 'לא רלוונטי': 'var(--danger)' };
    return keys.sort(function (a, b) { return types[b] - types[a]; }).map(function (k) {
      var w = Math.round(types[k] / max * 100);
      return '<div class="hbar-row" data-go="{&quot;ctype&quot;:&quot;' + esc(k) + '&quot;}" style="cursor:pointer"><div class="hbar-lbl">' + esc(k) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.max(4, w) + '%;background:' + (COL[k] || 'var(--brand)') + '"></div></div>' +
        '<div class="hbar-n">' + types[k] + '</div></div>';
    }).join('');
  }

  function paintOverview(all, head) {
    var ans = all.filter(function (c) { return c.answered === true; });
    var talk = ans.reduce(function (a, c) { return a + (+c.talk_sec || 0); }, 0);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todayN = all.filter(function (c) { return new Date(c.started_at) >= today; }).length;

    var az = all.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });
    var avgScore = az.length ? Math.round(az.reduce(function (a, c) { return a + c.crm_analysis.score; }, 0) / az.length) : null;
    var alerts = az.filter(function (c) { return c.crm_analysis.score < 40; }).sort(function (a, b) { return a.crm_analysis.score - b.crm_analysis.score; });
    //  התראות פעילות לפי ההגדרות (אותו חישוב כמו עמוד ההתראות) — כדי שה-KPI
    //  לא יסתור את העמוד כשמגבילים סוגי התראה.
    var activeAlerts = callAlerts(all);

    var sent = { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 };
    az.forEach(function (c) { var s = c.crm_analysis.sentiment; if (sent[s] !== undefined) sent[s]++; });
    var types = { 'מכירה ראשונית': 0, 'המשך מכירה': 0, 'שירות': 0, 'לא רלוונטי': 0 };
    az.forEach(function (c) { var t = c.crm_analysis.call_type; if (t) types[t] = (types[t] || 0) + 1; });

    var hours = {}, i;
    for (i = 7; i <= 21; i++) hours[i] = 0;
    all.forEach(function (c) { if (!c.started_at) return; var h = new Date(c.started_at).getHours(); if (hours[h] !== undefined) hours[h]++; });
    var hourItems = Object.keys(hours).map(function (h) { return [(h < 10 ? '0' : '') + h, hours[h]]; });

    var byAg = {};
    all.forEach(function (c) {
      var k = agentOf(c);
      byAg[k] = byAg[k] || { n: 0, ans: 0, talk: 0, scores: [], sent: { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 }, sugg: {} };
      var o = byAg[k]; o.n++;
      if (c.answered) { o.ans++; o.talk += (+c.talk_sec || 0); }
      var a = c.crm_analysis;
      if (a) {
        if (typeof a.score === 'number') o.scores.push(a.score);
        if (o.sent[a.sentiment] !== undefined) o.sent[a.sentiment]++;
        if (a.status_suggestion) o.sugg[a.status_suggestion] = (o.sugg[a.status_suggestion] || 0) + 1;
      }
    });
    var maxTalk = Math.max.apply(null, Object.keys(byAg).map(function (k) { return byAg[k].talk; }).concat([1]));
    var agRows = Object.keys(byAg).sort(function (a, b) { return byAg[b].n - byAg[a].n; }).map(function (k) {
      var o = byAg[k];
      var sc = o.scores.length ? Math.round(o.scores.reduce(function (a, b) { return a + b; }, 0) / o.scores.length) : null;
      var ts = ['חיובי', 'ניטרלי', 'שלילי'].sort(function (a, b) { return o.sent[b] - o.sent[a]; })[0];
      var top = Object.keys(o.sugg).sort(function (a, b) { return o.sugg[b] - o.sugg[a]; })[0];
      var A = function (extra, txt) { return clickable('data-go=\'{"agent":"' + esc(k) + '"' + extra + '}\'', txt); };
      return '<tr><td><b>' + A('', esc(k)) + '</b></td>' +
        '<td>' + A('', o.n) + '</td>' +
        '<td>' + (sc != null ? scoreChip(sc) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (o.sent[ts] ? sentDot(ts) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (o.ans ? esc(mmss(o.talk / o.ans)) : '—') + '</td>' +
        '<td><div class="talk-cell"><div class="talk-bar"><div class="talk-fill" style="width:' + Math.round(o.talk / maxTalk * 100) + '%"></div></div><span>' + hms(o.talk) + '</span></div></td>' +
        '<td>' + (top ? badgeFor(top, '') : '<span class="muted">—</span>') + '</td></tr>';
    }).join('');

    var alertRows = alerts.slice(0, 8).map(function (c) {
      return '<tr data-callinfo="' + esc(c.id) + '" style="cursor:pointer" title="לחצו לפרטי השיחה">' +
        '<td>' + scoreChip(c.crm_analysis.score) + '</td><td>' + esc(agentOf(c)) + '</td>' +
        '<td class="ltr">' + esc(callPhone(c) || '—') + '</td>' +
        '<td class="muted cl-sum">' + esc((c.crm_analysis.summary || '').slice(0, 90)) + '</td>' +
        '<td class="muted">' + esc(fmtDateTime(c.started_at)) + '</td></tr>';
    }).join('');

    var recent = all.slice(0, 10).map(function (c) {
      var a = c.crm_analysis;
      return '<tr data-callinfo="' + esc(c.id) + '" style="cursor:pointer" title="לחצו לפרטי השיחה"><td class="muted">' + esc(fmtDateTime(c.started_at)) + '</td>' +
        '<td><span class="cl-dir ' + (c.direction === 'out' ? 'cl-out">↗' : 'cl-in">↙') + '</span></td>' +
        '<td class="ltr">' + esc(callPhone(c) || '—') + '</td>' +
        '<td>' + esc(agentOf(c)) + '</td>' +
        '<td>' + (a && typeof a.score === 'number' ? scoreChip(a.score) : '—') + '</td>' +
        '<td>' + (c.answered ? '<span class="cl-yes">✓</span>' : '<span class="cl-no">✗</span>') + '</td>' +
        '<td>' + (c.talk_sec ? esc(mmss(c.talk_sec)) : '—') + '</td></tr>';
    }).join('');

    view('<div class="card">' + head +
      '<div class="cards" style="margin-bottom:16px">' +
        stat('שיחות היום', todayN, true, 'today') +
        stat('סה"כ בטווח', all.length, null, 'all') +
        stat('שיחות שנענו', ans.length, null, 'ansOnly', 'שיחות בפועל עם לקוחות') +
        stat('שיעור מענה', pct(ans.length, all.length) + '%', null, 'ansOnly') +
        stat('משך שיחה ממוצע', ans.length ? mmss(talk / ans.length) : '—', null, 'ansOnly') +
        stat('ציון שיחה ממוצע', avgScore != null ? avgScore : '—', null, 'analyzed', az.length + ' נותחו') +
        stat('התראות פעילות', activeAlerts.length, null, 'alerts', 'לפי סוגי ההתראות הפעילים') +
      '</div>' +
      '<div class="grid2" style="gap:14px">' +
        '<div class="card cl-sub"><h3 class="cl-h">😊 סנטימנט שיחות</h3>' + sentDonut(sent['חיובי'], sent['ניטרלי'], sent['שלילי']) + '</div>' +
        '<div class="card cl-sub"><h3 class="cl-h">🏷️ סוגי שיחה</h3>' + typeBars(types) + '</div>' +
      '</div>' +
      '<div class="grid2" style="gap:14px;margin-top:14px">' +
        '<div class="card cl-sub"><h3 class="cl-h">🕐 שיחות לפי שעה</h3>' + miniBars(hourItems) + '</div>' +
        '<div class="card cl-sub"><h3 class="cl-h">👥 ביצועי נציגים</h3>' +
          '<div class="table-scroll"><table><thead><tr><th>נציג</th><th>שיחות</th><th>ציון</th><th>סנטימנט</th><th>משך ממוצע</th><th>זמן שיחה בפועל</th><th>תוצאה נפוצה</th></tr></thead>' +
          '<tbody>' + (agRows || '<tr><td colspan="7" class="empty">אין נתונים</td></tr>') + '</tbody></table></div></div>' +
      '</div>' +
      (alerts.length && alertOn('lowscore') ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">⚠️ התראות — שיחות בציון נמוך</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>ציון</th><th>נציג</th><th>מספר</th><th>סיכום</th><th>מועד</th></tr></thead>' +
        '<tbody>' + alertRows + '</tbody></table></div></div>' : '') +
      '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">⏱️ שיחות אחרונות</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>מועד</th><th>כיוון</th><th>מספר</th><th>נציג</th><th>ציון</th><th>נענתה</th><th>משך</th></tr></thead>' +
        '<tbody>' + (recent || '<tr><td colspan="7" class="empty">אין שיחות</td></tr>') + '</tbody></table></div></div>' +
      '</div>');
  }

  // ---------- ביצועי נציגים ----------
  function paintAgents(all, head) {
    var by = {};
    all.forEach(function (c) {
      var k = agentOf(c);
      by[k] = by[k] || { n: 0, ans: 0, out: 0, inn: 0, talk: 0, last: null, depts: {}, scores: [], sent: { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 }, sugg: {}, alerts: 0 };
      var o = by[k]; o.n++;
      if (c.answered) { o.ans++; o.talk += (+c.talk_sec || 0); }
      if (c.direction === 'out') o.out++; else if (c.direction === 'in') o.inn++;
      if (!o.last || c.started_at > o.last) o.last = c.started_at;
      if (c.department) o.depts[c.department] = (o.depts[c.department] || 0) + 1;
      var a = c.crm_analysis;
      if (a) {
        if (typeof a.score === 'number') { o.scores.push(a.score); if (a.score < 40) o.alerts++; }
        if (o.sent[a.sentiment] !== undefined) o.sent[a.sentiment]++;
        if (a.status_suggestion) o.sugg[a.status_suggestion] = (o.sugg[a.status_suggestion] || 0) + 1;
      }
    });
    var maxTalk = Math.max.apply(null, Object.keys(by).map(function (k) { return by[k].talk; }).concat([1]));
    var rows = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n; }).map(function (k) {
      var o = by[k];
      var dept = Object.keys(o.depts).sort(function (a, b) { return o.depts[b] - o.depts[a]; })[0] || '—';
      var rate = pct(o.ans, o.n);
      var sc = o.scores.length ? Math.round(o.scores.reduce(function (a, b) { return a + b; }, 0) / o.scores.length) : null;
      var ts = ['חיובי', 'ניטרלי', 'שלילי'].sort(function (a, b) { return o.sent[b] - o.sent[a]; })[0];
      var top = Object.keys(o.sugg).sort(function (a, b) { return o.sugg[b] - o.sugg[a]; })[0];
      var A = function (extra, txt) { return clickable('data-go=\'{"agent":"' + esc(k) + '"' + extra + '}\'', txt); };
      return '<tr><td><b>' + A('', esc(k)) + '</b></td>' +
        '<td>' + A('', o.n) + '</td>' +
        '<td>' + (o.out ? A(',"dir":"out"', o.out) : '0') + '</td>' +
        '<td>' + (o.inn ? A(',"dir":"in"', o.inn) : '0') + '</td>' +
        '<td><span style="color:' + (rate >= 70 ? 'var(--ok)' : rate >= 40 ? 'var(--warn)' : 'var(--danger)') + ';font-weight:700">' + rate + '%</span></td>' +
        '<td>' + (o.ans ? esc(mmss(o.talk / o.ans)) : '—') + '</td>' +
        '<td><div class="talk-cell"><div class="talk-bar"><div class="talk-fill" style="width:' + Math.round(o.talk / maxTalk * 100) + '%"></div></div><span>' + hms(o.talk) + '</span></div></td>' +
        '<td>' + (sc != null ? scoreChip(sc) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (o.sent[ts] ? sentDot(ts) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (o.alerts ? '<span style="color:var(--danger);font-weight:700">' + o.alerts + '</span>' : '0') + '</td>' +
        '<td>' + (top ? badgeFor(top, '') : '<span class="muted">—</span>') + '</td>' +
        '<td><span class="tag">' + esc(dept) + '</span></td></tr>';
    }).join('');
    view('<div class="card">' + head +
      '<p class="muted" style="font-size:12.5px;margin:0 0 12px;line-height:1.7">' +
      'הטבלה משלבת נתוני CDR (כמות, כיוון, מענה, משך) עם ניתוח ה-AI של השיחות (ציון, סנטימנט, התראות ותוצאה נפוצה). ' +
      'לחצו על שם נציג או על מספר כדי לסנן את הרשימה.</p>' +
      '<div class="table-scroll"><table><thead><tr>' +
        '<th>נציג</th><th>שיחות</th><th>יוצאות</th><th>נכנסות</th><th>שיעור מענה</th>' +
        '<th>משך ממוצע</th><th>זמן שיחה בפועל</th><th>ציון ממוצע</th><th>סנטימנט</th><th>התראות</th><th>תוצאה נפוצה</th><th>מחלקה</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="12" class="empty">אין נתונים</td></tr>') + '</tbody></table></div></div>');
  }

  // ---------- דוחות תקופתיים ----------
  //  אגרגציה מצטברת על כל השיחות בטווח — ביצועי נציגים, התנגדויות,
  //  דגלים אדומים ומיקוד אימון. בסגנון הדוחות התקופתיים של Nivision,
  //  מחושב מנתוני ה-crm_analysis של כל שיחה (בלי עלות AI נוספת).
  function avg(arr) { return arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : null; }

  //  דוח אימון מנהלים ב-AI: הפקה ב-call-report + מטמון ב-localStorage.
  function renderMgrReport(R, stats) {
    var priCol = function (p) { return /דחוף/.test(p) ? 'var(--danger)' : /השפעה/.test(p) ? 'var(--warn)' : 'var(--brand)'; };
    var kpi = function (k, v, sub) { return '<div class="mgr-kpi"><div class="mgr-kv">' + v + '</div><div class="mgr-kk">' + esc(k) + '</div>' + (sub ? '<div class="mgr-ks">' + esc(sub) + '</div>' : '') + '</div>'; };
    var h = '';
    if (R.greeting) h += '<div class="mgr-greet">\u2728 ' + esc(R.greeting) + '</div>';
    if (R.exec_summary) h += '<div class="cv-txt" style="margin:10px 0 14px;line-height:1.75">' + esc(R.exec_summary) + '</div>';
    h += '<div class="mgr-kpis">' + kpi('שיחות שנותחו', stats.total) + kpi('\u05e6\u05d9\u05d5\u05df \u05e6\u05d5\u05d5\u05ea', stats.teamScore) + kpi('\u05e2\u05e1\u05e7\u05d0\u05d5\u05ea', stats.deals) + kpi('\u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05d9\u05d5\u05ea', stats.objections, stats.objections ? Math.round(stats.objResolved / stats.objections * 100) + '% \u05d8\u05d5\u05e4\u05dc\u05d5' : '') + kpi('\u05d3\u05d2\u05dc\u05d9\u05dd \u05d0\u05d3\u05d5\u05de\u05d9\u05dd', stats.redFlags) + '</div>';
    if ((R.actions || []).length) {
      h += '<h4 class="mgr-h">3 \u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05dc\u05e4\u05d9 \u05e2\u05d3\u05d9\u05e4\u05d5\u05ea</h4>';
      R.actions.forEach(function (a) {
        h += '<div class="mgr-act" style="border-inline-start-color:' + priCol(a.priority) + '"><div><span class="tag" style="background:' + priCol(a.priority) + '22;color:' + priCol(a.priority) + '">' + esc(a.priority || '') + '</span> <b>' + esc(a.title || '') + '</b> <span class="muted" style="font-size:11.5px">' + esc(a.agent || '') + (a.when ? ' \u00b7 ' + esc(a.when) : '') + '</span></div>' + (a.detail ? '<div class="cv-txt" style="margin-top:4px">' + esc(a.detail) + '</div>' : '') + (a.impact ? '<div class="muted" style="font-size:12px;margin-top:3px">\ud83d\udcc8 ' + esc(a.impact) + '</div>' : '') + '</div>';
      });
    }
    if ((R.focus_agents || []).length) {
      h += '<h4 class="mgr-h">\u05de\u05d9\u05e7\u05d5\u05d3 \u05d0\u05d9\u05de\u05d5\u05df \u05e4\u05e8-\u05e0\u05e6\u05d9\u05d2</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">';
      R.focus_agents.forEach(function (f) {
        h += '<div class="card cl-sub" style="margin:0"><div class="row-between"><b>' + esc(f.name || '') + '</b>' + (f.score != null ? scoreChip(f.score) : '') + '</div>' + (f.topic ? '<div style="font-size:12.5px;font-weight:600;margin-top:5px">' + esc(f.topic) + '</div>' : '') + (f.why ? '<div class="muted" style="font-size:12px;margin-top:3px">' + esc(f.why) + '</div>' : '') + ((f.checklist || []).length ? '<ul class="cv-ul" style="margin-top:6px">' + f.checklist.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      });
      h += '</div>';
    }
    if (R.workshop && R.workshop.topic) {
      h += '<h4 class="mgr-h">\u05e1\u05d3\u05e0\u05ea \u05e6\u05d5\u05d5\u05ea \u05e9\u05d1\u05d5\u05e2\u05d9\u05ea</h4><div class="card cl-sub" style="margin:0"><b>' + esc(R.workshop.topic) + '</b>' + ((R.workshop.why || []).length ? '<ul class="cv-ul" style="margin-top:6px">' + R.workshop.why.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + ((R.workshop.structure || []).length ? '<div class="cv-sub-h">\u05de\u05d1\u05e0\u05d4 \u05d4\u05e1\u05d3\u05e0\u05d4</div><ul class="cv-ul">' + R.workshop.structure.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    }
    if ((R.targets || []).length) {
      h += '<h4 class="mgr-h">\u05d9\u05e2\u05d3\u05d9\u05dd \u05dc\u05de\u05d7\u05e8</h4><div class="mgr-kpis">' + R.targets.map(function (t) { return '<div class="mgr-kpi"><div class="mgr-kk">' + esc(t.metric) + '</div><div style="font-size:14px;font-weight:700;margin-top:3px">' + esc(t.current) + ' \u2192 <span style="color:var(--ok)">' + esc(t.goal) + '</span></div></div>'; }).join('') + '</div>';
    }
    return h;
  }
  function wireMgrReport() {
    var rng = callRange(), lbl = callRangeLabel();
    var body = $('mgrBody'), btn = $('mgrGen'), list = $('mgrList'); if (!btn || !body) return;
    var rows = [];
    function showReport(rec, note) {
      body.innerHTML = renderMgrReport(rec.data || rec.report, rec.stats) +
        (note ? '<div class="muted" style="font-size:11px;margin-top:10px">' + esc(note) + '</div>' : '');
    }
    //  פאנל ימני: כל הדוחות השמורים לפי תאריך, שעה ושם — לראות שיפור מיום ליום.
    function renderList(selDate) {
      if (!list) return;
      list.innerHTML = '<div class="mgr-list-h">דוחות שמורים · ' + rows.length + '</div>' + (rows.length ? rows.map(function (x) {
        var dt = new Date(x.created_at);
        return '<button class="mgr-item' + (x.report_date === selDate ? ' active' : '') + '" data-rd="' + esc(x.report_date) + '">' +
          esc(x.label || ('דוח ' + x.report_date)) +
          '<span class="d">' + esc(x.report_date) + ' · ' + dt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + '</span></button>';
      }).join('') : '<div class="muted" style="font-size:12px;padding:10px">אין עדיין דוחות שמורים</div>');
      list.querySelectorAll('[data-rd]').forEach(function (b) {
        b.addEventListener('click', function () { var rec = rows.filter(function (x) { return x.report_date === b.dataset.rd; })[0]; if (rec) { renderList(b.dataset.rd); showReport(rec, 'דוח מ-' + rec.report_date + ' · נשמר ' + new Date(rec.created_at).toLocaleString('he-IL')); } });
      });
    }
    function loadHist(selDate) {
      db.from('call_reports').select('report_date,label,data,stats,created_at').eq('report_type', 'manager').order('report_date', { ascending: false }).limit(120).then(function (r) {
        rows = (r && r.data) || [];
        var pick = selDate ? rows.filter(function (x) { return x.report_date === selDate; })[0] : rows[0];
        renderList(pick ? pick.report_date : null);
        if (pick) showReport(pick, 'דוח מ-' + pick.report_date + ' · נשמר ' + new Date(pick.created_at).toLocaleString('he-IL'));
        else body.innerHTML = '<div class="muted" style="font-size:12.5px">אין עדיין דוחות שמורים. לחצו "צור לטווח הנוכחי" לדוח הראשון (הוא יישמר, ומחר יופק דוח יומי אוטומטי).</div>';
      }, function () { });
    }
    function gen() {
      btn.disabled = true; btn.textContent = 'מפיק…'; body.innerHTML = '<div class="ai-empty">מפיק דוח אימון (עד ~20 שניות)…</div>';
      db.functions.invoke('call-report', { body: { since: rng.since, until: rng.until, label: lbl } }).then(function (r) {
        btn.disabled = false; btn.textContent = '✨ צור לטווח הנוכחי';
        var d = (r && r.data) || {};
        if (d.error || !d.report) { body.innerHTML = '<div class="ai-empty">' + (d.empty ? 'אין נתונים בטווח.' : 'שגיאה: ' + esc(d.error || 'לא ידועה')) + '</div>'; return; }
        showReport(d, 'נוצר עכשיו · נשמר ל-' + d.report_date); loadHist(d.report_date);
      }, function () { btn.disabled = false; btn.textContent = '✨ צור לטווח הנוכחי'; body.innerHTML = '<div class="ai-empty">שגיאה בהפקה</div>'; });
    }
    btn.addEventListener('click', gen);
    loadHist();
  }

  //  כרטיס נציג מפורט — drill-down בלחיצה על שם נציג בדוחות.
  function acInfo(k, v, cls) { return '<div class="cv-info-item"><div class="cv-info-k">' + esc(k) + '</div><div class="cv-info-v ' + (cls || '') + '">' + esc(v) + '</div></div>'; }
  function renderAgentCard(name, all) {
    var calls = all.filter(function (c) { return (agentOf(c)) === name; });
    var az = calls.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });
    var ans = calls.filter(function (c) { return c.answered === true; });
    var talk = ans.reduce(function (a, c) { return a + (+c.talk_sec || 0); }, 0);
    var won = calls.filter(function (c) { return c.crm_analysis && c.crm_analysis.status_suggestion === 'won'; }).length;

    var sc = [], skk = { objection_handling: [], empathy: [], clarity: [], needs_discovery: [] }, enk = { confidence: [], courtesy: [], patience: [], initiative: [], optimism: [] };
    var sent = { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 }, sentScores = [], str = {}, weak = {}, flags = 0;
    var objs = [], stageAgg = {}, styles = {};
    az.forEach(function (c) {
      var a = c.crm_analysis; sc.push(a.score);
      var s = a.agent_skills || {}; Object.keys(skk).forEach(function (k) { if (typeof s[k] === 'number') skk[k].push(s[k]); });
      var e = a.agent_energy || {}; Object.keys(enk).forEach(function (k) { if (typeof e[k] === 'number') enk[k].push(e[k]); });
      if (sent[a.sentiment] !== undefined) sent[a.sentiment]++;
      if (typeof a.sentiment_call === 'number') sentScores.push(a.sentiment_call);
      (a.agent_strengths || []).forEach(function (x) { str[x] = (str[x] || 0) + 1; });
      (a.agent_weaknesses || []).forEach(function (x) { weak[x] = (weak[x] || 0) + 1; });
      flags += (a.red_flags || []).length;
      (a.objections_detailed || []).forEach(function (o) { objs.push(o); });
      (a.stages || []).forEach(function (st) { var t = st.title || '—'; var o = stageAgg[t] || (stageAgg[t] = { n: 0, s: [] }); o.n++; if (typeof st.score === 'number') o.s.push(st.score); });
      if (a.sales_style) styles[a.sales_style] = (styles[a.sales_style] || 0) + 1;
    });
    var score = avg(sc), sentAvg = sentScores.length ? Math.round(sentScores.reduce(function (a, b) { return a + b; }, 0) / sentScores.length * 10) / 10 : null;
    var topStr = Object.keys(str).sort(function (a, b) { return str[b] - str[a]; }).slice(0, 5);
    var topWeak = Object.keys(weak).sort(function (a, b) { return weak[b] - weak[a]; }).slice(0, 5);
    var topStyle = Object.keys(styles).sort(function (a, b) { return styles[b] - styles[a]; })[0];
    var best = az.slice().sort(function (a, b) { return b.crm_analysis.score - a.crm_analysis.score; })[0];

    //  התנגדויות לפי קטגוריה
    var CATS = ['דחייה יסודית', 'לא עכשיו', 'מחיר', 'אי וודאות', 'אי הבנה', 'בדיקת עובדות', 'גישה', 'רגשי'];
    var oc = {}; CATS.forEach(function (c) { oc[c] = { n: 0, res: 0 }; });
    objs.forEach(function (o) { var cat = o.category || ''; CATS.forEach(function (c) { if (cat.indexOf(c) >= 0) { oc[c].n++; if (/טופל/.test(o.status || '')) oc[c].res++; } }); });
    var ocRows = CATS.filter(function (c) { return oc[c].n > 0; }).sort(function (a, b) { return oc[b].n - oc[a].n; }).map(function (c) {
      var pctv = oc[c].n ? Math.round(oc[c].res / oc[c].n * 100) : 0;
      return '<tr><td>' + esc(c) + '</td><td>' + oc[c].n + '</td><td><span style="color:' + (pctv >= 70 ? 'var(--ok)' : pctv >= 40 ? 'var(--warn)' : 'var(--danger)') + ';font-weight:700">' + pctv + '%</span></td></tr>';
    }).join('');

    var stageRows = Object.keys(stageAgg).map(function (t) { return { t: t, n: stageAgg[t].n, sc: avg(stageAgg[t].s) }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10).map(function (r) {
      return '<tr><td>' + esc(r.t) + '</td><td>' + r.n + '</td><td>' + (r.sc != null ? scoreChip(r.sc) : '—') + '</td></tr>';
    }).join('');

    var recent = calls.slice(0, 12).map(function (c) {
      var a = c.crm_analysis;
      return '<tr data-callinfo="' + esc(c.id) + '" style="cursor:pointer" title="פתח שיחה"><td class="muted">' + esc(fmtDateTime(c.started_at)) + '</td>' +
        '<td class="ltr">' + esc(callPhone(c) || '—') + '</td>' +
        '<td>' + (a && typeof a.score === 'number' ? scoreChip(a.score) : '—') + '</td>' +
        '<td>' + (c.answered ? '<span class="cl-yes">✓</span>' : '<span class="cl-no">✗</span>') + '</td>' +
        '<td>' + (c.talk_sec ? esc(mmss(c.talk_sec)) : '—') + '</td></tr>';
    }).join('');

    var sk = { objection_handling: avg(skk.objection_handling), empathy: avg(skk.empathy), clarity: avg(skk.clarity), needs_discovery: avg(skk.needs_discovery) };
    var en = { confidence: avg(enk.confidence), courtesy: avg(enk.courtesy), patience: avg(enk.patience), initiative: avg(enk.initiative), optimism: avg(enk.optimism) };

    view('<div class="cv-wrap">' +
      '<div class="lead-top"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" id="acBack">→ חזרה לדוחות</button>' +
        '<h3 style="margin:0">👤 ' + esc(name) + '</h3>' +
        (score != null ? scoreChip(score) : '') +
        (topStyle ? '<span class="tag">' + esc(topStyle) + '</span>' : '') +
      '</div></div>' +
      '<div class="cv-info">' +
        acInfo('שיחות', calls.length) + acInfo('נותחו', az.length) +
        acInfo('שיעור מענה', pct(ans.length, calls.length) + '%') +
        acInfo('זמן שיחה בפועל', hms(talk)) + acInfo('עסקאות', won) + acInfo('דגלים', flags) +
      '</div>' +

      '<div class="cv-grid">' +
        '<div class="cv-left">' +
          '<div class="card cv-block"><h3 class="cv-bt">📊 ציונים</h3>' +
            '<div class="gauge-row">' + gauge(score, 'ציון ממוצע') + gauge(sentAvg, 'סנטימנט', null, 10) + gauge(pct(won, calls.length), 'המרה %') + '</div></div>' +
          '<div class="card cv-block"><h3 class="cv-bt">🎯 כישורים</h3><div class="skill-list">' +
            skillBar('טיפול בהתנגדויות', sk.objection_handling || 0) + skillBar('אמפתיה', sk.empathy || 0) + skillBar('בהירות תקשורת', sk.clarity || 0) + skillBar('גילוי צרכים', sk.needs_discovery || 0) + '</div></div>' +
          '<div class="card cv-block"><h3 class="cv-bt">⚡ אנרגיה</h3><div class="skill-list">' +
            skillBar('ביטחון', en.confidence || 0) + skillBar('אדיבות', en.courtesy || 0) + skillBar('סבלנות', en.patience || 0) + skillBar('יוזמה', en.initiative || 0) + skillBar('אופטימיות', en.optimism || 0) + '</div></div>' +
        '</div>' +
        '<div class="cv-analysis">' +
          ((topStr.length || topWeak.length) ? '<div class="card cv-block"><h3 class="cv-bt">💪 חוזקות ונקודות לשיפור</h3>' +
            (topStr.length ? '<div class="cv-sub-h" style="color:var(--ok)">✓ חוזקות</div><ul class="cv-ul">' + topStr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
            (topWeak.length ? '<div class="cv-sub-h" style="color:var(--danger)">△ לשיפור</div><ul class="cv-ul">' + topWeak.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
            (topWeak.length ? '<div class="cv-hl cv-hl-info">🎓 תוכנית אימון: להתמקד ב"' + esc(topWeak[0]) + '"</div>' : '') + '</div>' : '') +
          (ocRows ? '<div class="card cv-block"><h3 class="cv-bt">⚠️ טיפול בהתנגדויות לפי קטגוריה</h3><div class="table-scroll"><table><thead><tr><th>קטגוריה</th><th>כמות</th><th>% פתרון</th></tr></thead><tbody>' + ocRows + '</tbody></table></div></div>' : '') +
          (stageRows ? '<div class="card cv-block"><h3 class="cv-bt">📈 ביצוע לפי שלב</h3><div class="table-scroll"><table><thead><tr><th>שלב</th><th>מופעים</th><th>ציון</th></tr></thead><tbody>' + stageRows + '</tbody></table></div></div>' : '') +
          (best ? '<div class="card cv-block"><h3 class="cv-bt">🏆 השיחה החזקה</h3>' +
            '<div class="row-between"><span>' + scoreChip(best.crm_analysis.score) + ' ' + esc(fmtDateTime(best.started_at)) + '</span><button class="btn btn-ghost btn-sm" data-callinfo="' + esc(best.id) + '">🎧 פתח</button></div>' +
            (best.crm_analysis.summary ? '<div class="cv-txt" style="margin-top:8px">' + esc(best.crm_analysis.summary) + '</div>' : '') + '</div>' : '') +
          '<div class="card cv-block"><h3 class="cv-bt">⏱️ שיחות אחרונות</h3><div class="table-scroll"><table><thead><tr><th>מועד</th><th>מספר</th><th>ציון</th><th>נענתה</th><th>משך</th></tr></thead><tbody>' + (recent || '<tr><td colspan="5" class="empty">אין</td></tr>') + '</tbody></table></div></div>' +
        '</div>' +
      '</div></div>');

    $('acBack').addEventListener('click', function () { renderCalls('reports'); });
    $('view').querySelectorAll('[data-callinfo]').forEach(function (b) {
      b.addEventListener('click', function () { openCall(b.dataset.callinfo, 'reports'); });
    });
  }

  // ---------- התראות ----------
  //  מרכז התראות + הגדרות: כל סוג התראה מוגדר ב-ALERT_TYPES וניתן
  //  להדליק/לכבות אותו (נשמר ב-localStorage לכל משתמש). מה שכבוי לא מופיע.
  var ALERT_SEV = { 'קריטי': ['var(--danger)', 0], 'גבוה': ['var(--warn)', 1], 'בינוני': ['#0ea5e9', 2] };
  var ALERT_TYPES = [
    { key: 'legal', type: 'איום בתביעה', sev: 'קריטי', title: '⚖️ איום בתביעה / הליך משפטי',
      desc: 'מזוהה כשהשיחה מזכירה תביעה, עו"ד, בית משפט, תלונה לרשות או הונאה',
      re: /תביעה|לתבוע|עורך דין|עו"ד|בית משפט|הליך משפטי|תלונה לרשות|הונאה/,
      action: 'להסלים לליאור/מנהל מיידית, לתעד ולחזור ללקוח בזהירות', email: true },
    { key: 'cancel', type: 'רצון לבטל', sev: 'קריטי', title: '🚫 הלקוח מבקש לבטל / לא מעוניין',
      desc: 'מזוהה כשהסטטוס "לא רלוונטי" או שהלקוח אמר לבטל / מתחרט',
      re: /לבטל|ביטול העסקה|לא רוצה יותר|מבטל|חוזר בי|מתחרט/, status: 'lost',
      action: 'שיחת שימור דחופה מול הלקוח' },
    { key: 'competitor', type: 'מתחרה', sev: 'בינוני', title: '🥊 הוזכר מתחרה / הצעה מתחרה',
      desc: 'מזוהה כשהלקוח מזכיר מתחרה או הצעה זולה יותר',
      re: /מתחרה|יורוליס|אלדן|חברה אחרת|הצעה אחרת|מחיר יותר טוב|זול יותר|קיבלתי הצעה/,
      action: 'להדגיש ערך מוסף ולשקול הצעה משופרת' },
    { key: 'lowscore', type: 'ציון נמוך', sev: 'גבוה', title: '📉 ציון שיחה נמוך',
      desc: 'מזוהה כשציון השיחה מתחת ל-40', score: 40, action: 'סקירת השיחה עם הנציג ואימון ממוקד' },
    { key: 'negsent', type: 'סנטימנט שלילי', sev: 'גבוה', title: '😠 סנטימנט שלילי בשיחה',
      desc: 'מזוהה כשסנטימנט הלקוח שלילי', sentiment: 'שלילי', action: 'מעקב ושיחת שימור' },
    { key: 'redflag', type: 'דגל אדום', sev: 'גבוה', title: '🚩 דגל אדום מהניתוח',
      desc: 'דגלים אדומים שה-AI סימן בשיחה עצמה', redflag: true, action: '' }
  ];
  //  קריאה/כתיבה מול ההגדרות בצד-שרת (app_config → window.C2B.alertSettings).
  //  ברירת מחדל: פעיל (כל עוד לא כובה במפורש).
  function alertOn(key) { var s = window.C2B.alertSettings || {}; return s[key] !== false; }
  function alertSet(key, v) {
    var s = Object.assign({}, window.C2B.alertSettings || {}); s[key] = !!v; window.C2B.alertSettings = s;
    db.from('app_config').upsert({ org_id: window.C2B.orgId, key: 'alert_settings', value: s, updated_at: new Date().toISOString() }, { onConflict: 'org_id,key' }).then(function () { refreshAlertBadge(); }, function () { });
  }

  function callAlerts(all) {
    var out = [];
    all.forEach(function (c) {
      var a = c.crm_analysis; if (!a) return;
      var txt = [a.summary, a.bottom_line, (a.objections || []).join(' '), a.status_reason, a.customer_wants].filter(Boolean).join(' ');
      var cust = callPhone(c), ag = agentOf(c);
      var mk = function (t, sev, title, detail, action) { out.push({ call: c.id, time: c.started_at, agent: ag, customer: cust, lead: c._lead, type: t, sev: sev, title: title, detail: detail || a.summary || '', action: action || '' }); };
      ALERT_TYPES.forEach(function (t) {
        if (!alertOn(t.key)) return;
        if (t.redflag) { (a.red_flags || []).forEach(function (f) { mk(t.type, /חם|גבוה/.test(f.severity || '') ? 'קריטי' : 'גבוה', f.title || t.title, f.detail, f.action); }); return; }
        var hit = (t.re && t.re.test(txt)) || (t.status && a.status_suggestion === t.status) ||
          (t.score != null && typeof a.score === 'number' && a.score < t.score) || (t.sentiment && a.sentiment === t.sentiment);
        if (!hit) return;
        var detail = t.score != null ? (a.score_reason || a.summary) : t.sentiment ? (a.sentiment_insight || a.summary) : (a.bottom_line || a.summary);
        mk(t.type, t.sev, t.title + (t.score != null ? ' (' + a.score + ')' : ''), detail, t.action);
      });
    });
    return out.sort(function (x, y) { return ((ALERT_SEV[x.sev] || [0, 3])[1] - (ALERT_SEV[y.sev] || [0, 3])[1]) || (new Date(y.time) - new Date(x.time)); });
  }

  var alertFilter = { sev: '', type: '' };
  function paintAlerts(all, head) {
    var alerts = callAlerts(all);
    var byType = {}, bySev = { 'קריטי': 0, 'גבוה': 0, 'בינוני': 0 };
    alerts.forEach(function (al) { byType[al.type] = (byType[al.type] || 0) + 1; if (bySev[al.sev] != null) bySev[al.sev]++; });
    var shown = alerts.filter(function (al) { return (!alertFilter.sev || al.sev === alertFilter.sev) && (!alertFilter.type || al.type === alertFilter.type); });
    var chip = function (label, key, val, active) { return '<button class="al-chip' + (active ? ' on' : '') + '" data-alf="' + key + '" data-alv="' + esc(val) + '">' + esc(label) + '</button>'; };
    var sevChips = chip('הכל', 'sev', '', !alertFilter.sev) + ['קריטי', 'גבוה', 'בינוני'].map(function (sv) { return chip(sv + ' (' + bySev[sv] + ')', 'sev', sv, alertFilter.sev === sv); }).join('');
    var typeChips = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; }).map(function (tp) { return chip(tp + ' (' + byType[tp] + ')', 'type', tp, alertFilter.type === tp); }).join('');
    var cards = shown.slice(0, 200).map(function (al) {
      var col = (ALERT_SEV[al.sev] || ['var(--muted)'])[0];
      return '<div class="al-card" data-callinfo="' + esc(al.call) + '" style="border-inline-start-color:' + col + '">' +
        '<div class="al-top"><span class="al-sev" style="background:' + col + '1f;color:' + col + '">' + esc(al.sev) + '</span><b class="al-title">' + esc(al.title) + '</b><span class="tag muted">' + esc(al.type) + '</span></div>' +
        (al.detail ? '<div class="al-detail">' + esc(al.detail) + '</div>' : '') +
        (al.action ? '<div class="al-action">➡️ ' + esc(al.action) + '</div>' : '') +
        '<div class="al-meta"><span>👤 ' + esc(al.agent) + '</span><span class="ltr">📞 ' + esc(al.customer || '—') + '</span>' + (al.lead ? '<span>· ' + esc(al.lead.name) + '</span>' : '') + '<span class="muted">' + esc(fmtDateTime(al.time)) + '</span></div></div>';
    }).join('');
    view('<div class="card">' + head +
      '<div class="row-between" style="margin-bottom:10px;align-items:center"><span class="muted" style="font-size:12.5px">מרכז התראות · ' + alerts.length + ' התראות</span><button class="btn btn-ghost btn-sm" id="alSettings">⚙️ הגדרת התראות</button></div>' +
      '<div class="cards" style="margin-bottom:14px">' + stat('סה"כ התראות', alerts.length) + stat('קריטי', bySev['קריטי'], null, null, 'דורש טיפול מיידי') + stat('גבוה', bySev['גבוה']) + stat('בינוני', bySev['בינוני']) + '</div>' +
      '<div class="al-filters"><div class="al-frow">' + sevChips + '</div>' + (typeChips ? '<div class="al-frow">' + typeChips + '</div>' : '') + '</div>' +
      '<div class="al-list">' + (cards || '<div class="ai-empty">✅ אין התראות פעילות בטווח שנבחר.</div>') + '</div></div>');
    if ($('alSettings')) $('alSettings').addEventListener('click', function () { paintAlertSettings(all, head); });
    $('view').querySelectorAll('[data-alf]').forEach(function (b) { b.addEventListener('click', function () { alertFilter[b.dataset.alf] = alertFilter[b.dataset.alf] === b.dataset.alv ? '' : b.dataset.alv; paintAlerts(all, head); }); });
  }

  function paintAlertSettings(all, head) {
    var cards = ALERT_TYPES.map(function (t) {
      var on = alertOn(t.key), col = (ALERT_SEV[t.sev] || ['var(--muted)'])[0];
      return '<div class="al-set-card' + (on ? '' : ' off') + '"><div class="al-top"><span class="al-sev" style="background:' + col + '1f;color:' + col + '">' + esc(t.sev) + '</span><b class="al-title">' + esc(t.title) + '</b>' + (t.email ? '<span class="tag">📧 מייל לליאור</span>' : '') + '</div>' +
        '<div class="al-detail" style="margin:8px 0 12px">' + esc(t.desc) + '</div>' +
        '<label class="al-switch"><input type="checkbox" data-alton="' + t.key + '"' + (on ? ' checked' : '') + '><span class="al-slider"></span><span class="al-swlbl">' + (on ? 'פעיל' : 'כבוי') + '</span></label></div>';
    }).join('');
    view('<div class="card">' + head +
      '<div class="row-between" style="margin-bottom:12px;align-items:center"><h3 style="margin:0">⚙️ הגדרת התראות</h3><button class="btn btn-ghost btn-sm" id="alSetBack">→ חזרה להתראות</button></div>' +
      '<p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.7">הדליקו או כבו סוגי התראות לפי מה שהכי רלוונטי לכם. סוג שכבוי לא יופיע במרכז ההתראות. (התראת "איום בתביעה" גם שולחת מייל לליאור אוטומטית.)</p>' +
      '<div class="al-set-grid">' + cards + '</div></div>');
    $('alSetBack').addEventListener('click', function () { renderCalls('alerts'); });
    $('view').querySelectorAll('[data-alton]').forEach(function (cb) { cb.addEventListener('click', function () { alertSet(cb.dataset.alton, cb.checked); paintAlertSettings(all, head); }); });
  }

  // ---------- תיקי לקוחות ----------
  //  קיבוץ השיחות לפי מספר הלקוח; לחיצה פותחת פרופיל שמסכם את כל
  //  השיחות איתו ומחלץ פרטים ממה שאמר (עיסוק, מיקום, תקציב, סגנון).
  function renderCustomers(all, head) {
    var by = {};
    all.forEach(function (c) {
      var ph = last9(callPhone(c)); if (!ph) return;
      var o = by[ph] || (by[ph] = { phone: callPhone(c), ph: ph, n: 0, ans: 0, scores: [], sent: { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 }, agents: {}, last: null, lead: c._lead, status: null });
      o.n++; if (c.answered) o.ans++;
      o.agents[agentOf(c)] = (o.agents[agentOf(c)] || 0) + 1;
      if (!o.last || c.started_at > o.last) { o.last = c.started_at; if (c.crm_analysis) o.status = c.crm_analysis.status_suggestion; }
      var a = c.crm_analysis; if (a) { if (typeof a.score === 'number') o.scores.push(a.score); if (o.sent[a.sentiment] !== undefined) o.sent[a.sentiment]++; }
      if (c._lead) o.lead = c._lead;
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n; }).map(function (o) {
      var sc = o.scores.length ? Math.round(o.scores.reduce(function (a, b) { return a + b; }, 0) / o.scores.length) : null;
      var ts = ['חיובי', 'ניטרלי', 'שלילי'].sort(function (a, b) { return o.sent[b] - o.sent[a]; })[0];
      var ags = Object.keys(o.agents).sort(function (a, b) { return o.agents[b] - o.agents[a]; }).slice(0, 2).join(', ');
      return '<tr data-cust="' + esc(o.ph) + '" style="cursor:pointer" title="פתח תיק לקוח">' +
        '<td><b>' + (o.lead ? esc(o.lead.name) : '<span class="ltr">' + esc(o.phone) + '</span>') + '</b>' + (o.lead ? '<div class="muted ltr" style="font-size:11px">' + esc(o.phone) + '</div>' : '') + '</td>' +
        '<td>' + o.n + '</td>' +
        '<td>' + (sc != null ? scoreChip(sc) : '—') + '</td>' +
        '<td>' + (o.sent[ts] ? sentDot(ts) : '—') + '</td>' +
        '<td>' + esc(ags || '—') + '</td>' +
        '<td>' + (o.status ? badgeFor(o.status, '') : '—') + '</td>' +
        '<td class="muted">' + esc(fmtDateTime(o.last)) + '</td></tr>';
    }).join('');
    view('<div class="card">' + head +
      '<div class="cards" style="margin-bottom:14px">' + stat('לקוחות', Object.keys(by).length) + stat('שיחות', all.length) + '</div>' +
      '<p class="muted" style="font-size:12.5px;margin:0 0 10px">לחצו על לקוח לתיק המלא — סיכום כל השיחות איתו ופרטים שחולצו ממה שאמר.</p>' +
      '<div class="table-scroll"><table><thead><tr><th>לקוח</th><th>שיחות</th><th>ציון</th><th>סנטימנט</th><th>נציגים</th><th>סטטוס</th><th>אחרונה</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="7" class="empty">אין לקוחות בטווח</td></tr>') + '</tbody></table></div></div>');
    $('view').querySelectorAll('[data-cust]').forEach(function (tr) { tr.addEventListener('click', function () { renderCustomerProfile(tr.dataset.cust, all); }); });
  }

  function custProfileHTML(d) {
    var cs = d.comm_style || {};
    var has = function (v) { return v != null && v !== ''; };
    var det = d.details || {};
    var kv = [['עיסוק', det.occupation], ['אזור', det.location], ['מחפש', det.wants], ['תקציב', det.budget], ['רכב', det.vehicle], ['משפחה', det.family]].filter(function (x) { return has(x[1]); });
    var lst = function (t, arr, col) { return (Array.isArray(arr) && arr.length) ? '<div class="cv-sub-h" style="color:' + col + '">' + t + '</div><ul class="cv-ul">' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; };
    return (has(d.summary) ? '<div class="cv-summary">' + esc(d.summary) + '</div>' : '') +
      (has(d.key_insight) ? '<div class="cv-hl cv-hl-line"><b>תובנת מפתח:</b> ' + esc(d.key_insight) + '</div>' : '') +
      (has(d.action) ? '<div class="cv-hl cv-hl-info">➡️ המלצת פעולה: ' + esc(d.action) + '</div>' : '') +
      (has(d.profile) ? '<div class="cv-txt" style="margin-top:10px">' + esc(d.profile) + '</div>' : '') +
      (Object.keys(cs).length ? '<div class="gauge-row" style="margin-top:12px">' + gauge(cs.satisfaction, 'שביעות רצון', null, 10) + gauge(cs.trust, 'אמון', null, 10) + gauge(cs.engagement, 'מעורבות', null, 10) + gauge(cs.frustration, 'תסכול', null, 10) + '</div>' : '') +
      lst('✓ מה עובד מולו', d.what_works, 'var(--ok)') + lst('△ מה לא עובד', d.what_fails, 'var(--danger)') +
      (kv.length ? '<div class="cv-sub-h">📋 פרטים שחולצו</div><div class="cl-kv">' + kv.map(function (r) { return '<div class="k">' + esc(r[0]) + '</div><div class="v">' + esc(r[1]) + '</div>'; }).join('') + '</div>' : '') +
      ((d.keywords && d.keywords.length) ? '<div class="cv-sub-h">🏷️ מילות מפתח</div><div class="cv-tags">' + d.keywords.map(function (k) { return '<span class="tag">' + esc(k) + '</span>'; }).join('') + '</div>' : '');
  }

  function renderCustomerProfile(ph, all) {
    var calls = all.filter(function (c) { return last9(callPhone(c)) === ph; });
    var lead = calls.map(function (c) { return c._lead; }).filter(Boolean)[0];
    var name = lead ? lead.name : (calls[0] ? callPhone(calls[0]) : ph);
    var ans = calls.filter(function (c) { return c.answered === true; });
    var talk = ans.reduce(function (a, c) { return a + (+c.talk_sec || 0); }, 0);
    var az = calls.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });
    var sc = az.length ? Math.round(az.reduce(function (a, c) { return a + c.crm_analysis.score; }, 0) / az.length) : null;
    var flags = calls.reduce(function (a, c) { return a + ((c.crm_analysis && c.crm_analysis.red_flags) ? c.crm_analysis.red_flags.length : 0); }, 0);
    var ags = {}; calls.forEach(function (c) { ags[agentOf(c)] = (ags[agentOf(c)] || 0) + 1; });
    var hist = calls.slice().sort(function (a, b) { return new Date(b.started_at) - new Date(a.started_at); }).map(function (c) {
      var a = c.crm_analysis;
      return '<tr data-callinfo="' + esc(c.id) + '" style="cursor:pointer" title="פתח שיחה"><td class="muted">' + esc(fmtDateTime(c.started_at)) + '</td>' +
        '<td>' + esc(agentOf(c)) + '</td><td>' + (a && typeof a.score === 'number' ? scoreChip(a.score) : '—') + '</td>' +
        '<td>' + (c.answered ? '<span class="cl-yes">✓</span>' : '<span class="cl-no">✗</span>') + '</td>' +
        '<td>' + (c.talk_sec ? esc(mmss(c.talk_sec)) : '—') + '</td>' +
        '<td class="muted cl-sum" style="max-width:320px">' + esc((a && a.summary) || '') + '</td></tr>';
    }).join('');

    view('<div class="cv-wrap">' +
      '<div class="lead-top"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" id="cpBack">→ חזרה ללקוחות</button>' +
        '<h3 style="margin:0">👤 ' + esc(name) + '</h3><span class="muted ltr" style="font-size:12.5px">' + esc(calls[0] ? callPhone(calls[0]) : ph) + '</span>' +
        (lead ? '<a href="#" class="btn btn-ghost btn-sm" data-golead="' + esc(lead.id) + '">📂 כרטיס הליד</a>' : '') +
      '</div></div>' +
      '<div class="cv-info">' + acInfo('שיחות', calls.length) + acInfo('נענו', ans.length) + acInfo('ציון ממוצע', sc != null ? sc : '—') + acInfo('זמן שיחה', hms(talk)) + acInfo('דגלים', flags) + '</div>' +
      '<div class="cv-grid">' +
        '<div class="cv-left"><div class="card cv-block"><div class="row-between" style="align-items:center"><h3 class="cv-bt" style="margin:0">🧠 פרופיל לקוח (AI)</h3><button class="btn btn-sm" id="cpGen">✨ צור/רענן</button></div>' +
          '<div id="cpBody" style="margin-top:12px"></div></div>' +
          '<div class="card cv-block"><h3 class="cv-bt">👥 נציגים ששוחחו איתו</h3><div class="cv-tags">' + Object.keys(ags).sort(function (a, b) { return ags[b] - ags[a]; }).map(function (k) { return '<span class="tag">' + esc(k) + ' · ' + ags[k] + '</span>'; }).join('') + '</div></div></div>' +
        '<div class="cv-analysis"><div class="card cv-block"><h3 class="cv-bt">📞 היסטוריית שיחות</h3>' +
          '<div class="table-scroll"><table><thead><tr><th>מועד</th><th>נציג</th><th>ציון</th><th>נענתה</th><th>משך</th><th>סיכום</th></tr></thead><tbody>' + (hist || '<tr><td colspan="6" class="empty">אין</td></tr>') + '</tbody></table></div></div></div>' +
      '</div></div>');

    $('cpBack').addEventListener('click', function () { renderCalls('customers'); });
    $('view').querySelectorAll('[data-golead]').forEach(function (el) { el.addEventListener('click', function (e) { e.preventDefault(); window.C2B_openLeadCard(el.dataset.golead); }); });
    $('view').querySelectorAll('[data-callinfo]').forEach(function (b) { b.addEventListener('click', function () { openCall(b.dataset.callinfo, 'customers'); }); });
    var body = $('cpBody'), btn = $('cpGen');
    function show(d, note) { body.innerHTML = custProfileHTML(d) + (note ? '<div class="muted" style="font-size:11px;margin-top:10px">' + esc(note) + '</div>' : ''); }
    db.from('customer_profiles').select('data,updated_at').eq('phone', ph).maybeSingle().then(function (r) {
      if (r && r.data && r.data.data) show(r.data.data, 'עודכן ' + new Date(r.data.updated_at).toLocaleString('he-IL'));
      else body.innerHTML = '<div class="muted" style="font-size:12.5px">לחצו "צור" כדי להפיק פרופיל לקוח מכל השיחות איתו (קריאת AI אחת).</div>';
    }, function () { });
    btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = 'מפיק…'; body.innerHTML = '<div class="ai-empty">בונה פרופיל מכל השיחות…</div>';
      db.functions.invoke('call-profile', { body: { phone: ph, name: name } }).then(function (r) {
        btn.disabled = false; btn.textContent = '✨ צור/רענן';
        var d = (r && r.data) || {};
        if (d.error || d.empty || !d.profile) { body.innerHTML = '<div class="ai-empty">' + (d.empty ? 'אין מספיק שיחות מנותחות ללקוח זה.' : 'שגיאה: ' + esc(d.error || 'לא ידועה')) + '</div>'; return; }
        show(d.profile, 'נוצר עכשיו · ' + d.calls_count + ' שיחות');
      }, function () { btn.disabled = false; btn.textContent = '✨ צור/רענן'; body.innerHTML = '<div class="ai-empty">שגיאה בהפקה</div>'; });
    });
  }

  // ---------- מגמות ומשפך ----------
  //  מגמה יומית (נפח + ציון), משפך המרה, וזמן תגובה לשיחות שלא נענו.
  function paintTrends(all, head) {
    var az = all.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });

    //  ---- מגמה יומית ----
    var byDay = {};
    all.forEach(function (c) { if (!c.started_at) return; var d = String(c.started_at).slice(0, 10); var o = byDay[d] || (byDay[d] = { n: 0, ans: 0, scores: [], sent: { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 } }); o.n++; if (c.answered) o.ans++; var a = c.crm_analysis; if (a) { if (typeof a.score === 'number') o.scores.push(a.score); if (o.sent[a.sentiment] !== undefined) o.sent[a.sentiment]++; } });
    var days = Object.keys(byDay).sort().slice(-30);
    var maxN = Math.max.apply(null, days.map(function (d) { return byDay[d].n; }).concat([1]));
    var trendBars = '<div style="display:flex;align-items:flex-end;gap:5px;height:150px;direction:ltr;border-bottom:1px solid var(--line);padding-bottom:2px">' +
      days.map(function (d) {
        var o = byDay[d], h = Math.max(4, Math.round(o.n / maxN * 120));
        var sc = o.scores.length ? Math.round(o.scores.reduce(function (a, b) { return a + b; }, 0) / o.scores.length) : null;
        var col = sc == null ? 'var(--line)' : sc >= 70 ? 'var(--ok)' : sc >= 40 ? 'var(--warn)' : 'var(--danger)';
        return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end" title="' + esc(d + ' · ' + o.n + ' שיחות' + (sc != null ? ' · ציון ' + sc : '')) + '">' +
          '<div style="font-size:9px;color:var(--muted)">' + (sc != null ? sc : '') + '</div>' +
          '<div style="width:70%;max-width:22px;background:' + col + ';border-radius:3px 3px 0 0;height:' + h + 'px"></div></div>';
      }).join('') + '</div>' +
      '<div style="display:flex;gap:5px;direction:ltr;margin-top:4px">' + days.map(function (d, i) { return '<div style="flex:1;min-width:0;text-align:center;font-size:9px;color:var(--muted)">' + (i % 3 === 0 ? esc(d.slice(5)) : '') + '</div>'; }).join('') + '</div>' +
      '<div class="muted" style="font-size:11px;margin-top:6px">גובה = נפח שיחות · צבע = ציון ממוצע ביום (ירוק=גבוה, אדום=נמוך)</div>';

    //  ---- משפך המרה ----
    var total = all.length, answered = all.filter(function (c) { return c.answered === true; }).length;
    var won = az.filter(function (c) { return c.crm_analysis.status_suggestion === 'won'; }).length;
    var meeting = az.filter(function (c) { return /meeting|quote/.test(c.crm_analysis.status_suggestion || ''); }).length;
    var funnelSteps = [['כל השיחות', total, 'var(--brand)'], ['נענו', answered, '#6366f1'], ['נותחו', az.length, '#0ea5e9'], ['פגישה/הצעה', meeting, 'var(--warn)'], ['עסקאות', won, 'var(--ok)']];
    var fMax = total || 1;
    var funnelHTML = funnelSteps.map(function (s) {
      var w = Math.round(s[1] / fMax * 100);
      return '<div class="hbar-row"><div class="hbar-lbl" style="flex-basis:110px">' + esc(s[0]) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.max(3, w) + '%;background:' + s[2] + '"></div></div>' +
        '<div class="hbar-n" style="flex-basis:90px">' + s[1] + ' · ' + (total ? Math.round(s[1] / total * 100) : 0) + '%</div></div>';
    }).join('');

    //  ---- זמן תגובה לשיחות נכנסות שלא נענו ----
    var byCust = {};
    all.forEach(function (c) { var p = last9(callPhone(c)); if (!p) return; (byCust[p] = byCust[p] || []).push(c); });
    var gaps = [], stillOpen = 0;
    Object.keys(byCust).forEach(function (p) {
      var arr = byCust[p].slice().sort(function (a, b) { return new Date(a.started_at) - new Date(b.started_at); });
      arr.forEach(function (c, i) {
        if (c.direction === 'in' && c.answered !== true) {
          var next = null;
          for (var j = i + 1; j < arr.length; j++) { if (arr[j].answered === true) { next = arr[j]; break; } }
          if (next) gaps.push((new Date(next.started_at) - new Date(c.started_at)) / 60000);
          else stillOpen++;
        }
      });
    });
    var avgGap = gaps.length ? Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null;
    var under15 = gaps.filter(function (g) { return g <= 15; }).length;
    var fmtGap = function (m) { return m == null ? '—' : m < 60 ? m + ' דק\'' : Math.round(m / 60) + ' שע\''; };

    view('<div class="card">' + head +
      '<div class="cards" style="margin-bottom:16px">' +
        stat('זמן תגובה ממוצע', fmtGap(avgGap), null, null, gaps.length + ' חזרות') +
        stat('נענו תוך 15 דק\'', gaps.length ? Math.round(under15 / gaps.length * 100) + '%' : '—') +
        stat('ממתינים לחזרה', stillOpen, null, 'todo') +
        stat('שיעור המרה', total ? Math.round(won / total * 100) + '%' : '—', null, null, won + ' עסקאות') +
      '</div>' +
      '<div class="card cl-sub"><h3 class="cl-h">📈 מגמה יומית · ' + days.length + ' ימים</h3>' + trendBars + '</div>' +
      '<div class="grid2" style="gap:14px;margin-top:14px">' +
        '<div class="card cl-sub"><h3 class="cl-h">🔀 משפך המרה</h3>' + funnelHTML + '</div>' +
        '<div class="card cl-sub"><h3 class="cl-h">⏱️ זמן תגובה לשיחות שלא נענו</h3>' +
          '<p class="cv-txt">מרגע שלקוח התקשר ולא נענה — עד השיחה הבאה שנענתה מולו.</p>' +
          '<div class="cl-kv" style="margin-top:10px"><div class="k">זמן תגובה ממוצע</div><div class="v">' + fmtGap(avgGap) + '</div>' +
          '<div class="k">נענו תוך 15 דקות</div><div class="v">' + (gaps.length ? Math.round(under15 / gaps.length * 100) + '%' : '—') + '</div>' +
          '<div class="k">חזרות שנמדדו</div><div class="v">' + gaps.length + '</div>' +
          '<div class="k">עדיין ממתינים</div><div class="v" style="color:var(--danger)">' + stillOpen + '</div></div></div>' +
      '</div></div>');
  }

  // ---------- דוח התנגדויות ----------
  //  טאב ייעודי: התנגדויות לפי קטגוריה, פלייבוק שיפור לכל התנגדות,
  //  טיפול לפי נציג, והתנגדויות פתוחות. מבוסס על objections_detailed מהניתוח.
  function paintObjections(all, head) {
    var az = all.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });
    if (!az.length) return view('<div class="card">' + head + '<div class="ai-empty">אין עדיין שיחות מנותחות בטווח שנבחר.</div></div>');
    var objs = [];
    az.forEach(function (c) { (c.crm_analysis.objections_detailed || []).forEach(function (o) { objs.push({ o: o, agent: agentOf(c), call: c.id }); }); });
    if (!objs.length) return view('<div class="card">' + head + '<div class="ai-empty">לא זוהו התנגדויות בשיחות שבטווח שנבחר.</div></div>');
    var objRes = objs.filter(function (x) { return /טופל/.test(x.o.status || ''); }).length;
    var objByDiff = { 'קלה': 0, 'בינונית': 0, 'גבוהה': 0 };
    objs.forEach(function (x) { var d = x.o.difficulty || ''; Object.keys(objByDiff).forEach(function (k) { if (d.indexOf(k) >= 0) objByDiff[k]++; }); });
    var CATS = ['דחייה יסודית', 'לא עכשיו', 'מחיר', 'אי וודאות', 'אי הבנה', 'בדיקת עובדות', 'גישה', 'רגשי'];
    var objByCat = {}; CATS.forEach(function (c) { objByCat[c] = { n: 0, res: 0 }; });
    objs.forEach(function (x) { var cat = x.o.category || ''; CATS.forEach(function (c) { if (cat.indexOf(c) >= 0) { objByCat[c].n++; if (/טופל/.test(x.o.status || '')) objByCat[c].res++; } }); });
    var catKeys = CATS.filter(function (c) { return objByCat[c].n > 0; }).sort(function (a, b) { return objByCat[b].n - objByCat[a].n; });
    var catMax = Math.max.apply(null, catKeys.map(function (c) { return objByCat[c].n; }).concat([1]));
    var catBars = catKeys.map(function (c) {
      var o = objByCat[c], w = Math.round(o.n / catMax * 100), r = o.n ? Math.round(o.res / o.n * 100) : 0;
      return '<div class="hbar-row"><div class="hbar-lbl" style="flex-basis:118px">' + esc(c) + '</div><div class="hbar-track"><div class="hbar-fill" style="width:' + Math.max(4, w) + '%;background:var(--brand)"></div></div><div class="hbar-n" style="flex-basis:72px">' + o.n + ' · ' + r + '%</div></div>';
    }).join('');
    var playbookCards = catKeys.slice(0, 6).map(function (cat) {
      var catObjs = objs.filter(function (x) { return (x.o.category || '').indexOf(cat) >= 0; });
      var samples = [], improvements = [], byAgCat = {};
      catObjs.forEach(function (x) {
        if (samples.length < 3 && x.o.quote) samples.push(x.o.quote);
        if (improvements.length < 3 && x.o.improvement) improvements.push(x.o.improvement);
        var o = byAgCat[x.agent] || (byAgCat[x.agent] = { n: 0, res: 0 }); o.n++; if (/טופל/.test(x.o.status || '')) o.res++;
      });
      var topAgent = Object.keys(byAgCat).filter(function (k) { return byAgCat[k].n >= 2; }).sort(function (a, b) { return (byAgCat[b].res / byAgCat[b].n) - (byAgCat[a].res / byAgCat[a].n); })[0];
      var topPct = topAgent ? Math.round(byAgCat[topAgent].res / byAgCat[topAgent].n * 100) : null;
      return '<div class="card cl-sub" style="margin:0"><div class="row-between"><b>' + esc(cat) + '</b><span class="tag">' + objByCat[cat].n + ' · ' + (objByCat[cat].n ? Math.round(objByCat[cat].res / objByCat[cat].n * 100) : 0) + '% נפתרו</span></div>' +
        (samples.length ? '<div class="cv-sub-h">איך זה נשמע</div>' + samples.map(function (q) { return '<div class="cv-quote" style="margin-bottom:6px">"' + esc(q) + '"</div>'; }).join('') : '') +
        (improvements.length ? '<div class="cv-sub-h" style="color:var(--ok)">איך לשפר</div><ul class="cv-ul">' + improvements.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        (topAgent ? '<div class="cv-hl cv-hl-info" style="margin-top:8px">🏆 אלוף הקטגוריה: <b>' + esc(topAgent) + '</b> · ' + topPct + '% פתרון</div>' : '') + '</div>';
    }).join('');
    var openObjs = objs.filter(function (x) { return !/טופל/.test(x.o.status || ''); }).slice(0, 60);
    var objRows = openObjs.map(function (x) {
      return '<tr data-callinfo="' + esc(x.call) + '" style="cursor:pointer" title="פתח שיחה"><td>' + esc(x.o.category || '—') + '</td><td>' + esc(x.agent) + '</td><td class="cl-sum" style="max-width:340px">' + esc(x.o.quote || x.o.text || x.o.detail || '') + '</td><td>' + esc(x.o.difficulty || '—') + '</td></tr>';
    }).join('');
    var byAg = {};
    az.forEach(function (c) { var k = agentOf(c), a = c.crm_analysis; var o = byAg[k] || (byAg[k] = { objs: 0, res: 0, oh: [] }); (a.objections_detailed || []).forEach(function (ob) { o.objs++; if (/טופל/.test(ob.status || '')) o.res++; }); var s = a.agent_skills || {}; if (typeof s.objection_handling === 'number') o.oh.push(s.objection_handling); });
    var agRows = Object.keys(byAg).filter(function (k) { return byAg[k].objs > 0; }).sort(function (a, b) { return byAg[b].objs - byAg[a].objs; }).map(function (k) {
      var o = byAg[k], pct = o.objs ? Math.round(o.res / o.objs * 100) : 0, oh = o.oh.length ? Math.round(o.oh.reduce(function (a, b) { return a + b; }, 0) / o.oh.length) : null;
      return '<tr><td><b>' + esc(k) + '</b></td><td>' + o.objs + '</td><td>' + pct + '%</td><td>' + (oh != null ? scoreChip(oh) : '—') + '</td></tr>';
    }).join('');
    view('<div class="card">' + head +
      '<div class="cards" style="margin-bottom:14px">' + stat('סה"כ התנגדויות', objs.length, null, null, objs.length ? Math.round(objRes / objs.length * 100) + '% טופלו' : '') + stat('קלות', objByDiff['קלה']) + stat('בינוניות', objByDiff['בינונית']) + stat('גבוהות', objByDiff['גבוהה']) + '</div>' +
      (catBars ? '<div class="card cl-sub"><h3 class="cl-h">📊 התנגדויות לפי קטגוריה</h3><p class="muted" style="font-size:12px;margin:0 0 10px">כמות · אחוז שטופל</p>' + catBars + '</div>' : '') +
      (playbookCards ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">📖 פלייבוק — שיפור כל התנגדות <span class="muted" style="font-size:11px;font-weight:400">· מבנה מנצח, ציטוטים ואלוף לכל קטגוריה</span></h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">' + playbookCards + '</div></div>' : '') +
      (agRows ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">👥 טיפול בהתנגדויות לפי נציג</h3><div class="table-scroll"><table><thead><tr><th>נציג</th><th>התנגדויות</th><th>% טופל</th><th>ציון טיפול</th></tr></thead><tbody>' + agRows + '</tbody></table></div></div>' : '') +
      (objRows ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">⚠️ התנגדויות פתוחות · ' + openObjs.length + '</h3><div class="table-scroll"><table><thead><tr><th>קטגוריה</th><th>נציג</th><th>מה נאמר</th><th>קושי</th></tr></thead><tbody>' + objRows + '</tbody></table></div></div>' : '') +
      '</div>');
    $('view').querySelectorAll('[data-callinfo]').forEach(function (b) { b.addEventListener('click', function () { openCall(b.dataset.callinfo, 'objections'); }); });
  }

  function paintReports(all, head) {
    var az = all.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });
    if (!az.length) {
      return view('<div class="card">' + head + '<div class="ai-empty">אין עדיין שיחות מנותחות בטווח שנבחר.<br>הדוח יתמלא ברגע שיהיו ניתוחים.</div></div>');
    }

    //  אגרגציות צוותיות
    var teamScore = avg(az.map(function (c) { return c.crm_analysis.score; }));
    var won = all.filter(function (c) { return c.crm_analysis && c.crm_analysis.status_suggestion === 'won'; }).length;
    var objs = [], flags = [], acts = [];
    var teamSk = { objection_handling: [], empathy: [], clarity: [], needs_discovery: [] };
    var teamEn = { confidence: [], courtesy: [], patience: [], initiative: [], optimism: [] };
    az.forEach(function (c) {
      var a = c.crm_analysis;
      (a.objections_detailed || []).forEach(function (o) { objs.push({ o: o, agent: agentOf(c), call: c.id }); });
      (a.red_flags || []).forEach(function (f) { flags.push({ f: f, agent: agentOf(c), call: c.id }); });
      (a.action_items || []).forEach(function (t) { acts.push({ t: t, agent: agentOf(c), call: c.id }); });
      var s = a.agent_skills || {}; Object.keys(teamSk).forEach(function (k) { if (typeof s[k] === 'number') teamSk[k].push(s[k]); });
      var e = a.agent_energy || {}; Object.keys(teamEn).forEach(function (k) { if (typeof e[k] === 'number') teamEn[k].push(e[k]); });
    });
    var objRes = objs.filter(function (x) { return /טופל/.test(x.o.status || ''); }).length;
    var flagsHot = flags.filter(function (x) { return /חם|גבוה/.test(x.f.severity || ''); }).length;
    var objByDiff = { 'קלה': 0, 'בינונית': 0, 'גבוהה': 0 };
    objs.forEach(function (x) { var d = x.o.difficulty || ''; Object.keys(objByDiff).forEach(function (k) { if (d.indexOf(k) >= 0) objByDiff[k]++; }); });
    //  התנגדויות לפי קטגוריה (מהשדה category שנוסף לניתוח)
    var CATS = ['דחייה יסודית', 'לא עכשיו', 'מחיר', 'אי וודאות', 'אי הבנה', 'בדיקת עובדות', 'גישה', 'רגשי'];
    var objByCat = {}; CATS.forEach(function (c) { objByCat[c] = { n: 0, res: 0 }; });
    objs.forEach(function (x) { var cat = x.o.category || ''; CATS.forEach(function (c) { if (cat.indexOf(c) >= 0) { objByCat[c].n++; if (/טופל/.test(x.o.status || '')) objByCat[c].res++; } }); });
    var catKeys = CATS.filter(function (c) { return objByCat[c].n > 0; }).sort(function (a, b) { return objByCat[b].n - objByCat[a].n; });
    var catMax = Math.max.apply(null, catKeys.map(function (c) { return objByCat[c].n; }).concat([1]));
    var catBars = catKeys.map(function (c) {
      var o = objByCat[c], w = Math.round(o.n / catMax * 100), r = o.n ? Math.round(o.res / o.n * 100) : 0;
      return '<div class="hbar-row"><div class="hbar-lbl" style="flex-basis:118px">' + esc(c) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.max(4, w) + '%;background:var(--brand)"></div></div>' +
        '<div class="hbar-n" style="flex-basis:72px">' + o.n + ' · ' + r + '%</div></div>';
    }).join('');
    //  ניתוח שלבי שיחה (מהשדה stages)
    var stageAgg = {};
    az.forEach(function (c) { (c.crm_analysis.stages || []).forEach(function (st) { var t = st.title || '—'; var o = stageAgg[t] || (stageAgg[t] = { n: 0, scores: [] }); o.n++; if (typeof st.score === 'number') o.scores.push(st.score); }); });
    var stageRows = Object.keys(stageAgg).map(function (t) { return { t: t, n: stageAgg[t].n, sc: avg(stageAgg[t].scores) }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12).map(function (r) {
      return '<tr><td>' + esc(r.t) + '</td><td>' + r.n + '</td><td>' + (r.sc != null ? scoreChip(r.sc) : '—') + '</td></tr>';
    }).join('');
    //  סגנונות מכירה (מהשדה sales_style)
    var styles = {}; az.forEach(function (c) { var st = c.crm_analysis.sales_style; if (st) styles[st] = (styles[st] || 0) + 1; });
    var styleKeys = Object.keys(styles).sort(function (a, b) { return styles[b] - styles[a]; });
    var styleMax = Math.max.apply(null, styleKeys.map(function (k) { return styles[k]; }).concat([1]));
    var styleBars = styleKeys.map(function (k) {
      return '<div class="hbar-row"><div class="hbar-lbl" style="flex-basis:150px">' + esc(k) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + Math.max(4, Math.round(styles[k] / styleMax * 100)) + '%;background:#6366f1"></div></div>' +
        '<div class="hbar-n">' + styles[k] + '</div></div>';
    }).join('');
    //  שלב הנפילה במשפך — השלב החלש ביותר בשיחות שלא נסגרו
    var dropStages = {};
    az.forEach(function (c) { var a = c.crm_analysis; if (a.status_suggestion === 'won') return; var st = a.stages || []; if (!st.length) return; var weak = st.slice().sort(function (x, y) { return (x.score == null ? 100 : x.score) - (y.score == null ? 100 : y.score); })[0]; if (weak && weak.title) dropStages[weak.title] = (dropStages[weak.title] || 0) + 1; });
    var dropRows = Object.keys(dropStages).map(function (t) { return { t: t, n: dropStages[t] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8).map(function (r) {
      return '<tr><td>' + esc(r.t) + '</td><td><span style="color:var(--danger);font-weight:700">' + r.n + '</span></td></tr>';
    }).join('');
    //  פלייבוק התנגדויות — 4 הקטגוריות המובילות: ציטוטים, שיפורים ואלוף
    var playbookCards = catKeys.slice(0, 4).map(function (cat) {
      var catObjs = objs.filter(function (x) { return (x.o.category || '').indexOf(cat) >= 0; });
      var samples = [], improvements = [], byAgCat = {};
      catObjs.forEach(function (x) {
        if (samples.length < 3 && x.o.quote) samples.push(x.o.quote);
        if (improvements.length < 2 && x.o.improvement) improvements.push(x.o.improvement);
        var o = byAgCat[x.agent] || (byAgCat[x.agent] = { n: 0, res: 0 }); o.n++; if (/טופל/.test(x.o.status || '')) o.res++;
      });
      var topAgent = Object.keys(byAgCat).filter(function (k) { return byAgCat[k].n >= 2; }).sort(function (a, b) { return (byAgCat[b].res / byAgCat[b].n) - (byAgCat[a].res / byAgCat[a].n); })[0];
      var topPct = topAgent ? Math.round(byAgCat[topAgent].res / byAgCat[topAgent].n * 100) : null;
      return '<div class="card cl-sub" style="margin:0"><div class="row-between"><b>' + esc(cat) + '</b><span class="tag">' + objByCat[cat].n + ' · ' + (objByCat[cat].n ? Math.round(objByCat[cat].res / objByCat[cat].n * 100) : 0) + '% נפתרו</span></div>' +
        (samples.length ? '<div class="cv-sub-h">איך זה נשמע</div>' + samples.map(function (q) { return '<div class="cv-quote" style="margin-bottom:6px">"' + esc(q) + '"</div>'; }).join('') : '') +
        (improvements.length ? '<div class="cv-sub-h" style="color:var(--ok)">איך לשפר</div><ul class="cv-ul">' + improvements.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        (topAgent ? '<div class="cv-hl cv-hl-info" style="margin-top:8px">🏆 אלוף הקטגוריה: <b>' + esc(topAgent) + '</b> · ' + topPct + '% פתרון</div>' : '') +
        '</div>';
    }).join('');

    //  אגרגציה פר-נציג
    var byAg = {};
    az.forEach(function (c) {
      var k = agentOf(c), a = c.crm_analysis;
      var o = byAg[k] || (byAg[k] = { calls: 0, scores: [], sk: { objection_handling: [], empathy: [], clarity: [], needs_discovery: [] }, objs: 0, objRes: 0, flags: 0, sent: { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 }, weak: {}, sugg: {} });
      o.calls++; o.scores.push(a.score);
      var s = a.agent_skills || {}; Object.keys(o.sk).forEach(function (k2) { if (typeof s[k2] === 'number') o.sk[k2].push(s[k2]); });
      (a.objections_detailed || []).forEach(function (ob) { o.objs++; if (/טופל/.test(ob.status || '')) o.objRes++; });
      o.flags += (a.red_flags || []).length;
      if (o.sent[a.sentiment] !== undefined) o.sent[a.sentiment]++;
      (a.agent_weaknesses || []).forEach(function (w) { o.weak[w] = (o.weak[w] || 0) + 1; });
      if (a.status_suggestion) o.sugg[a.status_suggestion] = (o.sugg[a.status_suggestion] || 0) + 1;
    });
    var agents = Object.keys(byAg).map(function (k) {
      var o = byAg[k];
      return {
        name: k, calls: o.calls, score: avg(o.scores),
        oh: avg(o.sk.objection_handling), emp: avg(o.sk.empathy), clr: avg(o.sk.clarity), nd: avg(o.sk.needs_discovery),
        objs: o.objs, objPct: o.objs ? Math.round(o.objRes / o.objs * 100) : null, flags: o.flags,
        topSent: ['חיובי', 'ניטרלי', 'שלילי'].sort(function (a, b) { return o.sent[b] - o.sent[a]; })[0],
        topSentN: 0, topSugg: Object.keys(o.sugg).sort(function (a, b) { return o.sugg[b] - o.sugg[a]; })[0],
        topWeak: Object.keys(o.weak).sort(function (a, b) { return o.weak[b] - o.weak[a]; })[0], sent: o.sent
      };
    }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });

    //  מיקוד אימון: נציגים בציון הנמוך ביותר
    var focus = agents.slice().filter(function (a) { return a.score != null; }).sort(function (a, b) { return a.score - b.score; }).slice(0, 3);

    var A = function (k, txt) { return clickable('data-go=\'{"agent":"' + esc(k) + '"}\'', txt); };

    //  ---- טבלת ביצועי נציגים ----
    var agRows = agents.map(function (a) {
      return '<tr><td><b><a href="#" class="cl-go" data-agentcard="' + esc(a.name) + '">' + esc(a.name) + '</a></b></td>' +
        '<td>' + A(a.name, a.calls) + '</td>' +
        '<td>' + (a.score != null ? scoreChip(a.score) : '—') + '</td>' +
        '<td>' + (a.oh != null ? a.oh : '—') + '</td>' +
        '<td>' + (a.emp != null ? a.emp : '—') + '</td>' +
        '<td>' + (a.clr != null ? a.clr : '—') + '</td>' +
        '<td>' + (a.nd != null ? a.nd : '—') + '</td>' +
        '<td>' + (a.objs ? a.objs + ' · ' + a.objPct + '%' : '0') + '</td>' +
        '<td>' + (a.flags ? '<span style="color:var(--danger);font-weight:700">' + a.flags + '</span>' : '0') + '</td>' +
        '<td>' + (a.topSugg ? badgeFor(a.topSugg, '') : '—') + '</td></tr>';
    }).join('');

    //  ---- מפת כישורים צוותית ----
    var skillMap = skillBar('טיפול בהתנגדויות', avg(teamSk.objection_handling) || 0) +
      skillBar('אמפתיה', avg(teamSk.empathy) || 0) + skillBar('בהירות תקשורת', avg(teamSk.clarity) || 0) +
      skillBar('גילוי צרכים', avg(teamSk.needs_discovery) || 0);
    var energyMap = skillBar('ביטחון', avg(teamEn.confidence) || 0) + skillBar('אדיבות', avg(teamEn.courtesy) || 0) +
      skillBar('סבלנות', avg(teamEn.patience) || 0) + skillBar('יוזמה', avg(teamEn.initiative) || 0) + skillBar('אופטימיות', avg(teamEn.optimism) || 0);

    //  ---- דגלים אדומים ----
    var flagRows = flags.filter(function (x) { return /חם|גבוה/.test(x.f.severity || ''); }).slice(0, 12).map(function (x) {
      return '<tr data-callinfo="' + esc(x.call) + '" style="cursor:pointer" title="פתח שיחה">' +
        '<td>🔴 ' + esc(x.f.title || '') + '</td><td>' + esc(x.agent) + '</td>' +
        '<td class="muted">' + esc(x.f.action || '') + '</td></tr>';
    }).join('');

    //  ---- התנגדויות: דגימות אחרונות ----
    var objRows = objs.filter(function (x) { return !/טופל/.test(x.o.status || ''); }).slice(0, 10).map(function (x) {
      return '<tr data-callinfo="' + esc(x.call) + '" style="cursor:pointer" title="פתח שיחה">' +
        '<td class="cl-sum" style="max-width:340px">"' + esc(x.o.quote || '') + '"</td>' +
        '<td>' + esc(x.agent) + '</td>' +
        '<td>' + (x.o.difficulty ? '<span class="tag muted">' + esc(x.o.difficulty) + '</span>' : '—') + '</td></tr>';
    }).join('');

    //  ---- מיקוד אימון ----
    var focusCards = focus.map(function (a) {
      return '<div class="card cl-sub" style="margin:0"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<b>' + A(a.name, esc(a.name)) + '</b>' + (a.score != null ? scoreChip(a.score) : '') + '</div>' +
        (a.topWeak ? '<div class="muted" style="font-size:12.5px;margin-top:6px;line-height:1.6">לתרגל: ' + esc(a.topWeak) + '</div>' : '') +
        '<div class="muted" style="font-size:11.5px;margin-top:4px">' + a.calls + ' שיחות · ' + (a.objPct != null ? 'טיפול התנגדויות ' + a.objPct + '%' : '') + '</div></div>';
    }).join('');

    view('<div class="card">' + head +
      '<div class="card cl-sub" style="margin-bottom:14px"><div class="row-between" style="flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px"><h3 class="cl-h" style="margin:0">🧑‍🏫 אימון מנהלים (AI)</h3><button class="btn btn-sm" id="mgrGen">✨ צור לטווח הנוכחי</button></div><div class="mgr-layout"><div class="mgr-list" id="mgrList"></div><div id="mgrBody" class="mgr-main"></div></div></div>' +
      '<div class="cards" style="margin-bottom:16px">' +
        stat('שיחות מנותחות', az.length, null, 'analyzed') +
        stat('ציון צוות ממוצע', teamScore, null, null, teamScore >= 70 ? 'טוב' : teamScore >= 40 ? 'בינוני' : 'דורש שיפור') +
        stat('סה"כ התנגדויות', objs.length, null, null, objs.length ? Math.round(objRes / objs.length * 100) + '% טופלו' : '') +
        stat('דגלים אדומים', flags.length, null, 'alerts', flagsHot + ' חמים') +
        stat('עסקאות (המלצה)', won, null, null) +
      '</div>' +

      (focusCards ? '<div class="card cl-sub" style="margin-bottom:14px"><h3 class="cl-h">🎯 מיקוד אימון — 3 נציגים לשבוע</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">' + focusCards + '</div></div>' : '') +

      '<div class="grid2" style="gap:14px">' +
        '<div class="card cl-sub"><h3 class="cl-h">💪 מפת כישורים צוותית</h3><div class="skill-list">' + skillMap + '</div></div>' +
        '<div class="card cl-sub"><h3 class="cl-h">⚡ אנרגיה צוותית ממוצעת</h3><div class="skill-list">' + energyMap + '</div></div>' +
      '</div>' +

      '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">👥 ביצועי נציגים</h3>' +
        '<p class="muted" style="font-size:12px;margin:0 0 10px">כישורים בסקאלה 0-100, ממוצע על כל שיחות הנציג. לחצו על שם לסינון.</p>' +
        '<div class="table-scroll"><table><thead><tr><th>נציג</th><th>שיחות</th><th>ציון</th><th>התנגדויות</th><th>אמפתיה</th><th>בהירות</th><th>גילוי צרכים</th><th>התנגדויות (טופל)</th><th>דגלים</th><th>תוצאה נפוצה</th></tr></thead>' +
        '<tbody>' + agRows + '</tbody></table></div></div>' +

      (objRows ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">⚠️ התנגדויות פתוחות · ' + objs.length + ' סה"כ · ' + (objs.length ? Math.round(objRes / objs.length * 100) : 0) + '% טופלו</h3>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          '<span class="tag">קלה: ' + objByDiff['קלה'] + '</span><span class="tag">בינונית: ' + objByDiff['בינונית'] + '</span><span class="tag">גבוהה: ' + objByDiff['גבוהה'] + '</span></div>' +
        '<div class="table-scroll"><table><thead><tr><th>ציטוט הלקוח</th><th>נציג</th><th>קושי</th></tr></thead><tbody>' + objRows + '</tbody></table></div></div>' : '') +

      (catBars ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">📊 התנגדויות לפי קטגוריה</h3>' +
        '<p class="muted" style="font-size:12px;margin:0 0 10px">כמות · אחוז שטופל</p>' + catBars + '</div>' : '') +
      (stageRows ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">📈 ניתוח שלבי שיחה</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>שלב בשיחה</th><th>מופעים</th><th>ציון ממוצע</th></tr></thead><tbody>' + stageRows + '</tbody></table></div></div>' : '') +
      (styleBars ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">🎭 סגנונות מכירה</h3>' + styleBars + '</div>' : '') +
      (dropRows ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">📉 שלב הנפילה במשפך <span class="muted" style="font-size:11px;font-weight:400">· השלב החלש בשיחות שלא נסגרו</span></h3>' +
        '<div class="table-scroll"><table><thead><tr><th>שלב בשיחה</th><th>נפילות</th></tr></thead><tbody>' + dropRows + '</tbody></table></div></div>' : '') +
      (playbookCards ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">📖 פלייבוק התנגדויות <span class="muted" style="font-size:11px;font-weight:400">· מבנה מנצח לכל התנגדות</span></h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">' + playbookCards + '</div></div>' : '') +
      (flagRows ? '<div class="card cl-sub" style="margin-top:14px"><h3 class="cl-h">🚩 דגלים אדומים חמים · ' + flagsHot + '</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>דגל</th><th>נציג</th><th>פעולה נדרשת</th></tr></thead><tbody>' + flagRows + '</tbody></table></div></div>' : '') +
      '</div>');
    wireMgrReport();
  }

  // ---------- דורש חזרה ----------
  //  שיחה נכנסת שלא נענתה היא לקוח שניסה להשיג אתכם ולא הצליח. אם לא
  //  חזרו אליו מאז — הוא עדיין מחכה. זה הדבר היחיד במסך שדורש פעולה
  //  עכשיו, ולכן הוא לשונית נפרדת ולא שורה בטבלה.
  function paintTodo(all, head) {
    var miss = {};
    all.forEach(function (c) {
      if (c.direction !== 'in' || c.answered === true) return;
      var p = last9(c.from_number); if (!p) return;
      miss[p] = miss[p] || { phone: c.from_number, n: 0, last: null, lead: c._lead, dept: c.department };
      miss[p].n++;
      if (!miss[p].last || c.started_at > miss[p].last) miss[p].last = c.started_at;
    });
    //  מי שכבר טופל: יש שיחה מאוחרת יותר שנענתה, לכל כיוון
    all.forEach(function (c) {
      if (c.answered !== true) return;
      var p = last9(callPhone(c));
      if (miss[p] && c.started_at > miss[p].last) miss[p].done = c.started_at;
    });
    var open = Object.keys(miss).map(function (k) { return miss[k]; })
      .filter(function (m) { return !m.done; })
      .sort(function (a, b) { return (b.n - a.n) || (a.last < b.last ? 1 : -1); });

    var rows = open.map(function (m) {
      var hrs = Math.round((Date.now() - new Date(m.last)) / 36e5);
      return '<tr><td class="ltr"><a class="call-ic" data-call="' + esc(m.phone) + '">' + esc(m.phone) + '</a>' +
        ' ' + clickable('data-go=\'{"phone":"' + esc(m.phone) + '"}\' title="כל השיחות מול המספר"', '↗') + '</td>' +
        '<td>' + (m.lead ? '<a href="#" data-golead="' + esc(m.lead.id) + '"><b>' + esc(m.lead.name) + '</b></a>'
                        : '<span class="muted">לא מזוהה כליד</span>') + '</td>' +
        '<td>' + clickable('data-go=\'{"phone":"' + esc(m.phone) + '","ans":"n"}\'',
          '<b style="color:' + (m.n > 1 ? 'var(--danger)' : 'inherit') + '">' + m.n + '</b>') + '</td>' +
        '<td class="muted">' + esc(fmtDateTime(m.last)) + '</td>' +
        '<td><span style="color:' + (hrs >= 24 ? 'var(--danger)' : hrs >= 4 ? 'var(--warn)' : 'var(--muted)') + ';font-weight:700">' +
          (hrs < 1 ? 'פחות משעה' : hrs < 24 ? hrs + ' שעות' : Math.floor(hrs / 24) + ' ימים') + '</span></td>' +
        '<td>' + (m.dept ? '<span class="tag">' + esc(m.dept) + '</span>' : '—') + '</td></tr>';
    }).join('');

    view('<div class="card">' + head +
      '<div class="cards" style="margin-bottom:14px">' +
        stat('ממתינים לחזרה', open.length) +
        stat('ניסו יותר מפעם', open.filter(function (m) { return m.n > 1; }).length) +
        stat('מחכים מעל יממה', open.filter(function (m) { return Date.now() - new Date(m.last) > 864e5; }).length) +
        stat('מזוהים כלידים', open.filter(function (m) { return !!m.lead; }).length) +
      '</div>' +
      '<p class="muted" style="font-size:12.5px;margin:0 0 12px;line-height:1.7">' +
      'שיחות נכנסות שלא נענו, ושמאז לא הייתה שיחה נוספת שנענתה מול אותו מספר. ' +
      'לקוח שניסה פעמיים ולא קיבל מענה מסומן באדום.</p>' +
      '<div class="table-scroll"><table><thead><tr>' +
        '<th>מספר</th><th>ליד</th><th>ניסיונות</th><th>ניסיון אחרון</th><th>ממתין</th><th>מחלקה</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">✅ אין מי שממתין לחזרה</td></tr>') +
      '</tbody></table></div></div>');
  }

  // ---------- ניתוח שיחות ----------
  //  בונה תקציר קומפקטי של השיחות (כבר מסונן RLS: נציג=שלו, מנהל=הארגון)
  //  שנשלח לסוכן ה-AI. סטטיסטיקה + ביצועי נציגים + דגימת שיחות אחרונות.
  function callsDigest(all) {
    var az = all.filter(function (c) { return c.crm_analysis && typeof c.crm_analysis.score === 'number'; });
    var sent = { 'חיובי': 0, 'ניטרלי': 0, 'שלילי': 0 }, types = {}, statuses = {}, objCats = {}, byAgent = {}, scores = [];
    var avg = function (a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; };
    az.forEach(function (c) {
      var a = c.crm_analysis; scores.push(a.score);
      if (sent[a.sentiment] != null) sent[a.sentiment]++;
      if (a.call_type) types[a.call_type] = (types[a.call_type] || 0) + 1;
      if (a.status_suggestion) statuses[a.status_suggestion] = (statuses[a.status_suggestion] || 0) + 1;
      (a.objections_detailed || []).forEach(function (o) { if (o.category) objCats[o.category] = (objCats[o.category] || 0) + 1; });
      var k = agentOf(c), o = byAgent[k] || (byAgent[k] = { n: 0, s: [] }); o.n++; o.s.push(a.score);
    });
    return {
      stats: { total: all.length, answered: all.filter(function (c) { return c.answered === true; }).length, analyzed: az.length, avgScore: avg(scores), sentiment: sent, types: types, statuses: statuses, top_objections: objCats },
      agents: Object.keys(byAgent).map(function (k) { return { name: k, calls: byAgent[k].n, avgScore: avg(byAgent[k].s) }; }),
      recent: all.slice(0, 35).map(function (c) {
        var a = c.crm_analysis || {};
        return { date: String(c.started_at || '').slice(0, 10), agent: agentOf(c), answered: c.answered === true, score: a.score, sentiment: a.sentiment, type: a.call_type, status: a.status_suggestion, summary: String(a.summary || '').slice(0, 220), objections: (a.objections_detailed || []).map(function (o) { return o.category; }).filter(Boolean) };
      })
    };
  }
  function paintAi(all, head) {
    var digest = callsDigest(all);
    var isMgr = window.C2B.role === 'admin' || window.C2B.role === 'branch' || window.C2B.isSuper;
    var sugg = isMgr
      ? ['איך הביצועים של הצוות?', 'מי הנציג החזק ומי צריך חיזוק?', 'מה ההתנגדויות הכי נפוצות ואיך לשפר?', 'אילו שיחות דורשות מעקב דחוף?']
      : ['איך הביצועים שלי?', 'מה ההתנגדויות שהכי קשה לי?', 'במה כדאי לי להשתפר?', 'אילו שיחות שלי דורשות מעקב?'];
    view('<div class="card">' + head +
      '<div class="cl-ai" style="margin-bottom:12px"><b>🤖 סוכן AI לשיחות</b><div class="muted" style="font-size:12.5px;margin-top:4px">שאלו כל שאלה על השיחות ' + (isMgr ? 'של הצוות' : 'שלכם') + ' בטווח שנבחר — ביצועים, התנגדויות, מגמות והמלצות. מבוסס על ' + digest.stats.analyzed + ' שיחות מנותחות.</div></div>' +
      '<div id="caiChat" style="min-height:120px;max-height:52vh;overflow:auto;display:flex;flex-direction:column;gap:10px;margin-bottom:12px"></div>' +
      '<div id="caiSug" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' + sugg.map(function (s) { return '<button class="btn btn-ghost btn-sm" data-caisug="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
      '<div style="display:flex;gap:8px"><input class="inp" id="caiQ" placeholder="שאלו את הסוכן…" style="flex:1"><button class="btn" id="caiAsk">שאל</button></div>' +
      '</div>');
    var chat = $('caiChat');
    chat.innerHTML = '<div class="ai-empty">שאלו שאלה או בחרו הצעה כדי להתחיל.</div>';
    function bubble(role, txt) {
      var wrap = document.createElement('div'); wrap.style.cssText = 'max-width:90%;' + (role === 'me' ? 'align-self:flex-start' : 'align-self:flex-end');
      var b = document.createElement('div');
      b.style.cssText = 'border-radius:12px;padding:10px 13px;font-size:14px;line-height:1.7;white-space:pre-wrap;border:1px solid var(--line);' + (role === 'me' ? 'background:var(--surface-2)' : 'background:var(--brand-soft)');
      b.textContent = txt; wrap.appendChild(b); return wrap;
    }
    function ask(qtext) {
      var q = (qtext || $('caiQ').value || '').trim(); if (!q) return;
      var e = chat.querySelector('.ai-empty'); if (e) chat.innerHTML = '';
      $('caiQ').value = '';
      chat.appendChild(bubble('me', q));
      var pend = bubble('ai', 'חושב…'); chat.appendChild(pend); chat.scrollTop = chat.scrollHeight;
      $('caiAsk').disabled = true;
      db.functions.invoke('call-ai', { body: { question: q, digest: digest, range: callRangeLabel(), role: (isMgr ? 'מנהל' : 'נציג') } }).then(function (r) {
        $('caiAsk').disabled = false;
        var d = (r && r.data) || {};
        pend.querySelector('div').textContent = d.answer || ('שגיאה: ' + (d.error || 'לא התקבלה תשובה'));
        chat.scrollTop = chat.scrollHeight;
      }, function () { $('caiAsk').disabled = false; pend.querySelector('div').textContent = 'שגיאה בקבלת תשובה. נסו שוב.'; });
    }
    $('caiAsk').addEventListener('click', function () { ask(); });
    $('caiQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
    $('view').querySelectorAll('[data-caisug]').forEach(function (b) { b.addEventListener('click', function () { ask(b.dataset.caisug); }); });
  }

  // ---------- רשימת כל השיחות ----------
  function paintList(all, head) {
    var depts = {};
    all.forEach(function (c) { if (c.department) depts[c.department] = (depts[c.department] || 0) + 1; });

    var list = all.filter(function (c) {
      if (callFilter.dept && c.department !== callFilter.dept) return false;
      if (callFilter.dir && c.direction !== callFilter.dir) return false;
      if (callFilter.ans === 'y' && c.answered !== true) return false;
      if (callFilter.ans === 'n' && c.answered !== false) return false;
      if (callFilter.agent && (agentOf(c)) !== callFilter.agent) return false;
      if (callFilter.phone && last9(callPhone(c)) !== last9(callFilter.phone)) return false;
      if (callFilter.rec === 'y' && !c.recording_url) return false;
      if (callFilter.rec === 'n' && c.recording_url) return false;
      if (callFilter.sentiment && (!c.crm_analysis || c.crm_analysis.sentiment !== callFilter.sentiment)) return false;
      if (callFilter.ctype && (!c.crm_analysis || c.crm_analysis.call_type !== callFilter.ctype)) return false;
      if (callFilter.scoreband === 'low' && (!c.crm_analysis || typeof c.crm_analysis.score !== 'number' || c.crm_analysis.score >= 40)) return false;
      if (callFilter.analyzed === 'y' && (!c.crm_analysis || typeof c.crm_analysis.score !== 'number')) return false;
      if (callFilter.hour !== '' && c.started_at && new Date(c.started_at).getHours() !== +callFilter.hour) return false;
      if (callFilter.today) {
        var t0 = new Date(); t0.setHours(0, 0, 0, 0);
        if (new Date(c.started_at) < t0) return false;
      }
      if (callFilter.q) {
        var q = callFilter.q.toLowerCase();
        var hay = [c.from_number, c.to_number, c.did, c.agent_name, agentOf(c), c.department,
                   c._lead && c._lead.name, c.transcript].filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    if (!callCols) callCols = window.C2B.colPicker('calls', CALL_COLS, function () { renderCalls('list'); }, { sortable: true });
    //  כל השורה לחיצה — פותחת את עמוד השיחה. הבודק ב-wireCalls מדלג על
    //  לחיצות על קישורים/כפתורים בתוך השורה (טלפון, ליד, וואטסאפ).
    var rows = callCols.sortRows(list).map(function (c) {
      return '<tr data-callinfo="' + esc(c.id) + '" style="cursor:pointer" title="לחצו לפתיחת עמוד השיחה">' + callCols.cells(c) + '</tr>';
    }).join('');
    var dOpts = Object.keys(depts).sort(function (a, b) { return depts[b] - depts[a]; })
      .map(function (d) { return '<option value="' + esc(d) + '"' + (callFilter.dept === d ? ' selected' : '') + '>' + esc(d) + ' (' + depts[d] + ')</option>'; }).join('');

    view('<div class="card">' + head +
      '<div class="row-between" style="margin-bottom:8px"><span class="muted" style="font-size:12.5px">' +
        list.length + ' מתוך ' + all.length + '</span>' + callCols.button() + '</div>' +
      //  מה שסינן את הרשימה מוצג במפורש. בלי זה לחיצה על מספר בסקירה
      //  הייתה מובילה לרשימה קצרה בלי שום רמז למה.
      (Object.keys(callFilter).some(function (k) { return callFilter[k] !== ''; })
        ? '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
          '<span class="muted" style="font-size:12px">מסונן לפי:</span>' +
          Object.keys(callFilter).filter(function (k) { return callFilter[k] !== ''; }).map(function (k) {
            return '<span class="tag" style="background:var(--brand-soft);color:var(--brand);font-weight:700">' +
              esc(CF_LABELS[k]) + ': ' + esc(cfText(k, callFilter[k])) +
              ' <a href="#" data-cfdel="' + k + '" style="color:inherit;text-decoration:none">✕</a></span>';
          }).join('') +
          '<a href="#" id="cfClearAll" style="font-size:12px">נקה הכל</a></div>'
        : '') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<input class="inp" id="clQ" placeholder="🔎 מספר, נציג, מחלקה, שם לקוח או תוכן תמלול…" value="' + esc(callFilter.q) + '" style="flex:1;min-width:240px">' +
        '<select class="inp" id="clDept" style="width:190px"><option value="">כל המחלקות</option>' + dOpts + '</select>' +
        '<select class="inp" id="clDir" style="width:130px"><option value="">כל הכיוונים</option>' +
          '<option value="in"' + (callFilter.dir === 'in' ? ' selected' : '') + '>נכנסות</option>' +
          '<option value="out"' + (callFilter.dir === 'out' ? ' selected' : '') + '>יוצאות</option></select>' +
        '<select class="inp" id="clAns" style="width:140px"><option value="">נענו ולא נענו</option>' +
          '<option value="y"' + (callFilter.ans === 'y' ? ' selected' : '') + '>נענו בלבד</option>' +
          '<option value="n"' + (callFilter.ans === 'n' ? ' selected' : '') + '>לא נענו בלבד</option></select>' +
      '</div>' +
      '<div class="table-scroll"><table><thead><tr>' + callCols.thead() + '</tr></thead><tbody>' +
        (rows || '<tr><td colspan="' + callCols.colCount() + '" class="empty">אין שיחות בסינון הזה</td></tr>') +
      '</tbody></table></div></div>');

    callCols.bind();
    var qEl = $('clQ'), t = null;
    qEl.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { callFilter.q = qEl.value.trim(); renderCalls('list'); }, 350);
    });
    ['clDept:dept', 'clDir:dir', 'clAns:ans'].forEach(function (pair) {
      var p = pair.split(':');
      $(p[0]).addEventListener('change', function () { callFilter[p[1]] = this.value; renderCalls('list'); });
    });
  }

  //  חיווט משותף לכל תתי-התצוגות
  function wireCalls(all) {
    //  מאזין אחד על המכל: כל אלמנט עם data-go מוביל לרשימה המסוננת,
    //  בלי לחווט כל שורה בנפרד ובלי לדלוף מאזינים בכל ציור מחדש.
    var host = $('view');
    host.addEventListener('click', function (e2) {
      var ac = e2.target.closest('[data-agentcard]');
      if (ac) { e2.preventDefault(); return renderAgentCard(ac.dataset.agentcard, all); }
      var g = e2.target.closest('[data-go]');
      if (g) {
        e2.preventDefault();
        var patch = {};
        try { patch = JSON.parse(g.dataset.go); } catch (x) {}
        return goList(patch);
      }
      var kpi = e2.target.closest('.kpi[data-kpi]');
      if (kpi) {
        var k = kpi.dataset.kpi;
        if (k === 'today') return goList({ today: '1' });
        if (k === 'ansOnly') return goList({ ans: 'y' });
        if (k === 'noAns') return goList({ ans: 'n' });
        if (k === 'rec') return goList({ rec: 'y' });
        if (k === 'analyzed') return goList({ analyzed: 'y' });
        if (k === 'alerts') return goList({ scoreband: 'low' });
        return goList({});
      }
      var row = e2.target.closest('tr[data-callinfo]');
      if (row && !e2.target.closest('a,button')) {
        var c = all.filter(function (x) { return x.id === row.dataset.callinfo; })[0];
        if (c) openCall(c.id);
      }
    });
    if ($('cfClearAll')) $('cfClearAll').addEventListener('click', function (e2) { e2.preventDefault(); cfClear(); renderCalls('list'); });
    host.querySelectorAll('[data-cfdel]').forEach(function (x) {
      x.addEventListener('click', function (e2) { e2.preventDefault(); e2.stopPropagation(); callFilter[x.dataset.cfdel] = ''; renderCalls('list'); });
    });
    $('view').querySelectorAll('[data-golead]').forEach(function (aEl) {
      aEl.addEventListener('click', function (e) { e.preventDefault(); window.C2B_openLeadCard(aEl.dataset.golead); });
    });
    $('view').querySelectorAll('[data-callinfo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = all.filter(function (x) { return x.id === b.dataset.callinfo; })[0];
        if (c) openCall(c.id);
      });
    });
    //  כתובות חתומות בבקשה אחת ולא אחת לכל שורה
    var recEls = $('view').querySelectorAll('[data-recplay]');
    if (recEls.length) {
      var paths = [];
      recEls.forEach(function (el) { if (paths.indexOf(el.dataset.recplay) < 0) paths.push(el.dataset.recplay); });
      db.storage.from('call-recordings').createSignedUrls(paths, 3600).then(function (sr) {
        var map = {};
        ((sr && sr.data) || []).forEach(function (s) { if (s && s.signedUrl) map[s.path] = s.signedUrl; });
        recEls.forEach(function (el) { swapPlayer(el, map[el.dataset.recplay], 'cl-play'); });
      }, function () {});
    }
  }

  //  פרטי שיחה — כולל המטען המקורי. הוא מוצג בכוונה: מבנה ה-CDR של
  //  הספק אינו מתועד, וכשמתברר ששדה כלשהו לא מופה נכון אפשר לראות כאן
  //  את הערך האמיתי בלי לגשת למסד.
  //  עמוד השיחה המלא — נפתח בלחיצה על שיחה. כאן יושב כל מה שראינו
  //  אצל Nivision ויותר: השיחה כדיאלוג נציג/לקוח, הקלטה, סיכום,
  //  התנגדויות, מה הנציג התחייב, הצעד הבא, והמלצת סטטוס עם החלה בקליק.
  //  מד עגול (conic) לציון, סרגל כישור אופקי, ויחס דיבור מחושב מהדיאלוג.
  function gauge(val, label, sub, max) {
    max = max || 100;
    var v = (val == null || isNaN(+val)) ? null : +val;
    var p = v == null ? 0 : Math.max(0, Math.min(100, Math.round(v / max * 100)));
    var col = p >= 70 ? 'var(--ok)' : p >= 40 ? 'var(--warn)' : 'var(--danger)';
    return '<div class="gauge-wrap">' +
      '<div class="gauge" style="background:conic-gradient(' + col + ' 0 ' + (p * 3.6) + 'deg,var(--surface-2) ' + (p * 3.6) + 'deg 360deg)">' +
        '<div class="gauge-hole"><div class="gauge-num" style="color:' + col + '">' + (v == null ? '—' : v) + '</div></div></div>' +
      '<div class="gauge-lbl">' + esc(label) + '</div>' + (sub ? '<div class="gauge-sub">' + esc(sub) + '</div>' : '') +
    '</div>';
  }
  function skillBar(label, val) {
    val = Math.max(0, Math.min(100, Math.round(+val || 0)));
    var col = val >= 70 ? 'var(--ok)' : val >= 40 ? 'var(--warn)' : 'var(--danger)';
    return '<div class="skill-row"><div class="skill-lbl">' + esc(label) + '</div>' +
      '<div class="skill-track"><div class="skill-fill" style="width:' + val + '%;background:' + col + '"></div></div>' +
      '<div class="skill-n">' + val + '</div></div>';
  }
  function talkRatio(c) {
    var d = c.transcript_dialog; if (!Array.isArray(d) || !d.length) return null;
    var wa = 0, wc = 0;
    d.forEach(function (t) {
      var n = String(t.text || '').split(/\s+/).filter(Boolean).length;
      if (/נציג|agent/i.test(t.speaker || '')) wa += n; else wc += n;
    });
    var tot = wa + wc; if (!tot) return null;
    return { agent: Math.round(wa / tot * 100), customer: Math.round(wc / tot * 100) };
  }

  function renderCallView(c) {
    var a = c.crm_analysis || {};
    var dir = c.direction === 'out' ? '↗ יוצאת' : c.direction === 'in' ? '↙ נכנסת' : '—';
    var dirCls = c.direction === 'out' ? 'cl-out' : 'cl-in';
    var has = function (v) { return v != null && v !== ''; };

    //  ---- דיאלוג ----
    var convo;
    if (Array.isArray(c.transcript_dialog) && c.transcript_dialog.length) {
      convo = c.transcript_dialog.map(function (t) {
        var me = /נציג|agent/i.test(t.speaker || '');
        return '<div class="cv-turn' + (me ? ' me' : '') + '"><div class="cv-who">' + esc(t.speaker || '') + '</div>' +
          '<div class="cv-bub">' + esc(t.text || '') + '</div></div>';
      }).join('');
    } else if (c.transcript) {
      convo = '<div class="muted" style="font-size:12px;margin-bottom:8px">התמלול טרם עובד לדיאלוג — מוצג גולמי:</div><div class="cl-tr">' + esc(c.transcript) + '</div>';
    } else {
      convo = '<div class="ai-empty">אין עדיין תמלול לשיחה הזו.<br>' + (c.recording_path ? 'הקובץ הורד וממתין לתמלול (עד כמה דקות).' : 'ההקלטה טרם הורדה.') + '</div>';
    }

    //  ---- הקלטה ----
    var recBlock;
    if (c.recording_path) recBlock = '<div class="cv-rec"><span class="cv-rec-lbl">🎧 הקלטת השיחה</span><span data-recplay="' + esc(c.recording_path) + '" class="muted" style="font-size:12px">טוען הקלטה…</span><button class="btn btn-ghost btn-sm" data-recdl="' + esc(c.recording_path) + '" title="הורד למחשב">⬇ הורד</button></div>';
    else if (c.answered === false) recBlock = '<div class="cv-rec cv-rec-none">☎️ השיחה לא נענתה — אין הקלטה</div>';
    else if (c.recording_url) recBlock = '<div class="cv-rec"><span class="cv-rec-lbl">🎧 הקלטת השיחה</span><a class="btn btn-ghost btn-sm" href="' + esc(c.recording_url) + '" target="_blank" rel="noopener">האזן ב-Voicenter</a><span class="muted" style="font-size:11px">ההקלטה יורדת למערכת ותופיע כאן בקרוב</span></div>';
    else recBlock = '<div class="cv-rec cv-rec-none">אין הקלטה זמינה לשיחה זו</div>';

    //  ---- בלוקי הניתוח ----
    function sec(title, body) { return body ? '<div class="card cv-block"><h3 class="cv-bt">' + title + '</h3>' + body + '</div>' : ''; }
    function ul(arr) { return (Array.isArray(arr) && arr.length) ? '<ul class="cv-ul">' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }
    function info(k, v, cls) { return '<div class="cv-info-item"><div class="cv-info-k">' + esc(k) + '</div><div class="cv-info-v ' + (cls || '') + '">' + esc(v) + '</div></div>'; }
    var blocks = '';

    if (has(a.summary) || has(a.bottom_line) || has(a.what_done)) blocks += sec('📝 סיכום שיחה',
      (has(a.summary) ? '<div class="cv-summary">' + esc(a.summary) + '</div>' : '') +
      (has(a.bottom_line) ? '<div class="cv-hl cv-hl-line"><b>השורה התחתונה:</b> ' + esc(a.bottom_line) + '</div>' : '') +
      (has(a.what_done) ? '<div class="cv-hl cv-hl-done">✓ מה בוצע: ' + esc(a.what_done) + '</div>' : ''));

    if (has(a.score) || has(a.customer_score) || has(a.agent_score)) blocks += sec('📊 ציוני שיחה',
      '<div class="gauge-row">' + gauge(a.customer_score, 'ציון לקוח') + gauge(a.agent_score, 'ציון נציג') + gauge(a.score, 'ציון שיחה') + '</div>' +
      (has(a.difficulty) ? '<div class="cv-inline"><span class="muted">רמת קושי:</span> <span class="tag">' + esc(a.difficulty) + '</span></div>' : '') +
      (has(a.score_reason) ? '<div class="cv-txt" style="margin-top:8px">' + esc(a.score_reason) + '</div>' : ''));

    var sk = a.agent_skills || {};
    if (Object.keys(sk).length || (a.agent_strengths && a.agent_strengths.length) || (a.agent_weaknesses && a.agent_weaknesses.length) || has(a.manager_insight)) blocks += sec('🎯 ביצועי נציג' + ' · ' + esc(agentOf(c)),
      (Object.keys(sk).length ? '<div class="skill-list">' + skillBar('טיפול בהתנגדויות', sk.objection_handling) + skillBar('אמפתיה', sk.empathy) + skillBar('בהירות תקשורת', sk.clarity) + skillBar('גילוי צרכים', sk.needs_discovery) + '</div>' : '') +
      ((a.agent_strengths && a.agent_strengths.length) ? '<div class="cv-sub-h" style="color:var(--ok)">✓ חוזקות</div>' + ul(a.agent_strengths) : '') +
      ((a.agent_weaknesses && a.agent_weaknesses.length) ? '<div class="cv-sub-h" style="color:var(--danger)">△ לשיפור</div>' + ul(a.agent_weaknesses) : '') +
      (has(a.manager_insight) ? '<div class="cv-hl cv-hl-info">💡 תובנה למנהל: ' + esc(a.manager_insight) + '</div>' : ''));

    var en = a.agent_energy || {};
    if (Object.keys(en).length) blocks += sec('⚡ אנרגיית נציג',
      '<div class="skill-list">' + skillBar('ביטחון', en.confidence) + skillBar('אדיבות', en.courtesy) + skillBar('סבלנות', en.patience) + skillBar('יוזמה', en.initiative) + skillBar('אופטימיות', en.optimism) + '</div>' +
      (has(a.energy_summary) ? '<div class="cv-txt" style="margin-top:8px">' + esc(a.energy_summary) + '</div>' : ''));

    if (has(a.sentiment_call) || has(a.sentiment_customer) || has(a.sentiment_agent)) blocks += sec('😊 סנטימנט שיחה',
      '<div class="gauge-row">' + gauge(a.sentiment_customer, 'לקוח', a.sentiment_customer_label, 10) + gauge(a.sentiment_agent, 'נציג', a.sentiment_agent_label, 10) + gauge(a.sentiment_call, 'שיחה', a.sentiment_call_label, 10) + '</div>' +
      (has(a.sentiment_insight) ? '<div class="cv-txt" style="margin-top:8px">' + esc(a.sentiment_insight) + '</div>' : ''));

    var tr = talkRatio(c) || (a.talk_ratio && (a.talk_ratio.agent || a.talk_ratio.customer) ? a.talk_ratio : null);
    if (tr) blocks += sec('🗣️ יחס דיבור', '<div class="tr-bar"><div class="tr-seg tr-a" style="width:' + (tr.agent || 0) + '%">נציג ' + (tr.agent || 0) + '%</div><div class="tr-seg tr-c" style="width:' + (tr.customer || 0) + '%">לקוח ' + (tr.customer || 0) + '%</div></div>');

    if (a.stages && a.stages.length) blocks += sec('📈 ציר זמן שיחה',
      a.stages.map(function (st, i) { return '<div class="stage-row"><div class="stage-n">' + (i + 1) + '</div><div style="flex:1"><div class="stage-t">' + esc(st.title || '') + (has(st.score) ? ' ' + scoreChip(st.score) : '') + '</div>' + (has(st.note) ? '<div class="muted" style="font-size:12px">' + esc(st.note) + '</div>' : '') + '</div></div>'; }).join(''));

    if (a.objections_detailed && a.objections_detailed.length) blocks += sec('⚠️ התנגדויות וחששות',
      a.objections_detailed.map(function (o) { return '<div class="cv-obj"><div class="cv-obj-q">"' + esc(o.quote || '') + '"</div>' + (has(o.agent_response) ? '<div class="cv-obj-r"><span class="muted">תגובת הנציג:</span> ' + esc(o.agent_response) + '</div>' : '') + (has(o.improvement) ? '<div class="cv-obj-i"><span class="muted">לשיפור:</span> ' + esc(o.improvement) + '</div>' : '') + '<div class="cv-obj-tags">' + (has(o.status) ? '<span class="tag">' + esc(o.status) + '</span>' : '') + (has(o.difficulty) ? '<span class="tag muted">קושי: ' + esc(o.difficulty) + '</span>' : '') + '</div></div>'; }).join(''));

    if (a.red_flags && a.red_flags.length) blocks += sec('🚩 דגלים אדומים',
      a.red_flags.map(function (f) { var hot = /חם|גבוה/.test(f.severity || ''); return '<div class="cv-flag ' + (hot ? 'hot' : '') + '"><div class="cv-flag-t">' + (hot ? '🔴' : '🟠') + ' ' + esc(f.title || '') + '</div>' + (has(f.detail) ? '<div class="muted" style="font-size:12.5px">' + esc(f.detail) + '</div>' : '') + (has(f.action) ? '<div class="cv-flag-a">▸ ' + esc(f.action) + '</div>' : '') + '</div>'; }).join(''));

    if (a.action_items && a.action_items.length) blocks += sec('✅ פעולות לביצוע',
      a.action_items.map(function (t) { return '<div class="cv-act"><span class="cv-act-t">' + esc(t.title || '') + '</span>' + (has(t.priority) ? '<span class="tag' + (/גבוה/.test(t.priority) ? '' : ' muted') + '">' + esc(t.priority) + '</span>' : '') + (has(t.owner) ? '<span class="muted" style="font-size:11.5px">' + esc(t.owner) + '</span>' : '') + '</div>'; }).join(''));

    if (a.key_quotes && a.key_quotes.length) blocks += sec('💬 ציטוטי מפתח', a.key_quotes.map(function (q) { return '<div class="cv-quote">"' + esc(q) + '"</div>'; }).join(''));

    if (has(a.vehicle_context)) blocks += sec('🚗 הקשר רכב', '<div class="cv-txt">' + esc(a.vehicle_context) + '</div>' + (has(a.car_mentioned) ? '<div style="margin-top:6px"><span class="tag">🚗 ' + esc(a.car_mentioned) + '</span></div>' : ''));

    if (a.next_action && has(a.next_action.text)) blocks += sec('➡️ הצעד הבא',
      '<div class="cv-hl cv-hl-info">' + (has(a.next_action.who) ? '<b>' + esc(a.next_action.who) + ' מחזיק בכדור:</b> ' : '') + esc(a.next_action.text) + '</div>' +
      (has(a.next_step) ? '<div class="cv-txt" style="margin-top:6px">' + esc(a.next_step) + (has(a.next_step_when) ? ' <span class="muted">(' + esc(a.next_step_when) + ')</span>' : '') + '</div>' : ''));

    //  בלוק הסטטוס המומלץ נבנה בנפרד ומוקדם לראש הניתוח (הדבר הכי
    //  שימושי לנציג/מנהל). אם הסטטוס "לא רלוונטי" — ה-AI ממליץ גם על סיבה
    //  מתוך הרשימה הקנונית, וההחלה כותבת אותה ל-close_reason של הכרטיס.
    var isLost = a.status_suggestion === 'lost';
    var lreason = isLost && has(a.lost_reason) ? String(a.lost_reason) : '';
    var statusBlock = '';
    if (has(a.status_suggestion)) statusBlock = sec('🎯 סטטוס מומלץ',
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + badgeFor(a.status_suggestion, '') +
      (has(a.status_reason) ? '<span class="muted" style="font-size:12.5px">' + esc(a.status_reason) + '</span>' : '') +
      (lreason ? '<span class="tag" style="color:var(--danger);border-color:var(--danger)">🚫 סיבה מומלצת: ' + esc(lreason) + '</span>' : '') +
      (c._lead ? '<button class="btn btn-sm" data-applyst="' + esc(c._lead.id) + '" data-st="' + esc(a.status_suggestion) + '" data-reason="' + esc(lreason) + '">החל על כרטיס הלקוח</button>' + (a.next_step ? ' <button class="btn btn-ghost btn-sm" data-applytask="' + esc(c._lead.id) + '" data-st="' + esc(a.status_suggestion) + '" data-ns="' + esc(a.next_step) + '" data-nw="' + esc(a.next_step_when || '') + '" data-agent="' + esc(c._agentUserId || '') + '" data-reason="' + esc(lreason) + '">✓ החל + פתח משימה לנציג</button>' : '') : '<span class="muted" style="font-size:12px">הלקוח אינו קיים ככרטיס במערכת — לא נוצר ליד חדש</span>') + '</div>');
    blocks = statusBlock + blocks;

    if (!blocks) blocks = '<div class="card cv-block"><div class="ai-empty">' + (c.transcript ? 'הניתוח בדרך (עד כמה דקות).' : 'הניתוח יופק אחרי התמלול.') + '</div></div>';

    var det = [
      ['נציג', agentOf(c) + (c.agent_ext ? ' · שלוחה ' + c.agent_ext : '')],
      ['מחלקה', c.department || '—'],
      ['מספר הלקוח', callPhone(c) || '—'],
      ['משך שיחה', c.talk_sec ? mmss(c.talk_sec) : '—'],
      ['זמן צלצול', c.ring_sec != null ? c.ring_sec + ' ש\'' : '—'],
      ['נענתה', c.answered === true ? 'כן' : c.answered === false ? 'לא' : '—'],
      ['מספר הארגון', c.did || '—'],
      ['מזהה שיחה', c.external_id ? String(c.external_id).slice(0, 20) : '—']
    ];

    var headBadges = (has(a.outcome) ? '<span class="tag">' + esc(a.outcome) + '</span>' : '') +
      (has(a.call_type) ? '<span class="tag muted">' + esc(a.call_type) + '</span>' : '') +
      (has(a.difficulty) ? '<span class="tag muted">קושי: ' + esc(a.difficulty) + '</span>' : '');

    view('<div class="cv-wrap">' +
      '<div class="lead-top"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" id="cvBack">→ חזרה לשיחות</button>' +
        '<h3 style="margin:0">📞 שיחה · ' + esc(c.started_at ? fmtDateTime(c.started_at) : '') + '</h3>' +
        '<span class="cl-dir ' + dirCls + '">' + dir + '</span>' +
        (c.answered === false ? '<span class="cl-no">✗ לא נענתה</span>' : '') +
        (c._lead ? '<a href="#" class="btn btn-ghost btn-sm" data-golead="' + esc(c._lead.id) + '">👤 ' + esc(c._lead.name) + '</a>' : '') +
      '</div></div>' +
      (headBadges ? '<div class="cv-headbadges">' + headBadges + '</div>' : '') +
      '<div class="cv-info">' +
        info('נציג', agentOf(c)) +
        info('מספר הלקוח', callPhone(c) || '—', 'ltr') +
        info('מחלקה', c.department || '—') +
        info('משך שיחה', c.talk_sec ? mmss(c.talk_sec) : '—') +
        info('נענתה', c.answered === true ? 'כן' : c.answered === false ? 'לא' : '—') +
      '</div>' +

      '<div class="cv-grid">' +
        '<div class="card cv-left"><h3 style="margin:0 0 12px">💬 מהלך השיחה</h3>' + recBlock + '<div class="cv-tagbar" id="cvTags"></div>' + '<div class="cv-convo">' + convo + '</div>' +
          '<details style="margin-top:14px"><summary class="muted" style="font-size:12px;cursor:pointer">פרטים מלאים ותמלול גולמי</summary>' +
          '<div class="cl-kv" style="margin-top:10px">' + det.map(function (r) { return '<div class="k">' + esc(r[0]) + '</div><div class="v">' + esc(r[1]) + '</div>'; }).join('') + '</div>' +
          (c.transcript ? '<div class="cl-tr" style="margin-top:10px">' + esc(c.transcript) + '</div>' : '') +
          '</details>' +
        '</div>' +
        '<div class="cv-analysis">' + blocks + '</div>' +
      '</div></div>');

    $('cvBack').addEventListener('click', function () { renderCalls(callBackSub || 'list'); });
    $('view').querySelectorAll('[data-golead]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); window.C2B_openLeadCard(el.dataset.golead); });
    });
    document.querySelectorAll('[data-applyst]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true; btn.textContent = 'מחיל…';
        var patch = { status: btn.dataset.st };
        if (btn.dataset.reason) patch.close_reason = btn.dataset.reason;
        db.from('leads').update(patch).eq('id', btn.dataset.applyst).then(function (r) {
          btn.textContent = r.error ? 'שגיאה' : '✓ הוחל';
          if (!r.error && window.C2B.refreshBadges) window.C2B.refreshBadges();
        });
      });
    });
    var recEls = $('view').querySelectorAll('[data-recplay]');
    if (recEls.length) {
      var rpaths = [];
      recEls.forEach(function (el) { if (rpaths.indexOf(el.dataset.recplay) < 0) rpaths.push(el.dataset.recplay); });
      db.storage.from('call-recordings').createSignedUrls(rpaths, 3600).then(function (sr) {
        var rmap = {};
        ((sr && sr.data) || []).forEach(function (s) { if (s && s.signedUrl) rmap[s.path] = s.signedUrl; });
        recEls.forEach(function (el) { swapPlayer(el, rmap[el.dataset.recplay], 'cl-wide'); });
      }, function () {});
    }
    //  הורדת הקלטה למחשב
    $('view').querySelectorAll('[data-recdl]').forEach(function (b) {
      b.addEventListener('click', function () {
        db.storage.from('call-recordings').createSignedUrl(b.dataset.recdl, 3600, { download: true }).then(function (r) {
          if (r && r.data && r.data.signedUrl) { var a = document.createElement('a'); a.href = r.data.signedUrl; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
        }, function () {});
      });
    });
    //  תיוג ידני לשיחה
    var tagBar = $('cvTags');
    function drawTags() {
      if (!tagBar) return;
      var tags = c.tags || [];
      tagBar.innerHTML = '<span class="cv-rec-lbl">🏷️ תיוגים:</span> ' + tags.map(function (t) { return '<span class="tag">' + esc(t) + ' <a href="#" data-tagdel="' + esc(t) + '" style="cursor:pointer;text-decoration:none">✕</a></span>'; }).join(' ') + ' <input class="inp" id="cvTagIn" placeholder="הוסף תגית…" style="width:130px;font-size:12px;padding:4px 8px">';
      tagBar.querySelectorAll('[data-tagdel]').forEach(function (x) { x.addEventListener('click', function (e) { e.preventDefault(); c.tags = (c.tags || []).filter(function (t) { return t !== x.dataset.tagdel; }); db.from('calls').update({ tags: c.tags }).eq('id', c.id).then(function () {}, function () {}); drawTags(); }); });
      var inp = $('cvTagIn'); if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var v = this.value.trim(); if (v && (c.tags || []).indexOf(v) < 0) { c.tags = (c.tags || []).concat([v]); db.from('calls').update({ tags: c.tags }).eq('id', c.id).then(function () {}, function () {}); drawTags(); } } });
    }
    drawTags();
    //  החל סטטוס + פתיחת משימה מהצעד הבא
    document.querySelectorAll('[data-applytask]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true; btn.textContent = 'מחיל…';
        var due = new Date(Date.now() + 864e5); due.setHours(10, 0, 0, 0);
        var leadPatch = { status: btn.dataset.st };
        if (btn.dataset.reason) leadPatch.close_reason = btn.dataset.reason;
        Promise.all([
          db.from('leads').update(leadPatch).eq('id', btn.dataset.applytask),
          db.from('tasks').insert({ lead_id: btn.dataset.applytask, title: btn.dataset.ns + (btn.dataset.nw ? ' (' + btn.dataset.nw + ')' : ''), due_at: due.toISOString(), done: false, assigned_to: btn.dataset.agent || null })
        ]).then(function () { btn.textContent = '✓ הוחל + משימה'; if (window.C2B.refreshBadges) window.C2B.refreshBadges(); }, function () { btn.textContent = 'שגיאה'; });
      });
    });
  }

  //  פתיחת שיחה מלאה: טוענים אותה טרייה מהמסד (התמלול/ניתוח מתעדכנים
  //  ברקע), ומשייכים לליד לפי הטלפון אם עדיין לא שויכה.
  var callBackSub = 'list';
  function openCall(id, backSub) {
    callBackSub = backSub || 'list';
    var myTok = ++viewToken;
    loading();
    db.from('calls').select('*').eq('id', id).single().then(function (r) {
      if (myTok !== viewToken) return;
      if (r.error || !r.data) return errBox('השיחה לא נמצאה');
      var c = r.data;
      var ph = last9(callPhone(c));
      var q = ph ? db.from('leads').select('id,name').is('deleted_at', null)
        .filter('phone', 'ilike', '%' + ph).limit(1) : Promise.resolve({ data: [] });
      //  מפענחים את הנציג שדיבר לפי המספר שלו כדי לשייך אליו את המשימה.
      var an = agentNumOf(c);
      var qa = an ? db.from('profiles').select('user_id').ilike('agent_phone', '%' + an + '%').limit(1) : Promise.resolve({ data: [] });
      Promise.all([q, qa]).then(function (res) {
        if (myTok !== viewToken) return;
        var lr = res[0], pr = res[1];
        c._lead = (lr && lr.data && lr.data[0]) || (c.lead_id ? { id: c.lead_id, name: 'ליד' } : null);
        c._agentUserId = (pr && pr.data && pr.data[0] && pr.data[0].user_id) || null;
        renderCallView(c);
      });
    });
  }
  window.C2B_openCall = openCall;


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
    { key: 'code', label: 'קוד', cell: function (c) { return '<td class="muted">' + esc(c.code || '—') + '</td>'; } },
    //  שדות שכבר מגיעים מהגיליון ולא הוצגו עד היום
    window.C2B.txtCol('year', 'שנת דגם', { w: 100 }),
    window.C2B.txtCol('fuel', 'סוג דלק', { w: 110 }),
    window.C2B.txtCol('cat', 'קטגוריה', { w: 120 }),
    window.C2B.txtCol('condition', 'מצב', { w: 90 }),
    window.C2B.txtCol('km', 'קילומטראז׳', { w: 110 }),
    window.C2B.txtCol('hand', 'יד', { w: 80 }),
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
      view('<div class="card"><div class="row-between"><h3>רכבים <span class="muted" id="ccount"></span></h3><div><input class="inp" id="cq" placeholder="חיפוש חופשי…" style="width:180px"> ' + carCols.button() + '</div></div>' +
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
      //  אין כפתור סנכרון: pg_cron מריץ את sync-cars כל 15 דקות
      draw();
    }).catch(function (e) { errBox(e.message || e); });
  }

  // ---------- APPOINTMENTS (calendar) ----------
  var APPT_MODES = ['פרונטלי', 'טלפוני', 'וידאו', 'בסניף'];
  var APPT_COLS = [
    { key: 'status', label: 'סטטוס', cell: function (a) { return '<td>' + (a._handled ? '<span class="done-badge">✓ בוצעה</span>' : a._soon ? '<span class="task-open">● עתידית</span>' : a._overdue ? '<span class="tag" style="background:rgba(220,38,38,.12);color:var(--danger)">⏰ עברה</span>' : '<span class="tag">חדשה</span>') + '</td>'; } },
    { key: 'name', label: 'שם', fixed: true, cell: function (a) { return '<td><b>' + esc(a.name) + '</b>' + (a._lid ? ' <span class="muted" style="font-size:11px">→ לכרטיס</span>' : '') + '</td>'; } },
    { key: 'phone', label: 'טלפון', cell: function (a) { return '<td>' + esc(a.phone || '—') + '</td>'; } },
    { key: 'when', label: 'מועד', descFirst: true, sort: function (a) { return a._dt || ''; }, cell: function (a) { return '<td><input type="datetime-local" class="inp" data-appt-when="' + a.id + '" value="' + a._dt + '" onclick="event.stopPropagation()" style="font-size:12.5px"></td>'; } },
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
    { key: 'due', label: 'מועד', descFirst: true, sort: function (t) { return t.due_at || ''; }, cell: function (t) { var over = !t.done && t.due_at && new Date(t.due_at).getTime() < Date.now(); return '<td' + (over ? ' style="color:var(--danger);font-weight:600"' : ' class="muted"') + '>' + (t.due_at ? fmtDateTime(t.due_at) : '—') + '</td>'; } },
    { key: 'notes', label: 'הערות', cell: function (t) { return '<td><input class="inp" data-tnote="' + t.id + '" value="' + esc(t.notes || '') + '" placeholder="הוסף הערה…" style="width:100%;min-width:150px;font-size:13px"></td>'; } },
    { key: 'open', label: 'פעולות', cell: function (t) { return '<td>' + (t.lead_id ? '<a href="#" data-lead="' + t.lead_id + '">פתח ליד →</a>' : '') + '</td>'; } },
    { key: 'assigned', label: 'אחראי', def: false, w: 160,
      sort: function (t) { return taskStaff[t.assigned_to] || ''; },
      cell: function (t) { return '<td>' + esc(taskStaff[t.assigned_to] || '—') + '</td>'; } },
  ];
  var taskCols = null, taskStaff = {};
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
      //  שמות הנציגים נדרשים לעמודת "אחראי" בבורר העמודות
      return Promise.all([Promise.resolve(tr), leadsQ, db.from('profiles').select('user_id,full_name')]);
    }).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var tasks = res[0].data || [], lmap = {}, now = Date.now();
      (res[1].data || []).forEach(function (l) { lmap[l.id] = l; });
      ((res[2] && res[2].data) || []).forEach(function (p) { taskStaff[p.user_id] = p.full_name; });
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
  //  pre מוסיף מספר בסוגריים לפני שם השורה (למשל כמות רכבים בדגם),
  //  כדי שאפשר יהיה לקרוא הכנסה וכמות באותה שורה בלי טבלה נוספת.
  function barRows(items, fmt, pre) { var mx = Math.max.apply(null, items.map(function (i) { return i.v; }).concat([1])); return items.length ? items.map(function (i) { var w = mx ? Math.round(i.v / mx * 100) : 0; var q = pre ? pre(i) : ''; return '<div class="mbar"><span class="lbl" title="' + esc(i.label) + '">' + (q ? '<span class="qty">(' + esc(q) + ')</span> ' : '') + esc(i.label) + '</span><span class="track"><span style="width:' + w + '%"></span></span><span class="val">' + fmt(i.v) + '</span></div>'; }).join('') : '<p class="empty">אין נתונים</p>'; }
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
      db.from('leads').select('id,name,phone,car,status,source,created_at,first_response_at,assigned_to,brand,utm_campaign,utm_source,utm_medium,utm_term,utm_content,campaign,adset_name,ad_name,ad_group,ad_id,marketing_company,city').is('deleted_at', null),
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
      //  100% מהלידים: מי שטרם נענה נספר לפי זמן ההמתנה עד עכשיו
      var rts = leads.map(function (l) { return window.C2B.respMins(l.created_at, l.first_response_at || new Date()); });
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
          secCard('🚙 הכנסות לפי דגם', barRows(repTop(byModel, 'revenue', 10), M, function (i) { return i.o.count; })) +
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
      //  רק utm_medium. העמודה medium היא שריד ישן שנכתב כ-"cpc" קבוע
      //  גם לליד אורגני, ואינו נכתב כלל ללידים אורגניים מהאתר — נפילה
      //  אליו הייתה מסווגת לידים אורגניים כממומנים.
      var byMedium = attrBy(function (l) { return l.utm_medium; });
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
      //  ---------- קמפיין \u2192 סדרה \u2192 מודעה בטבלה אחת ----------
      //  קודם היו שלוש טבלאות נפרדות, והמנהל היה צריך לזכור איזו סדרה
      //  שייכת לאיזה קמפיין. כאן ההיררכיה מפורשת: לחיצה על קמפיין
      //  פותחת את הסדרות שלו, ולחיצה על סדרה פותחת את המודעות שלה.
      function attrTree(byDeals) {
        var UN = UNATTR;
        var tree = {};
        function node(m, k) { m[k] = m[k] || { leads: 0, count: 0, revenue: 0, L: [], D: [], kids: {} }; return m[k]; }
        function put(l, d) {
          if (!isPaid(l)) return;
          var c = String(l.campaign || l.utm_campaign || '').trim() || UN;
          var a = String(l.adset_name || l.ad_group || '').trim() || UN;
          var v = String(l.ad_name || '').trim() || UN;
          var lv = [node(tree, c), null, null];
          lv[1] = node(lv[0].kids, a);
          lv[2] = node(lv[1].kids, v);
          lv.forEach(function (o) {
            if (d) { o.count++; o.revenue += (+d.car_price || 0); o.D.push({ d: d, l: l }); }
            else { o.leads++; o.L.push(l); }
          });
        }
        leads.forEach(function (l) { put(l, null); });
        deals.forEach(function (d) { var l = leadById[d.lead_id]; if (l) put(l, d); });

        var sortFn = byDeals
          ? function (a, b) { return (b[1].revenue - a[1].revenue) || (b[1].count - a[1].count) || (b[1].leads - a[1].leads); }
          : function (a, b) { return (b[1].leads - a[1].leads) || (b[1].revenue - a[1].revenue); };
        var out = '', n = 0;
        function row(label, o, depth, pid, id, hasKids) {
          var cr = o.leads ? P1(o.count / o.leads * 100) : '<span class="muted">\u2014</span>';
          var key = repKeys.push({ label: label, o: o }) - 1;
          var nL = o.leads ? '<a class="drill-n" data-rk="' + key + '" data-what="leads">' + o.leads + '</a>' : '<span class="muted">0</span>';
          var nD = o.count ? '<a class="drill-n" data-rk="' + key + '" data-what="deals">' + o.count + '</a>' : '<span class="muted">0</span>';
          var cells = byDeals
            ? ['<td>' + nD + '</td>', '<td>' + M(o.revenue) + '</td>', '<td>' + nL + '</td>', '<td>' + cr + '</td>']
            : ['<td>' + nL + '</td>', '<td>' + nD + '</td>', '<td>' + M(o.revenue) + '</td>', '<td>' + cr + '</td>'];
          var arrow = hasKids ? '<span class="drill-x">\u25b8</span> ' : '';
          return '<tr data-id="' + esc(id) + '" data-parent="' + esc(pid) + '"' +
              (depth ? ' class="hidden"' : '') + '>' +
            '<td style="padding-inline-start:' + (10 + depth * 22) + 'px' + (hasKids ? ';cursor:pointer' : '') + '"' +
              (hasKids ? ' data-drill="1"' : '') + '>' + arrow +
              (depth ? esc(label) : '<b>' + esc(label) + '</b>') + '</td>' + cells.join('') + '</tr>';
        }
        Object.keys(tree).map(function (k) { return [k, tree[k]]; }).sort(sortFn).forEach(function (c) {
          var cid = 'c' + (n++);
          var adsets = Object.keys(c[1].kids).map(function (k) { return [k, c[1].kids[k]]; }).sort(sortFn);
          //  סדרה יחידה ששמה "ללא ייחוס" אינה מוסיפה מידע — לא מציגים חץ
          var real = adsets.filter(function (a) { return a[0] !== UN; });
          out += row(c[0], c[1], 0, '', cid, real.length > 0);
          adsets.forEach(function (a) {
            var aid = cid + '-a' + (n++);
            var ads = Object.keys(a[1].kids).map(function (k) { return [k, a[1].kids[k]]; }).sort(sortFn);
            var realAds = ads.filter(function (x) { return x[0] !== UN; });
            out += row(a[0], a[1], 1, cid, aid, realAds.length > 0);
            ads.forEach(function (x) { out += row(x[0], x[1], 2, aid, aid + '-v' + (n++), false); });
          });
        });
        if (!out) return '<span class="muted">אין קמפיינים בטווח שנבחר.</span>';
        var head = byDeals
          ? ['קמפיין / סדרה / מודעה', 'עסקאות חתומות', 'הכנסות', 'לידים', 'אחוז המרה']
          : ['קמפיין / סדרה / מודעה', 'לידים', 'עסקאות חתומות', 'הכנסות', 'אחוז המרה'];
        return '<div class="table-scroll"><table class="drill-tree">' +
          '<thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' +
          '<tbody>' + out + '</tbody></table></div>';
      }

      //  ---------- אורגני מול ממומן ----------
      //  שני הערוצים נמדדים באותן אמות מידה. ההשוואה החשובה אינה כמות
      //  הלידים אלא מה כל ליד שווה: ערוץ שמביא חצי מהלידים אבל סוגר
      //  פי שלוש הוא הערוץ הרווחי, וזה נעלם כשמסתכלים רק על הכמות.
      function vsPanel() {
        var g = { cpc: { leads: 0, deals: 0, rev: 0 }, seo: { leads: 0, deals: 0, rev: 0 } };
        function bucket(l) {
          var m = String((l && l.utm_medium) || '').toLowerCase();
          if (m === 'cpc' || m === 'ppc' || m === 'paid') return 'cpc';
          if (m === 'seo' || m === 'organic') return 'seo';
          return null;
        }
        leads.forEach(function (l) { var k = bucket(l); if (k) g[k].leads++; });
        deals.forEach(function (dd) {
          var k = bucket(leadById[dd.lead_id]); if (!k) return;
          g[k].deals++; g[k].rev += (+dd.car_price || 0);
        });
        if (!g.cpc.leads && !g.seo.leads) return '';
        var totalSpend = (repCtx && repCtx.spend) || 0;
        function col(key, title, icon, color) {
          var o = g[key];
          var conv = o.leads ? o.deals / o.leads * 100 : null;
          var perLead = o.leads ? o.rev / o.leads : 0;
          var avg = o.deals ? o.rev / o.deals : 0;
          //  עלות מוצגת רק לממומן, ורק כשידועה ההוצאה בפועל
          var cost = (key === 'cpc' && totalSpend)
            ? [['הוצאת פרסום', nis0(totalSpend)],
               ['עלות לליד', o.leads ? nis0(totalSpend / o.leads) : '\u2014'],
               ['עלות לעסקה', o.deals ? nis0(totalSpend / o.deals) : '\u2014']]
            : [];
          var rows = [['לידים', o.leads], ['עסקאות חתומות', o.deals], ['הכנסות', M(o.rev)],
                      ['אחוז המרה', conv === null ? '\u2014' : P1(conv)],
                      ['הכנסה ממוצעת לליד', perLead ? M(perLead) : '\u2014'],
                      ['עסקה ממוצעת', avg ? M(avg) : '\u2014']].concat(cost);
          var win = perLead > 0 && perLead >= (key === 'cpc'
            ? (g.seo.leads ? g.seo.rev / g.seo.leads : 0)
            : (g.cpc.leads ? g.cpc.rev / g.cpc.leads : 0));
          return '<div class="vs-col' + (win ? ' win' : '') + '">' +
            '<h4>' + icon + ' ' + title +
            (win ? '<span class="tag-sm" style="background:' + color + '18;color:' + color + '">מוביל</span>' : '') + '</h4>' +
            rows.map(function (r) {
              return '<div class="vs-row"><span class="muted">' + r[0] + '</span><b>' + r[1] + '</b></div>';
            }).join('') + '</div>';
        }
        return secCard('\u2696\ufe0f אורגני מול ממומן',
          '<div class="vs-grid">' +
            col('cpc', 'ממומן \u00b7 PPC', '\ud83d\udcb8', 'var(--warn)') +
            col('seo', 'אורגני \u00b7 SEO', '\ud83c\udf31', 'var(--ok)') +
          '</div>' +
          '<div class="vs-note">\u2139\ufe0f החלוקה לפי <b>utm_medium</b>: ליד מקמפיין מסומן <b>cpc</b>, וליד שנכנס בלי ייחוס פרסומי מקבל <b>seo</b> אוטומטית. ' +
          'הסימון <b>מוביל</b> ניתן לפי <b>הכנסה ממוצעת לליד</b> ולא לפי כמות — ערוץ עם פחות לידים ששוויים גבוה יותר עדיף.' +
          (totalSpend ? '' : ' עלות לליד ולעסקה יוצגו כשנתוני ההוצאה של Meta יהיו בטווח שנבחר.') + '</div>');
      }

      //  ---------- מקורות לפי נציג ----------
      //  אותם נתונים כמו טבלת המקורות, אבל חתוכים לפי בעל התיק. כך רואים
      //  שנציג אחד חי מפייסבוק ואחר מהפניות, ואיזה מקור כל אחד באמת יודע
      //  לסגור — נתון שעד היום לא הופיע בשום מסך. לחיצה על נציג פותחת את
      //  פירוט המקורות שלו.
      function staffSourceTree(byDeals) {
        var tree = {};
        function node(m, k) { m[k] = m[k] || { leads: 0, count: 0, revenue: 0, L: [], D: [], kids: {} }; return m[k]; }
        function srcOf(l) {
          var n = namedSource(l);
          if (n) return n;
          return isPaid(l) ? 'פרסום ממומן' : UNATTR;
        }
        function put(l, d) {
          var who = (l.assigned_to && prof[l.assigned_to]) || 'ללא שיוך לנציג';
          var lv = [node(tree, who)];
          lv.push(node(lv[0].kids, srcOf(l)));
          lv.forEach(function (o) {
            if (d) { o.count++; o.revenue += (+d.car_price || 0); o.D.push({ d: d, l: l }); }
            else { o.leads++; o.L.push(l); }
          });
        }
        leads.forEach(function (l) { put(l, null); });
        deals.forEach(function (d) { var l = leadById[d.lead_id]; if (l) put(l, d); });

        var sortFn = byDeals
          ? function (a, b) { return (b[1].revenue - a[1].revenue) || (b[1].count - a[1].count) || (b[1].leads - a[1].leads); }
          : function (a, b) { return (b[1].leads - a[1].leads) || (b[1].revenue - a[1].revenue); };
        var out = '', n = 0;
        function row(label, o, depth, pid, id, hasKids) {
          var cr = o.leads ? P1(o.count / o.leads * 100) : '<span class="muted">—</span>';
          var key = repKeys.push({ label: label, o: o }) - 1;
          var nL = o.leads ? '<a class="drill-n" data-rk="' + key + '" data-what="leads">' + o.leads + '</a>' : '<span class="muted">0</span>';
          var nD = o.count ? '<a class="drill-n" data-rk="' + key + '" data-what="deals">' + o.count + '</a>' : '<span class="muted">0</span>';
          var cells = byDeals
            ? ['<td>' + nD + '</td>', '<td>' + M(o.revenue) + '</td>', '<td>' + nL + '</td>', '<td>' + cr + '</td>']
            : ['<td>' + nL + '</td>', '<td>' + nD + '</td>', '<td>' + M(o.revenue) + '</td>', '<td>' + cr + '</td>'];
          return '<tr data-id="' + esc(id) + '" data-parent="' + esc(pid) + '"' + (depth ? ' class="hidden"' : '') + '>' +
            '<td style="padding-inline-start:' + (10 + depth * 22) + 'px' + (hasKids ? ';cursor:pointer' : '') + '"' +
              (hasKids ? ' data-drill="1"' : '') + '>' + (hasKids ? '<span class="drill-x">▸</span> ' : '') +
              (depth ? esc(label) : '<b>' + esc(label) + '</b>') + '</td>' + cells.join('') + '</tr>';
        }
        Object.keys(tree).map(function (k) { return [k, tree[k]]; }).sort(sortFn).forEach(function (a) {
          var aid = 's' + (n++);
          var kids = Object.keys(a[1].kids).map(function (k) { return [k, a[1].kids[k]]; }).sort(sortFn);
          out += row(a[0], a[1], 0, '', aid, kids.length > 0);
          kids.forEach(function (k) { out += row(k[0], k[1], 1, aid, aid + '-' + (n++), false); });
        });
        if (!out) return '<span class="muted">אין לידים בטווח שנבחר.</span>';
        var head = byDeals
          ? ['נציג / מקור', 'עסקאות חתומות', 'הכנסות', 'לידים', 'אחוז המרה']
          : ['נציג / מקור', 'לידים', 'עסקאות חתומות', 'הכנסות', 'אחוז המרה'];
        return '<div class="table-scroll"><table class="drill-tree">' +
          '<thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' +
          '<tbody>' + out + '</tbody></table></div>';
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
          secCard('👤 מקורות לפי נציג <span class="muted" style="font-size:12px;font-weight:400">· לחצו על נציג לפתיחת המקורות שלו</span>', staffSourceTree(byDeals)) +
          vsPanel() +
          secCard('\ud83d\udce3 קמפיינים <span class="muted" style="font-size:12px;font-weight:400">\u00b7 פרסום ממומן בלבד \u00b7 לחצו על שורה לפתיחת הרמה שמתחתיה</span>', attrTree(byDeals)) +
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
        var a = e.target.closest('a.drill-n[data-rk]');
        if (a) {
        var it = (window.C2B_repKeys || [])[+a.dataset.rk]; if (!it) return;
        var what = a.dataset.what;
        return repDetail((what === 'deals' ? 'עסקאות \u00b7 ' : 'לידים \u00b7 ') + it.label, what,
                  what === 'deals' ? it.o.D : it.o.L);
        }
        //  פתיחת רמה בטבלת הקמפיינים: קמפיין ← סדרת מודעות ← מודעה.
        //  כל השורות כבר קיימות ב-DOM ורק מוסתרות ב-class, ולכן הפתיחה
        //  מיידית ואינה מצריכה ציור מחדש של הטבלה.
        var cell = e.target.closest('td[data-drill]'); if (!cell) return;
        var tr = cell.closest('tr'), id = tr.dataset.id, tb = tr.parentNode;
        var open = tr.classList.toggle('drill-open');
        var mark = tr.querySelector('.drill-x'); if (mark) mark.textContent = open ? '▾' : '▸';
        [].forEach.call(tb.querySelectorAll('tr[data-parent="' + id + '"]'), function (k) {
          k.classList.toggle('hidden', !open);
          //  בסגירה מקפלים גם את הנכדים, אחרת פתיחה חוזרת הייתה חושפת
          //  רמה שלישית שהמשתמש כבר סגר.
          if (!open) {
            k.classList.remove('drill-open');
            var m2 = k.querySelector('.drill-x'); if (m2) m2.textContent = '▸';
            [].forEach.call(tb.querySelectorAll('tr[data-parent="' + k.dataset.id + '"]'), function (g) { g.classList.add('hidden'); });
          }
        });
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

      repCtx.spend = sp;   //  בשביל בלוק "אורגני מול ממומן"

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
  // ---------- דיוור והחזרה (nurture) ----------
  function renderNurture() {
    loading();
    var orgId = window.C2B.orgId;
    Promise.all([
      db.from('leads').select('id,email,no_marketing,phone').eq('status', 'lost').is('deleted_at', null),
      db.from('nurture_state').select('lead_id,last_sent_at,unsubscribed,reengaged_at'),
      db.from('leads').select('id,name,phone,email,status,updated_at').eq('no_marketing', true).is('deleted_at', null).order('updated_at', { ascending: false })
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var lost = res[0].data || [], states = res[1].data || [];
      var stBy = {}; states.forEach(function (s) { stBy[s.lead_id] = s; });
      var withEmail = lost.filter(function (l) { return l.email && String(l.email).indexOf('@') > 0; });
      var sent = 0, pending = 0, reeng = 0;
      withEmail.forEach(function (l) {
        if (l.no_marketing) return;                 // חסום לדיוור — לא נספר כממתין
        var s = stBy[l.id];
        if (s && s.last_sent_at) sent++; else pending++;
      });
      states.forEach(function (s) { if (s.reengaged_at) reeng++; });
      //  רשימת החסומים (DNC) — dedupe לפי אדם (מייל/טלפון)
      var dncRows = res[2].data || [], seenDnc = {}, dncList = [];
      dncRows.forEach(function (l) {
        var key = (String(l.email || '').trim().toLowerCase()) || (String(l.phone || '').replace(/\D/g, '').slice(-9));
        if (!key || seenDnc[key]) return; seenDnc[key] = 1; dncList.push(l);
      });
      var brandName = (window.C2B.brand && window.C2B.brand.name) || 'הארגון';
      var batch = Math.min(pending, 25);

      view('<div class="head"><h1>📧 דיוור והחזרה</h1><div class="muted">החזרת לידים שסומנו "לא רלוונטי" באמצעות מייל ממותג עם כפתור "אשמח שנציג יחזור אליי". לחיצה מחזירה את הליד אוטומטית לחלוקה, עם ייחוס מלא (מקור: ליד חוזר · דיוור).</div></div>'
        + '<div class="kpis">'
        + stat('לידים לא-רלוונטי', String(lost.length), null, null, 'סה״כ במערכת')
        + stat('עם כתובת מייל', String(withEmail.length), null, null, 'ניתנים לדיוור')
        + stat('ממתינים לשליחה', String(pending), null, null, 'עוד לא קיבלו מייל')
        + stat('נשלחו', String(sent), null, null, 'מייל החזרה יצא')
        + stat('חזרו למעגל', String(reeng), reeng ? true : null, null, 'לחצו "שיחזרו אליי"')
        + stat('🚫 חסומים לדיוור', String(dncList.length), null, null, 'הוסרו — לא יקבלו כלום')
        + '</div>'
        + '<div class="card" style="margin-top:14px"><div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">'
        + '<div><b>סבב שליחה</b><div class="muted" style="font-size:13px;margin-top:3px;max-width:520px">כל סבב שולח עד 25 מיילים מ-<b>' + esc(brandName) + '</b> ללידים שעוד לא קיבלו. כל ליד מקבל את מייל ההחזרה פעם אחת. <b>המערכת חוסמת אוטומטית כל מי שברשימת ההסרה</b> — לא יישלח אליו דבר. אפשר להריץ כמה סבבים עד שהתור מתרוקן.</div></div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" id="nuPreview">👁 תצוגה מקדימה</button>'
        + '<button class="btn btn-primary" id="nuSend"' + (batch ? '' : ' disabled') + '>📤 שלח סבב (' + batch + ')</button></div>'
        + '</div><div id="nuResult" style="margin-top:12px"></div></div>'
        //  ---------- ניהול רשימת ההסרה מדיוור (DNC) ----------
        + '<div class="card" style="margin-top:14px"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>🚫 רשימת הסרה מדיוור (' + dncList.length + ')</b>'
        + '<span class="muted" style="font-size:12.5px">כל האנשים שביקשו הסרה או שסומנו ידנית. אף שליחה שיווקית (מייל/וואטסאפ/סמס) לא תגיע אליהם — בכל הערוצים.</span></div>'
        + '<div style="margin-top:10px;overflow-x:auto">' + (dncList.length
          ? '<table><thead><tr><th>שם</th><th>טלפון</th><th>מייל</th><th>מתי</th><th></th></tr></thead><tbody>'
            + dncList.map(function (l) {
              return '<tr><td><b>' + esc(l.name || '—') + '</b></td>'
                + '<td class="ltr"><bdi>' + esc(l.phone || '—') + '</bdi></td>'
                + '<td class="ltr" style="font-size:12.5px">' + esc(l.email || '—') + '</td>'
                + '<td class="muted" style="font-size:12px">' + fmtDateTime(l.updated_at) + '</td>'
                + '<td><button class="btn btn-ghost btn-sm" data-resub="' + esc(l.id) + '" data-ph="' + esc(l.phone || '') + '" data-em="' + esc(l.email || '') + '">↩ החזר לדיוור</button></td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="muted" style="margin:6px 0">אין אף אחד ברשימת ההסרה כרגע.</p>')
        + '</div></div>');

      $('nuPreview').addEventListener('click', function () {
        openDrawer('<h3 style="margin:0 0 10px">👁 תצוגה מקדימה</h3><div class="muted" style="font-size:13px">טוען…</div>');
        db.functions.invoke('nurture-run', { body: { org: orgId, preview: true } }).then(function (r) {
          var d = r && r.data;
          if (!d || !d.html) { openDrawer('<p class="err">שגיאה בתצוגה מקדימה</p>'); return; }
          openDrawer('<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0">👁 תצוגה מקדימה</h3><button class="btn btn-ghost btn-sm" onclick="window.C2B.closeDrawer()">✕ סגור</button></div>'
            + '<div class="muted" style="font-size:12.5px;margin-bottom:10px">מאת: ' + esc(d.from || '') + ' · נושא: ' + esc(d.subject || '') + '</div>'
            + '<div id="nuFrameWrap" style="border:1px solid var(--line);border-radius:12px;overflow:hidden;height:72vh"></div>');
          var fr = document.createElement('iframe'); fr.style.cssText = 'width:100%;height:100%;border:0;background:#fff'; fr.srcdoc = d.html;
          $('nuFrameWrap').appendChild(fr);
        }, function () { openDrawer('<p class="err">שגיאה בתצוגה מקדימה</p>'); });
      });

      var sendBtn = $('nuSend');
      if (sendBtn) sendBtn.addEventListener('click', function () {
        var btn = this;
        if (!confirm('לשלוח מייל החזרה עד 25 לידים לא-רלוונטי? הפעולה שולחת מיילים אמיתיים ללקוחות.')) return;
        btn.disabled = true; btn.textContent = 'שולח…';
        $('nuResult').innerHTML = '<div class="muted">שולח…</div>';
        db.functions.invoke('nurture-run', { body: { org: orgId, limit: 25 } }).then(function (r) {
          var d = r && r.data;
          if (!d || d.error) { $('nuResult').innerHTML = '<p class="err">שגיאה: ' + esc((d && d.error) || 'לא ידועה') + '</p>'; btn.disabled = false; btn.textContent = '📤 שלח סבב'; return; }
          $('nuResult').innerHTML = '<div style="background:var(--brand-soft);border-radius:10px;padding:11px 13px;font-weight:600">✅ נשלחו ' + d.sent + ' מיילים' + (d.failed ? (' · נכשלו ' + d.failed) : '') + ' · נותרו ' + d.remaining + ' ממתינים.</div>';
          setTimeout(renderNurture, 1400);
        }, function () { $('nuResult').innerHTML = '<p class="err">שגיאה בשליחה</p>'; btn.disabled = false; btn.textContent = '📤 שלח סבב'; });
      });

      //  החזרה לדיוור — מסיר את האדם (טלפון/מייל) מרשימת ההסרה
      $('view').querySelectorAll('[data-resub]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('להחזיר את ' + (b.closest('tr').querySelector('b').textContent) + ' לרשימת הדיוור? מעכשיו יוכל לקבל דיוור שיווקי שוב.')) return;
          b.disabled = true; b.textContent = 'מחזיר…';
          db.rpc('dnc_set', { p_org: orgId, p_phone: b.dataset.ph || '', p_email: b.dataset.em || '', p_on: false }).then(function (r) {
            if (r.error) { alert('שגיאה: ' + r.error.message); b.disabled = false; b.textContent = '↩ החזר לדיוור'; return; }
            renderNurture();
          });
        });
      });
    }, function () { errBox('שגיאה בטעינת נתוני הדיוור'); });
  }

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

      waThreads = threads;
      var shown = waPick();
      view(heyyHead(nums, numById, isAdm, shown.length) +
        '<div class="wa-wrap">' +
          '<div class="card wa-side">' +
            '<div class="wa-search"><input class="inp" id="waQ" placeholder="\ud83d\udd0d חיפוש שיחה\u2026" value="' + esc(heyyQ) + '"></div>' +
            '<div class="wa-filter"><select class="inp" id="waStFil">' +
              '<option value="">כל הסטטוסים</option>' +
              '<option value="__none"' + (heyySt === '__none' ? ' selected' : '') + '>ללא ליד</option>' +
              (window.C2B_STATUSES || []).map(function (s) {
                return '<option value="' + esc(s.k) + '"' + (heyySt === s.k ? ' selected' : '') + '>' + esc(s.icon + ' ' + s.label) + '</option>';
              }).join('') + '</select></div>' +
            '<div class="wa-list" id="waList">' + heyyList(shown) + '</div>' +
          '</div>' +
          '<div class="card wa-pane" id="waPane">' + heyyEmpty() + '</div>' +
        '</div>');

      if ($('heyyNum')) $('heyyNum').addEventListener('change', function () { heyyNum = this.value; heyyThread = ''; renderHeyy(); });
      if ($('waStFil')) $('waStFil').addEventListener('change', function () { heyySt = this.value; waListPaint(); });
      if ($('waNewChat')) $('waNewChat').addEventListener('click', function () { newChatBox(nums, isAdm); });
      var q = $('waQ');
      if (q) {
        //  שמירת מיקום הסמן: renderHeyy נקרא מחדש בכל הקלדה, ובלי זה
        //  הסמן קופץ לתחילת השדה אחרי כל אות.
        q.addEventListener('input', function () { heyyQ = this.value; waListPaint(); });
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
  //  סינון לפי סטטוס ליד, חיפוש בתוך השיחה, והודעה שעונים לה
  var heyySt = '', waReply = null, waChan = null;

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
    //  \u05de\u05d4 \u05e9\u05e2\u05d5\u05e0\u05d9\u05dd \u05dc\u05d5, \u05e2\u05dd \u05d0\u05e4\u05e9\u05e8\u05d5\u05ea \u05dc\u05d1\u05d8\u05dc
    var rep = waReply ? '<div class="wa-reply"><b>\u21a9 \u05de\u05e9\u05d9\u05d1 \u05dc:</b><span>' +
      esc(String(waReply.body).slice(0, 90)) + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="waRepX">\u2715</button></div>' : '';
    return '<div class="wa-tools">' + banner + rep +
      '<div class="wa-chips">' + (chips || '<span class="muted" style="font-size:12px">אין הודעות מהירות</span>') + '</div>' +
      '<div class="wa-compose">' +
        '<div class="wa-line">' +
        '<textarea class="inp" id="waBody" rows="2" placeholder="כתבו הודעה, או בחרו הודעה מהירה למעלה\u2026">' + esc(waDraft) + '</textarea>' +
          '<div class="wa-go">' +
          '<button class="btn btn-sm" id="waSend"' + (open24 ? '' : ' disabled title="\u05d7\u05dc\u05d5\u05df 24 \u05d4\u05e9\u05e2\u05d5\u05ea \u05e1\u05d2\u05d5\u05e8"') + '>\u05e9\u05dc\u05d7 \u27a4</button>' +
          '<div class="wa-go2">' +
          '<button class="btn' + (open24 ? ' btn-ghost btn-sm' : '') + '" id="waTplBtn" title="\u05e9\u05dc\u05d9\u05d7\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05ea">\ud83d\udce8 \u05ea\u05d1\u05e0\u05d9\u05ea</button>' +
          '<button class="btn btn-ghost btn-sm" id="waSched" title="תזמון לשעה מאוחרת יותר">\u23f0 תזמון</button>' +
          '</div>' +
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
    if ($('waRepX')) $('waRepX').onclick = function () { waReply = null; openThread(t); };
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
        reply_to: (waReply && waReply.id) || null,
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
      waPickedCar = null; waReply = null;
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
        t.lead_id = r.data.id; waLeads[r.data.id] = r.data;
        //  קבצים שהלקוח שלח לפני שהיה ליד — נכנסים לתיק עכשיו
        db.functions.invoke('heyy-send', { body: { action: 'import_docs', thread_id: t.id } })
          .then(function () {}, function () {});
        cb(r.data.id, null);
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

  //  ---------- \u05e8\u05e2\u05e0\u05d5\u05df \u05d7\u05d9 ----------
  //  \u05dc\u05dc\u05d0 \u05d6\u05d4 \u05d4\u05e0\u05e6\u05d9\u05d2 \u05d4\u05d9\u05d4 \u05e6\u05e8\u05d9\u05da \u05dc\u05e8\u05e2\u05e0\u05df \u05d9\u05d3\u05e0\u05d9\u05ea \u05db\u05d3\u05d9 \u05dc\u05e8\u05d0\u05d5\u05ea \u05ea\u05e9\u05d5\u05d1\u05d4.
  //  \u05e0\u05e8\u05e9\u05de\u05d9\u05dd \u05e4\u05e2\u05dd \u05d0\u05d7\u05ea \u05d1\u05dc\u05d1\u05d3 \u05d5\u05de\u05d1\u05d8\u05dc\u05d9\u05dd \u05d1\u05d9\u05e6\u05d9\u05d0\u05d4 \u05de\u05d4\u05de\u05e1\u05da:
  //  \u05de\u05e0\u05d5\u05d9 \u05db\u05e4\u05d5\u05dc \u05d4\u05d9\u05d4 \u05de\u05e8\u05e0\u05d3\u05e8 \u05d0\u05ea \u05d4\u05e9\u05d9\u05d7\u05d4 \u05e4\u05e2\u05de\u05d9\u05d9\u05dd \u05e2\u05dc \u05db\u05dc \u05d4\u05d5\u05d3\u05e2\u05d4.
  //  \u05d4\u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05de\u05e2\u05d5\u05db\u05d1 \u05d1-250ms \u05db\u05d3\u05d9 \u05e9\u05e8\u05e6\u05e3 \u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd (\u05d4\u05d5\u05d3\u05e2\u05d4 + \u05e2\u05d3\u05db\u05d5\u05df
  //  \u05d4\u05e9\u05d9\u05d7\u05d4 + \u05e1\u05d8\u05d8\u05d5\u05e1) \u05d9\u05d2\u05e8\u05d5\u05e8 \u05e8\u05e0\u05d3\u05d5\u05e8 \u05d0\u05d7\u05d3 \u05d5\u05dc\u05d0 \u05e9\u05dc\u05d5\u05e9\u05d4.
  var waRtTimer = null;
  //  \u05e2\u05d3\u05db\u05d5\u05df \u05e0\u05e7\u05d5\u05d3\u05ea\u05d9 \u05d1\u05de\u05e7\u05d5\u05dd \u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05de\u05dc\u05d0. renderHeyy \u05d1\u05d5\u05e0\u05d4 \u05de\u05d7\u05d3\u05e9 \u05d0\u05ea \u05db\u05dc
  //  \u05d4\u05de\u05e1\u05da \u2014 \u05d4\u05e8\u05e9\u05d9\u05de\u05d4, \u05d4\u05e9\u05d9\u05d7\u05d4, \u05e1\u05e8\u05d2\u05dc \u05d4\u05db\u05ea\u05d9\u05d1\u05d4 \u05d5\u05d4\u05d8\u05d9\u05d5\u05d8\u05d4 \u2014 \u05d5\u05dc\u05db\u05df \u05db\u05dc \u05d4\u05d5\u05d3\u05e2\u05d4
  //  \u05e0\u05db\u05e0\u05e1\u05ea \u05d4\u05e8\u05d2\u05d9\u05e9\u05d4 \u05db\u05e7\u05e4\u05d9\u05e6\u05d4. \u05db\u05d0\u05df \u05e8\u05e7 \u05de\u05d4 \u05e9\u05d1\u05d0\u05de\u05ea \u05d4\u05e9\u05ea\u05e0\u05d4 \u05de\u05ea\u05e2\u05d3\u05db\u05df.
  function waBusy() {
    if (document.querySelector('.adm-bg')) return true;
    var f = document.activeElement;
    if (f && /INPUT|TEXTAREA|SELECT/.test(f.tagName) && f.id !== 'waBody') return true;
    if (document.querySelector('.cp-dragging, .cp-reordering')) return true;
    return false;
  }
  function waOnScreen() {
    var act = $('nav').querySelector('.nav-item.active');
    return !!(act && act.dataset.nav === 'heyy' && $('waList'));
  }
  function waRefresh(soft, threadId) {
    clearTimeout(waRtTimer);
    waRtTimer = setTimeout(function () {
      if (!waOnScreen() || waBusy()) return;
      //  \u05d4\u05e8\u05e9\u05d9\u05de\u05d4: \u05e9\u05d5\u05dc\u05e4\u05d9\u05dd \u05e8\u05e7 \u05d0\u05ea \u05e9\u05d5\u05e8\u05d5\u05ea \u05d4\u05e9\u05d9\u05d7\u05d5\u05ea \u05d5\u05de\u05e6\u05d9\u05d9\u05e8\u05d9\u05dd \u05d0\u05d5\u05ea\u05d4 \u05dc\u05d1\u05d3
      db.from('wa_threads').select('id,number_id,contact_phone,contact_name,lead_id,last_at,last_text,last_dir,unread,provider_chat_id')
        .order('last_at', { ascending: false }).limit(300).then(function (r) {
          if (!r.data || !waOnScreen() || waBusy()) return;
          waThreads = r.data;
          waListPaint();
          var on = $('waList') && $('waList').querySelector('.wa-th.on');
          if (on) on.classList.add('on');
        });
      //  \u05d4\u05e9\u05d9\u05d7\u05d4 \u05d4\u05e4\u05ea\u05d5\u05d7\u05d4: \u05de\u05d5\u05e1\u05d9\u05e4\u05d9\u05dd \u05e8\u05e7 \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea \u05e9\u05d8\u05e8\u05dd \u05de\u05d5\u05e6\u05d2\u05d5\u05ea, \u05d1\u05dc\u05d9
      //  \u05dc\u05d2\u05e2\u05ea \u05d1\u05ea\u05d9\u05d1\u05ea \u05d4\u05db\u05ea\u05d9\u05d1\u05d4 \u05d5\u05d1\u05dc\u05d9 \u05dc\u05d0\u05e4\u05e1 \u05d0\u05ea \u05d4\u05d2\u05dc\u05d9\u05dc\u05d4.
      if (heyyThread && (!threadId || threadId === heyyThread)) waAppendNew();
    }, soft ? 900 : 0);
  }
  function waAppendNew() {
    var box = $('waMsgs'); if (!box) return;
    var have = {};
    box.querySelectorAll('[data-mid]').forEach(function (x) { have[x.dataset.mid] = 1; });
    db.from('wa_messages').select('id,direction,body,media_url,media_type,author,sent_at,status,reply_to,provider_msg_id')
      .eq('thread_id', heyyThread).order('sent_at', { ascending: false }).limit(20)
      .then(function (r) {
        var rows = (r.data || []).slice().reverse().filter(function (m) { return !have[m.id]; });
        if (!rows.length) {
          //  \u05d0\u05d9\u05df \u05d7\u05d3\u05e9\u05d5\u05ea \u2014 \u05d0\u05d5\u05dc\u05d9 \u05e8\u05e7 \u05d4\u05e1\u05d8\u05d8\u05d5\u05e1 \u05d4\u05e9\u05ea\u05e0\u05d4 (\u05e0\u05de\u05e1\u05e8/\u05e0\u05e7\u05e8\u05d0)
          (r.data || []).forEach(function (m) {
            var el = box.querySelector('[data-mid="' + m.id + '"] .tick'); if (!el) return;
            var st = String(m.status || '').toLowerCase();
            el.className = 'tick' + (st === 'read' ? ' read' : '');
            el.textContent = st === 'read' || st === 'delivered' ? '\u2713\u2713' : (st === 'failed' ? '\u26a0' : '\u2713');
          });
          return;
        }
        var atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
        rows.forEach(function (m) {
          var d = new Date(m.sent_at);
          var st = String(m.status || '').toLowerCase();
          var tick = st === 'read' ? '<span class="tick read">\u2713\u2713</span>'
            : (st === 'delivered' ? '<span class="tick">\u2713\u2713</span>'
            : (st === 'failed' ? '<span class="tick" style="color:var(--danger)">\u26a0</span>' : '<span class="tick">\u2713</span>'));
          var media = m.media_url
            ? (/image/i.test(m.media_type || '') ? '<img src="' + esc(m.media_url) + '" alt="">'
               : '<a href="' + esc(m.media_url) + '" target="_blank" rel="noopener">\ud83d\udcce \u05e7\u05d5\u05d1\u05e5 \u05de\u05e6\u05d5\u05e8\u05e3</a>')
            : '';
          var div = document.createElement('div');
          div.className = 'wa-m ' + m.direction;
          div.dataset.mid = m.id;
          div.dataset.txt = String(m.body || '').toLowerCase();
          div.innerHTML = media + (m.body ? esc(m.body) : (media ? '' : '\u2014')) +
            '<span class="t">' + esc(d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })) +
            (m.direction === 'out' ? ' ' + tick : '') +
            (m.author ? ' \u00b7 ' + esc(m.author) : '') + '</span>' +
            '<button class="rbtn" data-reply="' + esc(m.id) + '" title="\u05d4\u05e9\u05d1 \u05dc\u05d4\u05d5\u05d3\u05e2\u05d4 \u05d4\u05d6\u05d5">\u21a9</button>';
          box.appendChild(div);
        });
        //  \u05d2\u05d5\u05dc\u05dc\u05d9\u05dd \u05dc\u05de\u05d8\u05d4 \u05e8\u05e7 \u05d0\u05dd \u05d4\u05e0\u05e6\u05d9\u05d2 \u05db\u05d1\u05e8 \u05d4\u05d9\u05d4 \u05dc\u05de\u05d8\u05d4
        if (atEnd) box.scrollTop = box.scrollHeight;
      });
  }
  function waWatch() {
    if (waChan) return;
    try {
      waChan = db.channel('wa-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_messages' }, function (p2) { waRefresh(true, (p2 && p2.new && p2.new.thread_id) || null); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_threads' }, function () { waRefresh(true, '-'); })
        .subscribe();
    } catch (e) { waChan = null; }   //  \u05d1\u05dc\u05d9 realtime \u05d4\u05de\u05e1\u05da \u05e2\u05d5\u05d3\u05e0\u05d5 \u05e2\u05d5\u05d1\u05d3, \u05e8\u05e7 \u05d1\u05dc\u05d9 \u05e8\u05e2\u05e0\u05d5\u05df \u05e2\u05e6\u05de\u05d9
  }
  function waUnwatch() {
    if (!waChan) return;
    try { db.removeChannel(waChan); } catch (e) { /* \u05e0\u05d5\u05ea\u05e7 \u05d1\u05dc\u05d0\u05d5 \u05d4\u05db\u05d9 */ }
    waChan = null; clearTimeout(waRtTimer);
  }

  //  \u05de\u05e1\u05de\u05e0\u05ea \u05d0\u05ea \u05d4\u05d4\u05d5\u05d3\u05e2\u05d5\u05ea \u05d4\u05ea\u05d5\u05d0\u05de\u05d5\u05ea \u05d5\u05d2\u05d5\u05dc\u05dc\u05ea \u05dc\u05e8\u05d0\u05e9\u05d5\u05e0\u05d4, \u05d1\u05dc\u05d9 \u05dc\u05d2\u05e2\u05ea
  //  \u05d1-DOM \u05de\u05e2\u05d1\u05e8 \u05dc\u05de\u05d7\u05dc\u05e7\u05d4 \u05d0\u05d7\u05ea. \u05d1\u05dc\u05d9 \u05e9\u05dc\u05d9\u05e4\u05d4, \u05d1\u05dc\u05d9 \u05e8\u05d9\u05e0\u05d3\u05d5\u05e8, \u05d1\u05dc\u05d9 \u05e7\u05e4\u05d9\u05e6\u05d4.

  //  ---------- \u05e6\u05d9\u05d5\u05e8 \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05d1\u05dc\u05d1\u05d3 ----------
  //  \u05e7\u05d5\u05d3\u05dd \u05db\u05dc \u05d4\u05e7\u05dc\u05d3\u05d4 \u05d1\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d5\u05db\u05dc \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e1\u05d8\u05d8\u05d5\u05e1 \u05e7\u05e8\u05d0\u05d5 \u05dc-renderHeyy,
  //  \u05e9\u05e9\u05d5\u05dc\u05e3 \u05de\u05d7\u05d3\u05e9 \u05de\u05d4\u05de\u05e1\u05d3 \u05d5\u05de\u05e8\u05e0\u05d3\u05e8 \u05d0\u05ea \u05db\u05dc \u05d4\u05de\u05e1\u05da \u2014 \u05de\u05db\u05d0\u05df \u05d4\u05e7\u05e4\u05d9\u05e6\u05d5\u05ea,
  //  \u05d0\u05d9\u05d1\u05d5\u05d3 \u05d4\u05e4\u05d5\u05e7\u05d5\u05e1 \u05d5\u05e1\u05d2\u05d9\u05e8\u05ea \u05d4\u05ea\u05e4\u05e8\u05d9\u05d8 \u05d4\u05e0\u05e4\u05ea\u05d7. \u05d4\u05e9\u05d9\u05d7\u05d5\u05ea \u05db\u05d1\u05e8 \u05d1\u05d6\u05d9\u05db\u05e8\u05d5\u05df.
  var waThreads = [];
  function waPick() {
    return waThreads.filter(function (t) {
      if (heyyNum && t.number_id !== heyyNum) return false;
      if (heyySt) {
        var lz = t.lead_id && waLeads[t.lead_id];
        if (heyySt === '__none') { if (t.lead_id) return false; }
        else if (!lz || (lz.status || 'new') !== heyySt) return false;
      }
      if (!heyyQ) return true;
      var q = String(heyyQ).toLowerCase();
      return ((t.contact_name || '') + ' ' + t.contact_phone + ' ' + (t.last_text || '')).toLowerCase().indexOf(q) >= 0;
    });
  }
  function waListPaint() {
    var box = $('waList'); if (!box) return;
    var shown = waPick();
    box.innerHTML = heyyList(shown);
    //  \u05de\u05d5\u05e0\u05d4 \u05d4\u05e9\u05d9\u05d7\u05d5\u05ea \u05d1\u05db\u05d5\u05ea\u05e8\u05ea \u05de\u05ea\u05e2\u05d3\u05db\u05df \u05d1\u05de\u05e7\u05d5\u05dd, \u05d1\u05dc\u05d9 \u05dc\u05d1\u05e0\u05d5\u05ea \u05d0\u05ea \u05d4\u05db\u05d5\u05ea\u05e8\u05ea \u05de\u05d7\u05d3\u05e9
    var sub = document.querySelector('#view p.muted');
    if (sub) sub.innerHTML = String(sub.innerHTML).replace(/\u00b7\s*\d+\s*\u05e9\u05d9\u05d7\u05d5\u05ea/, '\u00b7 ' + shown.length + ' \u05e9\u05d9\u05d7\u05d5\u05ea');
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
    db.from('wa_messages').select('id,direction,body,media_url,media_type,author,sent_at,status,reply_to,provider_msg_id')
      .eq('thread_id', t.id).order('sent_at').limit(500).then(function (r) {
      if (r.error) return ($('waPane').innerHTML = '<p class="err">' + esc(r.error.message) + '</p>');
      //  מפתח לציטוט: reply_to מחזיק את provider_msg_id של המקור
      var byId = {}; (r.data || []).forEach(function (m) { if (m.provider_msg_id) byId[m.provider_msg_id] = m; });
      var last = '', html = (r.data || []).map(function (m) {
        //  מפריד תאריך בין ימים, כמו בווטסאפ
        var d = new Date(m.sent_at), key = d.toDateString(), sep = '';
        if (key !== last) { last = key; sep = '<div class="wa-day">' + esc(waDay(d)) + '</div>'; }
        var media = m.media_url
          ? (/image/i.test(m.media_type || '') ? '<img src="' + esc(m.media_url) + '" alt="">'
             : '<a href="' + esc(m.media_url) + '" target="_blank" rel="noopener">\ud83d\udcce קובץ מצורף</a>')
          : '';
        //  \u05e1\u05d9\u05de\u05d5\u05e0\u05d9 \u05de\u05e1\u05d9\u05e8\u05d4 \u05db\u05de\u05d5 \u05d1\u05d5\u05d5\u05d8\u05e1\u05d0\u05e4: \u05d0\u05d7\u05d3 \u05e0\u05e9\u05dc\u05d7, \u05e9\u05e0\u05d9\u05d9\u05dd \u05e0\u05de\u05e1\u05e8,
        //  \u05d5\u05db\u05d7\u05d5\u05dc \u05e0\u05e7\u05e8\u05d0. \u05de\u05d2\u05d9\u05e2 \u05de\u05d0\u05d9\u05e8\u05d5\u05e2 message.updated \u05e9\u05dc Heyy.
        var st = String(m.status || '').toLowerCase();
        var tick = st === 'read' ? '<span class="tick read">\u2713\u2713</span>'
          : (st === 'delivered' ? '<span class="tick">\u2713\u2713</span>'
          : (st === 'failed' ? '<span class="tick" style="color:var(--danger)">\u26a0</span>' : '<span class="tick">\u2713</span>'));
        var rp = m.reply_to ? byId[m.reply_to] : null;
        return sep + '<div class="wa-m ' + esc(m.direction) + '" data-mid="' + esc(m.id) + '"' +
          ' data-txt="' + esc(String(m.body || '').toLowerCase()) + '">' +
          (rp ? '<span class="rep">' + esc(String(rp.body || '[\u05e7\u05d5\u05d1\u05e5]').slice(0, 90)) + '</span>' : '') +
          media + (m.body ? esc(m.body) : (media ? '' : '\u2014')) +
          '<span class="t">' + esc(d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })) +
          (m.direction === 'out' ? ' ' + tick : '') +
          (m.author ? ' \u00b7 ' + esc(m.author) : '') + '</span>' +
          '<button class="rbtn" data-reply="' + esc(m.id) + '" title="\u05d4\u05e9\u05d1 \u05dc\u05d4\u05d5\u05d3\u05e2\u05d4 \u05d4\u05d6\u05d5">\u21a9</button></div>';
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
      var el = $('waMsgs');
      //  \u05d1\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d2\u05d5\u05dc\u05dc\u05d9\u05dd \u05dc\u05ea\u05d5\u05e6\u05d0\u05d4 \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d4, \u05d0\u05d7\u05e8\u05ea \u05dc\u05e1\u05d5\u05e3
      if (el) el.scrollTop = el.scrollHeight;
      if (el) el.addEventListener('click', function (e) {
        var rb = e.target.closest('[data-reply]'); if (!rb) return;
        var m2 = (r.data || []).filter(function (x) { return x.id === rb.dataset.reply; })[0];
        if (!m2) return;
        waReply = { id: m2.provider_msg_id || null, body: m2.body || '[\u05e7\u05d5\u05d1\u05e5]', dir: m2.direction };
        openThread(t);
      });
      //  \u05e4\u05ea\u05d9\u05d7\u05ea \u05e9\u05d9\u05d7\u05d4 = \u05e0\u05e7\u05e8\u05d0\u05d4. \u05d4\u05e2\u05de\u05d5\u05d3\u05d4 \u05d4\u05ea\u05de\u05dc\u05d0\u05d4 \u05d5\u05de\u05e2\u05d5\u05dc\u05dd \u05dc\u05d0 \u05d4\u05ea\u05d0\u05e4\u05e1\u05d4
      if (t.unread) {
        db.from('wa_threads').update({ unread: 0 }).eq('id', t.id).then(function () {
          t.unread = 0;
          var row = $('waList') && $('waList').querySelector('[data-th="' + t.id + '"] .wa-unread');
          if (row) row.remove();
        });
      }
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

  //  קונסולת סופר-אדמין: רשימת הארגונים + פתיחת ארגון חדש (עם מנהל ראשון).
  //  מוגן פעמיים — כאן ובמסד (superadmin_create_org + RLS על orgs).
  function renderOrgs() {
    if (!(window.C2B && window.C2B.isSuper)) return go('dashboard');
    loading();
    Promise.all([
      db.from('orgs').select('id,name,slug,plan,active,created_at,branding').order('id', { ascending: true }),
      db.from('profiles').select('org_id')
    ]).then(function (res) {
      if (res[0] && res[0].error) return errBox(res[0].error.message);
      var orgs = (res[0] && res[0].data) || [], profs = (res[1] && res[1].data) || [];
      var orgById = {}; orgs.forEach(function (o) { orgById[o.id] = o; });
      var uCount = {}; profs.forEach(function (p) { uCount[p.org_id] = (uCount[p.org_id] || 0) + 1; });
      var rows = orgs.map(function (o) {
        return '<tr><td>' + o.id + '</td><td><b>' + esc(o.name) + '</b></td>' +
          '<td class="ltr muted">' + esc(o.slug || '—') + '</td><td>' + (uCount[o.id] || 0) + '</td>' +
          '<td class="muted">' + esc(fmtDateTime(o.created_at)) + '</td>' +
          '<td>' + (o.active === false ? '<span class="cl-no">כבוי</span>' : '<span class="cl-yes">פעיל</span>') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-orgbrand="' + o.id + '">🎨 מיתוג</button></td></tr>';
      }).join('');
      view('<div class="card"><h3 style="margin:0 0 4px">🏢 ארגונים <span class="muted" style="font-size:12px;font-weight:400">· קונסולת סופר-אדמין</span></h3>' +
        '<p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.7">כל ארגון עובד על אותה מערכת עם נתונים מופרדים לחלוטין (org_id + RLS). פתיחת ארגון יוצרת גם מנהל ראשון ושולחת לו פרטי התחברות.</p>' +
        '<div class="table-scroll"><table><thead><tr><th>#</th><th>ארגון</th><th>מזהה</th><th>משתמשים</th><th>נוצר</th><th>סטטוס</th><th>מיתוג</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7" class="empty">אין ארגונים</td></tr>') + '</tbody></table></div>' +
        '<div class="card cl-sub" style="margin-top:16px"><h3 class="cl-h">➕ פתיחת ארגון חדש</h3>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:640px">' +
            '<div class="field" style="margin:0"><label>שם הארגון</label><input class="inp" id="orgName" placeholder="למשל: אלפא ליסינג"></div>' +
            '<div class="field" style="margin:0"><label>מזהה באנגלית (slug)</label><input class="inp ltr" id="orgSlug" placeholder="alpha"></div>' +
            '<div class="field" style="margin:0"><label>שם המנהל הראשון</label><input class="inp" id="orgAdminName" placeholder="שם מלא"></div>' +
            '<div class="field" style="margin:0"><label>אימייל המנהל</label><input class="inp ltr" id="orgAdminEmail" type="email" placeholder="admin@company.com"></div>' +
          '</div>' +
          '<div style="margin-top:14px"><button class="btn" id="orgCreate">צור ארגון ושלח הזמנה למנהל</button> <span id="orgMsg" style="font-size:13px;margin-inline-start:10px"></span></div>' +
          '<div id="orgResult" style="margin-top:12px"></div>' +
        '</div></div>');
      $('orgCreate').addEventListener('click', function () {
        var name = $('orgName').value.trim(), slug = $('orgSlug').value.trim(), an = $('orgAdminName').value.trim(), ae = $('orgAdminEmail').value.trim();
        var msg = $('orgMsg');
        if (!name) { msg.style.color = 'var(--danger)'; msg.textContent = 'הזינו שם ארגון'; return; }
        if (!ae || ae.indexOf('@') < 0) { msg.style.color = 'var(--danger)'; msg.textContent = 'הזינו אימייל מנהל תקין'; return; }
        var btn = this; btn.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'יוצר ארגון…';
        db.rpc('superadmin_create_org', { p_name: name, p_slug: slug, p_admin_email: ae, p_admin_name: an || ae }).then(function (r) {
          btn.disabled = false;
          if (r.error || (r.data && r.data.error)) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + esc((r.error && r.error.message) || r.data.error); return; }
          var d = r.data || {}; msg.textContent = '';
          $('orgResult').innerHTML = '<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:0"><b>✅ הארגון נוצר (מזהה ' + esc(d.org_id) + ')</b>' +
            '<div style="margin-top:8px;font-family:monospace;font-size:13px;background:var(--surface);padding:10px;border-radius:8px">מנהל: ' + esc(d.admin_email) + '<br>סיסמה זמנית: <b>' + esc(d.password || '') + '</b></div>' +
            '<div class="muted" style="font-size:12px;margin-top:8px">' + (d.emailed ? 'נשלח מייל עם פרטי ההתחברות למנהל.' : 'שמרו את הסיסמה — שליחת המייל לא הוגדרה.') + '</div></div>';
          $('orgName').value = ''; $('orgSlug').value = ''; $('orgAdminName').value = ''; $('orgAdminEmail').value = '';
          setTimeout(renderOrgs, 2500);   // הפרופיל נוצר אסינכרונית — מרעננים אחרי רגע
        }, function (e) { btn.disabled = false; msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + esc((e && e.message) || e); });
      });
      $('view').querySelectorAll('[data-orgbrand]').forEach(function (b) { b.addEventListener('click', function () { editOrgBranding(orgById[b.dataset.orgbrand]); }); });
    }, function (e) { errBox((e && e.message) || e); });
  }
  window.C2B_renderOrgs = renderOrgs;

  //  עורך מיתוג פר-ארגון (סופר-אדמין): צבע + לוגו → orgs.branding.
  function editOrgBranding(o) {
    if (!o) return;
    var b = o.branding || {};
    openDrawer('<div class="dw-head"><h3 style="margin:0">🎨 מיתוג · ' + esc(o.name) + '</h3></div>' +
      '<div class="dw-body">' +
      '<p class="muted" style="font-size:12.5px;margin:0 0 14px">הלוגו, הצבע והשם שהארגון יראה במערכת. אפשר להדביק קישור תמונה (כולל Google Drive שיתופי) — והצבעים יזוהו ממנו אוטומטית.</p>' +
      '<div class="field"><label>קישור ללוגו</label><input class="inp ltr" id="obLogo" value="' + esc(b.logo || '') + '" placeholder="קישור לתמונה או ל-Google Drive"></div>' +
      '<div style="display:flex;gap:12px;align-items:center;margin:0 0 14px"><img id="obPrev" alt="" style="max-height:44px;max-width:130px;border-radius:6px;background:var(--surface-2);display:none" onerror="this.style.display=\'none\'">' +
        '<button class="btn btn-ghost btn-sm" id="obDetect">🎨 זהה צבעים מהלוגו</button><span id="obDetMsg" style="font-size:12px"></span></div>' +
      '<div style="display:flex;gap:18px;flex-wrap:wrap">' +
        '<div class="field"><label>צבע ראשי</label><input class="inp" type="color" id="obColor" value="' + esc(b.color || '#D9F243') + '" style="width:80px;height:40px;padding:3px"></div>' +
        '<div class="field"><label>צבע כהה (hover)</label><input class="inp" type="color" id="obColorDeep" value="' + esc(b.color_deep || '#6E8B10') + '" style="width:80px;height:40px;padding:3px"></div>' +
      '</div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;align-items:center"><button class="btn" id="obSave">💾 שמור</button><button class="btn btn-ghost" id="obCancel">סגור</button><span id="obMsg" style="font-size:12px"></span></div>' +
      '</div>');
    var prev = $('obPrev');
    function refreshPreview() { var u = logoUrl($('obLogo').value); if (u) { prev.src = u; prev.style.display = ''; } else { prev.style.display = 'none'; } }
    function detect() {
      var raw = $('obLogo').value.trim(); if (!raw) return;
      var dm = $('obDetMsg'); dm.style.color = 'var(--muted)'; dm.textContent = 'מזהה…';
      extractLogoColor(raw, function (c) {
        if (!c) { dm.style.color = 'var(--danger)'; dm.textContent = 'לא זוהו צבעים (ודא שהלוגו ציבורי/שיתופי)'; return; }
        $('obColor').value = c.color; $('obColorDeep').value = c.deep;
        dm.style.color = 'var(--ok)'; dm.textContent = '✔ צבעים זוהו מהלוגו';
      });
    }
    refreshPreview();
    $('obLogo').addEventListener('change', function () { refreshPreview(); detect(); });
    $('obDetect').addEventListener('click', detect);
    $('obCancel').addEventListener('click', closeDrawer);
    $('obSave').addEventListener('click', function () {
      var val = { color: $('obColor').value, color_deep: $('obColorDeep').value, logo: logoUrl($('obLogo').value) || null };
      var msg = $('obMsg'); msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
      db.from('orgs').update({ branding: val }).eq('id', o.id).then(function (u) {
        if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
        msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר';
        if (o.id === window.C2B.orgId) { window.C2B.brand = { name: o.name, color: val.color, colorDeep: val.color_deep, logo: val.logo }; applyBranding(); }
        setTimeout(function () { closeDrawer(); renderOrgs(); }, 700);
      });
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
        '<div class="field" style="margin:0"><label>📞 מספר נציג בוויס סנטר</label>' +
          '<input class="inp" id="ue_agent_phone" type="tel" value="' + esc(((p.agent_phone || '').split(',')[0] || '').trim()) + '" placeholder="למשל 0534494707" style="width:100%">' +
          '<span class="muted" style="font-size:11px">קובע אילו שיחות המשתמש רואה — רק שלו.</span></div>' +
        '<div class="field" style="margin:0"><label>📞 מספר נציג נוסף (אם יש)</label>' +
          '<input class="inp" id="ue_agent_phone2" type="tel" value="' + esc(((p.agent_phone || '').split(',')[1] || '').trim()) + '" placeholder="למשל 0534495197" style="width:100%">' +
          '<span class="muted" style="font-size:11px">לנציג עם שני מספרים (כמו ליאור).</span></div>' +
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
        agent_phone: [($('ue_agent_phone').value || '').trim(), ($('ue_agent_phone2') ? ($('ue_agent_phone2').value || '').trim() : '')].filter(Boolean).join(',') || null,
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

  //  ---------- היסטוריית השיחות עם העוזר ----------
  //  עד היום כל תשובה דרסה את הקודמת ויציאה מהמסך מחקה הכל. עכשיו כל
  //  הודעה נשמרת ב-ai_messages ומקובצת ל-thread, כך שאפשר לחזור לשיחה
  //  מאתמול ולהמשיך אותה. RLS מגביל כל אחד לשיחות שלו בלבד.
  var aiThread = null;
  function aiUuid() {
    try { return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function aiBubble(m) {
    return '<div class="ai-msg' + (m.role === 'user' ? ' me' : '') + '">' +
      '<div class="ai-b">' + esc(m.body || '') + '</div>' +
      '<div class="ai-t">' + esc(fmtDateTime(m.created_at)) + '</div></div>';
  }
  function aiTitle(msgs) {
    for (var i = 0; i < msgs.length; i++) if (msgs[i].role === 'user') return String(msgs[i].body || '').slice(0, 44);
    return 'שיחה';
  }
  function aiItem(id, msgs) {
    return '<button class="ai-item' + (id === aiThread ? ' active' : '') + '" data-th="' + esc(id) + '">' +
      '<span class="ai-del" data-delth="' + esc(id) + '" title="מחק שיחה">✕</span>' +
      esc(aiTitle(msgs)) +
      '<span class="d">' + esc(fmtDateTime(msgs[msgs.length - 1].created_at)) + ' · ' + msgs.length + ' הודעות</span></button>';
  }
  var AI_EMPTY = '<div class="ai-empty">עוד לא שאלת כאן כלום.<br>כל שאלה ותשובה יישמרו, ותוכל לחזור אליהן מהרשימה שבצד.</div>';

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
      db.from('profiles').select('user_id,full_name'),
      //  ההיסטוריה שלי בלבד — RLS מסנן, ולכן אין צורך בתנאי כאן
      db.from('ai_messages').select('*').order('created_at', { ascending: true }).limit(600)
    ]).then(function (res) {
      if (res[0].error) return errBox(res[0].error.message);
      var leads = res[0].data || [], deals = res[1].data || [], pays = res[2].data || [],
          tasks = res[3].data || [], appts = res[4].data || [], profs = res[5].data || [];
      var hist = (res[6] && res[6].data) || [];
      var pmap = {}; profs.forEach(function (p) { pmap[p.user_id] = p.full_name; });
      var ST = window.C2B_STATUSES || [];
      var stLabel = function (k) { for (var i = 0; i < ST.length; i++) if (ST[i].k === k) return ST[i].label; return k || '—'; };
      var now = Date.now(), days = function (t) { return t ? Math.round((now - new Date(t)) / 864e5) : null; };
      var money = function (n) { return nis(Math.round(n || 0)); };

      // ---- אבני בניין משותפות ----
      var by = {}; leads.forEach(function (l) { by[l.status || 'new'] = (by[l.status || 'new'] || 0) + 1; });
      var won = by.won || 0, lost = by.lost || 0, conv = (won + lost) ? Math.round(won / (won + lost) * 100) : 0;
      var rts = leads.map(function (l) { return window.C2B.respMins(l.created_at, l.first_response_at || new Date()); });
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
          '- טרם נענו: ' + noResp.length + ' לידים חדשים.' + (avgRt ? ' זמן תגובה ממוצע שלי: ' + window.C2B.respTxt(avgRt) + ' (כל הלידים, בלי שעות סגירה).' : '') + '\n' +
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
          '- זמן תגובה ראשון ממוצע: ' + (avgRt ? window.C2B.respTxt(avgRt) : 'לא ידוע') + ' (על כל הלידים, בלי שעות סגירת המשרד) · לידים חדשים שטרם נענו: ' + noResp.length + '.\n' +
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

      //  מקבצים את ההודעות לשיחות. הסדר נשמר לפי זמן, כך ששיחה
      //  שנגעת בה לאחרונה יושבת בראש הרשימה.
      var thr = {}, ord = [];
      hist.forEach(function (m) {
        if (!thr[m.thread_id]) { thr[m.thread_id] = []; ord.push(m.thread_id); }
        thr[m.thread_id].push(m);
      });
      ord.reverse();
      //  נפתחת השיחה האחרונה — ממשיכים מאיפה שהפסקת, בלי לחפש
      if (!aiThread || !thr[aiThread]) aiThread = ord.length ? ord[0] : aiUuid();
      var cur = thr[aiThread] || [];

      view('<div class="card"><div class="row-between"><h3 style="margin:0">' + per.title + '</h3>' +
          '<button class="btn btn-ghost btn-sm" id="aiNew">➕ שיחה חדשה</button></div>' +
        '<p class="muted" style="font-size:13px;margin:4px 0 12px">' + esc(per.lead) + '</p>' +
        '<div class="ai-wrap">' +
          '<aside class="ai-side"><h4>השיחות שלי</h4><div id="aiList">' +
            (ord.length ? ord.map(function (id) { return aiItem(id, thr[id]); }).join('')
                        : '<div class="muted" style="font-size:12px;padding:6px 4px">אין עדיין שיחות</div>') +
          '</div></aside>' +
          '<div>' +
            '<div class="ai-chat" id="aiChat">' + (cur.length ? cur.map(aiBubble).join('') : AI_EMPTY) + '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 8px">' +
              per.qs.map(function (q) { return '<button class="btn btn-ghost btn-sm" data-sug="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
            '<textarea class="inp" id="aiQ" rows="3" style="width:100%" placeholder="כתוב כאן שאלה…"></textarea>' +
            '<div style="margin-top:10px"><button class="btn" id="aiAsk">שאל את ה-AI</button>' +
            '<span class="muted" id="aiState" style="font-size:13px;margin-inline-start:10px"></span></div>' +
          '</div>' +
        '</div>' +
        '<details style="margin-top:16px"><summary class="muted" style="font-size:12px;cursor:pointer">הנתונים שנשלחים למודל</summary>' +
        '<pre style="white-space:pre-wrap;font-size:11.5px;background:var(--surface-2);padding:12px;border-radius:8px;margin-top:8px">' + esc(ctx) + '</pre></details></div>');

      var chatEl = $('aiChat'); chatEl.scrollTop = chatEl.scrollHeight;
      $('view').querySelectorAll('[data-sug]').forEach(function (b) {
        b.addEventListener('click', function () { $('aiQ').value = b.dataset.sug; $('aiAsk').click(); }); });
      $('aiAsk').addEventListener('click', function () { askAI(ctx, per.system, per.title); });
      //  Ctrl+Enter שולח — הידיים כבר על המקלדת
      $('aiQ').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('aiAsk').click(); } });
      $('aiNew').addEventListener('click', function () {
        aiThread = aiUuid();
        chatEl.innerHTML = AI_EMPTY;
        $('aiList').querySelectorAll('.ai-item').forEach(function (x) { x.classList.remove('active'); });
        $('aiQ').focus();
      });
      //  מאזין אחד על הרשימה: פתיחת שיחה ומחיקתה
      $('aiList').addEventListener('click', function (e) {
        var del = e.target.closest('[data-delth]');
        if (del) {
          e.stopPropagation();
          if (!confirm('למחוק את השיחה הזאת? הפעולה אינה הפיכה.')) return;
          var id = del.dataset.delth;
          db.from('ai_messages').delete().eq('thread_id', id).then(function (r) {
            if (r.error) { alert('שגיאה במחיקה: ' + r.error.message); return; }
            var btn = $('aiList').querySelector('[data-th="' + id + '"]');
            if (btn) btn.remove();
            if (id === aiThread) { aiThread = aiUuid(); chatEl.innerHTML = AI_EMPTY; }
          });
          return;
        }
        var it = e.target.closest('[data-th]'); if (!it) return;
        aiThread = it.dataset.th;
        $('aiList').querySelectorAll('.ai-item').forEach(function (x) { x.classList.toggle('active', x === it); });
        chatEl.innerHTML = (thr[aiThread] || []).map(aiBubble).join('') || AI_EMPTY;
        chatEl.scrollTop = chatEl.scrollHeight;
      });
    }).catch(function (e) { errBox(e.message || e); });
  }
  function askAI(ctx, sysPrompt, persona, retried) {
    var qEl = $('aiQ'), q = (qEl.value || '').trim(); if (!q) return;
    var state = $('aiState'), chat = $('aiChat'), btn = $('aiAsk');
    if (chat.querySelector('.ai-empty')) chat.innerHTML = '';
    if (!retried) {
      chat.insertAdjacentHTML('beforeend', aiBubble({ role: 'user', body: q, created_at: new Date().toISOString() }));
      chat.scrollTop = chat.scrollHeight;
    }
    qEl.value = '';
    var firstInThread = !document.querySelector('#aiList [data-th="' + aiThread + '"]');
    state.style.color = 'var(--muted)'; state.textContent = 'חושב…'; btn.disabled = true;
    var save = function (role, body) {
      return db.from('ai_messages')
        .insert({ thread_id: aiThread, role: role, body: body, persona: persona || null })
        .then(function (r) { if (r.error) console.warn('[ai history]', r.error.message); }, function () {});
    };
    if (!retried) save('user', q);

    var fail = function (msg) {
      btn.disabled = false; state.style.color = 'var(--danger)';
      state.textContent = /unauthorized/i.test(msg)
          ? '\u26a0 ההתחברות פגה. רעננו את הדף (F5) ושלחו שוב.'
        : /IDLE_TIMEOUT|timeout/i.test(msg) ? 'התשובה ארכה יותר מדי. נסו לפצל את השאלה לשניים.'
        : /ANTHROPIC_API_KEY|מפתח AI/.test(msg) ? 'חסר מפתח AI בהגדרות הפונקציה.'
        : 'שגיאה: ' + msg;
    };

    //  הבועה נוצרת ריקה ומתמלאת תוך כדי. חוץ מהחוויה, זה מה שמונע את
    //  ה-504: Supabase קוטע בקשה שלא החזירה בייט במשך 150 שניות, ותשובה
    //  ארוכה (נוהל עבודה, מסמך הנחיות) נמשכת יותר מזה.
    var wrap = document.createElement('div');
    wrap.className = 'ai-msg';
    wrap.innerHTML = '<div class="ai-b"></div><div class="ai-t"></div>';
    var bodyEl = wrap.querySelector('.ai-b'), timeEl = wrap.querySelector('.ai-t');
    var acc = '';

    db.auth.getSession().then(function (sr) {
      var tok = sr && sr.data && sr.data.session && sr.data.session.access_token;
      if (!tok) return fail('unauthorized');
      return fetch(SUPABASE_URL + '/functions/v1/ai-assistant', {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: ctx + '\n\nהשאלה: ' + q,
                               system: sysPrompt ? (AI_BASE + ' ' + sysPrompt) : undefined, stream: true })
      }).then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            var msg = t; try { msg = (JSON.parse(t) || {}).error || (JSON.parse(t) || {}).message || t; } catch (e) {}
            //  סשן שפג הוא המקרה הנפוץ — מחדשים טוקן ושולחים שוב פעם אחת
            if (/unauthorized/i.test(msg) && !retried) {
              return db.auth.refreshSession().then(function (rs) {
                if (rs && rs.error) return fail(msg);
                qEl.value = q; askAI(ctx, sysPrompt, persona, true);
              }, function () { fail(msg); });
            }
            fail(msg);
          });
        }
        if (!resp.body || !resp.body.getReader) {
          //  דפדפן בלי תמיכה בהזרמה — קוראים הכל בבת אחת
          return resp.text().then(function (t) { acc = String(t).replace(/​/g, ''); done(); });
        }
        state.textContent = 'חושב… (התשובה תתחיל להיכתב ברגע שתהיה מוכנה)';
        chat.appendChild(wrap); chat.scrollTop = chat.scrollHeight;
        var reader = resp.body.getReader(), dec = new TextDecoder();
        var pump = function () {
          return reader.read().then(function (res) {
            if (res.done) return done();
            //  תווי רוחב-אפס הם פעימת הלב של השרת ואינם חלק מהתשובה
            acc += dec.decode(res.value, { stream: true }).replace(/​/g, '');
            bodyEl.textContent = acc;
            if (acc && state.textContent !== 'כותב…') state.textContent = 'כותב…';
            chat.scrollTop = chat.scrollHeight;
            return pump();
          });
        };
        return pump();
      });
    }).catch(function (e) { fail((e && e.message) || String(e)); });

    function done() {
      btn.disabled = false; state.textContent = '';
      if (!acc) { wrap.remove(); return fail('לא התקבלה תשובה'); }
      if (!wrap.parentNode) { bodyEl.textContent = acc; chat.appendChild(wrap); }
      timeEl.textContent = fmtDateTime(new Date().toISOString());
      chat.scrollTop = chat.scrollHeight;
      save('assistant', acc);
      if (firstInThread && $('aiList')) {
        var html = '<button class="ai-item active" data-th="' + esc(aiThread) + '">' +
          '<span class="ai-del" data-delth="' + esc(aiThread) + '" title="מחק שיחה">✕</span>' +
          esc(q.slice(0, 44)) + '<span class="d">' + esc(fmtDateTime(new Date().toISOString())) + ' · 2 הודעות</span></button>';
        $('aiList').querySelectorAll('.ai-item').forEach(function (x) { x.classList.remove('active'); });
        var empty = $('aiList').querySelector('.muted'); if (empty) empty.remove();
        $('aiList').insertAdjacentHTML('afterbegin', html);
      }
    }
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
  //  מסך חיבורי פלטפורמה פר-ארגון: כל עסק מזין את חשבונות ה-Voicenter/
  //  פייסבוק/WhatsApp שלו. הנתונים מבודדים (org_integrations, RLS למנהל).
  //  שדות סוד מוצגים ממוסכים ונשמרים רק אם הוזנו מחדש.
  var CONN_PLATFORMS = [
    { key: 'resend', icon: '📧', title: 'מיילים (Resend)', desc: 'כתובת השולח של הארגון. מרגע שמוגדרת — כל המיילים היוצאים (הזמנות, אוטומציות, התראות) נשלחים ממנה. הדומיין חייב להיות מאומת בחשבון ה-Resend.',
      fields: [{ k: 'from_name', l: 'שם השולח (למשל: סנטר ליס)' }, { k: 'from_email', l: 'כתובת שולח (דומיין מאומת)' }, { k: 'api_key', l: 'Resend API Key (של חשבון הארגון)', s: true }] },
    { key: 'openai', icon: '🧠', title: 'OpenAI — תמלול וניתוח AI', desc: 'מפתח ה-OpenAI של הארגון לתמלול השיחות, ניתוח AI וסוכן ה-AI. אם נשאר ריק — נעשה שימוש במפתח המשותף של המערכת.',
      fields: [{ k: 'api_key', l: 'OpenAI API Key (sk-...)', s: true }] },
    { key: 'voicenter', icon: '📞', title: 'Voicenter — שיחות והקלטות', desc: 'קליטת שיחות והקלטות אוטומטית מחשבון ה-Voicenter של העסק.',
      fields: [{ k: 'user', l: 'שם משתמש Voicenter' }, { k: 'password', l: 'סיסמה / טוקן', s: true }, { k: 'dids', l: 'מספרי DID (מופרדים בפסיק)' }], hook: '/voicenter-cdr' },
    { key: 'facebook', icon: '📘', title: 'פייסבוק — לידים ממודעות', desc: 'קליטת לידים אוטומטית מטפסי מודעות של דף הפייסבוק.',
      fields: [{ k: 'page_token', l: 'Page Access Token', s: true }, { k: 'page_ids', l: 'מזהי דפים/טפסים (מופרדים בפסיק)' }], hook: '/fb-forms' },
    { key: 'whatsapp', icon: '💬', title: 'WhatsApp (Heyy)', desc: 'שליחה וקבלה של הודעות WhatsApp דרך Heyy.',
      fields: [{ k: 'api_key', l: 'Heyy API Key', s: true }, { k: 'number', l: 'מספר WhatsApp / מזהה' }], hook: '/wa-webhook' },
    { key: 'icredit', icon: '💳', title: 'iCredit (ריווחית) — סליקת אשראי', desc: 'יצירת לינקי תשלום לחיוב כרטיס אשראי והפקת חשבונית מס-קבלה אוטומטית בריווחית. הטוקן הפרטי (GroupPrivateToken) נשלח אליך במייל מ-iCredit. התחל ב-Test — עבור ל-prod רק אחרי בדיקה.',
      fields: [{ k: 'group_token', l: 'GroupPrivateToken (מזהה קבוצה פרטי)', s: true }, { k: 'mode', l: 'סביבה — test או prod (ברירת מחדל: test)' }] }
  ];
  function renderConnections() {
    var host = $('connBox'); if (!host) return;
    if (!(window.C2B.role === 'admin' || window.C2B.isSuper)) { host.innerHTML = '<div class="card"><div class="sec-note">רק מנהל מערכת של הארגון מגדיר חיבורים.</div></div>'; return; }
    var oid = window.C2B.orgId || 1;
    var base = 'https://gfwopgoydfqiouratcpc.supabase.co/functions/v1';
    host.innerHTML = '<div class="ai-empty">טוען חיבורים…</div>';
    Promise.all([
      db.from('org_integrations').select('platform,config,connected'),
      db.from('calls').select('id', { count: 'exact', head: true }).not('crm_analysis', 'is', null),
      db.from('calls').select('id', { count: 'exact', head: true }).not('recording_path', 'is', null),
      db.from('wa_messages').select('id', { count: 'exact', head: true }),
      db.from('leads').select('id', { count: 'exact', head: true }).not('form_id', 'is', null),
      db.from('scheduled_emails').select('id', { count: 'exact', head: true })
    ]).then(function (res) {
      var r = res[0];
      if (r && r.error) { host.innerHTML = '<div class="card"><div class="sec-note">שגיאה: ' + esc(r.error.message) + '</div></div>'; return; }
      var by = {}; ((r && r.data) || []).forEach(function (x) { by[x.platform] = x; });
      var cnt = function (i) { return (res[i] && res[i].count) || 0; };
      //  סטטוס אוטומטי — "מחובר" כשיש הגדרה שמורה או פעילות אמיתית בפועל (RLS מסנן לארגון).
      var live = {
        resend: !!(by.resend && by.resend.config && by.resend.config.from_email) || cnt(5) > 0,
        openai: !!(by.openai && by.openai.config && by.openai.config.api_key) || cnt(1) > 0,
        voicenter: !!(by.voicenter && by.voicenter.connected) || cnt(2) > 0,
        facebook: !!(by.facebook && by.facebook.connected) || cnt(4) > 0,
        whatsapp: !!(by.whatsapp && by.whatsapp.connected) || cnt(3) > 0,
        icredit: !!(by.icredit && by.icredit.config && by.icredit.config.group_token)
      };
      host.innerHTML = '<p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.7">כל עסק מחבר את החשבונות שלו בנפרד. הסטטוס מתעדכן אוטומטית — "מחובר" מופיע ברגע שיש פעילות אמיתית (שיחות, הודעות, מיילים) או הגדרה שמורה.</p>' +
        CONN_PLATFORMS.map(function (p) {
          var st = by[p.key] || {}, cfg = st.config || {};
          var fh = p.fields.map(function (fd) {
            if (fd.s) return '<div class="field" style="margin:0 0 8px"><label>' + esc(fd.l) + '</label><input class="inp ltr" data-cf="' + p.key + ':' + fd.k + '" type="password" placeholder="' + (cfg[fd.k] ? 'מוגדר ✓ — הזן מחדש להחלפה' : '') + '"></div>';
            return '<div class="field" style="margin:0 0 8px"><label>' + esc(fd.l) + '</label><input class="inp ltr" data-cf="' + p.key + ':' + fd.k + '" value="' + esc(cfg[fd.k] || '') + '"></div>';
          }).join('');
          var badge = live[p.key] ? '<span class="cl-yes">מחובר ✓</span>' : '<span class="cl-no">לא מחובר</span>';
          return '<div class="card cl-sub" style="margin-bottom:14px"><div class="row-between" style="align-items:center"><h3 class="cl-h" style="margin:0">' + p.icon + ' ' + esc(p.title) + '</h3>' + badge + '</div>' +
            '<p class="muted" style="font-size:12.5px;margin:6px 0 12px">' + esc(p.desc) + '</p>' + fh +
            (p.hook ? '<div class="field" style="margin:8px 0 0"><label>כתובת Webhook להגדרה בפלטפורמה</label><input class="inp ltr" readonly value="' + esc(base + p.hook + '?org=' + oid) + '" onclick="this.select()"></div>' : '') +
            '<div style="margin-top:12px"><button class="btn btn-sm" data-connsave="' + p.key + '">💾 שמור חיבור</button> <span data-cm="' + p.key + '" style="font-size:12px;margin-inline-start:8px"></span></div></div>';
        }).join('');
      host.querySelectorAll('[data-connsave]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.dataset.connsave, plat = CONN_PLATFORMS.filter(function (x) { return x.key === key; })[0];
          var cfg = Object.assign({}, (by[key] && by[key].config) || {});
          host.querySelectorAll('[data-cf^="' + key + ':"]').forEach(function (inp) {
            var fk = inp.dataset.cf.split(':')[1], v = inp.value.trim();
            var fd = plat.fields.filter(function (x) { return x.k === fk; })[0];
            if (fd && fd.s) { if (v) cfg[fk] = v; } else cfg[fk] = v;   // סוד: מעדכנים רק אם הוזן מחדש
          });
          var msg = host.querySelector('[data-cm="' + key + '"]'); msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
          db.from('org_integrations').upsert({ org_id: oid, platform: key, config: cfg, connected: true, updated_at: new Date().toISOString() }, { onConflict: 'org_id,platform' }).then(function (u) {
            if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
            msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר'; by[key] = { platform: key, config: cfg, connected: true };
            setTimeout(renderConnections, 700);   // רענון הסטטוס
          });
        });
      });
    }, function (e) { host.innerHTML = '<div class="card"><div class="sec-note">שגיאה: ' + esc((e && e.message) || e) + '</div></div>'; });
  }

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
        phone: ['\u260e\ufe0f טלפוניה וווטסאפ', 'חיוג מהמערכת, וכל החיבור של Hey · WhatsApp.'],
        connections: ['🔗 חיבורי פלטפורמה', 'חבר את החשבונות החיצוניים של הארגון — Voicenter, פייסבוק, WhatsApp. כל עסק בנפרד.'],
        actions: ['\u26a1 פעולות', 'סרגל הפעולות שמופיע בכרטיס הליד.']
      };
      var hd = HEAD[sec] || HEAD.lists, mid = '';
      if (sec === 'lists') mid = '<div style="margin-bottom:16px"><button class="btn btn-sm" id="seedSources">\ud83c\udfaf טען מקורות מומלצים</button></div>' + warn + cards;
      else if (sec === 'integrations') mid = '<div id="integrationsCard"></div>';
      else if (sec === 'brands') mid = '<div id="brandMapCard"></div>';
      else if (sec === 'quick') mid = '<div id="quickMsgCard"></div>';
      else if (sec === 'phone') mid = '<div id="telephonyCard"></div><div id="heyCard"></div>';
      else if (sec === 'hours') mid = '<div id="officeCard"></div>';
      else if (sec === 'connections') mid = '<div id="connBox"></div>';
      else if (sec === 'actions') mid = actionEditorCard();
      view('<h2 style="margin:0 0 4px">' + hd[0] + '</h2>' +
        '<p class="muted" style="font-size:13px;margin-bottom:14px">' + hd[1] + '</p>' + mid);
      if (sec === 'actions') bindActionEditor();
      if (sec === 'integrations') renderIntegrations();
      if (sec === 'brands') renderBrandMap();
      if (sec === 'quick') renderQuickMsgs();
      if (sec === 'phone') { renderTelephony(); renderHeyCfg(); }
      if (sec === 'hours') renderOffice();
      if (sec === 'connections') renderConnections();
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
        db.from('app_config').upsert({ org_id: window.C2B.orgId, key: 'telephony', value: val, updated_at: new Date().toISOString() }, { onConflict: 'org_id,key' }).then(function (u) {
          if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
          window.C2B.tel = val; msg.style.color = 'var(--ok)'; msg.textContent = '✔ נשמר';
        });
      });
    });
  }

  // ---------- SETTINGS: החלון שבו המשרד סגור ----------
  function renderOffice() {
    var host = $('officeCard'); if (!host) return;
    var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    db.from('app_config').select('value').eq('key', 'office_hours').maybeSingle().then(function (r) {
      var o = Object.assign({ fromDow: 5, fromTime: '13:00', toDow: 0, toTime: '09:00' }, (r && r.data && r.data.value) || {});
      function daySel(id, cur) {
        return '<select class="inp" id="' + id + '" style="width:120px">' + DAYS.map(function (d, i) {
          return '<option value="' + i + '"' + (+cur === i ? ' selected' : '') + '>' + d + '</option>';
        }).join('') + '</select>';
      }
      host.innerHTML = '<div class="card"><h3 style="margin:0 0 6px">\ud83d\udd52 החלון שבו המשרד סגור</h3>' +
        '<p class="muted" style="font-size:13px;margin:0 0 14px;line-height:1.7">הזמן שבתוך החלון הזה אינו נספר במדד <b>זמן תגובה</b>. ' +
        'ליד שנכנס בשישי אחר הצהריים ונענה בראשון בבוקר ייספר לפי דקות העבודה בפועל ולא לפי יומיים של לוח שנה. ' +
        'שעון הקיר המלא ממשיך להופיע בפירוט, כדי שתראו כמה הלקוח באמת חיכה.</p>' +
        '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">' +
          '<div class="field" style="margin:0"><label>סגור מיום</label>' + daySel('ohFromD', o.fromDow) + '</div>' +
          '<div class="field" style="margin:0"><label>בשעה</label><input class="inp" type="time" id="ohFromT" value="' + esc(o.fromTime) + '" style="width:120px"></div>' +
          '<div class="field" style="margin:0"><label>עד יום</label>' + daySel('ohToD', o.toDow) + '</div>' +
          '<div class="field" style="margin:0"><label>בשעה</label><input class="inp" type="time" id="ohToT" value="' + esc(o.toTime) + '" style="width:120px"></div>' +
          '<button class="btn btn-sm" id="ohSave">\ud83d\udcbe שמור</button><span id="ohMsg" style="font-size:12px"></span>' +
        '</div>' +
        '<p class="muted" style="font-size:12px;margin-top:12px" id="ohPreview"></p></div>';
      function preview() {
        var span = ((+$('ohToD').value - +$('ohFromD').value + 7) % 7) * 24 * 60 +
                   (hhmm($('ohToT').value) - hhmm($('ohFromT').value));
        $('ohPreview').innerHTML = span > 0
          ? '\u2139\ufe0f החלון נמשך <b>' + Math.floor(span / 60) + ' שעות</b> בכל שבוע.'
          : '<span style="color:var(--danger)">\u26a0 שעת הסיום מוקדמת מההתחלה \u2014 החלון ריק ושום דבר לא ינוכה.</span>';
      }
      ['ohFromD', 'ohFromT', 'ohToD', 'ohToT'].forEach(function (id) { $(id).addEventListener('change', preview); });
      preview();
      $('ohSave').addEventListener('click', function () {
        var val = { fromDow: +$('ohFromD').value, fromTime: $('ohFromT').value,
                    toDow: +$('ohToD').value, toTime: $('ohToT').value };
        var msg = $('ohMsg'); msg.style.color = 'var(--muted)'; msg.textContent = 'שומר…';
        db.from('app_config').upsert({ org_id: window.C2B.orgId, key: 'office_hours', value: val, updated_at: new Date().toISOString() }, { onConflict: 'org_id,key' })
          .then(function (u) {
            if (u.error) { msg.style.color = 'var(--danger)'; msg.textContent = 'שגיאה: ' + u.error.message; return; }
            window.C2B.office = val; msg.style.color = 'var(--ok)'; msg.textContent = '\u2714 נשמר';
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

  //  ---------- \u05d4\u05d2\u05d3\u05e8\u05d5\u05ea Hey \u00b7 WhatsApp ----------
  //  \u05db\u05dc \u05de\u05d4 \u05e9\u05d4\u05d5\u05d2\u05d3\u05e8 \u05d1\u05de\u05d4\u05dc\u05da \u05d4\u05d7\u05d9\u05d1\u05d5\u05e8, \u05d1\u05de\u05e7\u05d5\u05dd \u05d0\u05d7\u05d3 \u05d5\u05e0\u05d9\u05ea\u05df \u05dc\u05e2\u05e8\u05d9\u05db\u05d4.
  //  \u05d4\u05e1\u05d5\u05d3\u05d5\u05ea \u05e2\u05e6\u05de\u05dd \u05d0\u05d9\u05e0\u05dd \u05de\u05d5\u05e6\u05d2\u05d9\u05dd \u05d5\u05dc\u05d0 \u05e0\u05d9\u05ea\u05e0\u05d9\u05dd \u05dc\u05e9\u05dc\u05d9\u05e4\u05d4 \u05de\u05db\u05d0\u05df \u2014 \u05e8\u05e7 \u05d4\u05d0\u05dd \u05d4\u05dd
  //  \u05de\u05d5\u05d2\u05d3\u05e8\u05d9\u05dd. \u05de\u05e4\u05ea\u05d7 \u05db\u05ea\u05d9\u05d1\u05d4 \u05dc\u05d5\u05d5\u05d8\u05e1\u05d0\u05e4 \u05dc\u05d0 \u05e6\u05e8\u05d9\u05da \u05dc\u05d4\u05d2\u05d9\u05e2 \u05dc\u05d3\u05e4\u05d3\u05e4\u05df.
  function renderHeyCfg() {
    var host = $('heyCard'); if (!host) return;
    host.innerHTML = '<div class="card"><h3>\ud83d\udfe2 Hey \u00b7 WhatsApp</h3><p class="muted" style="font-size:13px">\u05d8\u05d5\u05e2\u05df\\u2026</p></div>';
    Promise.all([
      db.from('wa_numbers').select('id,phone,label,channel_id,active').order('created_at'),
      db.from('profiles').select('user_id,full_name,role,wa_number_id').eq('active', true).order('full_name'),
      db.from('wa_threads').select('id', { count: 'exact', head: true }),
      db.from('wa_outbox').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    ]).then(function (r) {
      var nums = r[0].data || [], profs = r[1].data || [];
      var nThreads = r[2].count || 0, nQueued = r[3].count || 0;
      var byNum = {}; nums.forEach(function (n) { byNum[n.id] = n; });
      var rows = nums.map(function (n) {
        var owners = profs.filter(function (x) { return x.wa_number_id === n.id; })
          .map(function (x) { return x.full_name; });
        return '<tr data-num="' + esc(n.id) + '">' +
          '<td><b>' + esc(n.label || '\u05dc\u05dc\u05d0 \u05e9\u05dd') + '</b></td>' +
          '<td class="ltr"><bdi>' + esc(n.phone || '\u2014') + '</bdi></td>' +
          '<td>' + (n.channel_id
            ? '<span style="color:var(--ok)">\u25cf \u05de\u05d7\u05d5\u05d1\u05e8</span><div class="muted" style="font-size:11px">' + esc(String(n.channel_id).slice(0, 13)) + '\u2026</div>'
            : '<span style="color:var(--warn)">\u25cb \u05de\u05de\u05ea\u05d9\u05df \u05dc\u05d4\u05d5\u05d3\u05e2\u05d4 \u05e8\u05d0\u05e9\u05d5\u05e0\u05d4</span>') + '</td>' +
          '<td>' + (owners.length ? esc(owners.join(', ')) : '<span class="muted">\u05db\u05dc \u05de\u05e0\u05d4\u05dc\u05d9 \u05d4\u05de\u05e2\u05e8\u05db\u05ea</span>') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-numedit="' + esc(n.id) + '">\u05e2\u05e8\u05d9\u05db\u05d4</button></td></tr>';
      }).join('');

      host.innerHTML =
        '<div class="card"><div class="row-between"><h3 style="margin:0">\ud83d\udfe2 \u05de\u05e1\u05e4\u05e8\u05d9 \u05d5\u05d5\u05d8\u05e1\u05d0\u05e4</h3>' +
          '<button class="btn btn-ghost btn-sm" id="heyAddNum">\u2795 \u05de\u05e1\u05e4\u05e8</button></div>' +
          '<div class="table-scroll" style="margin-top:10px"><table><thead><tr>' +
          '<th>\u05e9\u05dd</th><th>\u05de\u05e1\u05e4\u05e8</th><th>\u05de\u05e6\u05d1</th><th>\u05de\u05e9\u05d5\u05d9\u05da \u05dc</th><th></th>' +
          '</tr></thead><tbody id="heyNums">' + (rows || '<tr><td colspan="5" class="empty">\u05d0\u05d9\u05df \u05de\u05e1\u05e4\u05e8\u05d9\u05dd</td></tr>') + '</tbody></table></div>' +
          '<p class="muted" style="font-size:12px;margin:10px 0 0">\u05e9\u05d9\u05d5\u05da \u05de\u05e1\u05e4\u05e8 \u05dc\u05e0\u05e6\u05d9\u05d2 \u05e0\u05e2\u05e9\u05d4 \u05d1\u05de\u05e1\u05da <b>\u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd \u05d5\u05d4\u05e8\u05e9\u05d0\u05d5\u05ea</b>. \u05e0\u05e6\u05d9\u05d2 \u05e8\u05d5\u05d0\u05d4 \u05e8\u05e7 \u05d0\u05ea \u05d4\u05e9\u05d9\u05d7\u05d5\u05ea \u05e9\u05dc \u05d4\u05de\u05e1\u05e4\u05e8 \u05e9\u05dc\u05d5.</p></div>' +

        '<div class="card"><h3>\ud83d\udd0c \u05d4\u05d7\u05d9\u05d1\u05d5\u05e8 \u05dc-Heyy</h3>' +
          '<div class="table-scroll"><table><tbody>' +
          '<tr><td style="width:180px">\u05db\u05ea\u05d5\u05d1\u05ea \u05d4\u05d5\u05d5\u05d1\u05d4\u05d5\u05e7</td><td class="ltr"><bdi style="font-size:12px">' +
            esc(SUPABASE_URL + '/functions/v1/heyy-webhook/<\u05d4\u05e1\u05d5\u05d3>') + '</bdi>' +
            '<div class="muted" style="font-size:11.5px">\u05e0\u05e8\u05e9\u05de\u05ea \u05d1-app.heyy.io \u2190 Settings \u2190 Webhooks. \u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd: Message received + Message sent</div></td></tr>' +
          '<tr><td>\u05de\u05e4\u05ea\u05d7 API</td><td><span id="heyKeyState" class="muted">\u05d1\u05d5\u05d3\u05e7\\u2026</span>' +
            '<div class="muted" style="font-size:11.5px">\u05e0\u05e9\u05de\u05e8 \u05d1-Supabase \u05db-HEYY_API_KEY. \u05e0\u05d5\u05e6\u05e8 \u05d1-app.heyy.io/settings/api-keys</div></td></tr>' +
          '<tr><td>\u05e9\u05e2\u05d5\u05df \u05d4\u05ea\u05d6\u05de\u05d5\u05df</td><td>\u05e8\u05e5 \u05db\u05dc \u05d3\u05e7\u05d4 \u00b7 ' + nQueued + ' \u05de\u05de\u05ea\u05d9\u05e0\u05d5\u05ea \u05dc\u05e9\u05dc\u05d9\u05d7\u05d4</td></tr>' +
          '<tr><td>\u05e9\u05d9\u05d7\u05d5\u05ea \u05d1\u05de\u05e2\u05e8\u05db\u05ea</td><td>' + nThreads + '</td></tr>' +
          '</tbody></table></div>' +
          '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">' +
            '<button class="btn btn-ghost btn-sm" id="heyTpls">\ud83d\udce8 \u05d4\u05e6\u05d2 \u05ea\u05d1\u05e0\u05d9\u05d5\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05d5\u05ea</button>' +
            '<button class="btn btn-ghost btn-sm" id="heyLog">\ud83d\udcdc \u05d9\u05d5\u05de\u05df \u05d4\u05d5\u05d5\u05d1\u05d4\u05d5\u05e7</button>' +
          '</div><div id="heyOut" style="margin-top:12px"></div></div>';

      //  \u05de\u05e6\u05d1 \u05d4\u05de\u05e4\u05ea\u05d7 \u05e0\u05d1\u05d3\u05e7 \u05d3\u05e8\u05da \u05e7\u05e8\u05d9\u05d0\u05d4 \u05d0\u05de\u05d9\u05ea\u05d9\u05ea \u05d5\u05dc\u05d0 \u05de\u05d5\u05e6\u05d2 \u05e2\u05e8\u05db\u05d5
      db.functions.invoke('heyy-send', { body: { action: 'templates' } }).then(function (rr) {
        var d = rr.data || {}, el = $('heyKeyState'); if (!el) return;
        if (d.ok) { el.style.color = 'var(--ok)'; el.textContent = '\u25cf \u05de\u05d5\u05d2\u05d3\u05e8 \u05d5\u05e2\u05d5\u05d1\u05d3'; }
        else { el.style.color = 'var(--danger)'; el.textContent = '\u25cb ' + (d.error || '\u05dc\u05d0 \u05e0\u05d1\u05d3\u05e7'); }
      });

      if ($('heyAddNum')) $('heyAddNum').onclick = function () { heyNumBox(null); };
      host.querySelectorAll('[data-numedit]').forEach(function (b) {
        b.onclick = function () { heyNumBox(byNum[b.dataset.numedit]); };
      });
      if ($('heyTpls')) $('heyTpls').onclick = function () {
        var o = $('heyOut'); o.innerHTML = '<p class="muted">\u05d8\u05d5\u05e2\u05df\\u2026</p>';
        db.functions.invoke('heyy-send', { body: { action: 'templates' } }).then(function (rr) {
          var d = rr.data || {};
          if (d.error) return (o.innerHTML = '<p class="err">' + esc(d.error) + '</p>');
          var L = d.templates || [];
          o.innerHTML = '<div class="table-scroll"><table><thead><tr><th>\u05e9\u05dd</th><th>\u05e1\u05d5\u05d2</th><th>\u05d8\u05e7\u05e1\u05d8</th></tr></thead><tbody>' +
            (L.map(function (x) {
              return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.category || '') + '</td>' +
                '<td class="muted" style="font-size:12px">' + esc(String(x.body || '').slice(0, 110)) + '</td></tr>';
            }).join('') || '<tr><td colspan="3" class="empty">\u05d0\u05d9\u05df \u05ea\u05d1\u05e0\u05d9\u05d5\u05ea \u05de\u05d0\u05d5\u05e9\u05e8\u05d5\u05ea</td></tr>') + '</tbody></table></div>';
        });
      };
      if ($('heyLog')) $('heyLog').onclick = function () {
        var o = $('heyOut'); o.innerHTML = '<p class="muted">\u05d8\u05d5\u05e2\u05df\\u2026</p>';
        db.from('wa_hook_log').select('at,ok,note').order('at', { ascending: false }).limit(25).then(function (rr) {
          var L = rr.data || [];
          o.innerHTML = '<div class="table-scroll"><table><thead><tr><th>\u05de\u05ea\u05d9</th><th></th><th>\u05de\u05d4</th></tr></thead><tbody>' +
            (L.map(function (x) {
              return '<tr><td class="muted" style="font-size:12px">' + esc(fmtDateTime(x.at)) + '</td>' +
                '<td>' + (x.ok ? '\u2714' : '<span style="color:var(--danger)">\u2716</span>') + '</td>' +
                '<td>' + esc(x.note || '') + '</td></tr>';
            }).join('') || '<tr><td colspan="3" class="empty">\u05e8\u05d9\u05e7</td></tr>') + '</tbody></table></div>';
        });
      };
    });
  }

  //  \u05e2\u05e8\u05d9\u05db\u05d4 \u05d9\u05d3\u05e0\u05d9\u05ea \u05e9\u05dc \u05de\u05e1\u05e4\u05e8: \u05e9\u05dd, \u05d8\u05dc\u05e4\u05d5\u05df, \u05de\u05d6\u05d4\u05d4 \u05e2\u05e8\u05d5\u05e5 \u05d5\u05d4\u05e4\u05e2\u05dc\u05d4
  function heyNumBox(n) {
    n = n || {};
    var bg = document.createElement('div'); bg.className = 'adm-bg';
    bg.innerHTML = '<div class="adm" style="max-width:430px"><div class="adm-hd">' +
      '<h3>' + (n.id ? '\u05e2\u05e8\u05d9\u05db\u05ea \u05de\u05e1\u05e4\u05e8' : '\u05de\u05e1\u05e4\u05e8 \u05d7\u05d3\u05e9') + '</h3><button class="adm-x" data-admx>\u2715</button></div>' +
      '<div class="adm-body">' +
      '<div class="field"><label>\u05e9\u05dd \u05dc\u05ea\u05e6\u05d5\u05d2\u05d4</label><input class="inp" id="hnLabel" value="' + esc(n.label || '') + '"></div>' +
      '<div class="field"><label>\u05de\u05e1\u05e4\u05e8 (\u05dc\u05dc\u05d0 \u05e4\u05dc\u05d5\u05e1, \u05dc\u05de\u05e9\u05dc 972534495185)</label>' +
        '<input class="inp ltr" id="hnPhone" value="' + esc(n.phone || '') + '"></div>' +
      '<div class="field"><label>\u05de\u05d6\u05d4\u05d4 \u05d4\u05e2\u05e8\u05d5\u05e5 \u05d1-Heyy</label>' +
        '<input class="inp ltr" id="hnChan" value="' + esc(n.channel_id || '') + '" placeholder="\u05e8\u05d9\u05e7 = \u05d9\u05d0\u05d5\u05de\u05e5 \u05d1\u05d4\u05d5\u05d3\u05e2\u05d4 \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d4"></div>' +
      '<label style="display:flex;gap:7px;align-items:center;font-size:13px;margin-bottom:12px">' +
        '<input type="checkbox" id="hnActive"' + (n.active === false ? '' : ' checked') + '> \u05e4\u05e2\u05d9\u05dc</label>' +
      '<div class="row" style="gap:8px"><button class="btn" id="hnGo">\u05e9\u05de\u05d5\u05e8</button>' +
      (n.id ? '<button class="btn btn-ghost btn-sm" id="hnDel">\u05de\u05d7\u05e7</button>' : '') + '</div>' +
      '<p class="err" id="hnErr"></p></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) {
      if (e.target === bg || e.target.closest('[data-admx]')) return bg.remove();
      if (e.target.closest('#hnDel')) {
        if (!confirm('\u05dc\u05de\u05d7\u05d5\u05e7 \u05d0\u05ea \u05d4\u05de\u05e1\u05e4\u05e8? \u05d4\u05e9\u05d9\u05d7\u05d5\u05ea \u05e9\u05dc\u05d5 \u05d9\u05d9\u05de\u05d7\u05e7\u05d5 \u05d0\u05d9\u05ea\u05d5.')) return;
        return db.from('wa_numbers').delete().eq('id', n.id).then(function (r) {
          if (r.error) return ($('hnErr').textContent = r.error.message);
          bg.remove(); renderHeyCfg();
        });
      }
      if (!e.target.closest('#hnGo')) return;
      var row = {
        label: ($('hnLabel').value || '').trim() || null,
        phone: ($('hnPhone').value || '').replace(/[^0-9]/g, '') || null,
        channel_id: ($('hnChan').value || '').trim() || null,
        active: $('hnActive').checked,
      };
      var q = n.id ? db.from('wa_numbers').update(row).eq('id', n.id) : db.from('wa_numbers').insert(row);
      q.then(function (r) {
        if (r.error) return ($('hnErr').textContent = r.error.message);
        bg.remove(); renderHeyCfg();
      });
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
        db.from('admin_config').upsert({ org_id: window.C2B.orgId, key: 'manychat', value: { token: tok }, updated_at: new Date().toISOString() }, { onConflict: 'org_id,key' }).then(function (u) {
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
