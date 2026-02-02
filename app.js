/**
 * Wazo Voicemail STT Plugin
 * Plugin pour afficher les messages vocaux avec transcription
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    // URL du serveur STT (à configurer selon l'environnement)
    sttServerUrl: localStorage.getItem('sttServerUrl') || 'http://localhost:8000',
    // Intervalle de polling pour les transcriptions (ms)
    pollInterval: 2000,
    // Timeout maximum pour le polling (ms)
    pollTimeout: 120000
  };

  // État de l'application
  const state = {
    app: null,
    context: null,
    voicemails: [],
    currentAudio: null,
    currentPlayingId: null,
    transcriptionPollers: new Map()
  };

  // Éléments DOM
  const elements = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    errorMessage: document.getElementById('error-message'),
    empty: document.getElementById('empty'),
    voicemailList: document.getElementById('voicemail-list'),
    refreshBtn: document.getElementById('refresh-btn'),
    retryBtn: document.getElementById('retry-btn'),
    audioPlayer: document.getElementById('audio-player'),
    template: document.getElementById('voicemail-item-template')
  };

  /**
   * Initialise le SDK Wazo et charge les données
   */
  async function init() {
    try {
      // Initialiser le SDK Wazo
      // Le SDK UMD expose Wazo.default.App ou Wazo.App selon la version
      console.log('Recherche du SDK Wazo...', {
        Wazo: typeof window.Wazo,
        WazoDefault: window.Wazo ? typeof window.Wazo.default : 'N/A',
        WazoApp: window.Wazo ? typeof window.Wazo.App : 'N/A',
        WazoDefaultApp: window.Wazo && window.Wazo.default ? typeof window.Wazo.default.App : 'N/A'
      });

      let AppClass = null;

      // Essayer différentes façons d'accéder à App
      if (window.Wazo) {
        if (window.Wazo.default && window.Wazo.default.App) {
          AppClass = window.Wazo.default.App;
        } else if (window.Wazo.App) {
          AppClass = window.Wazo.App;
        }
      }

      if (!AppClass) {
        throw new Error('SDK Wazo non trouvé. Vérifiez que le script est bien chargé.');
      }

      state.app = new AppClass();
      await state.app.initialize();
      state.context = state.app.getContext();

      console.log('Plugin initialisé', state.context);

      // Charger les voicemails
      await loadVoicemails();

      // Configurer les événements
      setupEventListeners();

    } catch (error) {
      console.error('Erreur d\'initialisation:', error);
      showError('Erreur d\'initialisation du plugin. Veuillez recharger la page.');
    }
  }

  /**
   * Configure les écouteurs d'événements
   */
  function setupEventListeners() {
    elements.refreshBtn.addEventListener('click', () => loadVoicemails());
    elements.retryBtn.addEventListener('click', () => loadVoicemails());

    // Écouter la fin de lecture audio
    elements.audioPlayer.addEventListener('ended', () => {
      stopAudio();
    });
  }

  /**
   * Charge la liste des messages vocaux depuis l'API Wazo
   */
  async function loadVoicemails() {
    showLoading();

    try {
      const { host, token } = state.context.user;
      const response = await fetch(
        `https://${host}/api/calld/1.0/users/me/voicemails/messages?direction=desc`,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Auth-Token': token
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}`);
      }

      const data = await response.json();
      state.voicemails = data.items || [];

      if (state.voicemails.length === 0) {
        showEmpty();
      } else {
        renderVoicemails();
        // Vérifier les transcriptions existantes
        await checkExistingTranscriptions();
      }

    } catch (error) {
      console.error('Erreur chargement voicemails:', error);
      showError('Impossible de charger les messages vocaux. Vérifiez votre connexion.');
    }
  }

  /**
   * Vérifie les transcriptions existantes pour tous les messages
   */
  async function checkExistingTranscriptions() {
    const { uuid: userUuid } = state.context.user;

    for (const voicemail of state.voicemails) {
      try {
        const lookup = await lookupTranscription(userUuid, voicemail.id);
        if (lookup.found && lookup.status === 'completed') {
          updateTranscriptionUI(voicemail.id, 'completed', lookup.text);
        }
      } catch (error) {
        // Ignorer les erreurs de lookup silencieusement
        console.debug('Lookup failed for', voicemail.id);
      }
    }
  }

  /**
   * Affiche la liste des messages vocaux
   */
  function renderVoicemails() {
    elements.voicemailList.innerHTML = '';

    for (const voicemail of state.voicemails) {
      const item = createVoicemailItem(voicemail);
      elements.voicemailList.appendChild(item);
    }

    showList();
  }

  /**
   * Crée un élément de message vocal
   */
  function createVoicemailItem(voicemail) {
    const template = elements.template.content.cloneNode(true);
    const li = template.querySelector('.voicemail-item');

    li.dataset.id = voicemail.id;
    li.dataset.voicemailId = voicemail.voicemail.id;

    // Marquer les nouveaux messages
    if (voicemail.folder.type === 'new') {
      li.classList.add('new');
    }

    // Informations de l'appelant
    const callerName = li.querySelector('.caller-name');
    const callerNumber = li.querySelector('.caller-number');
    callerName.textContent = voicemail.caller_id_name || 'Inconnu';
    callerNumber.textContent = voicemail.caller_id_num || '';

    // Métadonnées
    const date = li.querySelector('.voicemail-date');
    const duration = li.querySelector('.voicemail-duration');
    const folder = li.querySelector('.voicemail-folder');

    date.textContent = formatDate(voicemail.timestamp);
    duration.textContent = formatDuration(voicemail.duration);
    folder.textContent = voicemail.folder.type === 'new' ? 'Nouveau' : 'Lu';
    if (voicemail.folder.type === 'new') {
      folder.classList.add('new');
    }

    // Boutons d'action
    const playBtn = li.querySelector('.btn-play');
    const transcribeBtn = li.querySelector('.btn-transcribe');

    playBtn.addEventListener('click', () => toggleAudio(voicemail));
    transcribeBtn.addEventListener('click', () => requestTranscription(voicemail));

    return li;
  }

  /**
   * Bascule la lecture audio
   */
  function toggleAudio(voicemail) {
    const { host, token } = state.context.user;
    const audioUrl = `https://${host}/api/calld/1.0/users/me/voicemails/${voicemail.voicemail.id}/messages/${voicemail.id}/recording?token=${token}`;

    // Si c'est le même message, basculer play/pause
    if (state.currentPlayingId === voicemail.id) {
      if (elements.audioPlayer.paused) {
        elements.audioPlayer.play();
        updatePlayButton(voicemail.id, true);
      } else {
        elements.audioPlayer.pause();
        updatePlayButton(voicemail.id, false);
      }
      return;
    }

    // Arrêter la lecture précédente
    stopAudio();

    // Démarrer la nouvelle lecture
    state.currentPlayingId = voicemail.id;
    elements.audioPlayer.src = audioUrl;
    elements.audioPlayer.play()
      .then(() => {
        updatePlayButton(voicemail.id, true);
      })
      .catch(error => {
        console.error('Erreur lecture audio:', error);
        stopAudio();
      });
  }

  /**
   * Arrête la lecture audio
   */
  function stopAudio() {
    if (state.currentPlayingId) {
      updatePlayButton(state.currentPlayingId, false);
    }
    elements.audioPlayer.pause();
    elements.audioPlayer.src = '';
    state.currentPlayingId = null;
  }

  /**
   * Met à jour l'apparence du bouton play
   */
  function updatePlayButton(messageId, isPlaying) {
    const item = document.querySelector(`.voicemail-item[data-id="${messageId}"]`);
    if (!item) return;

    const playBtn = item.querySelector('.btn-play');
    if (isPlaying) {
      playBtn.classList.add('playing');
    } else {
      playBtn.classList.remove('playing');
    }
  }

  /**
   * Demande une transcription pour un message
   */
  async function requestTranscription(voicemail) {
    const { uuid: userUuid, host, token } = state.context.user;
    const messageId = voicemail.id;

    // Vérifier si une transcription est déjà en cours
    if (state.transcriptionPollers.has(messageId)) {
      return;
    }

    const transcribeBtn = document.querySelector(
      `.voicemail-item[data-id="${messageId}"] .btn-transcribe`
    );
    transcribeBtn.classList.add('loading');

    try {
      // 1. Vérifier si la transcription existe déjà
      const lookup = await lookupTranscription(userUuid, messageId);

      if (lookup.found) {
        if (lookup.status === 'completed') {
          updateTranscriptionUI(messageId, 'completed', lookup.text);
          transcribeBtn.classList.remove('loading');
          transcribeBtn.classList.add('done');
          return;
        }
        // Si en cours, continuer le polling
        if (lookup.status === 'queued' || lookup.status === 'processing') {
          startPolling(lookup.job_id, messageId);
          return;
        }
      }

      // 2. Soumettre la transcription
      const audioUrl = `https://${host}/api/calld/1.0/users/me/voicemails/${voicemail.voicemail.id}/messages/${messageId}/recording?token=${token}`;

      const submitResponse = await submitTranscription(userUuid, messageId, audioUrl);

      if (submitResponse.cached && submitResponse.status === 'completed') {
        // Récupérer le texte depuis le job
        const jobStatus = await getJobStatus(submitResponse.job_id);
        updateTranscriptionUI(messageId, 'completed', jobStatus.text);
        transcribeBtn.classList.remove('loading');
        transcribeBtn.classList.add('done');
        return;
      }

      // 3. Démarrer le polling
      startPolling(submitResponse.job_id, messageId);

    } catch (error) {
      console.error('Erreur transcription:', error);
      updateTranscriptionUI(messageId, 'error', 'Erreur lors de la transcription');
      transcribeBtn.classList.remove('loading');
    }
  }

  /**
   * Vérifie si une transcription existe
   */
  async function lookupTranscription(userUuid, messageId) {
    const response = await fetch(
      `${CONFIG.sttServerUrl}/v1/audio/transcriptions/lookup?user_uuid=${userUuid}&message_id=${messageId}`
    );

    if (!response.ok) {
      throw new Error(`Lookup failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Soumet une transcription
   */
  async function submitTranscription(userUuid, messageId, audioUrl) {
    const formData = new FormData();
    formData.append('user_uuid', userUuid);
    formData.append('message_id', messageId);
    formData.append('url', audioUrl);

    const response = await fetch(
      `${CONFIG.sttServerUrl}/v1/audio/transcriptions`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      throw new Error(`Submit failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Récupère le statut d'un job
   */
  async function getJobStatus(jobId) {
    const response = await fetch(
      `${CONFIG.sttServerUrl}/v1/audio/transcriptions/${jobId}`
    );

    if (!response.ok) {
      throw new Error(`Get status failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Démarre le polling pour un job
   */
  function startPolling(jobId, messageId) {
    const startTime = Date.now();

    updateTranscriptionUI(messageId, 'loading', 'Transcription en cours...');

    const poll = async () => {
      // Vérifier le timeout
      if (Date.now() - startTime > CONFIG.pollTimeout) {
        state.transcriptionPollers.delete(messageId);
        updateTranscriptionUI(messageId, 'error', 'Timeout de la transcription');
        updateTranscribeButton(messageId, false);
        return;
      }

      try {
        const status = await getJobStatus(jobId);

        switch (status.status) {
          case 'completed':
            state.transcriptionPollers.delete(messageId);
            updateTranscriptionUI(messageId, 'completed', status.text);
            updateTranscribeButton(messageId, false, true);
            break;

          case 'failed':
            state.transcriptionPollers.delete(messageId);
            updateTranscriptionUI(messageId, 'error', status.error || 'Échec de la transcription');
            updateTranscribeButton(messageId, false);
            break;

          case 'queued':
            updateTranscriptionUI(messageId, 'loading', `En file d'attente (position: ${status.queue_position})`);
            state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
            break;

          case 'processing':
            updateTranscriptionUI(messageId, 'loading', 'Transcription en cours...');
            state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
            break;

          default:
            state.transcriptionPollers.set(messageId, setTimeout(poll, CONFIG.pollInterval));
        }

      } catch (error) {
        console.error('Polling error:', error);
        state.transcriptionPollers.delete(messageId);
        updateTranscriptionUI(messageId, 'error', 'Erreur de communication avec le serveur');
        updateTranscribeButton(messageId, false);
      }
    };

    // Démarrer le polling
    poll();
  }

  /**
   * Met à jour l'interface de transcription
   */
  function updateTranscriptionUI(messageId, status, text) {
    const item = document.querySelector(`.voicemail-item[data-id="${messageId}"]`);
    if (!item) return;

    const transcriptionDiv = item.querySelector('.voicemail-transcription');
    const statusDiv = item.querySelector('.transcription-status');
    const textDiv = item.querySelector('.transcription-text');

    transcriptionDiv.style.display = 'block';

    // Reset classes
    statusDiv.className = 'transcription-status';

    switch (status) {
      case 'loading':
        statusDiv.classList.add('loading');
        statusDiv.textContent = text;
        textDiv.textContent = '';
        break;

      case 'completed':
        statusDiv.textContent = 'Transcription';
        textDiv.textContent = text || '(Aucun texte détecté)';
        break;

      case 'error':
        statusDiv.classList.add('error');
        statusDiv.textContent = text;
        textDiv.textContent = '';
        break;
    }
  }

  /**
   * Met à jour le bouton de transcription
   */
  function updateTranscribeButton(messageId, isLoading, isDone = false) {
    const item = document.querySelector(`.voicemail-item[data-id="${messageId}"]`);
    if (!item) return;

    const transcribeBtn = item.querySelector('.btn-transcribe');
    transcribeBtn.classList.toggle('loading', isLoading);
    transcribeBtn.classList.toggle('done', isDone);
  }

  /**
   * Formate un timestamp en date lisible
   */
  function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    const timeStr = date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    if (diffDays === 0) {
      return `Aujourd'hui ${timeStr}`;
    } else if (diffDays === 1) {
      return `Hier ${timeStr}`;
    } else if (diffDays < 7) {
      return date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else {
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }

  /**
   * Formate une durée en secondes
   */
  function formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m${remainingSeconds > 0 ? ` ${remainingSeconds}s` : ''}`;
  }

  // Fonctions d'affichage des états
  function showLoading() {
    elements.loading.style.display = 'flex';
    elements.error.style.display = 'none';
    elements.empty.style.display = 'none';
    elements.voicemailList.style.display = 'none';
  }

  function showError(message) {
    elements.loading.style.display = 'none';
    elements.error.style.display = 'block';
    elements.errorMessage.textContent = message;
    elements.empty.style.display = 'none';
    elements.voicemailList.style.display = 'none';
  }

  function showEmpty() {
    elements.loading.style.display = 'none';
    elements.error.style.display = 'none';
    elements.empty.style.display = 'block';
    elements.voicemailList.style.display = 'none';
  }

  function showList() {
    elements.loading.style.display = 'none';
    elements.error.style.display = 'none';
    elements.empty.style.display = 'none';
    elements.voicemailList.style.display = 'block';
  }

  // Démarrer l'application
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
