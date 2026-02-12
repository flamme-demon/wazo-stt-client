# AGENTS.md - Wazo Voicemail STT Plugin

## Project Overview

This is a Wazo unified communications plugin that adds speech-to-text (STT) transcription capabilities to voicemail messages. The plugin integrates directly into Wazo's EUC (Enterprise Unified Communications) interface.

## Build/Lint/Test Commands

### Development Server
```bash
npm start           # Start development server on port 8080
npm run dev         # Same as npm start
```

### Build
```bash
npm run build       # No build step required (echo only) - static files
```

### Docker Build
```bash
docker-compose up -d                    # Build and run container
docker build -t wazo-stt-client .       # Build image manually
```

### Testing
No formal test framework is configured. Manual testing is done by:
1. Running `npm start`
2. Loading plugin in Wazo EUC Portal via manifest URL (http://localhost:8080/manifest.json)
3. Testing voicemail transcription functionality in browser

## Code Style Guidelines

### Language and Comments

- **Code comments are in French** throughout the codebase
- JSDoc-style documentation for all functions with French descriptions
- Example:
  ```javascript
  /**
   * Demande une transcription pour un message
   */
  async function requestTranscription(voicemail) {
  ```

### Imports

- ES6 module imports from CDN for Wazo SDK:
  ```javascript
  import { App } from 'https://unpkg.com/@wazo/euc-plugins-sdk@latest/lib/esm/app.js';
  ```
- No package manager imports in main files (the `serve` package is only for development serving)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Functions | camelCase | `loadVoicemails`, `requestTranscription` |
| Variables | camelCase | `voicemails`, `audioPlayer` |
| Constants | UPPER_SNAKE_CASE | `STT_SERVER_URL`, `STORAGE_KEY`, `CONFIG` |
| CSS classes | kebab-case with `stt-` prefix | `stt-transcribe-btn`, `stt-transcription-panel` |
| DOM data attributes | camelCase in JS, kebab-case in HTML | `dataset.messageId`, `data-testid` |

### State Management

Use a centralized state object pattern:
```javascript
const state = {
  app: null,
  context: null,
  voicemails: [],
  transcriptionPollers: new Map(),
  transcriptionCache: new Map()
};
```

### Configuration

Configuration constants go in a `CONFIG` object:
```javascript
const CONFIG = {
  sttServerUrl: 'http://localhost:8000',
  pollInterval: 2000,
  pollTimeout: 120000
};
```

### Error Handling

- Use try/catch blocks for async operations
- Log errors to console with prefix `[STT Overlay]` for overlay.js or plain console for app.js
- Display user-friendly error messages in French
```javascript
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
} catch (error) {
  console.error('[STT Overlay] Erreur:', error);
  showError('Impossible de charger les messages vocaux.');
}
```

### CSS in JavaScript

For overlay.js (injected styles), define CSS as template literal constants:
```javascript
const STYLES = `
  .stt-transcribe-btn {
    display: inline-flex;
    align-items: center;
    /* ... */
  }
`;
```

### HTML Templates

Use HTML `<template>` elements for reusable UI (see index.html). For dynamic content in overlay.js:
```javascript
const panel = document.createElement('div');
panel.className = 'stt-transcription-panel';
panel.innerHTML = `
  <div class="stt-transcription-header">
    <span class="stt-transcription-label">Transcription</span>
  </div>
`;
```

### Async Patterns

- Use async/await (not .then chains)
- Handle fetch responses explicitly:
  ```javascript
  const response = await fetch(url, { headers: { 'X-Auth-Token': token } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  ```

### DOM Manipulation

- Use `dataset` for data attributes: `item.dataset.sttProcessed = 'true'`
- Query with specific selectors: `document.querySelector('[data-testid="voicemail-item"]')`
- Use `MutationObserver` for DOM changes (see `startDOMObserver` in overlay.js)

### Wazo SDK Integration

- Initialize SDK with `App` from EUC plugins SDK
- Get user context: `state.context = state.app.getContext()`
- Access user credentials: `const { host, token, uuid } = state.context.user`
- API calls use `X-Auth-Token` header for authentication

### API Server Communication

The STT server API expects:
- `GET /v1/audio/transcriptions/lookup?user_uuid=...&message_id=...`
- `POST /v1/audio/transcriptions` with FormData (user_uuid, message_id, url)
- `GET /v1/audio/transcriptions/{job_id}` for polling status

### File Structure Conventions

```
/
├── app.js           # Standalone application (served at /)
├── overlay.js       # Background script injected into Wazo UI
├── index.html       # HTML for standalone app
├── style.css        # Styles for standalone app
├── manifest.json    # Wazo plugin manifest
├── icon.svg         # Plugin icon
├── Dockerfile       # Docker configuration
├── nginx.conf       # Nginx server config
└── docker-compose.yml
```

### Docker Environment Variables

- `STT_SERVER_URL`: URL of the STT server (default: `http://localhost:8000`)
- This is substituted at container startup via `docker-entrypoint.sh`

### User-Facing Messages

All user-facing text must be in French:
- UI labels, buttons, error messages
- Loading states, status text
- Example: `'Transcription en cours...'`, `'Erreur lors de la transcription'`

### Polling Pattern

Use setTimeout recursion for long-polling:
```javascript
const poll = async () => {
  if (Date.now() - startTime > timeout) {
    // Handle timeout
    return;
  }
  const status = await getJobStatus(jobId);
  if (status.status === 'completed') {
    // Done
  } else {
    poller = setTimeout(poll, interval);
  }
};
poll();
```