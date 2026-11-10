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
  const LEGACY_STORAGE_KEYS = {
    NOITE: 'mapa_ensalamento_univassouras_2027_1_oficial_v10',
    MANHA: 'mapa_ensalamento_univassouras_2027_1_manha_integral_v1'
  };

  let auth;
  let db;
  let firebaseReady = false;
  let writeQueue = Promise.resolve();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
        } else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
        }
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(script);
    });
  }

  async function initializeFirebase() {
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js');

    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);

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
    if (!data || !data.CAMPUS_1) return null;

    Object.keys(data).forEach(campusKey => {
      (data[campusKey] || []).forEach(block => {
        (block.rooms || []).forEach(room => {
          if (!room.schedule) room.schedule = {};
          if (!room.pmr) room.pmr = {};

          Object.keys(room.schedule).forEach(day => {
            if (room.schedule[day]) {
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
      return raw ? normalizeDataset(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn(`Não foi possível ler os dados locais de ${shiftKey}.`, error);
      return null;
    }
  }

  async function loadShiftData(isAdminUser) {
    for (const shiftKey of ['NOITE', 'MANHA']) {
      const ref = db.doc(`ensalamento/${shiftKey}`);
      const snapshot = await ref.get();

      if (snapshot.exists) {
        const saved = snapshot.data() || {};
        allShiftsData[shiftKey] =
          normalizeDataset(saved.dataset || saved) || defaultDataset();
        continue;
      }

      const data = readLegacyDataset(shiftKey) || defaultDataset();
      allShiftsData[shiftKey] = data;

      if (isAdminUser) await ref.set(data);
    }

    multiCampusData = allShiftsData[activeShift];
    firebaseReady = true;
  }

  function errorMessage(error) {
    const code = error && error.code ? error.code : '';

    const messages = {
      'auth/unauthorized-domain':
        'Este domínio do site não está autorizado no Firebase. Adicione o domínio do GitHub Pages em Authentication > Configurações > Domínios autorizados.',
      'auth/operation-not-allowed':
        'O login por e-mail e senha está desativado. Ative E-mail/senha nos métodos de login do Firebase Authentication.',
      'auth/invalid-credential':
        'O Firebase recusou as credenciais. Confira o e-mail e a senha da conta cadastrada neste projeto Firebase.',
      'auth/wrong-password':
        'A senha não corresponde a essa conta. Confira se a senha foi alterada para o usuário deste projeto Firebase.',
      'auth/user-not-found':
        'Esse e-mail não foi encontrado no Authentication deste projeto Firebase.',
      'auth/invalid-email':
        'O formato do e-mail está inválido.',
      'auth/too-many-requests':
        'Foram feitas muitas tentativas. Aguarde um pouco e tente novamente.',
      'auth/network-request-failed':
        'Falha de conexão com o Firebase. Confira a internet e tente novamente.',
      'auth/invalid-api-key':
        'A chave do projeto Firebase não foi aceita. Confira a configuração Firebase no arquivo auxiliar.'
    };

    return messages[code] || `Falha no Firebase (${code || 'erro sem código'}). Abra o console do navegador para ver os detalhes.`;
  }

  function setLoginError(message) {
    const element = document.getElementById('adminLoginError');
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function prepareLoginForm() {
    const form = document.querySelector('#adminLoginModal form');
    if (!form) return;

    form.innerHTML = `
      <div class="mt-4 space-y-3">
        <div>
          <label for="firebaseAdminEmail" class="block text-xs font-bold text-stone-700 mb-1">
            E-mail do administrador
          </label>
          <input
            type="email"
            id="firebaseAdminEmail"
            required
            autocomplete="username"
            value="${ADMIN_EMAIL}"
            class="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg
                   focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-stone-900">
        </div>

        <div>
          <label for="firebaseAdminPassword" class="block text-xs font-bold text-stone-700 mb-1">
            Senha da conta Firebase
          </label>
          <input
            type="password"
            id="firebaseAdminPassword"
            required
            autocomplete="current-password"
            placeholder="Digite a senha da conta cadastrada no Firebase"
            class="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg
                   focus:bg-white focus:outline-none focus:border-[#7a001e] font-bold text-stone-900">
        </div>

        <p id="adminLoginError" class="hidden text-[11px] font-bold text-rose-600"></p>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
          <button
            type="button"
            onclick="closeAdminLoginModal()"
            class="px-3 py-1.5 text-xs font-semibold text-stone-500 hover:bg-stone-100 rounded-lg">
            Cancelar
          </button>
          <button
            type="submit"
            class="px-4 py-1.5 text-xs font-bold text-white bg-[#7a001e] hover:bg-[#620018] rounded-lg shadow-sm">
            Entrar como administrador
          </button>
        </div>
      </div>
    `;

    form.removeAttribute('onsubmit');
    form.onsubmit = function (event) {
      return window.verifyAdminPassword(event);
    };
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

      const email = document.getElementById('firebaseAdminEmail');
      const password = document.getElementById('firebaseAdminPassword');
      const error = document.getElementById('adminLoginError');

      if (email) email.value = ADMIN_EMAIL;
      if (password) password.value = '';
      if (error) {
        error.textContent = '';
        error.classList.add('hidden');
      }

      document.getElementById('adminLoginModal').classList.remove('hidden');
      setTimeout(() => password && password.focus(), 50);
      if (typeof safeCreateIcons === 'function') safeCreateIcons();
    };

    window.closeAdminLoginModal = function () {
      document.getElementById('adminLoginModal').classList.add('hidden');
    };

    window.verifyAdminPassword = async function (event) {
      event.preventDefault();

      const email = document.getElementById('firebaseAdminEmail').value.trim();
      const password = document.getElementById('firebaseAdminPassword').value;

      try {
        const result = await auth.signInWithEmailAndPassword(email, password);

        if (!result.user || result.user.uid !== ADMIN_UID) {
          await auth.signOut();
          setLoginError('A conta entrou, mas não tem permissão de administrador neste site.');
        }
      } catch (error) {
        console.error('Erro detalhado de autenticação Firebase:', error);
        setLoginError(errorMessage(error));
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
      if (typeof updateHomeSummaries === 'function') updateHomeSummaries();

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

      writeQueue = writeQueue
        .then(() => db.doc(`ensalamento/${shiftKey}`).set(snapshot))
        .then(() => showToast('Alterações salvas no Firebase.'))
        .catch(error => {
          console.error('Erro ao salvar no Firestore:', error);
          showToast(`Falha ao salvar: ${error.code || 'verifique as regras do Firestore'}.`);
        });
    };

    const oldPasswordButton = document.querySelector(
      '#adminHeaderControls button[onclick="openChangePassModal()"]'
    );
    if (oldPasswordButton) oldPasswordButton.remove();
  }

  async function start() {
    prepareLoginForm();
    installAuthenticationHandlers();

    try {
      await initializeFirebase();

      auth.onAuthStateChanged(async user => {
        const isAdminUser = Boolean(user && user.uid === ADMIN_UID);
        isAdmin = isAdminUser;

        try {
          await loadShiftData(isAdminUser);
          refreshApp();

          if (isAdminUser) {
            const modal = document.getElementById('adminLoginModal');
            if (modal) modal.classList.add('hidden');
            showToast('Administrador conectado. Os mapas serão salvos no Firebase.');
          }
        } catch (error) {
          console.error('Erro ao carregar os mapas do Firestore:', error);
          firebaseReady = false;
          refreshApp();
          showToast(`Falha ao carregar os mapas: ${error.code || 'verifique as regras do Firestore'}.`);
        }
      });
    } catch (error) {
      console.error('Erro ao iniciar Firebase:', error);
      showToast(errorMessage(error));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();