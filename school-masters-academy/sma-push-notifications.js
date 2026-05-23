/**
 * sma-push-notifications.js
 * ─────────────────────────────────────────────────────────────────
 * Add ONE <script src="sma-push-notifications.js"></script> tag
 * near the bottom of EACH portal HTML file (before </body>).
 *
 * Then call  SMA_Push.init(role, user)  right after the user
 * successfully logs in. See the "INTEGRATION POINTS" section below
 * for exactly where in each portal to add these calls.
 *
 * ─── INTEGRATION POINTS ──────────────────────────────────────────
 *
 * STUDENT PORTAL  (student-portal.html)
 * ──────────────────────────────────────
 * Find the line where currentStudentData is set after login, e.g.:
 *   currentStudentData = student;
 * Immediately after that line add:
 *   SMA_Push.init('student', {
 *     id    : student.id,
 *     name  : student.name,
 *     class : student.class,
 *     apiKey: 'AIzaSyCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'   // ← your Firebase API key
 *   });
 *
 * TEACHER PORTAL  (teacher-portal.html)
 * ──────────────────────────────────────
 * Find where currentTeacherData is set after login, then add:
 *   SMA_Push.init('teacher', {
 *     id    : teacher.id,
 *     name  : teacher.name,
 *     apiKey: 'AIzaSyCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
 *   });
 *
 * ADMIN PORTAL  (admin-portal.html)
 * ──────────────────────────────────
 * Find where the admin session is confirmed after login, then add:
 *   SMA_Push.init('admin', {
 *     id    : 'admin',
 *     name  : 'Administrator',
 *     apiKey: 'AIzaSyCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
 *   });
 *
 * ON LOGOUT  (all portals)
 * ─────────────────────────
 * Find the logout function / button handler and add:
 *   SMA_Push.logout();
 */

'use strict';

window.SMA_Push = (() => {

  const SW_URL = '/sw-notifications.js';
  let _swReg   = null;

  /* ── PUBLIC: call after successful login ── */
  async function init(role, userInfo) {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.info('[SMA-Push] Push notifications not supported in this browser.');
      return;
    }

    // 1. Ask for permission (shows the browser "Allow notifications?" prompt)
    const permission = await requestPermission();
    if (permission !== 'granted') {
      console.info('[SMA-Push] Notification permission not granted.');
      return;
    }

    // 2. Register the service worker
    try {
      _swReg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      console.info('[SMA-Push] Service worker registered.');
    } catch (err) {
      console.warn('[SMA-Push] SW registration failed:', err);
      return;
    }

    // 3. Tell the SW who is logged in
    await sendToSW({
      type: 'SMA_LOGIN',
      user: {
        role,
        id    : userInfo.id    || '',
        name  : userInfo.name  || '',
        class : userInfo.class || '',
        apiKey: userInfo.apiKey || '',
      }
    });

    console.info(`[SMA-Push] Push active for ${role} "${userInfo.name}".`);
  }

  /* ── PUBLIC: call on logout ── */
  async function logout() {
    await sendToSW({ type: 'SMA_LOGOUT' });
  }

  /* ── INTERNAL HELPERS ── */

  async function requestPermission() {
    if (Notification.permission === 'granted')  return 'granted';
    if (Notification.permission === 'denied')   return 'denied';

    // Show a friendly in-page prompt first so the browser dialog
    // doesn't appear out of nowhere (browsers may block the native
    // dialog if it wasn't triggered by a user gesture).
    const agreed = await showPermissionBanner();
    if (!agreed) return 'dismissed';

    return await Notification.requestPermission();
  }

  function showPermissionBanner() {
    return new Promise(resolve => {
      // Remove any existing banner
      document.getElementById('sma-push-banner')?.remove();

      const banner = document.createElement('div');
      banner.id = 'sma-push-banner';
      banner.innerHTML = `
        <div style="
          position:fixed;bottom:1.2rem;left:50%;transform:translateX(-50%);
          z-index:99999;background:#1e3a5f;color:#fff;
          border-radius:14px;padding:1rem 1.4rem;
          box-shadow:0 8px 32px rgba(0,0,0,.35);
          display:flex;align-items:center;gap:1rem;
          font-family:system-ui,sans-serif;font-size:.92rem;
          max-width:min(92vw,480px);animation:smaSlideUp .3s ease;
        ">
          <span style="font-size:1.6rem">🔔</span>
          <span style="flex:1;line-height:1.4">
            <strong>Stay updated!</strong><br>
            Get notified about new announcements &amp; school updates — even when this tab is closed.
          </span>
          <div style="display:flex;flex-direction:column;gap:.5rem">
            <button id="sma-push-allow" style="
              background:#4ade80;color:#000;border:none;border-radius:8px;
              padding:.45rem .9rem;font-weight:700;cursor:pointer;font-size:.85rem;
              white-space:nowrap
            ">Allow</button>
            <button id="sma-push-deny" style="
              background:transparent;color:#aaa;border:1px solid #555;
              border-radius:8px;padding:.45rem .9rem;cursor:pointer;font-size:.8rem;
              white-space:nowrap
            ">Not now</button>
          </div>
        </div>
        <style>
          @keyframes smaSlideUp {
            from { opacity:0; transform:translateX(-50%) translateY(20px); }
            to   { opacity:1; transform:translateX(-50%) translateY(0);    }
          }
        </style>
      `;
      document.body.appendChild(banner);

      banner.querySelector('#sma-push-allow').onclick = () => {
        banner.remove(); resolve(true);
      };
      banner.querySelector('#sma-push-deny').onclick = () => {
        banner.remove(); resolve(false);
      };
    });
  }

  async function sendToSW(message) {
    // Wait for the SW to be ready if not yet registered
    const reg = _swReg || await navigator.serviceWorker.ready;
    if (reg?.active) {
      reg.active.postMessage(message);
    }
  }

  return { init, logout };
})();
