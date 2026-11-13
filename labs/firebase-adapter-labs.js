/* firebase-adapter-labs.js - Sistema de Agendamento de Laboratórios
   NÃO EDITE A SENHA NO CÓDIGO: Use o botão "Alterar Usuário / Senha" dentro da janela Admin no site.
*/
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
  var DOC_CRED_PATH = 'agendamento_laboratorios/CREDENCIAIS_ADMIN';
  var SESSION_AUTH_KEY = 'univassouras_labs_admin_session_v3';
  var LOCAL_CRED_BACKUP = 'univassouras_labs_cred_backup_v3';
  var SAFE_STORAGE_KEY = typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'univassouras_lab_monthly_v4';

  var db = null;
  var firebaseReady = false;
  var writeQueue = Promise.resolve();

  // Credencial inicial padrão (pode ser alterada pelo painel do site)
  var adminCredentials = {
    login: 'admin',
    password: '1234'
  };

  function loadLocalCredentialsBackup() {
    try {
      var raw = localStorage.getItem(LOCAL_CRED_BACKUP);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.login && parsed.password) {
          adminCredentials.login = String(parsed.login).trim();
          adminCredentials.password = String(parsed.password).trim();
        }
      }
    } catch (e) {}
  }

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

  function renderAdminModalView(mode) {
    var modal = document.getElementById('adminLoginModal');
    if (!modal) return;
    var box = modal.querySelector('.bg-white');
    if (!box) return;

    if (mode === 'CHANGE_PASS') {
      box.innerHTML =
        '<div class="flex items-center justify-between pb-3 border-b border-slate-200">' +
          '<div class="flex items-center gap-2.5">' +
            '<div class="w-9 h-9 rounded-xl bg-[#7a001e] text-white flex items-center justify-center">' +
              '<i data-lucide="key-round" class="w-4 h-4 text-amber-300"></i>' +
            '</div>' +
            '<div>' +
              '<h3 class="text-base font-black text-[#7a001e]">Alterar Login e Senha</h3>' +
              '<p class="text-[11px] text-slate-500">Salvo online no Firebase</p>' +
            '</div>' +
          '</div>' +
          '<button type="button" onclick="closeAdminLoginModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer">' +
            '<i data-lucide="x" class="w-4 h-4"></i>' +
          '</button>' +
        '</div>' +
        '<form onsubmit="saveNewCredentials(event)" class="mt-4 space-y-3 text-xs">' +
          '<div>' +
            '<label class="block font-bold text-slate-700 mb-1">Senha Atual</label>' +
            '<input type="password" id="currentAdminPassCheck" required placeholder="Digite a senha atual (Padrão: 1234)" ' +
              'class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
          '</div>' +
          '<div>' +
            '<label class="block font-bold text-slate-700 mb-1">Novo Usuário / Login</label>' +
            '<input type="text" id="newCustomLoginInput" required minlength="2" value="' + adminCredentials.login.replace(/"/g, '&quot;') + '" placeholder="Ex: jonas" ' +
              'class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
          '</div>' +
          '<div>' +
            '<label class="block font-bold text-slate-700 mb-1">Nova Senha</label>' +
            '<input type="text" id="newCustomPasswordInput" required minlength="3" placeholder="Digite a nova senha..." ' +
              'class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
          '</div>' +
          '<p id="adminChangeError" class="hidden text-[11px] font-bold text-rose-600"></p>' +
          '<div class="flex items-center justify-between pt-3 border-t border-slate-200">' +
            '<button type="button" onclick="switchAdminModalMode(\'LOGIN\')" class="px-3 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">' +
              '← Voltar' +
            '</button>' +
            '<button type="submit" id="btnSaveCredSubmit" class="px-5 py-2 font-extrabold text-white bg-[#7a001e] hover:bg-[#580015] rounded-xl shadow-sm cursor-pointer">' +
              'Salvar Novo Acesso' +
            '</button>' +
          '</div>' +
        '</form>';
    } else {
      box.innerHTML =
        '<div class="flex items-center justify-between pb-3 border-b border-slate-200">' +
          '<div class="flex items-center gap-2.5">' +
            '<div class="w-9 h-9 rounded-xl bg-[#7a001e] text-white flex items-center justify-center">' +
              '<i data-lucide="lock" class="w-4 h-4 text-amber-300"></i>' +
            '</div>' +
            '<div>' +
              '<h3 class="text-base font-black text-[#7a001e]">Acesso Administrador</h3>' +
              '<p class="text-xs text-slate-500">Entre para liberar agendamentos e edições</p>' +
            '</div>' +
          '</div>' +
          '<button type="button" onclick="closeAdminLoginModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer">' +
            '<i data-lucide="x" class="w-4 h-4"></i>' +
          '</button>' +
        '</div>' +
        '<form onsubmit="verifyAdminPassword(event)" class="mt-4 space-y-3 text-xs">' +
          '<div>' +
            '<label class="block font-bold text-slate-700 mb-1">Usuário / Login</label>' +
            '<input type="text" id="customAdminUser" autocomplete="username" required placeholder="Digite seu usuário (Padrão: admin)" ' +
              'class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
          '</div>' +
          '<div>' +
            '<label class="block font-bold text-slate-700 mb-1">Senha</label>' +
            '<input type="password" id="customAdminPass" autocomplete="current-password" required placeholder="Digite sua senha (Padrão: 1234)" ' +
              'class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">' +
          '</div>' +
          '<p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600"></p>' +
          '<div class="pt-1 flex items-center justify-between">' +
            '<button type="button" onclick="switchAdminModalMode(\'CHANGE_PASS\')" class="text-[11px] font-extrabold text-[#7a001e] hover:underline cursor-pointer">' +
              '🔑 Alterar Usuário / Senha' +
            '</button>' +
          '</div>' +
          '<div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">' +
            '<button type="button" onclick="closeAdminLoginModal()" class="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">' +
              'Cancelar' +
            '</button>' +
            '<button type="submit" class="px-5 py-2 font-extrabold text-white bg-[#7a001e] hover:bg-[#580015] rounded-xl shadow-sm cursor-pointer">' +
              'Entrar como Admin' +
            '</button>' +
          '</div>' +
        '</form>';
    }

    if (typeof refreshIcons === 'function') refreshIcons();
  }

  function ensureHeaderChangePassButton() {
    var adminControls = document.getElementById('adminHeaderControls');
    if (adminControls && !document.getElementById('btnHeaderChangePass')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btnHeaderChangePass';
      btn.onclick = function () {
        renderAdminModalView('CHANGE_PASS');
        document.getElementById('adminLoginModal').classList.remove('hidden');
      };
      btn.className = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-extrabold transition cursor-pointer';
      btn.innerHTML = '<i data-lucide="key-round" class="w-3.5 h-3.5 text-[#7a001e]"></i><span>Login / Senha</span>';
      adminControls.appendChild(btn);
    }
  }

  // Registra imediatamente as funções globais dos botões
  window.switchAdminModalMode = function (mode) {
    renderAdminModalView(mode);
  };

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

    renderAdminModalView('LOGIN');
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

    var matchCustom =
      typedUser.toLowerCase() === adminCredentials.login.toLowerCase() &&
      typedPass === adminCredentials.password;

    if (matchCustom) {
      window.isAdmin = true;
      sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
      window.closeAdminLoginModal();
      ensureHeaderChangePassButton();
      if (typeof updateAdminUI === 'function') updateAdminUI();
      if (typeof renderWorkspace === 'function') renderWorkspace();
      if (typeof notifyToast === 'function') {
        notifyToast('Modo Administrador ativado!');
      }
    } else if (errEl) {
      errEl.textContent = 'Usuário ou senha incorretos.';
      errEl.classList.remove('hidden');
    }
  };

  window.saveNewCredentials = function (event) {
    if (event) event.preventDefault();
    var currPass = (document.getElementById('currentAdminPassCheck').value || '').trim();
    var newLogin = (document.getElementById('newCustomLoginInput').value || '').trim();
    var newPassword = (document.getElementById('newCustomPasswordInput').value || '').trim();
    var errEl = document.getElementById('adminChangeError');

    if (currPass !== adminCredentials.password && !window.isAdmin) {
      if (errEl) {
        errEl.textContent = 'A senha atual digitada está incorreta.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!newLogin || !newPassword) return;

    adminCredentials = {
      login: newLogin,
      password: newPassword
    };
    localStorage.setItem(LOCAL_CRED_BACKUP, JSON.stringify(adminCredentials));

    window.isAdmin = true;
    sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
    ensureHeaderChangePassButton();
    if (typeof updateAdminUI === 'function') updateAdminUI();
    if (typeof renderWorkspace === 'function') renderWorkspace();
    window.closeAdminLoginModal();

    if (db) {
      db.doc(DOC_CRED_PATH).set({
        login: newLogin,
        password: newPassword,
        updatedAt: Date.now()
      }).then(function () {
        if (typeof notifyToast === 'function') {
          notifyToast('Novo login ("' + newLogin + '") e senha salvos no Firebase!');
        }
      }).catch(function () {
        if (typeof notifyToast === 'function') {
          notifyToast('Novo login e senha salvos neste navegador!');
        }
      });
    } else if (typeof notifyToast === 'function') {
      notifyToast('Novo login ("' + newLogin + '") e senha salvos!');
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
    loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
      .then(function () {
        return loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');
      })
      .then(function () {
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.firestore();
        firebaseReady = true;
        setSyncBadge('Sincronizado Online', true);

        // Escuta os agendamentos
        var dataRef = db.doc(DOC_DATA_PATH);
        dataRef.onSnapshot(
          function (snapshot) {
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
            setSyncBadge('Sincronizado Online', true);
            if (typeof buildFilterBar === 'function') buildFilterBar();
            if (typeof renderWorkspace === 'function') renderWorkspace();
          },
          function (err) {
            console.warn('Aviso Firestore dados:', err);
            setSyncBadge('Modo Local (Verifique Regras)', false);
          }
        );

        // Escuta as credenciais salvas no Firebase
        var credRef = db.doc(DOC_CRED_PATH);
        credRef.onSnapshot(
          function (snapshot) {
            if (snapshot.exists) {
              var data = snapshot.data() || {};
              if (data.login && data.password) {
                adminCredentials = {
                  login: String(data.login).trim(),
                  password: String(data.password).trim()
                };
                localStorage.setItem(LOCAL_CRED_BACKUP, JSON.stringify(adminCredentials));
              }
            }
          },
          function () {}
        );
      })
      .catch(function (err) {
        console.error('Erro ao carregar Firebase:', err);
        setSyncBadge('Modo Local', false);
      });
  }

  function bootstrap() {
    loadLocalCredentialsBackup();
    ensureHeaderChangePassButton();

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