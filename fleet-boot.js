/*  fleet-boot — בוחר את פרויקט ה-Supabase של המותג לפי ה-path, ואז טוען את
 *  אפליקציית ה-CRM. admin-crm.js תופס את C.db בזמן טעינה, לכן הלקוח חייב
 *  להיווצר לפני שהוא נטען — ולכן ה-resolve (async) קורה כאן, לפני הזרקת
 *  סקריפטי-האפליקציה. שורש (בלי slug) = המאסטר (פרי דרייב) — תואם-לאחור. */
(function () {
  'use strict';
  var MASTER_URL = 'https://gfwopgoydfqiouratcpc.supabase.co';
  var MASTER_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdmd29wZ295ZGZxaW91cmF0Y3BjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDg0NTUsImV4cCI6MjEwMzIyNDQ1NX0.ukPDUGS7KjYgD7jAhzSqAEKo_eJ8gQwsHMqTBGXeux8';
  var V = '202610011405';
  var APP = ['/admin.js', '/admin-crm.js', '/admin-modules.js'];
  //  נתיבים שאינם slug של מותג — נטענים כמאסטר (שורש/דפים ישנים).
  var RESERVED = { '': 1, 'admin.html': 1, 'index.html': 1, 'reset.html': 1, 'sign.html': 1, 'back.html': 1 };

  function slug() {
    var s = (location.pathname || '/').split('/').filter(Boolean)[0] || '';
    try { s = decodeURIComponent(s); } catch (e) {}
    return s.trim().toLowerCase();
  }
  function loadApp(cfg) {
    window.__fleetCfg = cfg;
    window.__fleetMaster = { url: MASTER_URL, anon: MASTER_ANON };   // למחליף-הצי: רשימת כל המותגים מהמאסטר
    var q = V && V.charAt(0) !== '_' ? ('?v=' + V) : '';
    (function next(i) {
      if (i >= APP.length) { if (window.C2B_boot) window.C2B_boot(); return; }   // כל הסקריפטים נטענו → הפעל את ה-boot
      var el = document.createElement('script');
      el.src = APP[i] + q;
      el.async = false;                       // שמירת סדר טעינה
      el.onload = function () { next(i + 1); };
      el.onerror = function () { showError('טעינת המערכת נכשלה'); };
      document.head.appendChild(el);
    })(0);
  }
  function showError(title, sub) {
    var safe = String(sub || '').replace(/[<>&]/g, '');
    document.body.innerHTML =
      '<div style="font-family:Arial,sans-serif;background:#0f1115;color:#e9edf2;display:flex;' +
      'align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
      '<div><div style="font-size:46px">🔌</div><h1 style="font-size:22px;margin:12px 0 6px">' + title + '</h1>' +
      (safe ? '<p style="color:#8a93a0;margin:0">' + safe + '</p>' : '') + '</div></div>';
  }

  var s = slug();
  if (!s || RESERVED[s]) {
    loadApp({ url: MASTER_URL, anon: MASTER_ANON, branding: null, slug: 'freedrive', isMaster: true });
    return;
  }
  fetch(MASTER_URL + '/rest/v1/rpc/fleet_resolve', {
    method: 'POST',
    headers: { apikey: MASTER_ANON, Authorization: 'Bearer ' + MASTER_ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ p_slug: s })
  }).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
    if (cfg && cfg.supabase_url && cfg.anon_key) {
      loadApp({ url: cfg.supabase_url, anon: cfg.anon_key, branding: cfg.branding || null, name: cfg.name || null, slug: s });
    } else {
      showError('מותג לא נמצא', s);
    }
  }).catch(function () { showError('שגיאת חיבור לשרת', s); });
})();
