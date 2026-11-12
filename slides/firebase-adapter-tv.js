/* firebase-adapter-tv.js para o Painel Digital de Slides (Maricá & Saquarema)

CONFIGURAÇÃO DAS REGRAS DO FIRESTORE:
No Console do Firebase (projeto salas-univassouras-marica), em Firestore Database > Regras,
dentro de match /databases/{database}/documents { ... }, acrescente:

  match /ensalamento_tv/{docId} {
    allow read: if true;
    allow write: if request.auth != null
      && request.auth.uid == "RjTmK1rV6ueGsm4xQ8E77WYZSpl2";
  }

Este adaptador:
1. Lê em tempo real os mapas de Maricá (coleção "ensalamento") e de Saquarema (coleção "ensalamento_saquarema") SEM nunca alterar nem gravar nada neles.
2. Salva os nomes dos professores e horários de início (ex: 17h) separadamente na coleção "ensalamento_tv".
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

  const COLLECTIONS = {
    MARICA: 'ensalamento',
    SAQUAREMA: 'ensalamento_saquarema',
    TV_META: 'ensalamento_tv'
  };

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
      'permission-denied': 'Permissão negada no Firestore. Adicione a regra da coleção ensalamento_tv no Console do Firebase.'
    };
    return messages[code] || ('Falha no Firebase (' + (code || 'erro desconhecido') + ').');
  }

  function startRealtimeListeners() {
    const shifts = ['NOITE', 'MANHA'];

    // 1. Escuta em tempo real o Ensalamento de Maricá (Somente Leitura)
    shifts.forEach(shiftKey => {
      db.doc(COLLECTIONS.MARICA + '/' + shiftKey).onSnapshot(snapshot => {
        if (snapshot.exists) {
          const saved = snapshot.data() || {};
          ensalamentoCloudData.MARICA[shiftKey] = saved.dataset || saved;
          if (activeUnit === 'MARICA' && activeShift === shiftKey) {
            refreshTvBoard();
          }
        }
      }, err => console.warn('Aviso ao ler Maricá (' + shiftKey + '):', err));
    });

    // 2. Escuta em tempo real o Ensalamento de Saquarema (Somente Leitura)
    shifts.forEach(shiftKey => {
      db.doc(COLLECTIONS.SAQUAREMA + '/' + shiftKey).onSnapshot(snapshot => {
        if (snapshot.exists) {
          const saved = snapshot.data() || {};
          ensalamentoCloudData.SAQUAREMA[shiftKey] = saved.dataset || saved;
          if (activeUnit === 'SAQUAREMA' && activeShift === shiftKey) {
            refreshTvBoard();
          }
        }
      }, err => console.warn('Aviso ao ler Saquarema (' + shiftKey + '):', err));
    });

    // 3. Escuta em tempo real as edições de Professores e Horários da TV
    ['MARICA_NOITE', 'MARICA_MANHA', 'SAQUAREMA_NOITE', 'SAQUAREMA_MANHA'].forEach(docKey => {
      db.doc(COLLECTIONS.TV_META + '/' + docKey).onSnapshot(snapshot => {
        if (snapshot.exists) {
          const data = snapshot.data() || {};
          tvOverridesData[docKey] = {
            items: data.items || {},
            extras: Array.isArray(data.extras) ? data.extras : []
          };
          if (getDocKey() === docKey) {
            refreshTvBoard();
          }
        }
      }, err => console.warn('Aviso ao ler complementos da TV (' + docKey + '):', err));
    });

    firebaseReady = true;
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
      <div class="flex items-center justify-between pb-3 border-b border-stone-100">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-[#7c1d24] text-white flex items-center justify-center">
            <i data-lucide="shield-lock" class="w-4 h-4 text-amber-300"></i>
          </div>
          <div>
            <h3 class="text-base font-black text-[#7c1d24]">Acesso Administrador TV</h3>
            <p class="text-xs text-stone-500">Entre com a conta do Firebase</p>
          </div>
        </div>
        <button type="button" onclick="closeAdminLoginModal()" class="text-stone-400 hover:text-stone-600 p-1 rounded-lg hover:bg-stone-100">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form id="firebaseLoginForm" class="mt-4 space-y-3" novalidate>
        <div>
          <label for="firebaseAdminEmail" class="block text-xs font-bold text-stone-700 mb-1">E-mail do administrador</label>
          <input type="email" id="firebaseAdminEmail" autocomplete="username" value="${ADMIN_EMAIL}"
            class="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#7c1d24] font-bold text-stone-900">
        </div>
        <div>
          <label for="firebaseAdminPassword" class="block text-xs font-bold text-stone-700 mb-1">Senha da conta Firebase</label>
          <input type="password" id="firebaseAdminPassword" autocomplete="current-password" placeholder="Digite a senha"
            class="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#7c1d24] font-bold text-stone-900">
        </div>
        <p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600"></p>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
          <button type="button" onclick="closeAdminLoginModal()" class="px-3 py-1.5 text-xs font-semibold text-stone-500 hover:bg-stone-100 rounded-lg">Cancelar</button>
          <button type="submit" id="firebaseLoginSubmit" class="px-4 py-1.5 text-xs font-bold text-white bg-[#7c1d24] hover:bg-[#5e1319] rounded-lg shadow-sm">Entrar como administrador</button>
        </div>
      </form>
    `;

    const form = document.getElementById('firebaseLoginForm');
    form.addEventListener('submit', window.verifyAdminPassword);
  }

  function installHandlers() {
    window.handleAdminButtonClick = function () {
      if (isAdmin) {
        auth.signOut().catch(() => showToast('Não foi possível sair da conta.'));
        return;
      }
      prepareLoginForm();
      clearLoginError();
      document.getElementById('adminLoginModal').classList.remove('hidden');
      setTimeout(() => {
        const pw = document.getElementById('firebaseAdminPassword');
        if (pw) pw.focus();
      }, 50);
      if (typeof safeCreateIcons === 'function') safeCreateIcons();
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
        setLoginError('O Firebase ainda está carregando.');
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
          setLoginError('Esta conta não tem permissão de administrador.');
        }
      } catch (error) {
        setLoginError(errorMessage(error));
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'Entrar como administrador';
        }
      }
    };

    // Salva apenas os professores e horários de início na coleção "ensalamento_tv"
    window.saveTvDataToStorage = function () {
      if (!firebaseReady || !db) {
        showToast('O Firebase ainda está conectando...');
        return;
      }
      if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID || !isAdmin) {
        showToast('Entre como administrador para salvar no Firebase.');
        return;
      }

      const docKey = getDocKey();
      const payload = cloneData(getActiveTvOverrides());

      writeQueue = writeQueue
        .then(() => db.doc(COLLECTIONS.TV_META + '/' + docKey).set(payload))
        .then(() => showToast('Professor e horário salvos online no Firebase!'))
        .catch(error => {
          console.error('Erro ao salvar complemento da TV:', error);
          showToast(errorMessage(error));
        });
    };
  }

  async function start() {
    installHandlers();
    try {
      await initializeFirebase();
      startRealtimeListeners();

      auth.onAuthStateChanged(user => {
        isAdmin = Boolean(user && user.uid === ADMIN_UID);
        refreshTvBoard();
        if (isAdmin) {
          const modal = document.getElementById('adminLoginModal');
          if (modal) modal.classList.add('hidden');
          showToast('Modo Admin ativo: clique em qualquer turma para definir professor e horário.');
        }
      });
    } catch (error) {
      console.error('Erro ao iniciar Firebase TV:', error);
      showToast(errorMessage(error));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();