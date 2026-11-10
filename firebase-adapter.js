/* Integração Firebase para o Portal de Ensalamento
   Salve este arquivo como firebase-adapter.js, na mesma pasta do index.html.
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
  const LEGACY_STORAGE_KEYS = {
    NOITE: 'mapa_ensalamento_univassouras_2027_1_oficial_v10',
    MANHA: 'mapa_ensalamento_univassouras_2027_1_manha_integral_v1'
  };

  let auth = null;
  let db = null;
  let firebaseReady = false;
  let firebaseWriteQueue = Promise.resolve();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadFirebaseSDK() {
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

  function createDefaultDataset() {
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

  function loadLegacyDataset(shiftKey) {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEYS[shiftKey]);
      if (!raw) return null;
      return normalizeDataset(JSON.parse(raw));
    } catch (error) {
      console.warn(`Não foi possível ler os dados locais do turno ${shiftKey}.`, error);
      return null;
    }
  }

  async function loadAllShiftData(isAuthorizedAdmin) {
    for (const shiftKey of ['NOITE', 'MANHA']) {
      const ref = db.doc(`ensalamento/${shiftKey}`);
      const snapshot = await ref.get();

      if (snapshot.exists) {
        const saved = snapshot.data() || {};
        allShiftsData[shiftKey] = normalizeDataset(saved.dataset || saved) || createDefaultDataset();
        continue;
      }

      // Se ainda não há dados na nuvem, aproveita os dados locais deste navegador.
      const data = loadLegacyDataset(shiftKey) || createDefaultDataset();
      allShiftsData[shiftKey] = data;

      // Somente o administrador autenticado pode criar os documentos iniciais.
      if (isAuthorizedAdmin) {
        await ref.set(data);
      }
    }

    multiCampusData = allShiftsData[activeShift];
    firebaseReady = true;
  }

  function setLoginError(message) {
    const errorElement = document.getElementById('adminLoginError');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.remove('hidden');
    }
  }

  function prepareFirebaseLoginForm() {
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
            value="inframaricaunivassouras@gmail.com"
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

    form.onsubmit = window.verifyAdminPassword;
  }

  function renderApplication() {
    if (typeof updateHomeSummaries === 'function') updateHomeSummaries();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateAdminUI === 'function') updateAdminUI();
    if (typeof updateCampusUI === 'function') updateCampusUI();
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof renderActiveView === 'function') renderActiveView();
    if (typeof safeCreateIcons === 'function') safeCreateIcons();
  }

  function installAdminAuthentication() {
    // O login agora é feito pela conta Firebase, não pela antiga senha local.
    window.handleAdminButtonClick = function () {
      if (isAdmin) {
        auth.signOut().catch(error => {
          console.error('Erro ao sair da conta Firebase:', error);
          showToast('Não foi possível sair da conta.');
        });
        return;
      }

      const passwordInput = document.getElementById('firebaseAdminPassword');
      const emailInput = document.getElementById('firebaseAdminEmail');
      const errorElement = document.getElementById('adminLoginError');

      if (emailInput) emailInput.value = 'inframaricaunivassouras@gmail.com';
      if (passwordInput) passwordInput.value = '';
      if (errorElement) {
        errorElement.textContent = '';
        errorElement.classList.add('hidden');
      }

      document.getElementById('adminLoginModal').classList.remove('hidden');
      setTimeout(() => passwordInput && passwordInput.focus(), 50);
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
          setLoginError('Essa conta não está autorizada a administrar os mapas.');
          return;
        }

        window.closeAdminLoginModal();
      } catch (error) {
        console.error('Falha no login do administrador:', error);
        setLoginError('E-mail ou senha incorretos, ou login por e-mail/senha ainda não ativado no Firebase.');
      }
    };

    // A senha de administrador deixa de ser guardada no navegador ou no Firestore.
    window.openChangePassModal = function () {
      showToast('A senha é gerenciada na conta do Firebase Authentication.');
    };

    window.saveNewAdminPassword = function (event) {
      event.preventDefault();
      showToast('Altere a senha pela conta Firebase, não por este site.');
    };

    // Grava os dados do turno atual no Firestore.
    window.saveToStorage = function () {
      allShiftsData[activeShift] = multiCampusData;

      if (typeof updateHomeSummaries === 'function') {
        updateHomeSummaries();
      }

      if (!firebaseReady || !db) {
        showToast('O Firebase ainda está carregando. Tente novamente em instantes.');
        return;
      }

      if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID || !isAdmin) {
        showToast('Entre com a conta de administrador para salvar alterações.');
        return;
      }

      const shiftKey = activeShift;
      const snapshot = cloneData(multiCampusData);

      firebaseWriteQueue = firebaseWriteQueue
        .then(() => db.doc(`ensalamento/${shiftKey}`).set(snapshot))
        .then(() => {
          showToast('Alterações salvas no Firebase.');
        })
        .catch(error => {
          console.error(`Erro ao salvar o turno ${shiftKey}:`, error);
          showToast('Não foi possível salvar no Firebase. Confira a conexão e as regras.');
        });
    };

    // O botão antigo de troca de senha não é mais necessário.
    const oldChangePasswordButton = document.querySelector(
      '#adminHeaderControls button[onclick="openChangePassModal()"]'
    );
    if (oldChangePasswordButton) oldChangePasswordButton.remove();
  }

  async function start() {
    prepareFirebaseLoginForm();
    installAdminAuthentication();

    try {
      await loadFirebaseSDK();

      auth.onAuthStateChanged(async user => {
        const isAuthorizedAdmin = Boolean(user && user.uid === ADMIN_UID);
        isAdmin = isAuthorizedAdmin;

        try {
          await loadAllShiftData(isAuthorizedAdmin);
          renderApplication();

          if (isAuthorizedAdmin) {
            document.getElementById('adminLoginModal').classList.add('hidden');
            showToast('Administrador conectado. Alterações serão salvas no Firebase.');
          } else if (user) {
            showToast('Esta conta não tem permissão para editar os mapas.');
          }
        } catch (error) {
          console.error('Erro ao carregar dados do Firestore:', error);
          firebaseReady = false;
          renderApplication();
          showToast('Não foi possível carregar o Firestore. Confira as regras do banco.');
        }
      });
    } catch (error) {
      console.error('Erro ao iniciar Firebase:', error);
      showToast('Não foi possível iniciar o Firebase. Confira a configuração do projeto.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();