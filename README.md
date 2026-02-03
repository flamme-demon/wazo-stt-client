# Wazo Voicemail STT Client

Plugin Wazo pour ajouter la transcription automatique aux messages vocaux via un serveur STT.

## Fonctionnalités

- **Intégration native** : S'injecte directement dans l'interface des messages vocaux de Wazo
- **Bouton de transcription** : Ajouté à côté du bouton play de chaque message
- **Panneau dépliable** : Affiche la transcription sous chaque message vocal
- **Toggle "Transcriptions"** : Bouton pour déplier/replier toutes les transcriptions d'un coup
- **Persistence locale** : Les transcriptions sont sauvegardées dans le localStorage
- **Re-transcription** : Possibilité de relancer une transcription avec le bouton refresh

## Prérequis

- Un serveur Wazo fonctionnel
- Le serveur [wazo-stt-server](https://github.com/flamme-demon/wazo-stt-server) déployé et accessible

## Installation

### Avec Docker (recommandé)

```bash
# Cloner le dépôt
git clone https://github.com/flamme-demon/wazo-stt-client.git
cd wazo-stt-client

# Construire et lancer
docker-compose up -d

# Le plugin est accessible sur http://localhost:8080
```

### Avec npm

```bash
# Cloner le dépôt
git clone https://github.com/flamme-demon/wazo-stt-client.git
cd wazo-stt-client

# Installer les dépendances
npm install

# Lancer le serveur de développement
npm start

# Le plugin est accessible sur http://localhost:8080
```

### Sans npm (serveur statique)

Vous pouvez utiliser n'importe quel serveur HTTP pour servir les fichiers statiques :

```bash
# Avec Python
python3 -m http.server 8080

# Avec PHP
php -S localhost:8080
```

## Configuration du plugin dans Wazo

1. Accédez à votre portail Wazo (E-UC Portal)
2. Allez dans **Plugins > Apps**
3. Ajoutez un nouveau plugin avec l'URL du manifest :
   ```
   http://votre-serveur:8080/manifest.json
   ```
4. Activez le plugin pour les utilisateurs souhaités
5. Accédez à la page **Messages vocaux** de Wazo - les boutons de transcription apparaissent automatiquement

## Configuration du serveur STT

L'URL du serveur STT est configurée via la variable d'environnement Docker `STT_SERVER_URL`.

Par défaut : `http://localhost:8000`

### Avec docker-compose

```yaml
services:
  wazo-stt-client:
    environment:
      - STT_SERVER_URL=http://192.168.1.100:8000
```

### Avec docker run

```bash
docker run -d -p 8080:80 -e STT_SERVER_URL=http://192.168.1.100:8000 wazo-stt-client
```

## Utilisation

1. **Transcrire un message** : Cliquez sur le bouton transcription (icône document) à côté du bouton play
2. **Voir la transcription** : Le panneau se déplie automatiquement sous le message
3. **Tout déplier** : Utilisez le bouton "Transcriptions" en haut de la liste pour afficher toutes les transcriptions disponibles
4. **Re-transcrire** : Cliquez sur le bouton refresh dans le panneau de transcription

## Structure du projet

```
wazo-stt-client/
├── manifest.json       # Configuration du plugin Wazo
├── overlay.js          # Script principal (injection DOM)
├── icon.svg            # Icône du plugin
├── Dockerfile          # Image Docker
├── docker-compose.yml  # Configuration Docker Compose
├── nginx.conf          # Configuration Nginx (pour Docker)
├── package.json        # Dépendances npm
└── API_SERVER.md       # Documentation de l'API STT
```

## Développement

### Architecture

Le plugin utilise un `backgroundScript` qui s'exécute dans le contexte de Wazo et observe le DOM pour détecter les éléments `[data-testid="voicemail-item"]`. Quand des messages vocaux sont détectés, il injecte :
- Un bouton de transcription dans le player audio
- Un panneau dépliable pour afficher la transcription

### Logs de débogage

Ouvrez la console développeur du navigateur pour voir les logs :
- `[STT Overlay] Initialisation...`
- `[STT Overlay] Voicemails charges: X`
- `[STT Overlay] Processing items: X`

## API utilisées

### API Wazo (calld)

- `GET /api/calld/1.0/users/me/voicemails/messages` - Liste des messages vocaux
- `GET /api/calld/1.0/users/me/voicemails/messages/{message_id}/recording` - Téléchargement de l'audio

### API STT Server

- `GET /v1/audio/transcriptions/lookup` - Vérifier si une transcription existe
- `POST /v1/audio/transcriptions` - Soumettre une transcription
- `GET /v1/audio/transcriptions/{job_id}` - Récupérer le statut d'un job

Voir [API_SERVER.md](./API_SERVER.md) pour la documentation complète de l'API STT.

## Licence

MIT
