/**
 * Wazo Voicemail STT Overlay
 * Injecte les boutons de transcription dans l'interface native de Wazo
 */

import { App } from 'https://unpkg.com/@wazo/euc-plugins-sdk@latest/lib/esm/app.js';

// Configuration
const CONFIG = {
  sttServerUrl: localStorage.getItem('sttServerUrl') || 'http://localhost:8000',
  pollInterval: 2000,
  pollTimeout: 120000,
  observerDebounce: 500
};

// Etat global
const state = {
  app: null,
  context: null,
  voicemails: [],
  voicemailsMap: new Map(), // Map pour lookup rapide par cle unique
  transcriptionPollers: new Map(),
  observerTimeout: null
};

// Styles CSS a injecter
const STYLES = `
.stt-transcribe-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: transparent;
  color: #666;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 4px;
}
.stt-transcribe-btn:hover {
  background-color: rgba(0, 0, 0, 0.08);
  color: #1976d2;
}
.stt-transcribe-btn.loading {
  animation: stt-pulse 1.5s ease-in-out infinite;
}
.stt-transcribe-btn.done {
  color: #4caf50;
}
.stt-transcription-container {
  padding: 12px 16px;
  background-color: #f5f5f5;
  border-left: 3px solid #1976d2;
  margin: 8px 16px 16px 16px;
  border-radius: 4px;
}
.stt-transcription-status {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}
.stt-transcription-status.loading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stt-transcription-status.loading::before {
  content: '';
  width: 12px;
  height: 12px;
  border: 2px solid #e0e0e0;
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: stt-spin 1s linear infinite;
}
.stt-transcription-status.error {
  color: #d32f2f;
}
.stt-transcription-text {
  font-size: 14px;
  color: #333;
  line-height: 1.5;
}
.stt-transcription-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stt-retranscribe-btn {
  padding: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  opacity: 0.6;
  border-radius: 4px;
}
.stt-retranscribe-btn:hover {
  opacity: 1;
  background-color: rgba(0, 0, 0, 0.08);
}
.stt-retranscribe-btn.loading {
  animation: stt-spin 1s linear infinite;
}
@keyframes stt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes stt-spin {
  to { transform: rotate(360deg); }
}
`;

// Icone SVG pour le bouton transcription
const TRANSCRIBE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zm-9.5-4.5v-1h5v1h-5zm0-2v-1h5v1h-5zm0-2v-1h5v1h-5z"/>
</svg>`;

const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
  <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
</svg>`;

/**
 * Initialise le plugin
 */
async function init() {
  try {
    console.log('[STT Overlay] Initialisation...');

    state.app = new App();
    await state.app.initialize();
    state.context = state.app.getContext();

    console.log('[STT Overlay] SDK initialise', state.context);

    // Injecter les styles CSS
    injectStyles();

    // Charger les voicemails
    await loadVoicemails();

    // Demarrer l'observation du DOM
    startDOMObserver();

    console.log('[STT Overlay] Plugin pret');

  } catch (error) {
    console.error('[STT Overlay] Erreur initialisation:', error);
  }
}

/**
 * Injecte les styles CSS dans la page
 */
function injectStyles() {
  if (document.getElementById('stt-overlay-styles')) return;

  const style = document.createElement('style');
  style.id = 'stt-overlay-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/**
 * Charge les voicemails depuis l'API
 */
async function loadVoicemails() {
  try {
    const { host, token } = state.context.user;
    const response = await fetch(
      `https://${host}/api/calld/1.0/users/me/voicemails/messages`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Auth-Token': token
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    state.voicemails = data.items || [];

    // Creer un map pour lookup rapide
    // Cle: "callerNumber|duration" pour matcher avec le DOM
    state.voicemailsMap.clear();
    for (const vm of state.voicemails) {
      const key = createVoicemailKey(vm.caller_id_num, vm.duration);
      state.voicemailsMap.set(key, vm);
    }

    console.log('[STT Overlay] Voicemails charges:', state.voicemails.length);

  } catch (error) {
    console.error('[STT Overlay] Erreur chargement voicemails:', error);
  }
}

/**
 * Cree une cle unique pour identifier un voicemail
 */
function createVoicemailKey(callerNum, duration) {
  return `${callerNum || 'unknown'}|${duration}`;
}

/**
 * Demarre l'observation du DOM
 */
function startDOMObserver() {
  const observer = new MutationObserver(() => {
    // Debounce pour eviter trop d'appels
    if (state.observerTimeout) {
      clearTimeout(state.observerTimeout);
    }
    state.observerTimeout = setTimeout(() => {
      processVoicemailItems();
    }, CONFIG.observerDebounce);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Traiter les elements deja presents
  processVoicemailItems();
}

/**
 * Traite les elements voicemail dans le DOM
 */
function processVoicemailItems() {
  const items = document.querySelectorAll('[data-testid="voicemail-item"]');

  items.forEach(item => {
    if (item.dataset.sttProcessed) return;

    // Extraire les infos du DOM
    const callerNum = extractCallerNumber(item);
    const duration = extractDuration(item);

    if (!callerNum && !duration) return;

    // Trouver le voicemail correspondant
    const key = createVoicemailKey(callerNum, duration);
    const voicemail = state.voicemailsMap.get(key);

    if (voicemail) {
      injectTranscribeButton(item, voicemail);
      item.dataset.sttProcessed = 'true';
      item.dataset.sttMessageId = voicemail.id;
    }
  });
}

/**
 * Extrait le numero de l'appelant du DOM
 */
function extractCallerNumber(item) {
  // Le numero est dans le texte "SDA VIP - 0973445936"
  const nameEl = item.querySelector('[data-testid="contact-card-name"]');
  if (nameEl) {
    const text = nameEl.textContent || '';
    // Extraire le numero (derniere partie apres " - ")
    const match = text.match(/(\d{10})$/);
    if (match) return match[1];
    // Ou juste des chiffres
    const numMatch = text.match(/(\d+)$/);
    if (numMatch) return numMatch[1];
  }
  return null;
}

/**
 * Extrait la duree du DOM (en secondes)
 */
function extractDuration(item) {
  // La duree est affichee comme "00:10"
  const durationEl = item.querySelector('.voicemail-player p, [class*="voicemail-player"] p');
  if (durationEl) {
    const text = durationEl.textContent || '';
    const match = text.match(/(\d{2}):(\d{2})/);
    if (match) {
      return parseInt(match[1]) * 60 + parseInt(match[2]);
    }
  }
  return null;
}

/**
 * Injecte le bouton de transcription dans un element voicemail
 */
function injectTranscribeButton(item, voicemail) {
  // Trouver le bouton play
  const playBtn = item.querySelector('[data-testid="audio-player-play"]');
  if (!playBtn) return;

  // Verifier si deja injecte
  if (item.querySelector('.stt-transcribe-btn')) return;

  // Creer le bouton
  const btn = document.createElement('button');
  btn.className = 'stt-transcribe-btn';
  btn.title = 'Transcrire';
  btn.innerHTML = TRANSCRIBE_ICON;
  btn.dataset.messageId = voicemail.id;

  // Ajouter le gestionnaire de clic
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    requestTranscription(voicemail, item);
  });

  // Inserer avant le bouton play
  playBtn.parentNode.insertBefore(btn, playBtn);

  // Verifier si une transcription existe deja
  checkExistingTranscription(voicemail, item);
}

/**
 * Verifie si une transcription existe deja
 */
async function checkExistingTranscription(voicemail, item) {
  try {
    const { uuid: userUuid } = state.context.user;
    const lookup = await lookupTranscription(userUuid, voicemail.id);

    if (lookup.found && lookup.status === 'completed') {
      showTranscription(item, voicemail.id, lookup.text);
      const btn = item.querySelector('.stt-transcribe-btn');
      if (btn) btn.classList.add('done');
    }
  } catch (error) {
    // Ignorer silencieusement
  }
}

/**
 * Demande une transcription
 */
async function requestTranscription(voicemail, item, force = false) {
  const { uuid: userUuid, host, token } = state.context.user;
  const messageId = voicemail.id;

  // Verifier si deja en cours
  if (state.transcriptionPollers.has(messageId)) return;

  const btn = item.querySelector('.stt-transcribe-btn');
  const retranscribeBtn = item.querySelector('.stt-retranscribe-btn');

  if (force && retranscribeBtn) {
    retranscribeBtn.classList.add('loading');
  } else if (btn) {
    btn.classList.add('loading');
  }

  try {
    // Verifier si existe deja (sauf si force)
    if (!force) {
      const lookup = await lookupTranscription(userUuid, messageId);
      if (lookup.found && lookup.status === 'completed') {
        showTranscription(item, messageId, lookup.text);
        if (btn) {
          btn.classList.remove('loading');
          btn.classList.add('done');
        }
        return;
      }
      if (lookup.found && (lookup.status === 'queued' || lookup.status === 'processing')) {
        showTranscriptionStatus(item, messageId, 'loading', 'Transcription en cours...');
        startPolling(lookup.job_id, messageId, item);
        return;
      }
    }

    // Soumettre la transcription
    const audioUrl = `https://${host}/api/calld/1.0/users/me/voicemails/messages/${messageId}/recording?token=${token}`;
    const submitResponse = await submitTranscription(userUuid, messageId, audioUrl, force);

    if (submitResponse.cached && submitResponse.status === 'completed') {
      const jobStatus = await getJobStatus(submitResponse.job_id);
      showTranscription(item, messageId, jobStatus.text);
      if (btn) {
        btn.classList.remove('loading');
        btn.classList.add('done');
      }
      if (retranscribeBtn) retranscribeBtn.classList.remove('loading');
      return;
    }

    // Demarrer le polling
    showTranscriptionStatus(item, messageId, 'loading', 'Transcription en cours...');
    startPolling(submitResponse.job_id, messageId, item);

  } catch (error) {
    console.error('[STT Overlay] Erreur transcription:', error);
    showTranscriptionStatus(item, messageId, 'error', 'Erreur lors de la transcription');
    if (btn) btn.classList.remove('loading');
    if (retranscribeBtn) retranscribeBtn.classList.remove('loading');
  }
}

/**
 * Lookup d'une transcription existante
 */
async function lookupTranscription(userUuid, messageId) {
  const response = await fetch(
    `${CONFIG.sttServerUrl}/v1/audio/transcriptions/lookup?user_uuid=${userUuid}&message_id=${messageId}`
  );
  if (!response.ok) throw new Error(`Lookup failed: ${response.status}`);
  return response.json();
}

/**
 * Soumet une transcription
 */
async function submitTranscription(userUuid, messageId, audioUrl, force = false) {
  const formData = new FormData();
  formData.append('user_uuid', userUuid);
  formData.append('message_id', messageId);
  formData.append('url', audioUrl);
  if (force) formData.append('force', 'true');

  const response = await fetch(
    `${CONFIG.sttServerUrl}/v1/audio/transcriptions`,
    { method: 'POST', body: formData }
  );
  if (!response.ok) throw new Error(`Submit failed: ${response.status}`);
  return response.json();
}

/**
 * Recupere le statut d'un job
 */
async function getJobStatus(jobId) {
  const response = await fetch(
    `${CONFIG.sttServerUrl}/v1/audio/transcriptions/${jobId}`
  );
  if (!response.ok) throw new Error(`Get status failed: ${response.status}`);
  return response.json();
}

/**
 * Demarre le polling pour un job
 */
function startPolling(jobId, messageId, item) {
  const startTime = Date.now();

  const poll = async () => {
    if (Date.now() - startTime > CONFIG.pollTimeout) {
      state.transcriptionPollers.delete(messageId);
      showTranscriptionStatus(item, messageId, 'error', 'Timeout de la transcription');
      const btn = item.querySelector('.stt-transcribe-btn');
      if (btn) btn.classList.remove('loading');
      return;
    }

    try {
      const status = await getJobStatus(jobId);

      switch (status.status) {
        case 'completed':
          state.transcriptionPollers.delete(messageId);
          showTranscription(item, messageId, status.text);
          const btn = item.querySelector('.stt-transcribe-btn');
          if (btn) {
            btn.classList.remove('loading');
            btn.classList.add('done');
          }
          break;

        case 'failed':
          state.transcriptionPollers.delete(messageId);
          showTranscriptionStatus(item, messageId, 'error', status.error || 'Echec');
          const failBtn = item.querySelector('.stt-transcribe-btn');
          if (failBtn) failBtn.classList.remove('loading');
          break;

        case 'queued':
          showTranscriptionStatus(item, messageId, 'loading', `File d'attente (${status.queue_position})`);
          state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
          break;

        case 'processing':
          showTranscriptionStatus(item, messageId, 'loading', 'Transcription en cours...');
          state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
          break;

        default:
          state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
      }
    } catch (error) {
      state.transcriptionPollers.delete(messageId);
      showTranscriptionStatus(item, messageId, 'error', 'Erreur de communication');
      const btn = item.querySelector('.stt-transcribe-btn');
      if (btn) btn.classList.remove('loading');
    }
  };

  poll();
}

/**
 * Affiche le statut de transcription
 */
function showTranscriptionStatus(item, messageId, status, text) {
  let container = item.querySelector('.stt-transcription-container');

  if (!container) {
    container = document.createElement('div');
    container.className = 'stt-transcription-container';
    container.dataset.messageId = messageId;

    // Trouver ou inserer (apres le contenu principal de la carte)
    const cardContent = item.querySelector('[data-testid="wideActivityListItem"]');
    if (cardContent) {
      cardContent.parentNode.insertBefore(container, cardContent.nextSibling);
    } else {
      item.appendChild(container);
    }
  }

  container.innerHTML = `
    <div class="stt-transcription-status ${status}">${text}</div>
    <div class="stt-transcription-text"></div>
  `;
}

/**
 * Affiche la transcription complete
 */
function showTranscription(item, messageId, text) {
  let container = item.querySelector('.stt-transcription-container');

  if (!container) {
    container = document.createElement('div');
    container.className = 'stt-transcription-container';
    container.dataset.messageId = messageId;

    const cardContent = item.querySelector('[data-testid="wideActivityListItem"]');
    if (cardContent) {
      cardContent.parentNode.insertBefore(container, cardContent.nextSibling);
    } else {
      item.appendChild(container);
    }
  }

  // Trouver le voicemail pour le bouton re-transcrire
  const voicemail = state.voicemails.find(vm => vm.id === messageId);

  container.innerHTML = `
    <div class="stt-transcription-header">
      <div class="stt-transcription-status">Transcription</div>
      <button class="stt-retranscribe-btn" title="Re-transcrire">${REFRESH_ICON}</button>
    </div>
    <div class="stt-transcription-text">${text || '(Aucun texte detecte)'}</div>
  `;

  // Ajouter le gestionnaire pour re-transcrire
  const retranscribeBtn = container.querySelector('.stt-retranscribe-btn');
  if (retranscribeBtn && voicemail) {
    retranscribeBtn.addEventListener('click', () => {
      requestTranscription(voicemail, item, true);
    });
  }
}

// Demarrer l'initialisation
init();
