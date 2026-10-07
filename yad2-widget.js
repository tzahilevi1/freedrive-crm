/* ============================================================
   yad2-Global · ווידג'ט מלאי לאתרי-המותגים
   הטמעה:  <div data-yad2-stock></div>
           <script src="https://crm.freedrive.co.il/yad2-widget.js" defer></script>
   קורא חי את המלאי המפורסם (מקור-יחיד) → מכירה/הוספה מתעדכנת מיד בכל האתרים.
   אפשר data-yad2-stock="6" להגביל מספר רכבים, ו-data-title="כותרת".
   ============================================================ */
(function () {
  var URL = 'https://xppsvottiwbjsjlusief.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwcHN2b3R0aXdianNqbHVzaWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNzg5NzYsImV4cCI6MjEwNjk1NDk3Nn0.b9WaudA0bbKQiEVHtdnChETITTq4Tl2oPEHPnzwWsZo';
  var INGEST = 'wgt_f5291fec7fdf5321526571ab';
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var money = function (v) { return v == null || v === '' ? '' : '₪' + Number(v).toLocaleString('en-US'); };
  var title = function (c) { return [c.make, c.model, c.year].filter(Boolean).join(' ') || 'רכב'; };
  var cover = function (c) { var im = Array.isArray(c.images) ? c.images : []; return im.length ? im[Math.min(c.cover_idx || 0, im.length - 1)] : ''; };

  if (!document.getElementById('y2w-style')) {
    var st = document.createElement('style'); st.id = 'y2w-style';
    st.textContent = '.y2w{direction:rtl;font-family:inherit;max-width:1200px;margin:0 auto}' +
      '.y2w-h{font-size:clamp(20px,3vw,28px);font-weight:800;margin:0 0 16px}' +
      '.y2w-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}' +
      '.y2w-card{border:1px solid #e6e8ec;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.05);transition:transform .15s,box-shadow .15s}' +
      '.y2w-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.1)}' +
      '.y2w-img{height:180px;background:#0b0f14 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#5a6676;font-size:13px}' +
      '.y2w-b{padding:14px 16px}.y2w-t{font-weight:800;font-size:17px;margin:0 0 4px}' +
      '.y2w-m{color:#6b7280;font-size:13px}.y2w-p{font-weight:800;font-size:19px;margin:8px 0 12px;color:#111}' +
      '.y2w-btn{display:block;width:100%;border:none;border-radius:10px;padding:10px;font-weight:700;font-size:14.5px;cursor:pointer;background:#ff6b00;color:#fff}' +
      '.y2w-btn:hover{filter:brightness(.95)}.y2w-form input{width:100%;box-sizing:border-box;border:1px solid #d7dbe0;border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:14px;font-family:inherit}' +
      '.y2w-ok{color:#1f8a4c;font-weight:700;padding:8px 0}.y2w-empty{color:#6b7280;padding:30px;text-align:center}';
    document.head.appendChild(st);
  }

  function renderInto(el) {
    var limit = parseInt(el.getAttribute('data-yad2-stock'), 10) || 0;
    var heading = el.getAttribute('data-title') || 'רכבי יד2 — מלאי זמין';
    el.innerHTML = '<div class="y2w"><div class="y2w-empty">טוען מלאי…</div></div>';
    fetch(URL + '/rest/v1/inventory?select=id,make,model,year,hand,km,color,price,images,cover_idx&published=eq.true&status=eq.available&order=created_at.desc', { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } })
      .then(function (r) { return r.json(); })
      .then(function (cars) {
        cars = Array.isArray(cars) ? cars : [];
        if (limit) cars = cars.slice(0, limit);
        if (!cars.length) { el.innerHTML = '<div class="y2w"><h2 class="y2w-h">' + E(heading) + '</h2><div class="y2w-empty">אין רכבים זמינים כרגע.</div></div>'; return; }
        var cards = cars.map(function (c) {
          var cov = cover(c);
          return '<div class="y2w-card" data-car="' + E(c.id) + '">' +
            '<div class="y2w-img"' + (cov ? ' style="background-image:url(\'' + E(cov) + '\')"' : '') + '>' + (cov ? '' : 'אין תמונה') + '</div>' +
            '<div class="y2w-b"><div class="y2w-t">' + E(title(c)) + '</div>' +
            '<div class="y2w-m">' + [c.hand ? 'יד ' + E(c.hand) : '', c.km != null ? Number(c.km).toLocaleString('en-US') + ' ק"מ' : '', c.color ? E(c.color) : ''].filter(Boolean).join(' · ') + '</div>' +
            '<div class="y2w-p">' + (money(c.price) || 'לפרטים') + '</div>' +
            '<div class="y2w-slot"><button class="y2w-btn" data-contact="' + E(c.id) + '">מעוניין? השאירו פרטים</button></div>' +
            '</div></div>';
        }).join('');
        el.innerHTML = '<div class="y2w"><h2 class="y2w-h">' + E(heading) + '</h2><div class="y2w-grid">' + cards + '</div></div>';
        el.querySelectorAll('[data-contact]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var car = cars.filter(function (x) { return x.id === btn.dataset.contact; })[0] || {};
            var slot = btn.parentNode;
            slot.innerHTML = '<div class="y2w-form"><input placeholder="שם מלא" data-f="name"><input placeholder="טלפון" data-f="phone" inputmode="tel"><button class="y2w-btn" data-send>שליחה</button></div>';
            slot.querySelector('[data-send]').addEventListener('click', function () {
              var name = slot.querySelector('[data-f=name]').value.trim(), phone = slot.querySelector('[data-f=phone]').value.trim();
              if (!name || !phone) { return; }
              this.disabled = true; this.textContent = 'שולח…';
              fetch(URL + '/functions/v1/ingest?key=' + INGEST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, phone: phone, car: title(car), message: 'התעניינות ברכב מהמלאי: ' + title(car) + ' (מזהה ' + car.id + ')' }) })
                .then(function () { slot.innerHTML = '<div class="y2w-ok">✔ קיבלנו! ניצור קשר בהקדם.</div>'; })
                .catch(function () { slot.innerHTML = '<div class="y2w-ok" style="color:#c0392b">שגיאה — נסו שוב.</div>'; });
            });
          });
        });
      })
      .catch(function () { el.innerHTML = '<div class="y2w"><div class="y2w-empty">שגיאה בטעינת המלאי.</div></div>'; });
  }

  function init() { document.querySelectorAll('[data-yad2-stock]').forEach(renderInto); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.Yad2Stock = { refresh: init };
})();
