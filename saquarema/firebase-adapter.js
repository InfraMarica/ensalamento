/* firebase-adapter.js para Saquarema

CONFIGURAÇÃO DAS REGRAS DO FIRESTORE

No Console do Firebase, abra o projeto salas-univassouras-marica:
1. No menu, entre em Firestore Database e abra a aba Regras.
2. Não apague as regras de Maricá. Dentro do bloco
   match /databases/{database}/documents { ... }, acrescente o bloco abaixo,
   antes da chave que fecha esse bloco:
   
   match /ensalamento_saquarema/{turno} {
     allow read: if true;
     allow write: if request.auth != null
       && request.auth.uid == "RjTmK1rV6ueGsm4xQ8E77WYZSpl2";
   }

3. Clique em Publicar.

Essa regra deixa qualquer pessoa visualizar os mapas de Saquarema, mas permite
alterações somente quando a pessoa estiver conectada com a conta Firebase cujo
UID é RjTmK1rV6ueGsm4xQ8E77WYZSpl2.

Não substitua o conjunto inteiro de regras por esse trecho: acrescente apenas
o match de Saquarema dentro do bloco documents existente.

Este adaptador espera que o index.html esteja configurado com os dados iniciais
INITIAL_CAMPUS_1 e INITIAL_CAMPUS_2, sendo CAMPUS_2 o Campus 3 de Saquarema.
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
  const FIRESTORE_COLLECTION = 'ensalamento_saquarema';

  const LEGACY_STORAGE_KEYS = {
    NOITE: 'mapa_ensalamento_univassouras_saquarema_2027_1_noite_v1',
    MANHA: 'mapa_ensalamento_univassouras_saquarema_2027_1_manha_integral_v1'
  };

  let auth = null;
  let db = null;
  let firebaseReady = false;
  let writeQueue = Promise.resolve();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);

      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }

        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener(
          'error',
          () => reject(new Error('Falha ao carregar o Firebase SDK: ' + src)),
          { once: true }
        );
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error('Falha ao carregar o Firebase SDK: ' + src));
      document.head.appendChild(script);
    });
  }

  async function initializeFirebase() {
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');

    if (!window.firebase) {
      throw new Error('O Firebase SDK não foi carregado.');
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    auth = firebase.auth();
    db = firebase.firestore();
  }

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function defaultDataset() {
    return {
      CAMPUS_1: cloneData(INITIAL_CAMPUS_1),
      CAMPUS_2: cloneData(INITIAL_CAMPUS_2)
    };
  }

  function normalizeDataset(data) {
    if (!data || !Array.isArray(data.CAMPUS_1)) return null;

    Object.keys(data).forEach(campusKey => {
      if (!Array.isArray(data[campusKey])) {
        data[campusKey] = [];
      }

      data[campusKey].forEach(block => {
        if (!block || typeof block !== 'object') return;
        if (!Array.isArray(block.rooms)) block.rooms = [];

        block.rooms.forEach(room => {
          if (!room || typeof room !== 'object') return;

          if (!room.schedule || typeof room.schedule !== 'object') {
            room.schedule = {};
          }

          if (!room.pmr || typeof room.pmr !== 'object') {
            room.pmr = {};
          }

          const days = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];

          days.forEach(day => {
            if (typeof room.schedule[day] !== 'string') {
              room.schedule[day] = room.schedule[day] == null
                ? ''
                : String(room.schedule[day]);
            }

            if (typeof room.pmr[day] !== 'boolean') {
              room.pmr[day] = Boolean(room.pmr[day]);
            }

            if (room.schedule[day] && typeof normalizeTurmaText === 'function') {
              room.schedule[day] = normalizeTurmaText(room.schedule[day]);
            }
          });
        });
      });
    });

    return data;
  }

  function readLegacyDataset(shiftKey) {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS[shiftKey]);
      if (!raw) return null;
      return normalizeDataset(JSON.parse(raw));
    } catch (error) {
      console.warn('Não foi possível ler os dados locais de ' + shiftKey + '.', error);
      return null;
    }
  }

  async function loadShiftData(isAdminUser) {
    const shifts = ['NOITE', 'MANHA'];

    for (const shiftKey of shifts) {
      const ref = db.doc(FIRESTORE_COLLECTION + '/' + shiftKey);
      const snapshot = await ref.get();

      if (snapshot.exists) {
        const saved = snapshot.data() || {};
        const dataset = normalizeDataset(saved.dataset || saved);

        allShiftsData[shiftKey] = dataset || defaultDataset();
        continue;
      }

      const legacyData = readLegacyDataset(shiftKey);
      const initialData = legacyData || defaultDataset();

      allShiftsData[shiftKey] = initialData;

      // Cria os documentos iniciais apenas quando o administrador entrar.
      if (isAdminUser) {
        await ref.set(cloneData(initialData));
      }
    }

    multiCampusData = allShiftsData[activeShift];
    firebaseReady = true;
  }

  function errorMessage(error) {
    const code = error && error.code ? error.code : '';

    const messages = {
      'auth/unauthorized-domain':
        'Este endereço do site não está autorizado no Firebase. Adicione o domínio do GitHub Pages em Authentication > Configurações > Domínios autorizados.',
      'auth/operation-not-allowed':
        'O login por e-mail e senha está desativado. Ative E-mail/senha em Authentication > Método de login.',
      'auth/invalid-credential':
        'E-mail ou senha incorretos para esta conta.',
      'auth/wrong-password':
        'Senha incorreta para esta conta.',
      'auth/user-not-found':
        'Esse e-mail não foi encontrado no Authentication deste projeto.',
      'auth/invalid-email':
        'O formato do e-mail está inválido.',
      'auth/too-many-requests':
        'Muitas tentativas de login. Aguarde um pouco e tente novamente.',
      'auth/network-request-failed':
        'Falha de conexão com o Firebase. Confira a internet e tente novamente.',
      'auth/invalid-api-key':
        'A configuração do projeto Firebase não foi aceita.',
      'permission-denied':
        'O Firestore recusou o acesso. Confira as regras da coleção ensalamento_saquarema.',
      'unavailable':
        'O Firebase está temporariamente indisponível. Tente novamente.'
    };

    return messages[code] || ('Falha no Firebase (' + (code || 'erro sem código') + ').');
  }

  function setLoginError(message) {
    const element = document.getElementById('adminLoginError');
    if (!element) return;

    element.textContent = message;
    element.classList.remove('hidden');
  }

  function clearLoginError() {
    const element = document.getElementById('adminLoginError');
    if (!element) return;

    element.textContent = '';
    element.classList.add('hidden');
  }

  function prepareLoginForm() {
    const modal = document.getElementById('adminLoginModal');
    if (!modal) return;

    const box = modal.querySelector('.bg-white');
    if (!box) return;

    box.innerHTML = `
      <div class="flex items-center justify-between pb-3 border-b border-stone-100">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-[#7a001e] text-white flex items-center justify-center">
            <i data-lucide="shield-lock" class="w-4 h-4 text-amber-300"></i>
          </div>
          <div>
            <h3 class="text-base font-black text-[#7a001e]">Acesso Administrador</h3>
            <p class="text-xs text-stone-500">Entre com a conta do Firebase</p>
          </div>
        </div>
        <button type="button" onclick="closeAdminLoginModal()"
          class="text-stone-400 hover:text-stone-600 p-1 rounded-lg hover:bg-stone-100">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <form id="firebaseLoginForm" class="mt-4 space-y-3" novalidate>
        <div>
          <label for="firebaseAdminEmail" class="block text-xs font-bold text-stone-700 mb-1">
            E-mail do administrador
          </label>
          <input type="email" id="firebaseAdminEmail" autocomplete="username"
            value="${ADMIN_EMAIL}"
            class="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg
            focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-stone-900">
        </div>
        <div>
          <label for="firebaseAdminPassword" class="block text-xs font-bold text-stone-700 mb-1">
            Senha da conta Firebase
          </label>
          <input type="password" id="firebaseAdminPassword"
            autocomplete="current-password" placeholder="Digite a senha"
            class="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg
            focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-stone-900">
        </div>
        <p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600"></p>
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
          <button type="button" onclick="closeAdminLoginModal()"
            class="px-3 py-1.5 text-xs font-semibold text-stone-500 hover:bg-stone-100 rounded-lg">
            Cancelar
          </button>
          <button type="submit" id="firebaseLoginSubmit"
            class="px-4 py-1.5 text-xs font-bold text-white bg-[#7a001e]
            hover:bg-[#620018] rounded-lg shadow-sm">
            Entrar como administrador
          </button>
        </div>
      </form>
    `;

    const form = document.getElementById('firebaseLoginForm');
    form.addEventListener('submit', window.verifyAdminPassword);
  }

  function refreshApp() {
    if (typeof updateHomeSummaries === 'function') updateHomeSummaries();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateAdminUI === 'function') updateAdminUI();
    if (typeof updateCampusUI === 'function') updateCampusUI();
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof renderActiveView === 'function') renderActiveView();
    if (typeof safeCreateIcons === 'function') safeCreateIcons();
  }

  function installAuthenticationHandlers() {
    window.handleAdminButtonClick = function () {
      if (isAdmin) {
        auth.signOut().catch(error => {
          console.error('Erro ao sair do Firebase:', error);
          showToast('Não foi possível sair da conta.');
        });
        return;
      }

      prepareLoginForm();
      clearLoginError();

      const modal = document.getElementById('adminLoginModal');
      if (modal) modal.classList.remove('hidden');

      setTimeout(() => {
        const passwordInput = document.getElementById('firebaseAdminPassword');
        if (passwordInput) passwordInput.focus();
      }, 50);

      if (typeof safeCreateIcons === 'function') safeCreateIcons();
    };

    window.closeAdminLoginModal = function () {
      const modal = document.getElementById('adminLoginModal');
      if (modal) modal.classList.add('hidden');
    };

    window.verifyAdminPassword = async function (event) {
      event.preventDefault();
      clearLoginError();

      const emailInput = document.getElementById('firebaseAdminEmail');
      const passwordInput = document.getElementById('firebaseAdminPassword');
      const submitButton = document.getElementById('firebaseLoginSubmit');

      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!email || !password) {
        setLoginError('Preencha o e-mail e a senha.');
        return;
      }

      if (!auth || !firebaseReady) {
        setLoginError('O Firebase ainda está carregando. Tente novamente em instantes.');
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Entrando...';
      }

      try {
        const result = await auth.signInWithEmailAndPassword(email, password);

        if (!result.user || result.user.uid !== ADMIN_UID) {
          await auth.signOut();
          setLoginError('Esta conta não tem permissão de administrador neste site.');
        }
      } catch (error) {
        console.error('Erro detalhado de autenticação Firebase:', error);
        setLoginError(errorMessage(error));
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Entrar como administrador';
        }
      }
    };

    window.openChangePassModal = function () {
      showToast('A senha da conta é gerenciada no Firebase Authentication.');
    };

    window.saveNewAdminPassword = function (event) {
      event.preventDefault();
      showToast('Altere a senha da conta pelo Firebase Authentication.');
    };

    window.saveToStorage = function () {
      allShiftsData[activeShift] = multiCampusData;

      if (typeof updateHomeSummaries === 'function') {
        updateHomeSummaries();
      }

      if (!firebaseReady || !db) {
        showToast('O Firebase ainda está carregando. Tente novamente.');
        return;
      }

      if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID || !isAdmin) {
        showToast('Entre com a conta de administrador para salvar alterações.');
        return;
      }

      const shiftKey = activeShift;
      const snapshot = cloneData(multiCampusData);
      const documentRef = db.doc(FIRESTORE_COLLECTION + '/' + shiftKey);

      writeQueue = writeQueue
        .then(() => documentRef.set(snapshot))
        .then(() => showToast('Alterações de Saquarema salvas no Firebase.'))
        .catch(error => {
          console.error('Erro ao salvar no Firestore:', error);
          showToast('Falha ao salvar: ' + errorMessage(error));
        });
    };

    const oldPasswordButton = document.querySelector(
      '#adminHeaderControls button[onclick="openChangePassModal()"]'
    );

    if (oldPasswordButton) {
      oldPasswordButton.remove();
    }
  }

  async function start() {
    installAuthenticationHandlers();

    try {
      await initializeFirebase();

      auth.onAuthStateChanged(async user => {
        const isAdminUser = Boolean(user && user.uid === ADMIN_UID);
        isAdmin = isAdminUser;
        firebaseReady = false;

        try {
          await loadShiftData(isAdminUser);
          refreshApp();

          if (isAdminUser) {
            const modal = document.getElementById('adminLoginModal');
            if (modal) modal.classList.add('hidden');
            showToast('Administrador conectado. Saquarema será salvo separadamente no Firebase.');
          }
        } catch (error) {
          console.error('Erro ao carregar os mapas de Saquarema:', error);
          firebaseReady = false;
          refreshApp();
          showToast('Falha ao carregar Saquarema: ' + errorMessage(error));
        }
      });
    } catch (error) {
      console.error('Erro ao iniciar o Firebase:', error);
      showToast(errorMessage(error));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();