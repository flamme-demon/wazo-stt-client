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
  voicemailsMap: new Map(),
  transcriptionPollers: new Map(),
  transcriptionCache: new Map(), // Cache des transcriptions
  expandedItems: new Set(), // Items avec transcription depliee
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
.stt-transcribe-btn.expanded {
  color: #1976d2;
  background-color: rgba(25, 118, 210, 0.08);
}

/* Panneau de transcription depliable */
.stt-transcription-panel {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease-out;
  background-color: #f8f9fa;
  margin: 0 16px;
  border-radius: 0 0 8px 8px;
}
.stt-transcription-panel.expanded {
  max-height: 200px;
  border: 1px solid #e0e0e0;
  border-top: none;
}
.stt-transcription-content {
  padding: 12px 16px;
}
.stt-transcription-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.stt-transcription-label {
  font-size: 11px;
  font-weight: 600;
  color: #1976d2;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.stt-transcription-text {
  font-size: 13px;
  color: #333;
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
}
.stt-transcription-text.loading {
  color: #666;
  font-style: italic;
  display: flex;
  align-items: center;
  gap: 8px;
}
.stt-transcription-text.loading::before {
  content: '';
  width: 14px;
  height: 14px;
  border: 2px solid #e0e0e0;
  border-top-color: #1976d2;
  border-radius: 50%;
  animation: stt-spin 1s linear infinite;
  flex-shrink: 0;
}
.stt-transcription-text.error {
  color: #d32f2f;
}
.stt-retranscribe-btn {
  padding: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  opacity: 0.6;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
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
const TRANSCRIBE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
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

    const callerNum = extractCallerNumber(item);
    const duration = extractDuration(item);

    if (!callerNum && !duration) return;

    const key = createVoicemailKey(callerNum, duration);
    const voicemail = state.voicemailsMap.get(key);

    if (voicemail) {
      injectTranscribeButton(item, voicemail);
      injectTranscriptionPanel(item, voicemail);
      item.dataset.sttProcessed = 'true';
      item.dataset.sttMessageId = voicemail.id;

      // Verifier si une transcription existe deja
      checkExistingTranscription(voicemail, item);
    }
  });
}

/**
 * Extrait le numero de l'appelant du DOM
 */
function extractCallerNumber(item) {
  const nameEl = item.querySelector('[data-testid="contact-card-name"]');
  if (nameEl) {
    const text = nameEl.textContent || '';
    const match = text.match(/(\d{10})$/);
    if (match) return match[1];
    const numMatch = text.match(/(\d+)$/);
    if (numMatch) return numMatch[1];
  }
  return null;
}

/**
 * Extrait la duree du DOM (en secondes)
 */
function extractDuration(item) {
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
  const playBtn = item.querySelector('[data-testid="audio-player-play"]');
  if (!playBtn) return;

  if (item.querySelector('.stt-transcribe-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'stt-transcribe-btn';
  btn.title = 'Transcrire';
  btn.innerHTML = TRANSCRIBE_ICON;
  btn.dataset.messageId = voicemail.id;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTranscribeClick(voicemail, item);
  });

  // Inserer AVANT le bouton play
  playBtn.parentNode.insertBefore(btn, playBtn);
}

/**
 * Injecte le panneau de transcription (cache par defaut)
 */
function injectTranscriptionPanel(item, voicemail) {
  if (item.querySelector('.stt-transcription-panel')) return;

  const panel = document.createElement('div');
  panel.className = 'stt-transcription-panel';
  panel.dataset.messageId = voicemail.id;
  panel.innerHTML = `
    <div class="stt-transcription-content">
      <div class="stt-transcription-header">
        <span class="stt-transcription-label">Transcription</span>
        <button class="stt-retranscribe-btn" title="Re-transcrire" style="display: none;">
          ${REFRESH_ICON}
        </button>
      </div>
      <div class="stt-transcription-text"></div>
    </div>
  `;

  // Ajouter gestionnaire pour re-transcrire
  const retranscribeBtn = panel.querySelector('.stt-retranscribe-btn');
  retranscribeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    requestTranscription(voicemail, item, true);
  });

  // Inserer apres la carte MUI
  const card = item.querySelector('.MuiCard-root');
  if (card) {
    card.parentNode.insertBefore(panel, card.nextSibling);
  } else {
    item.appendChild(panel);
  }
}

/**
 * Gere le clic sur le bouton transcription
 */
function handleTranscribeClick(voicemail, item) {
  const messageId = voicemail.id;
  const btn = item.querySelector('.stt-transcribe-btn');
  const panel = item.querySelector('.stt-transcription-panel');

  // Si deja expanded, toggle fermeture
  if (state.expandedItems.has(messageId)) {
    panel.classList.remove('expanded');
    btn.classList.remove('expanded');
    state.expandedItems.delete(messageId);
    return;
  }

  // Ouvrir le panneau
  panel.classList.add('expanded');
  btn.classList.add('expanded');
  state.expandedItems.add(messageId);

  // Si on a deja une transcription en cache, l'afficher
  if (state.transcriptionCache.has(messageId)) {
    const cached = state.transcriptionCache.get(messageId);
    updatePanelContent(item, messageId, cached.status, cached.text);
    return;
  }

  // Sinon, lancer la transcription
  requestTranscription(voicemail, item, false);
}

/**
 * Verifie si une transcription existe deja
 */
async function checkExistingTranscription(voicemail, item) {
  try {
    const { uuid: userUuid } = state.context.user;
    const lookup = await lookupTranscription(userUuid, voicemail.id);

    if (lookup.found && lookup.status === 'completed') {
      state.transcriptionCache.set(voicemail.id, { status: 'completed', text: lookup.text });
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

  if (state.transcriptionPollers.has(messageId)) return;

  const btn = item.querySelector('.stt-transcribe-btn');
  const retranscribeBtn = item.querySelector('.stt-retranscribe-btn');

  if (force && retranscribeBtn) {
    retranscribeBtn.classList.add('loading');
  } else if (btn) {
    btn.classList.add('loading');
  }

  // Afficher le statut loading
  updatePanelContent(item, messageId, 'loading', 'Transcription en cours...');

  try {
    if (!force) {
      const lookup = await lookupTranscription(userUuid, messageId);
      if (lookup.found && lookup.status === 'completed') {
        state.transcriptionCache.set(messageId, { status: 'completed', text: lookup.text });
        updatePanelContent(item, messageId, 'completed', lookup.text);
        if (btn) {
          btn.classList.remove('loading');
          btn.classList.add('done');
        }
        return;
      }
      if (lookup.found && (lookup.status === 'queued' || lookup.status === 'processing')) {
        startPolling(lookup.job_id, messageId, item);
        return;
      }
    }

    const audioUrl = `https://${host}/api/calld/1.0/users/me/voicemails/messages/${messageId}/recording?token=${token}`;
    const submitResponse = await submitTranscription(userUuid, messageId, audioUrl, force);

    if (submitResponse.cached && submitResponse.status === 'completed') {
      const jobStatus = await getJobStatus(submitResponse.job_id);
      state.transcriptionCache.set(messageId, { status: 'completed', text: jobStatus.text });
      updatePanelContent(item, messageId, 'completed', jobStatus.text);
      if (btn) {
        btn.classList.remove('loading');
        btn.classList.add('done');
      }
      if (retranscribeBtn) retranscribeBtn.classList.remove('loading');
      return;
    }

    startPolling(submitResponse.job_id, messageId, item);

  } catch (error) {
    console.error('[STT Overlay] Erreur transcription:', error);
    updatePanelContent(item, messageId, 'error', 'Erreur lors de la transcription');
    if (btn) btn.classList.remove('loading');
    if (retranscribeBtn) retranscribeBtn.classList.remove('loading');
  }
}

/**
 * Met a jour le contenu du panneau de transcription
 */
function updatePanelContent(item, messageId, status, text) {
  const panel = item.querySelector('.stt-transcription-panel');
  if (!panel) return;

  const textEl = panel.querySelector('.stt-transcription-text');
  const retranscribeBtn = panel.querySelector('.stt-retranscribe-btn');

  textEl.className = 'stt-transcription-text';

  switch (status) {
    case 'loading':
      textEl.classList.add('loading');
      textEl.textContent = text;
      retranscribeBtn.style.display = 'none';
      break;

    case 'completed':
      textEl.textContent = text || '(Aucun texte detecte)';
      retranscribeBtn.style.display = 'flex';
      retranscribeBtn.classList.remove('loading');
      break;

    case 'error':
      textEl.classList.add('error');
      textEl.textContent = text;
      retranscribeBtn.style.display = 'none';
      break;
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
  const btn = item.querySelector('.stt-transcribe-btn');

  const poll = async () => {
    if (Date.now() - startTime > CONFIG.pollTimeout) {
      state.transcriptionPollers.delete(messageId);
      updatePanelContent(item, messageId, 'error', 'Timeout de la transcription');
      if (btn) btn.classList.remove('loading');
      return;
    }

    try {
      const status = await getJobStatus(jobId);

      switch (status.status) {
        case 'completed':
          state.transcriptionPollers.delete(messageId);
          state.transcriptionCache.set(messageId, { status: 'completed', text: status.text });
          updatePanelContent(item, messageId, 'completed', status.text);
          if (btn) {
            btn.classList.remove('loading');
            btn.classList.add('done');
          }
          break;

        case 'failed':
          state.transcriptionPollers.delete(messageId);
          updatePanelContent(item, messageId, 'error', status.error || 'Echec');
          if (btn) btn.classList.remove('loading');
          break;

        case 'queued':
          updatePanelContent(item, messageId, 'loading', `File d'attente (${status.queue_position})`);
          state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
          break;

        case 'processing':
          updatePanelContent(item, messageId, 'loading', 'Transcription en cours...');
          state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
          break;

        default:
          state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
      }
    } catch (error) {
      state.transcriptionPollers.delete(messageId);
      updatePanelContent(item, messageId, 'error', 'Erreur de communication');
      if (btn) btn.classList.remove('loading');
    }
  };

  poll();
}

// Demarrer l'initialisation
init();
