/**
 * SMA_BACKEND.js  –  Firebase / Firestore Edition
 * School Masters Academy – Shared Firebase backend
 * All three portals (Admin, Teacher, Student) use this shared data layer.
 *
 * DROP-IN REPLACEMENT: Every public method has the same name and signature
 * as the original localStorage version, but now returns a Promise.
 * Portals must await every SMA call, e.g.:
 *   const students = await SMA.getStudents();
 *
 * Firebase SDK v12 is loaded via CDN (compat / global build).
 * Add these two scripts BEFORE this file in every portal's <head>:
 *
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
 *   <script src="sma_backend.js"></script>
 *
 * Firestore collections mirror the old localStorage keys:
 *   users | students | teachers | lesson_plans | lesson_notes | payments |
 *   announcements | settings  | activity | results | assignments |
 *   class_notes   | timetable | fees | notifications | payment_proofs | presence
 */

window.SMA = (() => {

  /* ═══════════ FIREBASE INIT ═══════════ */
  const firebaseConfig = {
    apiKey:            "AIzaSyDo2yotUrC8htCGEhd9cwz_3_oq7N1-ZGo",
    authDomain:        "sma-backend-web.firebaseapp.com",
    projectId:         "sma-backend-web",
    storageBucket:     "sma-backend-web.firebasestorage.app",
    messagingSenderId: "679984502762",
    appId:             "1:679984502762:web:1766f03a215e8255ab8493",
    measurementId:     "G-34H515BZX0",
  };

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  /* ═══════════ FIRESTORE HELPERS ═══════════ */
  // Collection references
  const col = name => db.collection(name);

  // Get a single document as plain JS object (returns null if missing)
  async function getDoc(collection, docId) {
    const snap = await col(collection).doc(docId).get();
    return snap.exists ? snap.data() : null;
  }

  // Set / overwrite a document
  async function setDoc(collection, docId, data) {
    await col(collection).doc(docId).set(data);
    return true;
  }

  // ─── Ordered array documents stored as a single doc ───────────────────────
  // We store arrays (students, teachers, payments, etc.) as a single Firestore
  // document with a field called "items". This keeps the API identical to the
  // old localStorage approach and avoids per-record listener complexity.
  async function loadList(name) {
    const doc = await getDoc('lists', name);
    return doc ? (doc.items || []) : [];
  }
  async function saveList(name, arr) {
    await setDoc('lists', name, { items: arr, updatedAt: new Date().toISOString() });
    return true;
  }

  // Key map (mirrors old KEY constant for readability)
  const KEY = {
    USERS:          'users',
    STUDENTS:       'students',
    TEACHERS:       'teachers',
    LESSON_PLANS:   'lesson_plans',
    LESSON_NOTES:   'lesson_notes',
    PAYMENTS:       'payments',
    ANNOUNCEMENTS:  'announcements',
    SETTINGS:       'settings',
    ACTIVITY:       'activity',
    RESULTS:        'results',
    ASSIGNMENTS:    'assignments',
    CLASS_NOTES:    'class_notes',
    TIMETABLE:      'timetable',
    FEES:           'fees',
    NOTIFICATIONS:  'notifications',
    PAYMENT_PROOFS: 'payment_proofs',
    PRESENCE:       'presence',
  };

  /* ═══════════ SEED DEFAULTS ═══════════ */
  // _seeded: true once Firestore confirms data is present.
  // _seedingPromise: shared Promise while a seed is in-flight, so concurrent
  //   callers await the same operation instead of each launching their own.
  let _seeded = false;
  let _seedingPromise = null;
  async function seedDefaults() {
    if (_seeded) return;
    if (_seedingPromise) return _seedingPromise; // reuse in-flight seed
    _seedingPromise = _doSeed().finally(() => { _seedingPromise = null; });
    return _seedingPromise;
  }
  async function _doSeed() {
    try {
      const users = await getDoc('config', 'users');
      if (users) { _seeded = true; return; } // already seeded in Firestore

      // Admin user — password stored as SHA-256 hash
      const hashedAdminPw = await hashPassword('SMA@Admin2025!');
      await setDoc('config', 'users', {
        admin: { role: 'admin', username: 'admin', password: hashedAdminPw, name: 'Super Admin', email: 'admin@schoolmasters.ng', mustChangePassword: true }
      });

      // Settings
      await setDoc('config', 'settings', {
        schoolName: 'School Masters Academy',
        address:    '12 Academy Road, Lagos, Nigeria',
        session:    '2024/2025',
        term:       'Third Term',
        email:      'admin@schoolmasters.ng',
        phone:      '+234 801 234 5678',
        fees: { Primary: 115000, JSS: 195000, SSS: 195000, ExamFee: 5000, LatePenalty: 2500 }
      });

      // Empty lists
      const emptyLists = [
        KEY.STUDENTS, KEY.TEACHERS, KEY.LESSON_PLANS, KEY.LESSON_NOTES,
        KEY.CLASS_NOTES, KEY.ASSIGNMENTS, KEY.TIMETABLE, KEY.PAYMENTS,
        KEY.ANNOUNCEMENTS, KEY.ACTIVITY, KEY.NOTIFICATIONS,
      ];
      await Promise.all(emptyLists.map(name => saveList(name, [])));

      // Results map
      await setDoc('config', 'results', {});

      // Presence map
      await setDoc('config', 'presence', {});
      _seeded = true;
    } catch(e) {
      console.warn('SMA _doSeed skipped (Firestore may need rules):', e.message || e);
    }
  }

  /* ═══════════ AUTH ═══════════ */
  async function hashPassword(plain) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(plain));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function login(role, username, password) {
    try {
      await seedDefaults();

      if (role === 'admin') {
        const users = await getDoc('config', 'users') || {};
        const u = users[username];
        const hashed = await hashPassword(password);
        const match = u && u.password === hashed;
        if (match && u.role === 'admin') return { ok: true, user: u };
        return { ok: false, msg: 'Invalid admin credentials.' };
      }
      const hashed = await hashPassword(password);
      if (role === 'teacher') {
        const teachers = await loadList(KEY.TEACHERS);
        const t = teachers.find(t => t.username.toLowerCase() === username.toLowerCase() && t.password === hashed);
        if (t) return { ok: true, user: { ...t, role: 'teacher' } };
        return { ok: false, msg: 'Invalid teacher credentials.' };
      }
      if (role === 'student') {
        const students = await loadList(KEY.STUDENTS);
        const s = students.find(s => s.username.toLowerCase() === username.toLowerCase() && s.password === hashed);
        if (s) return { ok: true, user: { ...s, role: 'student' } };
        return { ok: false, msg: 'Invalid student credentials.' };
      }
      return { ok: false, msg: 'Unknown role.' };
    } catch(e) {
      console.error('SMA login error:', e);
      return { ok: false, msg: 'Connection error: ' + (e.message || 'Could not reach database. Check Firestore security rules.') };
    }
  }

  /* ═══════════ STUDENTS ═══════════ */
  async function getStudents() {
    await seedDefaults();
    return loadList(KEY.STUDENTS);
  }
  async function saveStudents(arr) { return saveList(KEY.STUDENTS, arr); }
  async function addStudent(data) {
    const students = await getStudents();
    // Use timestamp + random suffix so IDs stay unique even after deletions.
    // The old length-based prefix caused collisions when a student was removed
    // and a new one was added (e.g. delete #5 → next add also gets STU005_…).
    const id = 'STU_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const section = data.class.startsWith('Primary') ? 'Primary' : data.class.startsWith('JSS') ? 'JSS' : 'SSS';
    const settings = await getSettings();
    const feeDue = settings.fees[section] || (section === 'Primary' ? 115000 : 195000);
    const username = (data.firstName.toLowerCase() + '.' + data.lastName.toLowerCase()).replace(/\s+/g, '');
    const plainPassword = 'sma@' + data.firstName.toLowerCase().replace(/\s+/g, '');
    const password = await hashPassword(plainPassword);
    const student = { id, ...data, username, password, fee: 'Unpaid', feePaid: 0, feeDue, grade: 0, admissionDate: new Date().toISOString().split('T')[0] };
    students.push(student);
    await saveList(KEY.STUDENTS, students);
    await logActivity(`New student registered: ${data.firstName} ${data.lastName} – ${data.class}`, '🎓', 'info');
    return student;
  }
  async function updateStudent(id, data) {
    const students = await getStudents();
    const idx = students.findIndex(s => s.id === id);
    if (idx === -1) return false;
    students[idx] = { ...students[idx], ...data };
    return saveList(KEY.STUDENTS, students);
  }
  async function removeStudent(id) {
    const students = (await getStudents()).filter(s => s.id !== id);
    await logActivity(`Student removed (${id})`, '🗑️', 'danger');
    return saveList(KEY.STUDENTS, students);
  }

  /* ═══════════ TEACHERS ═══════════ */
  async function getTeachers() {
    await seedDefaults();
    return loadList(KEY.TEACHERS);
  }
  async function saveTeachers(arr) { return saveList(KEY.TEACHERS, arr); }
  async function addTeacher(data) {
    const teachers = await getTeachers();
    // Use timestamp + random suffix — same reason as addStudent above.
    const id = 'TCH_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const username = (data.firstName.toLowerCase() + '.' + data.lastName.toLowerCase()).replace(/\s+/g, '');
    const plainPassword = 'sma@' + data.firstName.toLowerCase().replace(/\s+/g, '');
    const password = await hashPassword(plainPassword);
    const teacher = { id, ...data, username, password, status: 'Active' };
    teachers.push(teacher);
    await saveList(KEY.TEACHERS, teachers);
    await logActivity(`Teacher account created: ${data.firstName} ${data.lastName}`, '👩‍🏫', 'purple');
    return teacher;
  }
  async function updateTeacher(id, data) {
    const teachers = await getTeachers();
    const idx = teachers.findIndex(t => t.id === id);
    if (idx === -1) return false;
    teachers[idx] = { ...teachers[idx], ...data };
    return saveList(KEY.TEACHERS, teachers);
  }
  async function removeTeacher(id) {
    const teachers = (await getTeachers()).filter(t => t.id !== id);
    await logActivity(`Teacher removed (${id})`, '🗑️', 'danger');
    return saveList(KEY.TEACHERS, teachers);
  }

  /* ═══════════ LESSON PLANS ═══════════ */
  async function getLessonPlans() {
    await seedDefaults();
    return loadList(KEY.LESSON_PLANS);
  }
  async function addLessonPlan(data) {
    const plans = await getLessonPlans();
    const id = 'LP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const plan = { id, ...data, status: 'Pending', date: new Date().toISOString().split('T')[0] };
    plans.unshift(plan);
    await saveList(KEY.LESSON_PLANS, plans);
    await logActivity(`Lesson plan submitted by ${data.teacher} – ${data.subject}`, '📋', 'warning');
    return plan;
  }
  async function updatePlanStatus(id, status, comment) {
    const plans = await getLessonPlans();
    const idx = plans.findIndex(p => p.id === id);
    if (idx === -1) return false;
    plans[idx].status = status;
    if (comment) plans[idx].adminComment = comment;
    await saveList(KEY.LESSON_PLANS, plans);
    await logActivity(`Lesson plan ${status.toLowerCase()}: ${plans[idx].title}`, status === 'Approved' ? '✅' : '❌', status === 'Approved' ? 'success' : 'danger');
    return true;
  }

  /* ═══════════ LESSON NOTES ═══════════ */
  async function getLessonNotes() {
    await seedDefaults();
    return loadList(KEY.LESSON_NOTES);
  }
  async function addLessonNote(data) {
    const notes = await getLessonNotes();
    const id = 'LN_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const note = { id, ...data, status: 'Pending', date: new Date().toISOString().split('T')[0] };
    notes.unshift(note);
    await saveList(KEY.LESSON_NOTES, notes);
    await logActivity(`Lesson note submitted by ${data.teacher} – ${data.subject}`, '📝', 'info');
    return note;
  }
  async function updateNoteStatus(id, status, comment) {
    const notes = await getLessonNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    notes[idx].status = status;
    if (comment) notes[idx].adminComment = comment;
    await saveList(KEY.LESSON_NOTES, notes);
    return true;
  }

  /* ═══════════ CLASS NOTES ═══════════ */
  async function getClassNotes() {
    await seedDefaults();
    return loadList(KEY.CLASS_NOTES);
  }
  async function addClassNote(data) {
    const notes = await getClassNotes();
    const id = 'CN' + String(notes.length + 1).padStart(3, '0') + '_' + Date.now();
    const note = { id, ...data, date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
    notes.unshift(note);
    await saveList(KEY.CLASS_NOTES, notes);
    await addNotification({
      type: 'class_note', refId: id, targetClass: data.targetClass || null,
      title: `📚 New Class Note: ${data.subject || 'Note'}`,
      summary: (data.content || data.preview || '').substring(0, 160),
      content: data.content || data.preview || '',
      teacher: data.teacher || 'Teacher', subject: data.subject || '', term: data.term || '',
    });
    const classLabel = data.targetClass ? ' – ' + data.targetClass : '';
    await logActivity(`Class note shared by ${data.teacher || 'Teacher'} – ${data.subject || 'Note'}${classLabel}`, '📚', 'info');
    return note;
  }

  /* ═══════════ ASSIGNMENTS ═══════════ */
  async function getAssignments() {
    await seedDefaults();
    return loadList(KEY.ASSIGNMENTS);
  }
  async function saveAssignments(arr) { return saveList(KEY.ASSIGNMENTS, arr); }
  async function removeAssignment(id) {
    const assignments = (await getAssignments()).filter(a => String(a.id) !== String(id));
    return saveList(KEY.ASSIGNMENTS, assignments);
  }
  async function removeClassNote(id) {
    const notes = (await getClassNotes()).filter(n => String(n.id) !== String(id));
    return saveList(KEY.CLASS_NOTES, notes);
  }
  /**
   * cleanupExpiredContent()
   * Removes assignments and class notes whose dueDate has passed (i.e. is before today).
   * Call this on portal load so students never see overdue content.
   * Returns { removedAssignments: number, removedNotes: number }
   */
  async function cleanupExpiredContent() {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of today

    const [assignments, notes] = await Promise.all([getAssignments(), getClassNotes()]);

    const validAssignments = assignments.filter(a => {
      if (!a.dueDate) return true; // no deadline = keep forever
      const due = new Date(a.dueDate);
      due.setHours(0, 0, 0, 0);
      return due >= today; // keep if deadline is today or future
    });

    const validNotes = notes.filter(n => {
      if (!n.dueDate) return true;
      const due = new Date(n.dueDate);
      due.setHours(0, 0, 0, 0);
      return due >= today;
    });

    const removedAssignments = assignments.length - validAssignments.length;
    const removedNotes = notes.length - validNotes.length;

    if (removedAssignments > 0) await saveList(KEY.ASSIGNMENTS, validAssignments);
    if (removedNotes > 0) await saveList(KEY.CLASS_NOTES, validNotes);

    return { removedAssignments, removedNotes };
  }
  async function addAssignment(data) {
    const assignments = await getAssignments();
    const id = 'ASN' + String(assignments.length + 1).padStart(3, '0') + '_' + Date.now();
    const a = { id, ...data, postedDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
    assignments.unshift(a);
    await saveList(KEY.ASSIGNMENTS, assignments);
    await addNotification({
      type: 'assignment', refId: id, targetClass: data.targetClass || null,
      title: `📝 New Assignment: ${data.subject || 'Assignment'}`,
      summary: (data.description || '').substring(0, 160),
      content: data.description || '',
      teacher: data.teacher || 'Teacher', subject: data.subject || '',
      dueDate: data.dueDate || '', term: data.term || '',
    });
    const isClasswork = (data.type || '').toLowerCase() === 'classwork';
    const classLabel = data.targetClass ? ' – ' + data.targetClass : '';
    const dueLabel = data.dueDate ? ' (Due: ' + data.dueDate + ')' : '';
    if (isClasswork) {
      await logActivity(`Classwork set by ${data.teacher || 'Teacher'} – ${data.subject || 'Classwork'}${classLabel}`, '✏️', 'info');
    } else {
      await logActivity(`Assignment posted by ${data.teacher || 'Teacher'} – ${data.subject || 'Assignment'}${classLabel}${dueLabel}`, '📌', 'info');
    }
    return a;
  }

  /* ═══════════ NOTIFICATIONS ═══════════ */
  async function getNotifications() {
    await seedDefaults();
    return loadList(KEY.NOTIFICATIONS);
  }
  async function addNotification(data) {
    const notifs = await getNotifications();
    const id = 'NTF' + Date.now();
    const notif = {
      id, ...data,
      postedDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      postedAt: new Date().toISOString(),
    };
    notifs.unshift(notif);
    if (notifs.length > 200) notifs.pop();
    await saveList(KEY.NOTIFICATIONS, notifs);
    return notif;
  }
  async function getStudentNotifications(studentClass) {
    const notifs = await getNotifications();
    return notifs.filter(n => !n.targetClass || n.targetClass === studentClass);
  }

  /* ═══════════ PAYMENTS ═══════════ */
  async function getPayments() {
    await seedDefaults();
    return loadList(KEY.PAYMENTS);
  }
  async function addPayment(data) {
    const payments = await getPayments();
    const id = 'PAY' + String(payments.length + 1).padStart(3, '0') + '_' + Date.now();
    const ref = 'SMA' + Date.now();
    const { screenshotProof, ...rest } = data;
    // FIX: Always store amount as a whole-number integer (Math.round) to prevent
    // floating-point imprecision from causing the admin portal to show e.g. 99,992
    // instead of 100,000. Any float drift introduced by Number() or upstream
    // arithmetic is eliminated here before the value reaches Firestore.
    const safeAmount = Math.round(Number(rest.amount) || 0);
    const payment = { id, ...rest, amount: safeAmount, ref, date: new Date().toISOString().split('T')[0], status: 'Pending', hasProof: !!screenshotProof };
    payments.unshift(payment);
    await saveList(KEY.PAYMENTS, payments);
    if (screenshotProof) {
      // Store each proof as its own doc to avoid Firestore 1MB single-doc limit
      await setDoc('proofs', id, { data: screenshotProof, paymentId: id });
    }
    await logActivity(`Payment submitted: ${data.student} – ₦${data.amount.toLocaleString()}`, '💳', 'warning');
    return payment;
  }
  async function getPaymentProof(paymentId) {
    const doc = await getDoc('proofs', paymentId);
    return doc ? doc.data : null;
  }
  async function deletePaymentProof(paymentId) {
    await col('proofs').doc(paymentId).delete();
  }
  async function confirmPayment(id) {
    const payments = await getPayments();
    const idx = payments.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const pay = payments[idx];
    if (pay.status === 'Confirmed') return false; // already confirmed — prevent double-crediting
    pay.status = 'Confirmed';
    pay.confirmedDate = new Date().toISOString().split('T')[0];
    await saveList(KEY.PAYMENTS, payments);
    const students = await getStudents();
    const student = students.find(s => s.id === pay.studentId);
    if (student) {
      // FIX: Use Math.round on both operands to eliminate any floating-point
      // imprecision from old records (e.g. amount stored as 99999.9999992).
      // This ensures feePaid is always a clean integer.
      student.feePaid = Math.min(
        Math.round(student.feePaid || 0) + Math.round(pay.amount || 0),
        Math.round(student.feeDue || 0)
      );
      student.fee = student.feePaid >= student.feeDue ? 'Paid' : student.feePaid > 0 ? 'Partial' : 'Unpaid';
      await updateStudent(student.id, student);
    }
    await logActivity(`Fee confirmed: ${pay.student} – ₦${pay.amount.toLocaleString()}`, '✅', 'success');
    return true;
  }
  async function rejectPayment(id) {
    const payments = await getPayments();
    const idx = payments.findIndex(p => p.id === id);
    if (idx === -1) return false;
    payments[idx].status = 'Rejected';
    await saveList(KEY.PAYMENTS, payments);
    await logActivity(`Payment rejected: ${payments[idx].student}`, '❌', 'danger');
    return true;
  }

  /* ═══════════ ANNOUNCEMENTS ═══════════ */
  async function getAnnouncements() {
    await seedDefaults();
    return loadList(KEY.ANNOUNCEMENTS);
  }
  async function addAnnouncement(data) {
    const anns = await getAnnouncements();
    const id = 'ANN' + Date.now();
    const resolvedAuthor = data.author || 'Admin';
    const resolvedSource = data.source || (data.author && data.author !== 'Admin' ? 'teacher' : 'admin');
    const ann = {
      id, ...data,
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      author: resolvedAuthor, source: resolvedSource, postedAt: new Date().toISOString()
    };
    anns.unshift(ann);
    await saveList(KEY.ANNOUNCEMENTS, anns);
    await logActivity(`New announcement posted: ${data.title}`, '📢', 'info');
    return ann;
  }
  async function removeAnnouncement(id) {
    const anns = (await getAnnouncements()).filter(a => a.id !== id);
    return saveList(KEY.ANNOUNCEMENTS, anns);
  }
  async function toggleAnnouncementPin(id) {
    const anns = await getAnnouncements();
    const idx = anns.findIndex(a => a.id === id);
    if (idx === -1) return false;
    anns[idx].pinned = !anns[idx].pinned;
    return saveList(KEY.ANNOUNCEMENTS, anns);
  }

  /* ═══════════ RESULTS ═══════════ */
  // Results are stored per-student in the 'results' collection (one doc per student).
  // This replaces the old single shared-map approach (config/results) which had a
  // read-modify-write race: two concurrent saves would silently overwrite each other.
  async function getResults(studentId) {
    await seedDefaults();
    // Try new per-student collection first, fall back to legacy shared map.
    const perStudent = await getDoc('results', studentId);
    if (perStudent) return perStudent.results || [];
    const legacy = await getDoc('config', 'results') || {};
    return legacy[studentId] || [];
  }
  async function saveResult(studentId, results) {
    // Atomic merge write — no read required, eliminates race condition.
    try {
      await db.collection('results').doc(studentId).set(
        { studentId, results, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) {
      console.error('saveResult failed:', e);
      return false;
    }
  }
  // Returns a flat map { studentId: [results] } across all students.
  // Reads from the per-student 'results' collection (preferred) and merges the
  // legacy config/results map so no data is missed during migration.
  async function getAllResults() {
    await seedDefaults();
    const map = {};
    try {
      // Per-student collection (new)
      const snap = await db.collection('results').get();
      snap.forEach(doc => {
        const data = doc.data();
        if (data.results) map[doc.id] = data.results;
      });
    } catch(e) { console.error('getAllResults (per-student snap):', e); }
    try {
      // Legacy shared map (fallback — include any IDs not already in map)
      const legacy = await getDoc('config', 'results') || {};
      Object.entries(legacy).forEach(([id, res]) => {
        if (!map[id]) map[id] = res;
      });
    } catch(e) { console.error('getAllResults (legacy):', e); }
    return map;
  }
  // Bulk-overwrites the legacy config/results map (used by backup restore).
  async function saveAllResults(allResultsMap) {
    return setDoc('config', 'results', allResultsMap);
  }

  /* ═══════════ SETTINGS ═══════════ */
  async function getSettings() {
    await seedDefaults();
    return (await getDoc('config', 'settings')) || {};
  }
  async function saveSettings(data) {
    return setDoc('config', 'settings', data);
  }

  /* ═══════════ TIMETABLE ═══════════ */
  async function getTimetable() {
    await seedDefaults();
    return loadList(KEY.TIMETABLE);
  }

  /* ═══════════ PROFILE ═══════════ */
  async function getProfile(userId) {
    return (await getDoc('profiles', userId)) || {};
  }
  async function saveProfile(userId, data) {
    return setDoc('profiles', userId, data);
  }
  async function getAvatar(userId) {
    const doc = await getDoc('avatars', userId);
    return doc ? doc.data : null;
  }
  async function saveAvatar(userId, data) {
    return setDoc('avatars', userId, { data });
  }

  /* ═══════════ ADMIN ACCOUNT ═══════════ */
  async function getAdminUser() {
    const users = await getDoc('config', 'users') || {};
    return users['admin'] || null;
  }
  async function updateAdminProfile(data) {
    const users = await getDoc('config', 'users') || {};
    if (!users['admin']) return { ok: false, msg: 'Admin account not found.' };
    const allowed = ['name', 'email', 'phone', 'title'];
    allowed.forEach(k => { if (data[k] !== undefined) users['admin'][k] = data[k]; });
    await setDoc('config', 'users', users);
    await logActivity('Admin profile updated', '👤', 'info');
    return { ok: true, user: users['admin'] };
  }
  async function changeAdminPassword(currentPassword, newPassword) {
    const users = await getDoc('config', 'users') || {};
    const admin = users['admin'];
    if (!admin) return { ok: false, msg: 'Admin account not found.' };
    const hashedCurrent = await hashPassword(currentPassword);
    const currentMatch = admin.password === hashedCurrent;
    if (!currentMatch) return { ok: false, msg: 'Current password is incorrect.' };
    if (!newPassword || newPassword.length < 8) return { ok: false, msg: 'New password must be at least 8 characters.' };
    users['admin'].password = await hashPassword(newPassword);
    users['admin'].mustChangePassword = false;
    await setDoc('config', 'users', users);
    await logActivity('Admin password changed', '🔒', 'warning');
    return { ok: true };
  }

  /* ═══════════ ACTIVITY ═══════════ */
  async function getActivity() {
    await seedDefaults();
    return loadList(KEY.ACTIVITY);
  }
  async function logActivity(msg, icon, type) {
    const act = await getActivity();
    act.unshift({ msg, icon: icon || '📌', type: type || 'info', time: new Date().toISOString() });
    if (act.length > 50) act.pop();
    await saveList(KEY.ACTIVITY, act);
  }

  /* ═══════════ STATS ═══════════ */
  async function getStats() {
    const [students, teachers, plans, notes, payments] = await Promise.all([
      getStudents(), getTeachers(), getLessonPlans(), getLessonNotes(), getPayments()
    ]);
    const paid       = students.filter(s => s.fee === 'Paid').length;
    const partial    = students.filter(s => s.fee === 'Partial').length;
    const unpaid     = students.filter(s => s.fee === 'Unpaid').length;
    const totalCollected = students.reduce((sum, s) => sum + (s.feePaid || 0), 0);
    const totalDue       = students.reduce((sum, s) => sum + (s.feeDue  || 0), 0);
    return {
      totalStudents:   students.length,
      totalTeachers:   teachers.length,
      pendingPlans:    plans.filter(p => p.status === 'Pending').length,
      pendingNotes:    notes.filter(n => n.status === 'Pending').length,
      pendingPayments: payments.filter(p => p.status === 'Pending').length,
      feesPaid: paid, feesPartial: partial, feesUnpaid: unpaid,
      totalCollected, totalDue,
      collectionRate: totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0,
    };
  }

  /* ═══════════ PRESENCE ═══════════ */
  const PRESENCE_TTL = 60000;
  async function getPresence() {
    return (await getDoc('config', 'presence')) || {};
  }
  async function setPresence(role, id, username, name) {
    const p = await getPresence();
    p[id] = { role, id, username, name, lastSeen: Date.now() };
    await setDoc('config', 'presence', p);
  }
  async function clearPresence(id) {
    const p = await getPresence();
    delete p[id];
    await setDoc('config', 'presence', p);
  }
  async function getOnlineUsers() {
    const p = await getPresence();
    const cutoff = Date.now() - PRESENCE_TTL;
    const fresh = {};
    Object.values(p).forEach(u => { if (u.lastSeen >= cutoff) fresh[u.id] = u; });
    if (Object.keys(fresh).length !== Object.keys(p).length) {
      await setDoc('config', 'presence', fresh);
    }
    return Object.values(fresh).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /* ═══════════ ATTENDANCE ═══════════ */
  // Stored as a Firestore document per teacher in the 'attendance' collection.
  // Document ID = teacher username.
  // Shape: { [class_dateKey]: { [studentName]: 'P'|'A'|'L' }, updatedAt: ISO }
  // e.g. { "Primary 3_2025-05-01": { "Adeyemi Blessing": "P", ... } }
  async function getAttendance(teacherUsername) {
    const doc = await getDoc('attendance', teacherUsername);
    return doc ? doc : {};
  }
  async function saveAttendance(teacherUsername, allData) {
    // allData is the entire teacher attendance map
    await db.collection('attendance').doc(teacherUsername).set(
      { ...allData, updatedAt: new Date().toISOString() }
    );
    return true;
  }
  async function getAttendanceRecord(teacherUsername, cls, dateKey) {
    const doc = await getAttendance(teacherUsername);
    const fieldKey = cls.replace(/\s/g, '_') + '_' + dateKey;
    return doc[fieldKey] || {};
  }
  async function saveAttendanceRecord(teacherUsername, cls, dateKey, record) {
    const fieldKey = cls.replace(/\s/g, '_') + '_' + dateKey;
    await db.collection('attendance').doc(teacherUsername).set(
      { [fieldKey]: record, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return true;
  }

  /* ═══════════ SUBMISSION TRACKER ═══════════ */
  // Stored as a Firestore document per teacher in the 'submission_tracker' collection.
  // Document ID = teacher username.
  // Shape: { [contentId]: { [studentName]: 'submitted'|'viewed'|'pending' }, updatedAt: ISO }
  async function getSubmissionTracker(teacherUsername) {
    const doc = await getDoc('submission_tracker', teacherUsername);
    return doc ? doc : {};
  }
  async function saveSubmissionRecord(teacherUsername, contentId, record) {
    await db.collection('submission_tracker').doc(teacherUsername).set(
      { [String(contentId)]: record, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    return true;
  }

  /* ═══════════ ONLINE EXAMS ═══════════ */
  // All teachers' exams are stored in 'online_exams' collection.
  // Each doc ID = teacher username; shape: { items: [...exams], updatedAt }
  // This allows any student to read all published exams across all teachers.

  async function getPublishedExams(studentClass) {
    try {
      const snap = await db.collection('online_exams').get();
      let all = [];
      snap.forEach(doc => {
        const items = doc.data().items || [];
        all = all.concat(items);
      });
      // Filter: active status, matching class (or 'All Classes')
      const now = new Date();
      return all.filter(e => {
        if (e.status !== 'active') return false;
        if (e.class && e.class !== 'All Classes' && e.class !== studentClass) return false;
        return true;
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (err) {
      console.error('getPublishedExams', err);
      return [];
    }
  }

  async function submitExamResult(examId, studentId, resultData) {
    try {
      await db.collection('exam_results').doc(`${examId}_${studentId}`).set({
        ...resultData,
        examId,
        studentId,
        submittedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      console.error('submitExamResult failed:', err.code, err.message, err);
      return false;
    }
  }

  async function getStudentExamResult(examId, studentId) {
    try {
      const snap = await db.collection('exam_results').doc(`${examId}_${studentId}`).get();
      return snap.exists ? snap.data() : null;
    } catch (err) {
      console.error('getStudentExamResult', err);
      return null;
    }
  }

  async function deleteExamResult(examId, studentId) {
    try {
      await db.collection('exam_results').doc(`${examId}_${studentId}`).delete();
      return true;
    } catch (err) {
      console.error('deleteExamResult', err);
      return false;
    }
  }

  // Save exams for a specific teacher into the shared collection
  async function saveTeacherExams(teacherUsername, exams) {
    try {
      await db.collection('online_exams').doc(teacherUsername).set({
        items: exams,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      console.error('saveTeacherExams', err);
      return false;
    }
  }

  async function getTeacherExams(teacherUsername) {
    try {
      const snap = await db.collection('online_exams').doc(teacherUsername).get();
      return snap.exists ? (snap.data().items || []) : [];
    } catch (err) {
      console.error('getTeacherExams', err);
      return [];
    }
  }

  /* ═══════════ SAVE PAYMENTS (backup restore) ═══════════ */
  async function savePayments(arr) { return saveList(KEY.PAYMENTS, arr); }

  /* ═══════════ TIMETABLE (full save) ═══════════ */
  // Stores the timetable grid in config/admin_ui so admin can persist a custom layout.
  async function saveTimetableData(data) {
    try {
      await db.collection('config').doc('admin_ui').set(
        { timetable_v2: data, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) { console.error('saveTimetableData', e); return false; }
  }

  /* ═══════════ BULK SAVE HELPERS (used by backup restore) ═══════════ */
  async function saveLessonPlans(arr)   { return saveList(KEY.LESSON_PLANS,   arr); }
  async function saveLessonNotes(arr)   { return saveList(KEY.LESSON_NOTES,   arr); }
  async function saveAnnouncements(arr) { return saveList(KEY.ANNOUNCEMENTS,  arr); }
  async function saveActivity(arr)      { return saveList(KEY.ACTIVITY,       arr); }
  async function saveNotifications(arr) { return saveList(KEY.NOTIFICATIONS,  arr); }
  async function saveClassNotes(arr)    { return saveList(KEY.CLASS_NOTES,    arr); }

  /* ═══════════ TEACHER RESULT SUBMISSIONS ═══════════ */
  // Each doc ID is auto-generated; shape: { studentId, teacherUsername, results, submittedAt }
  async function getAllResultSubmissions() {
    try {
      const snap = await db.collection('teacher_result_submissions').orderBy('submittedAt', 'desc').get();
      const results = [];
      snap.forEach(doc => results.push({ _docId: doc.id, ...doc.data() }));
      return results;
    } catch(e) { console.error('getAllResultSubmissions', e); return []; }
  }
  async function restoreResultSubmissions(submissions) {
    try {
      const batch = db.batch();
      submissions.forEach(sub => {
        const { _docId, ...data } = sub;
        if (_docId) batch.set(db.collection('teacher_result_submissions').doc(_docId), data);
      });
      await batch.commit();
      return true;
    } catch(e) { console.error('restoreResultSubmissions', e); return false; }
  }

  /* ═══════════ TP EXAM RESULTS ═══════════ */
  // Keyed by teacher username; each doc contains that teacher's exam result records.
  async function getAllTpExamResults() {
    try {
      const snap = await db.collection('tp_exam_results').get();
      const map = {};
      snap.forEach(doc => { map[doc.id] = doc.data(); });
      return map;
    } catch(e) { console.error('getAllTpExamResults', e); return {}; }
  }
  async function restoreTpExamResults(map) {
    try {
      const batch = db.batch();
      Object.entries(map).forEach(([teacherUsername, data]) => {
        batch.set(db.collection('tp_exam_results').doc(teacherUsername), data);
      });
      await batch.commit();
      return true;
    } catch(e) { console.error('restoreTpExamResults', e); return false; }
  }

  /* ═══════════ DISTRIBUTED TIMETABLES ═══════════ */
  // Each doc ID = class name; shape is the teacher's distributed timetable for that class.
  async function getAllDistributedTimetables() {
    try {
      const snap = await db.collection('distributed_timetables').get();
      const map = {};
      snap.forEach(doc => { map[doc.id] = doc.data(); });
      return map;
    } catch(e) { console.error('getAllDistributedTimetables', e); return {}; }
  }
  async function restoreDistributedTimetables(map) {
    try {
      const batch = db.batch();
      Object.entries(map).forEach(([cls, data]) => {
        batch.set(db.collection('distributed_timetables').doc(cls), data);
      });
      await batch.commit();
      return true;
    } catch(e) { console.error('restoreDistributedTimetables', e); return false; }
  }

  /* ═══════════ ALL ATTENDANCE (admin view) ═══════════ */
  // Returns every teacher's attendance map keyed by teacher username.
  // Shape: { teacherUsername: { fieldKey: { studentName: 'P'|'A'|'L' } } }
  async function getAllAttendanceRecords() {
    try {
      const snap = await db.collection('attendance').get();
      const result = {};
      snap.forEach(doc => {
        const data = doc.data();
        const fields = {};
        Object.entries(data).forEach(([k, v]) => {
          if (k !== 'updatedAt' && typeof v === 'object') fields[k] = v;
        });
        result[doc.id] = fields;
      });
      return result;
    } catch(e) { console.error('getAllAttendanceRecords', e); return {}; }
  }

  /* ═══════════ ADMIN UI STATE ═══════════ */
  // Persists per-field admin UI preferences (dark mode, notification read count, etc.)
  // in config/admin_ui using merge writes so fields are independent.
  async function getAdminUIState(field, defaultValue) {
    try {
      const doc = await getDoc('config', 'admin_ui');
      if (!doc || doc[field] === undefined) return defaultValue !== undefined ? defaultValue : null;
      return doc[field];
    } catch(e) { return defaultValue !== undefined ? defaultValue : null; }
  }
  async function setAdminUIState(field, value) {
    try {
      await db.collection('config').doc('admin_ui').set(
        { [field]: value, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) { console.error('setAdminUIState', e); return false; }
  }

  /* ═══════════ STUDENT UI STATE ═══════════ */
  // Persists per-field student UI preferences (notification read list, etc.)
  // in student_ui/<studentId> using merge writes.
  async function getStudentUIState(studentId, field, defaultValue) {
    if (!studentId) return defaultValue !== undefined ? defaultValue : null;
    try {
      const doc = await getDoc('student_ui', studentId);
      if (!doc || doc[field] === undefined) return defaultValue !== undefined ? defaultValue : null;
      return doc[field];
    } catch(e) { return defaultValue !== undefined ? defaultValue : null; }
  }
  async function setStudentUIState(studentId, field, value) {
    if (!studentId) return false;
    try {
      await db.collection('student_ui').doc(studentId).set(
        { [field]: value, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return true;
    } catch(e) { console.error('setStudentUIState', e); return false; }
  }

  /* ═══════════ ALL ONLINE EXAMS (admin view) ═══════════ */
  // Reads all teachers' exams from the shared online_exams collection.
  async function getAllOnlineExams() {
    try {
      const snap = await db.collection('online_exams').get();
      let all = [];
      snap.forEach(doc => { all = all.concat(doc.data().items || []); });
      return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch(e) { console.error('getAllOnlineExams', e); return []; }
  }

  /* ═══════════ ALL EXAM RESULTS (admin view) ═══════════ */
  // Reads all student exam submissions from the shared exam_results collection.
  async function getAllExamResults() {
    try {
      const snap = await db.collection('exam_results').get();
      const results = [];
      snap.forEach(doc => results.push({ _docId: doc.id, ...doc.data() }));
      return results;
    } catch(e) { console.error('getAllExamResults', e); return []; }
  }

  /* ═══════════ INIT ═══════════ */
  seedDefaults(); // fire-and-forget on load — subsequent calls share the in-flight promise

  /* ═══════════ PUBLIC API ═══════════ */
  return {
    login, getAdminUser, updateAdminProfile, changeAdminPassword,
    getStats, getSettings, saveSettings, getTimetable, saveTimetableData,
    getStudents, saveStudents, addStudent, updateStudent, removeStudent,
    getTeachers, saveTeachers, addTeacher, updateTeacher, removeTeacher,
    getLessonPlans, addLessonPlan, updatePlanStatus, saveLessonPlans,
    getLessonNotes, addLessonNote, updateNoteStatus, saveLessonNotes,
    getClassNotes, addClassNote, saveClassNotes,
    getAssignments, saveAssignments, addAssignment, removeAssignment, removeClassNote, cleanupExpiredContent,
    getNotifications, addNotification, getStudentNotifications, saveNotifications,
    getPayments, addPayment, savePayments, confirmPayment, rejectPayment, getPaymentProof, deletePaymentProof,
    getAnnouncements, addAnnouncement, removeAnnouncement, toggleAnnouncementPin, saveAnnouncements,
    getResults, saveResult, getAllResults, saveAllResults,
    getProfile, saveProfile, getAvatar, saveAvatar,
    getActivity, logActivity, saveActivity,
    setPresence, clearPresence, getOnlineUsers,
    getAttendance, saveAttendance, getAttendanceRecord, saveAttendanceRecord, getAllAttendanceRecords,
    getSubmissionTracker, saveSubmissionRecord,
    getPublishedExams, submitExamResult, getStudentExamResult, deleteExamResult,
    saveTeacherExams, getTeacherExams, getAllOnlineExams, getAllExamResults,
    getAllResultSubmissions, restoreResultSubmissions,
    getAllTpExamResults, restoreTpExamResults,
    getAllDistributedTimetables, restoreDistributedTimetables,
    getAdminUIState, setAdminUIState,
    getStudentUIState, setStudentUIState,
    KEY,
  };
})();