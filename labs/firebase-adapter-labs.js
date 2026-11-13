/* firebase-adapter-labs.js para o Sistema de Agendamento de Laboratórios (Maricá & Saquarema)

Sincroniza em tempo real na coleção "agendamento_laboratorios/DADOS_GERAIS" do projeto
salas-univassouras-marica e exige autenticação com a conta de Administrador para criar,
editar, mover, copiar ou excluir agendamentos e cadastros.
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

  const ADMIN_UID = 'RjTmK1rV6ueGsm4xQ8E77WYZSpl2';
  const ADMIN_EMAIL = 'inframaricaunivassouras@gmail.com';
  const FIRESTORE_DOC_PATH = 'agendamento_laboratorios/DADOS_GERAIS';

  let auth = null;
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
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    auth = firebase.auth();
    db = firebase.firestore();
  }

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function errorMessage(error) {
    const code = error && error.code ? error.code : '';
    const messages = {
      'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication.',
      'auth/invalid-credential': 'E-mail ou senha incorretos para esta conta.',
      'auth/wrong-password': 'Senha incorreta para esta conta.',
      'auth/user-not-found': 'Esse e-mail não foi encontrado no Authentication.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde um instante e tente novamente.',
      'permission-denied': 'Permissão negada no Firestore. Publique a regra da coleção agendamento_laboratorios no Console do Firebase.'
    };
    return messages[code] || ('Falha no Firebase (' + (code || 'erro desconhecido') + ').');
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

  function startRealtimeListener() {
    const docRef = db.doc(FIRESTORE_DOC_PATH);

    docRef.onSnapshot(
      snapshot => {
        if (snapshot.exists) {
          const data = snapshot.data() || {};
          if (data.labs) appState.labs = data.labs;
          if (Array.isArray(data.technicians)) appState.technicians = data.technicians;
          if (Array.isArray(data.professors)) appState.professors = data.professors;
          if (data.bookings) appState.bookings = data.bookings;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
        } else if (isAdmin) {
          // Cria o documento inicial com os laboratórios, técnicos e professores da planilha quando o Admin entra pela 1ª vez
          docRef.set(cloneData(appState)).catch(err => console.warn('Aviso ao criar documento inicial:', err));
        }

        firebaseReady = true;
        setSyncBadge(true);
        if (typeof buildFilterBar === 'function') buildFilterBar();
        if (typeof renderWorkspace === 'function') renderWorkspace();
      },
      error => {
        console.error('Erro ao ler agendamento_laboratorios no Firestore:', error);
        setSyncBadge(false);
        if (typeof notifyToast === 'function') {
          notifyToast(errorMessage(error), 'error');
        }
      }
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

  function prepareLoginForm() {
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
            <p class="text-xs text-slate-500">Entre com a conta do Firebase para editar</p>
          </div>
        </div>
        <button type="button" onclick="closeAdminLoginModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form id="firebaseLoginForm" class="mt-4 space-y-3" novalidate>
        <div>
          <label for="firebaseAdminEmail" class="block text-xs font-bold text-slate-700 mb-1">E-mail do administrador</label>
          <input type="email" id="firebaseAdminEmail" autocomplete="username" value="${ADMIN_EMAIL}"
            class="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">
        </div>
        <div>
          <label for="firebaseAdminPassword" class="block text-xs font-bold text-slate-700 mb-1">Senha da conta Firebase</label>
          <input type="password" id="firebaseAdminPassword" autocomplete="current-password" placeholder="Digite a senha"
            class="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-slate-900">
        </div>
        <p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600"></p>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button type="button" onclick="closeAdminLoginModal()" class="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">Cancelar</button>
          <button type="submit" id="firebaseLoginSubmit" class="px-4 py-2 text-xs font-extrabold text-white bg-[#7a001e] hover:bg-[#580015] rounded-xl shadow-sm cursor-pointer">Entrar como Admin</button>
        </div>
      </form>
    `;

    const form = document.getElementById('firebaseLoginForm');
    form.addEventListener('submit', window.verifyAdminPassword);
  }

  function installHandlers() {
    window.handleAdminButtonClick = function () {
      if (isAdmin) {
        auth.signOut().catch(() => notifyToast('Não foi possível sair da conta.', 'error'));
        return;
      }
      prepareLoginForm();
      clearLoginError();
      document.getElementById('adminLoginModal').classList.remove('hidden');
      setTimeout(() => {
        const pw = document.getElementById('firebaseAdminPassword');
        if (pw) pw.focus();
      }, 50);
      if (typeof refreshIcons === 'function') refreshIcons();
    };

    window.closeAdminLoginModal = function () {
      document.getElementById('adminLoginModal').classList.add('hidden');
    };

    window.verifyAdminPassword = async function (event) {
      event.preventDefault();
      clearLoginError();

      const email = document.getElementById('firebaseAdminEmail').value.trim();
      const password = document.getElementById('firebaseAdminPassword').value;
      const submit = document.getElementById('firebaseLoginSubmit');

      if (!email || !password) {
        setLoginError('Preencha o e-mail e a senha.');
        return;
      }
      if (!auth) {
        setLoginError('O Firebase ainda está carregando. Tente novamente em instantes.');
        return;
      }

      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Entrando...';
      }

      try {
        const result = await auth.signInWithEmailAndPassword(email, password);
        if (!result.user || result.user.uid !== ADMIN_UID) {
          await auth.signOut();
          setLoginError('Esta conta não tem permissão de administrador neste site.');
        }
      } catch (error) {
        setLoginError(errorMessage(error));
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'Entrar como Admin';
        }
      }
    };

    window.saveAppState = function () {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));

      if (!firebaseReady || !db) {
        notifyToast('Conectando ao Firebase... tente novamente.', 'error');
        return;
      }
      if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID || !isAdmin) {
        notifyToast('Apenas o administrador pode salvar alterações no Firebase.', 'error');
        return;
      }

      const payload = cloneData(appState);
      writeQueue = writeQueue
        .then(() => db.doc(FIRESTORE_DOC_PATH).set(payload))
        .catch(error => {
          console.error('Erro ao salvar laboratórios no Firestore:', error);
          notifyToast(errorMessage(error), 'error');
        });
    };
  }

  async function start() {
    installHandlers();
    try {
      await initializeFirebase();
      startRealtimeListener();

      auth.onAuthStateChanged(user => {
        isAdmin = Boolean(user && user.uid === ADMIN_UID);
        if (typeof updateAdminUI === 'function') updateAdminUI();
        if (typeof renderWorkspace === 'function') renderWorkspace();

        if (isAdmin) {
          const modal = document.getElementById('adminLoginModal');
          if (modal) modal.classList.add('hidden');
          notifyToast('Modo Administrador ativado! Alterações serão salvas no Firebase.');
        }
      });
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