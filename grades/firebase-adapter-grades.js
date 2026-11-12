/* firebase-adapter-grades.js para o Portal de Grades Acadêmicas (Maricá & Saquarema)

Salva e sincroniza em tempo real cada curso separadamente na coleção "grades_cursos"
do Firestore (ex: grades_cursos/MARICA_direito, grades_cursos/SAQUAREMA_psicologia) e
as senhas individuais de cada curso em "grades_cursos/SENHAS".
*/
(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCLpvMrkFDeJp9RWtnliTsVDlcgkIUKwFc',
    authDomain: 'salas-univassouras-marica.firebaseapp.com',
    projectId: 'salas-univassouras-marica',
    storageBucket: 'salas-univassouras-marica.firebasestorage.app',
    messagingSenderId: '881760866715',
    appId: '1:881760866715:web:bc3778b5bca1ec8dfe513e',
    measurementId: 'G-340011RLRW'
  };

  const COLLECTION_NAME = 'grades_cursos';

  let db = null;
  let firebaseReady = false;
  let writeQueue = Promise.resolve();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === src);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Falha ao carregar ' + src)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error('Falha ao carregar ' + src));
      document.head.appendChild(script);
    });
  }

  async function initializeFirebase() {
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    db = firebase.firestore();
  }

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function setOnlineBadge(isOnline) {
    const badge = document.getElementById('firebaseStatusBadge');
    if (!badge) return;
    if (isOnline) {
      badge.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Sincronizado Online';
    } else {
      badge.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/20 text-rose-200 border border-rose-400/30';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span> Modo Local';
    }
  }

  function refreshCurrentScreens() {
    if (typeof updateCampusScreenSummaries === 'function') {
      updateCampusScreenSummaries();
    }
    if (activeCampus && !activeCourseId && typeof renderCourseSelectionGrid === 'function') {
      renderCourseSelectionGrid();
    }
    if (activeCampus && activeCourseId && typeof renderCourseSchedule === 'function') {
      renderCourseSchedule();
    }
    if (typeof safeCreateIcons === 'function') {
      safeCreateIcons();
    }
  }

  // Migra dados locais pré-existentes no navegador para o Firestore caso o banco ainda esteja vazio
  async function migrateLocalDataIfNeeded(existingDocIds) {
    const ops = [];

    ['MARICA', 'SAQUAREMA'].forEach(campusKey => {
      const campusObj = appData[campusKey] || {};
      Object.keys(campusObj).forEach(courseId => {
        const docId = `${campusKey}_${courseId}`;
        const courseState = campusObj[courseId];
        const hasLocalContent =
          courseState &&
          ((Array.isArray(courseState.periods) && courseState.periods.length > 0) ||
           (Array.isArray(courseState.classes) && courseState.classes.length > 0));

        if (hasLocalContent && !existingDocIds.has(docId)) {
          ops.push(
            db.doc(`${COLLECTION_NAME}/${docId}`).set({
              campus: campusKey,
              courseId: courseId,
              periods: cloneData(courseState.periods || []),
              classes: cloneData(courseState.classes || []),
              updatedAt: Date.now()
            })
          );
        }
      });
    });

    if (Object.keys(coursePasswords || {}).length > 0 && !existingDocIds.has('SENHAS')) {
      ops.push(
        db.doc(`${COLLECTION_NAME}/SENHAS`).set({
          passwords: cloneData(coursePasswords),
          updatedAt: Date.now()
        })
      );
    }

    if (ops.length > 0) {
      await Promise.all(ops);
    }
  }

  function startRealtimeSync() {
    let initialCheckDone = false;

    db.collection(COLLECTION_NAME).onSnapshot(
      snapshot => {
        const existingDocIds = new Set();

        snapshot.forEach(doc => {
          existingDocIds.add(doc.id);
          const data = doc.data() || {};

          if (doc.id === 'SENHAS') {
            if (data.passwords && typeof data.passwords === 'object') {
              coursePasswords = data.passwords;
              localStorage.setItem(STORAGE_KEY_PASS, JSON.stringify(coursePasswords));
            }
            return;
          }

          const parts = doc.id.split('_');
          const campusKey = parts[0];
          const courseId = parts.slice(1).join('_');

          if ((campusKey === 'MARICA' || campusKey === 'SAQUAREMA') && courseId) {
            if (!appData[campusKey]) appData[campusKey] = {};
            appData[campusKey][courseId] = {
              periods: Array.isArray(data.periods) ? data.periods : [],
              classes: Array.isArray(data.classes) ? data.classes : []
            };
          }
        });

        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(appData));
        firebaseReady = true;
        setOnlineBadge(true);
        refreshCurrentScreens();

        if (!initialCheckDone) {
          initialCheckDone = true;
          migrateLocalDataIfNeeded(existingDocIds).catch(err =>
            console.warn('Aviso ao migrar dados locais iniciais:', err)
          );
        }
      },
      error => {
        console.error('Erro ao sincronizar grades no Firestore:', error);
        setOnlineBadge(false);
        if (typeof showToast === 'function') {
          showToast('Verifique as regras da coleção grades_cursos no Firebase.', 'error');
        }
      }
    );
  }

  function installSaveHandlers() {
    // Sobrescreve saveStateToStorage para gravar no Firestore o curso ativo
    window.saveStateToStorage = function () {
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(appData));
      if (typeof updateCampusScreenSummaries === 'function') {
        updateCampusScreenSummaries();
      }

      if (!firebaseReady || !db || !activeCampus || !activeCourseId) {
        return;
      }

      const campusKey = activeCampus;
      const courseId = activeCourseId;
      const docId = `${campusKey}_${courseId}`;
      const currentCourseData = cloneData(
        (appData[campusKey] && appData[campusKey][courseId]) || { periods: [], classes: [] }
      );

      writeQueue = writeQueue
        .then(() =>
          db.doc(`${COLLECTION_NAME}/${docId}`).set({
            campus: campusKey,
            courseId: courseId,
            periods: currentCourseData.periods || [],
            classes: currentCourseData.classes || [],
            updatedAt: Date.now()
          })
        )
        .catch(error => {
          console.error('Erro ao salvar grade no Firestore:', error);
          if (typeof showToast === 'function') {
            showToast('Falha ao salvar no Firebase: verifique as regras do Firestore.', 'error');
          }
        });
    };

    // Sobrescreve setCoursePassword para gravar a senha exclusiva do curso no Firestore
    window.setCoursePassword = function (campus, courseId, newPass) {
      const key = `${campus}_${courseId}`;
      coursePasswords[key] = newPass;
      localStorage.setItem(STORAGE_KEY_PASS, JSON.stringify(coursePasswords));

      if (!firebaseReady || !db) return;

      const snapshotPasswords = cloneData(coursePasswords);
      writeQueue = writeQueue
        .then(() =>
          db.doc(`${COLLECTION_NAME}/SENHAS`).set({
            passwords: snapshotPasswords,
            updatedAt: Date.now()
          })
        )
        .catch(error => {
          console.error('Erro ao salvar senha do curso no Firestore:', error);
        });
    };
  }

  async function start() {
    installSaveHandlers();
    try {
      await initializeFirebase();
      startRealtimeSync();
    } catch (error) {
      console.error('Erro ao iniciar Firebase nas Grades:', error);
      setOnlineBadge(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();