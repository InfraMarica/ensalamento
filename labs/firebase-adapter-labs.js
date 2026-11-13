/* firebase-adapter-labs.js para o Sistema de Agendamento de Laboratórios (Maricá & Saquarema)

- Sincroniza em tempo real os agendamentos, alertas, laboratórios, técnicos e professores
  em "agendamento_laboratorios/DADOS_GERAIS" no projeto salas-univassouras-marica.
- Sistema próprio de Login e Senha customizáveis salvos online no Firebase em
  "agendamento_laboratorios/CREDENCIAIS_ADMIN" (Padrão inicial: Login "admin" | Senha "1234").
- Quem não tem a senha permanece apenas em modo de visualização.
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

  const DOC_DATA_PATH = 'agendamento_laboratorios/DADOS_GERAIS';
  const DOC_CRED_PATH = 'agendamento_laboratorios/CREDENCIAIS_ADMIN';
  const SESSION_AUTH_KEY = 'univassouras_labs_admin_session_v1';
  const LOCAL_CRED_BACKUP = 'univassouras_labs_cred_backup_v1';

  let db = null;
  let firebaseReady = false;
  let writeQueue = Promise.resolve();

  // Credenciais padrão caso ainda não tenham sido alteradas no Firebase
  let adminCredentials = {
    login: 'admin',
    password: '1234'
  };

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

  function loadLocalCredentialsBackup() {
    try {
      const raw = localStorage.getItem(LOCAL_CRED_BACKUP);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.login && parsed.password) {
          adminCredentials = {
            login: String(parsed.login).trim(),
            password: String(parsed.password).trim()
          };
        }
      }
    } catch (e) {}
  }

  function setSyncBadge(isOnline) {
    const badge = document.getElementById('firebaseSyncBadgeHome');
    if (!badge) return;
    if (isOnline) {
      badge.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-300';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Sincronizado Online';
    } else {
      badge.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-300';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span> Modo Local';
    }
  }

  // Injeta o botão "Login / Senha" na barra do Admin e cria o modal para cadastrar novo Login/Senha
  function injectAdminCredentialControls() {
    const adminControls = document.getElementById('adminHeaderControls');
    if (adminControls && !document.getElementById('btnOpenChangeCredModal')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btnOpenChangeCredModal';
      btn.onclick = () => window.openChangeCredentialsModal();
      btn.className = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-extrabold transition cursor-pointer';
      btn.title = 'Alterar Login e Senha do Administrador';
      btn.innerHTML = '<i data-lucide="key-round" class="w-3.5 h-3.5 text-[#7a001e]"></i><span>Login / Senha</span>';
      adminControls.appendChild(btn);
    }

    if (!document.getElementById('changeCredentialsModal')) {
      const modalWrapper = document.createElement('div');
      modalWrapper.id = 'changeCredentialsModal';
      modalWrapper.className = 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs hidden flex items-center justify-center p-4';
      modalWrapper.innerHTML = `
        <div class="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border-2 border-slate-300">
          <div class="flex items-center justify-between pb-3 border-b border-slate-200">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-[#7a001e] text-white flex items-center justify-center">
                <i data-lucide="key-round" class="w-4 h-4 text-amber-300"></i>
              </div>
              <div>
                <h3 class="text-base font-black text-[#7a001e]">Cadastrar Login e Senha</h3>
                <p class="text-[11px] text-slate-500">Salvo e sincronizado online no Firebase</p>
              </div>
            </div>
            <button type="button" onclick="closeChangeCredentialsModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer">
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>

          <form id="changeCredentialsForm" class="mt-4 space-y-3.5 text-xs">
            <div>
              <label class="block font-bold text-slate-700 mb-1">Novo Usuário / Login</label>
              <input type="text" id="newCustomLoginInput" required minlength="2" placeholder="Ex: jonas ou admin"
                class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">Nova Senha</label>
              <div class="relative">
                <input type="text" id="newCustomPasswordInput" required minlength="3" placeholder="Digite a nova senha..."
                  class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onclick="closeChangeCredentialsModal()" class="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">
                Cancelar
              </button>
              <button type="submit" class="px-5 py-2 font-extrabold text-white bg-[#7a001e] hover:bg-[#580015] rounded-xl shadow-sm cursor-pointer">
                Salvar no Firebase
              </button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modalWrapper);

      document.getElementById('changeCredentialsForm').addEventListener('submit', window.saveNewCredentials);
    }
  }

  function startRealtimeListeners() {
    // 1. Escuta em tempo real os Agendamentos, Laboratórios, Técnicos e Professores
    const dataRef = db.doc(DOC_DATA_PATH);
    dataRef.onSnapshot(
      snapshot => {
        if (snapshot.exists) {
          const data = snapshot.data() || {};
          if (data.labs) appState.labs = data.labs;
          if (Array.isArray(data.technicians)) appState.technicians = data.technicians;
          if (Array.isArray(data.professors)) appState.professors = data.professors;
          if (data.bookings) appState.bookings = data.bookings;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
        } else {
          // Inicializa o documento no Firestore caso ainda não exista
          dataRef.set(cloneData(appState)).catch(err => console.warn('Aviso ao inicializar dados:', err));
        }

        firebaseReady = true;
        setSyncBadge(true);
        if (typeof buildFilterBar === 'function') buildFilterBar();
        if (typeof renderWorkspace === 'function') renderWorkspace();
      },
      error => {
        console.error('Erro ao ler dados de laboratórios no Firestore:', error);
        setSyncBadge(false);
        if (typeof notifyToast === 'function') {
          notifyToast('Publique a regra de agendamento_laboratorios no Console do Firebase.', 'error');
        }
      }
    );

    // 2. Escuta em tempo real o Login e a Senha personalizados salvos no Firebase
    const credRef = db.doc(DOC_CRED_PATH);
    credRef.onSnapshot(
      snapshot => {
        if (snapshot.exists) {
          const data = snapshot.data() || {};
          if (data.login && data.password) {
            adminCredentials = {
              login: String(data.login).trim(),
              password: String(data.password).trim()
            };
            localStorage.setItem(LOCAL_CRED_BACKUP, JSON.stringify(adminCredentials));
          }
        } else {
          // Salva a credencial inicial padrão (admin / 1234) se o documento ainda não existir
          credRef.set({
            login: adminCredentials.login,
            password: adminCredentials.password,
            updatedAt: Date.now()
          }).catch(() => {});
        }
      },
      err => console.warn('Aviso ao sincronizar credenciais:', err)
    );
  }

  function setLoginError(message) {
    const el = document.getElementById('adminLoginError');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function clearLoginError() {
    const el = document.getElementById('adminLoginError');
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

  function prepareCustomLoginForm() {
    const modal = document.getElementById('adminLoginModal');
    if (!modal) return;
    const box = modal.querySelector('.bg-white');
    if (!box) return;

    box.innerHTML = `
      <div class="flex items-center justify-between pb-3 border-b border-slate-200">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl bg-[#7a001e] text-white flex items-center justify-center">
            <i data-lucide="shield-lock" class="w-4 h-4 text-amber-300"></i>
          </div>
          <div>
            <h3 class="text-base font-black text-[#7a001e]">Acesso Administrador</h3>
            <p class="text-xs text-slate-500">Digite seu login e senha para liberar edições</p>
          </div>
        </div>
        <button type="button" onclick="closeAdminLoginModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <form id="customAdminLoginForm" class="mt-4 space-y-3" novalidate>
        <div>
          <label for="customAdminUser" class="block text-xs font-bold text-slate-700 mb-1">Usuário / Login</label>
          <input type="text" id="customAdminUser" autocomplete="username" required placeholder="Digite o login (Padrão: admin)"
            class="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">
        </div>
        <div>
          <label for="customAdminPass" class="block text-xs font-bold text-slate-700 mb-1">Senha</label>
          <input type="password" id="customAdminPass" autocomplete="current-password" required placeholder="Digite a senha (Padrão: 1234)"
            class="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">
        </div>
        <p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600"></p>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button type="button" onclick="closeAdminLoginModal()" class="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">
            Cancelar
          </button>
          <button type="submit" class="px-5 py-2 text-xs font-extrabold text-white bg-[#7a001e] hover:bg-[#580015] rounded-xl shadow-sm cursor-pointer">
            Desbloquear Edição
          </button>
        </div>
      </form>
    `;

    const form = document.getElementById('customAdminLoginForm');
    form.addEventListener('submit', window.verifyAdminPassword);
  }

  function installHandlers() {
    window.handleAdminButtonClick = function () {
      if (isAdmin) {
        isAdmin = false;
        sessionStorage.removeItem(SESSION_AUTH_KEY);
        if (typeof updateAdminUI === 'function') updateAdminUI();
        if (typeof renderWorkspace === 'function') renderWorkspace();
        if (typeof notifyToast === 'function') {
          notifyToast('Modo Administrador bloqueado. Apenas visualização.');
        }
        return;
      }

      prepareCustomLoginForm();
      clearLoginError();
      document.getElementById('adminLoginModal').classList.remove('hidden');
      setTimeout(() => {
        const userInp = document.getElementById('customAdminUser');
        if (userInp) userInp.focus();
      }, 50);
      if (typeof refreshIcons === 'function') refreshIcons();
    };

    window.closeAdminLoginModal = function () {
      document.getElementById('adminLoginModal').classList.add('hidden');
    };

    window.verifyAdminPassword = function (event) {
      event.preventDefault();
      clearLoginError();

      const typedUser = (document.getElementById('customAdminUser').value || '').trim();
      const typedPass = (document.getElementById('customAdminPass').value || '').trim();

      if (!typedUser || !typedPass) {
        setLoginError('Preencha o login e a senha.');
        return;
      }

      const validUser = typedUser.toLowerCase() === adminCredentials.login.toLowerCase();
      const validPass = typedPass === adminCredentials.password;

      if (validUser && validPass) {
        isAdmin = true;
        sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
        window.closeAdminLoginModal();
        injectAdminCredentialControls();
        if (typeof updateAdminUI === 'function') updateAdminUI();
        if (typeof renderWorkspace === 'function') renderWorkspace();
        if (typeof refreshIcons === 'function') refreshIcons();
        if (typeof notifyToast === 'function') {
          notifyToast('Modo Administrador ativado!');
        }
      } else {
        setLoginError('Login ou senha incorretos. Tente novamente.');
      }
    };

    window.openChangeCredentialsModal = function () {
      if (!isAdmin) return;
      injectAdminCredentialControls();
      document.getElementById('newCustomLoginInput').value = adminCredentials.login;
      document.getElementById('newCustomPasswordInput').value = adminCredentials.password;
      document.getElementById('changeCredentialsModal').classList.remove('hidden');
      setTimeout(() => document.getElementById('newCustomLoginInput').focus(), 50);
      if (typeof refreshIcons === 'function') refreshIcons();
    };

    window.closeChangeCredentialsModal = function () {
      const modal = document.getElementById('changeCredentialsModal');
      if (modal) modal.classList.add('hidden');
    };

    window.saveNewCredentials = function (event) {
      event.preventDefault();
      if (!isAdmin) return;

      const newLogin = (document.getElementById('newCustomLoginInput').value || '').trim();
      const newPassword = (document.getElementById('newCustomPasswordInput').value || '').trim();

      if (!newLogin || !newPassword) return;

      adminCredentials = {
        login: newLogin,
        password: newPassword
      };
      localStorage.setItem(LOCAL_CRED_BACKUP, JSON.stringify(adminCredentials));
      window.closeChangeCredentialsModal();

      if (!firebaseReady || !db) {
        if (typeof notifyToast === 'function') {
          notifyToast('Login e senha salvos localmente (aguardando conexão com Firebase).');
        }
        return;
      }

      writeQueue = writeQueue
        .then(() =>
          db.doc(DOC_CRED_PATH).set({
            login: newLogin,
            password: newPassword,
            updatedAt: Date.now()
          })
        )
        .then(() => {
          if (typeof notifyToast === 'function') {
            notifyToast(`Novo login ("${newLogin}") e senha salvos online no Firebase!`);
          }
        })
        .catch(error => {
          console.error('Erro ao salvar novas credenciais no Firestore:', error);
          if (typeof notifyToast === 'function') {
            notifyToast('Erro ao salvar senha no Firebase. Verifique as regras do Firestore.', 'error');
          }
        });
    };

    window.saveAppState = function () {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));

      if (!firebaseReady || !db) {
        if (typeof notifyToast === 'function') {
          notifyToast('Conectando ao Firebase... tente novamente em instantes.', 'error');
        }
        return;
      }

      if (!isAdmin) {
        if (typeof notifyToast === 'function') {
          notifyToast('Apenas o administrador pode salvar alterações.', 'error');
        }
        return;
      }

      const payload = cloneData(appState);
      writeQueue = writeQueue
        .then(() => db.doc(DOC_DATA_PATH).set(payload))
        .catch(error => {
          console.error('Erro ao salvar laboratórios no Firestore:', error);
          if (typeof notifyToast === 'function') {
            notifyToast('Falha ao salvar no Firebase. Verifique as regras do Firestore.', 'error');
          }
        });
    };
  }

  async function start() {
    loadLocalCredentialsBackup();
    injectAdminCredentialControls();
    installHandlers();

    // Restaura sessão se o admin já estava logado nesta aba
    if (sessionStorage.getItem(SESSION_AUTH_KEY) === 'true') {
      isAdmin = true;
      if (typeof updateAdminUI === 'function') updateAdminUI();
    }

    try {
      await initializeFirebase();
      startRealtimeListeners();
    } catch (error) {
      console.error('Erro ao iniciar Firebase nos Laboratórios:', error);
      setSyncBadge(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();