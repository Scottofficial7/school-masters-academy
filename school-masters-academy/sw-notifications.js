/**
 * sw-notifications.js  –  SMA School Portal Service Worker
 * ─────────────────────────────────────────────────────────
 * Place this file at the ROOT of your web server (same folder
 * as student-portal.html, teacher-portal.html, admin-portal.html).
 *
 * This service worker polls Firestore every 60 s for new
 * announcements and student notifications, then fires native
 * OS notifications when new items arrive — even when the
 * browser tab is closed / in background.
 *
 * HOW IT WORKS
 * ────────────
 * 1. The portals register this SW on login and store the
 *    logged-in user's details in the SW via postMessage.
 * 2. The SW sets a periodic alarm (setInterval inside install)
 *    to poll Firestore directly via REST (no SDK needed in SW).
 * 3. It tracks the last-seen timestamp in IndexedDB so it never
 *    re-fires a notification for an item it already showed.
 * 4. Clicking a notification focuses / opens the portal tab.
 */

'use strict';

/* ─── CONFIG ───────────────────────────────────────────── */
const FIREBASE_PROJECT = 'sma-backend-web';          // ← your project ID
const FIRESTORE_BASE   =
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const POLL_INTERVAL_MS = 60_000;   // check every 60 seconds
const DB_NAME          = 'sma-sw';
const DB_VERSION       = 1;
const STORE_NAME       = 'meta';   // key-value store for lastSeen + user info

/* ─── INSTALL / ACTIVATE ────────────────────────────────── */
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

/* ─── STATE (in-memory, restored from IDB on wake) ──────── */
let _user   = null;   // { role, id, class, name, apiKey }
let _timer  = null;

/* ─── MESSAGE FROM PORTAL ───────────────────────────────── */
// Portal sends: { type:'SMA_LOGIN',  user:{ role, id, class, name, apiKey } }
// Portal sends: { type:'SMA_LOGOUT' }
self.addEventListener('message', async e => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'SMA_LOGIN') {
    _user = msg.user;
    await idbSet('user', _user);
    startPolling();
  } else if (msg.type === 'SMA_LOGOUT') {
    _user = null;
    await idbSet('user', null);
    stopPolling();
  }
});

/* ─── NOTIFICATION CLICK ────────────────────────────────── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Focus existing portal tab if open
        for (const client of clientList) {
          if (client.url.includes('portal') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open the correct portal
        const url = e.notification.data?.url || '/student-portal.html';
        return self.clients.openWindow(url);
      })
  );
});

/* ─── POLLING ───────────────────────────────────────────── */
async function startPolling() {
  stopPolling();
  // Restore user from IDB if not in memory (SW was restarted)
  if (!_user) _user = await idbGet('user');
  if (!_user) return;

  await poll(); // immediate first check
  _timer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function poll() {
  if (!_user) { _user = await idbGet('user'); }
  if (!_user || !_user.apiKey) return;

  try {
    await checkAnnouncements();
    await checkNotifications();
  } catch (err) {
    console.warn('[SMA-SW] poll error:', err.message);
  }
}

/* ─── CHECK ANNOUNCEMENTS ───────────────────────────────── */
async function checkAnnouncements() {
  const lastSeen = (await idbGet('lastSeenAnn')) || 0;
  const items    = await fetchCollection('announcements');
  if (!items) return;

  let newest = lastSeen;
  const toNotify = [];

  for (const item of items) {
    const ts = item.timestamp || 0;
    if (ts > lastSeen) {
      // Skip "teachers only" announcements for students
      if (_user.role === 'student' && item.audience === 'teachers') continue;
      toNotify.push(item);
      if (ts > newest) newest = ts;
    }
  }

  // Fire one notification per new announcement (max 3 at once)
  for (const ann of toNotify.slice(0, 3)) {
    await showNotification({
      title : `📢 ${ann.title || 'New Announcement'}`,
      body  : stripHtml(ann.content || '').slice(0, 120),
      tag   : `ann-${ann.id}`,
      icon  : '/icon-192.png',
      badge : '/icon-72.png',
      data  : { url: portalUrl() + '#notifications' }
    });
  }

  if (newest > lastSeen) await idbSet('lastSeenAnn', newest);
}

/* ─── CHECK STUDENT NOTIFICATIONS ──────────────────────── */
async function checkNotifications() {
  if (_user.role !== 'student') return; // teachers/admin see inside portal

  const lastSeen = (await idbGet('lastSeenNotif')) || 0;
  const items    = await fetchCollection('notifications');
  if (!items) return;

  const studentClass = _user.class || '';
  const studentId    = String(_user.id || '');

  let newest = lastSeen;
  const toNotify = [];

  for (const item of items) {
    const ts = item.timestamp || 0;
    if (ts <= lastSeen) continue;

    // Match logic mirrors getStudentNotifications() in sma_backend.js
    const forStudent  = item.studentId && String(item.studentId) === studentId;
    const forClass    = item.class && item.class === studentClass && !item.studentId;
    const forAll      = !item.class && !item.studentId;

    if (forStudent || forClass || forAll) {
      toNotify.push(item);
      if (ts > newest) newest = ts;
    }
  }

  for (const notif of toNotify.slice(0, 3)) {
    await showNotification({
      title : notif.title  || '🔔 School Notification',
      body  : stripHtml(notif.message || notif.content || '').slice(0, 120),
      tag   : `notif-${notif.id}`,
      icon  : '/icon-192.png',
      badge : '/icon-72.png',
      data  : { url: portalUrl() + '#notifications' }
    });
  }

  if (newest > lastSeen) await idbSet('lastSeenNotif', newest);
}

/* ─── FIRESTORE REST FETCH ──────────────────────────────── */
async function fetchCollection(collectionName) {
  // Firestore REST: GET /documents/{collection}
  // Uses the Firebase API key for public (rules-permitted) reads
  const url = `${FIRESTORE_BASE}/settings?key=${_user.apiKey}`;

  // First get the parent settings doc which holds the array (matches loadList pattern)
  const res = await fetch(
    `${FIRESTORE_BASE}/settings/${collectionName}?key=${_user.apiKey}`
  );
  if (!res.ok) return null;

  const json = await res.json();
  // The backend stores lists as a JSON string in a 'data' string field
  // Firestore REST wraps it as: { fields: { data: { stringValue: "..." } } }
  const raw = json?.fields?.data?.stringValue;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/* ─── HELPERS ───────────────────────────────────────────── */
async function showNotification(opts) {
  const permission = await self.registration.showNotification(opts.title, {
    body   : opts.body,
    icon   : opts.icon,
    badge  : opts.badge,
    tag    : opts.tag,          // deduplicates: same tag = replace existing
    renotify: false,
    data   : opts.data,
    vibrate: [200, 100, 200],
  });
  return permission;
}

function portalUrl() {
  if (!_user) return '/student-portal.html';
  if (_user.role === 'teacher') return '/teacher-portal.html';
  if (_user.role === 'admin')   return '/admin-portal.html';
  return '/student-portal.html';
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/* ─── INDEXEDDB HELPERS ─────────────────────────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}
