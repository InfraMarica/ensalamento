/* firebase-adapter-labs.js - Versão Final (Login Fixo: tecnicos / @tecnicosmarica) */
(function () {
  'use strict';

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCLpvMrkFDeJp9RWtnliTsVDlcgkIUKwFc',
    authDomain: 'salas-univassouras-marica.firebaseapp.com',
    projectId: 'salas-univassouras-marica',
    storageBucket: 'salas-univassouras-marica.firebasestorage.app',
    messagingSenderId: '881760866715',
    appId: '1:881760866715:web:bc3778b5bca1ec8dfe513e',
    measurementId: 'G-340011RLRW'
  };

  var DOC_DATA_PATH = 'agendamento_laboratorios/DADOS_GERAIS';
  var SAFE_STORAGE_KEY = typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'univassouras_lab_monthly_v4';
  var SESSION_AUTH_KEY = 'univassouras_labs_fixed_auth_v1';

  // Login e Senha fixos
  var FIXED_ADMIN_LOGIN = 'tecnicos';
  var FIXED_ADMIN_PASS = '@tecnicosmarica';

  var db = null;
  var firebaseReady = false;
  var writeQueue = Promise.resolve();

  function setSyncBadge(statusText, isOnline) {
    var badge = document.getElementById('firebaseSyncBadgeHome');
    if (!badge) return;
    if (isOnline) {
      badge.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-300';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> ' + statusText;
    } else {
      badge.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span> ' + statusText;
    }
  }

  function renderFixedLoginModal() {
    var modal = document.getElementById('adminLoginModal');
    if (!modal) return;
    var box = modal.querySelector('.bg-white');
    if (!box) return;

    box.innerHTML =
      '<div class="flex items-center justify-between pb-3 border-b border-slate-200">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-9 h-9 rounded-xl bg-[#7a001e] text-white flex items-center justify-center">' +
            '<i data-lucide="lock" class="w-4 h-4 text-amber-300"></i>' +
          '</div>' +
          '<div>' +
            '<h3 class="text-base font-black text-[#7a001e]">Acesso Restrito</h3>' +
            '<p class="text-xs text-slate-500">Informe suas credenciais para editar</p>' +
          '</div>' +
        '</div>' +
        '<button type="button" onclick="closeAdminLoginModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer">' +
          '<i data-lucide="x" class="w-4 h-4"></i>' +
        '</button>' +
      '</div>' +
      '<form onsubmit="verifyAdminPassword(event)" class="mt-4 space-y-3.5 text-xs">' +
        '<div>' +
          '<label class="block font-bold text-slate-700 mb-1">Login</label>' +
          '<input type="text" id="customAdminUser" autocomplete="username" required placeholder="Digite o usuário" ' +
            'class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
        '</div>' +
        '<div>' +
          '<label class="block font-bold text-slate-700 mb-1">Senha</label>' +
          '<input type="password" id="customAdminPass" autocomplete="current-password" required placeholder="Digite a senha" ' +
            'class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
        '</div>' +
        '<p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600">Usuário ou senha inválidos.</p>' +
        '<div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">' +
          '<button type="button" onclick="closeAdminLoginModal()" class="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">' +
            'Cancelar' +
          '</button>' +
          '<button type="submit" class="px-5 py-2 font-extrabold text-white bg-[#7a001e] hover:bg-[#580015] rounded-xl shadow-sm cursor-pointer">' +
            'Entrar' +
          '</button>' +
        '</div>' +
      '</form>';

    if (typeof refreshIcons === 'function') refreshIcons();
  }

  window.handleAdminButtonClick = function () {
    if (window.isAdmin) {
      window.isAdmin = false;
      sessionStorage.removeItem(SESSION_AUTH_KEY);
      if (typeof updateAdminUI === 'function') updateAdminUI();
      if (typeof renderWorkspace === 'function') renderWorkspace();
      if (typeof notifyToast === 'function') {
        notifyToast('Modo Administrador desconectado. Apenas visualização.');
      }
      return;
    }

    renderFixedLoginModal();
    var modal = document.getElementById('adminLoginModal');
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(function () {
        var inp = document.getElementById('customAdminUser');
        if (inp) inp.focus();
      }, 50);
    }
  };

  window.closeAdminLoginModal = function () {
    var modal = document.getElementById('adminLoginModal');
    if (modal) modal.classList.add('hidden');
  };

  window.verifyAdminPassword = function (event) {
    if (event) event.preventDefault();
    var userEl = document.getElementById('customAdminUser');
    var passEl = document.getElementById('customAdminPass');
    var errEl = document.getElementById('adminLoginError');

    var typedUser = userEl ? userEl.value.trim() : '';
    var typedPass = passEl ? passEl.value.trim() : '';

    if (typedUser.toLowerCase() === FIXED_ADMIN_LOGIN && typedPass === FIXED_ADMIN_PASS) {
      window.isAdmin = true;
      sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
      window.closeAdminLoginModal();
      if (typeof updateAdminUI === 'function') updateAdminUI();
      if (typeof renderWorkspace === 'function') renderWorkspace();
      if (typeof notifyToast === 'function') {
        notifyToast('Modo Administrador ativado!');
      }
    } else if (errEl) {
      errEl.classList.remove('hidden');
    }
  };

  window.saveAppState = function () {
    localStorage.setItem(SAFE_STORAGE_KEY, JSON.stringify(appState));

    if (!window.isAdmin) {
      if (typeof notifyToast === 'function') {
        notifyToast('Apenas o administrador pode salvar alterações.', 'error');
      }
      return;
    }

    if (!firebaseReady || !db) return;

    var payload = JSON.parse(JSON.stringify(appState));
    writeQueue = writeQueue
      .then(function () {
        return db.doc(DOC_DATA_PATH).set(payload);
      })
      .catch(function (error) {
        console.error('Erro ao salvar no Firestore:', error);
      });
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = Array.prototype.slice.call(document.scripts).find(function (s) {
        return s.src === src;
      });
      if (existing) {
        resolve();
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(script);
    });
  }

  function initFirebaseConnection() {
    var safetyTimer = setTimeout(function () {
      if (!firebaseReady) setSyncBadge('Sistema Pronto', true);
    }, 2500);

    var chain = typeof firebase !== 'undefined'
      ? Promise.resolve()
      : loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
          .then(function () {
            return loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');
          });

    chain
      .then(function () {
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.firestore();
        firebaseReady = true;
        setSyncBadge('Sincronizado Online', true);

        var dataRef = db.doc(DOC_DATA_PATH);
        dataRef.onSnapshot(
          function (snapshot) {
            clearTimeout(safetyTimer);
            setSyncBadge('Sincronizado Online', true);
            if (snapshot.exists) {
              var data = snapshot.data() || {};
              if (data.labs) appState.labs = data.labs;
              if (Array.isArray(data.technicians)) appState.technicians = data.technicians;
              if (Array.isArray(data.professors)) appState.professors = data.professors;
              if (data.bookings) appState.bookings = data.bookings;
              localStorage.setItem(SAFE_STORAGE_KEY, JSON.stringify(appState));
            } else {
              dataRef.set(JSON.parse(JSON.stringify(appState))).catch(function () {});
            }
            if (typeof buildFilterBar === 'function') buildFilterBar();
            if (typeof renderWorkspace === 'function') renderWorkspace();
          },
          function (err) {
            clearTimeout(safetyTimer);
            console.warn('Aviso Firestore:', err);
            setSyncBadge('Sistema Pronto', true);
          }
        );
      })
      .catch(function (err) {
        clearTimeout(safetyTimer);
        console.error('Erro ao carregar Firebase:', err);
        setSyncBadge('Sistema Pronto', true);
      });
  }

  function bootstrap() {
    if (sessionStorage.getItem(SESSION_AUTH_KEY) === 'true') {
      window.isAdmin = true;
      if (typeof updateAdminUI === 'function') updateAdminUI();
    }
    initFirebaseConnection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();