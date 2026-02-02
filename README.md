# Wazo Voicemail STT Client

Plugin Wazo pour afficher les messages vocaux avec transcription automatique via un serveur STT.

## Fonctionnalités

- Affichage de la liste des messages vocaux
- Lecture des messages vocaux (bouton play)
- Transcription à la demande (bouton feuille)
- Affichage du statut de transcription en temps réel
- Cache des transcriptions existantes

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

## Configuration du serveur STT

Par défaut, le plugin se connecte au serveur STT sur `http://localhost:8000`.

Pour modifier cette URL, vous pouvez utiliser le localStorage dans la console du navigateur :

```javascript
localStorage.setItem('sttServerUrl', 'https://votre-serveur-stt.example.com');
```

Puis rechargez la page du plugin.

## Structure du projet

```
wazo-stt-client/
├── manifest.json       # Configuration du plugin Wazo
├── index.html          # Page principale
├── app.js              # Logique JavaScript
├── style.css           # Styles CSS
├── icon.svg            # Icône du plugin
├── Dockerfile          # Image Docker
├── docker-compose.yml  # Configuration Docker Compose
├── nginx.conf          # Configuration Nginx (pour Docker)
├── package.json        # Dépendances npm
└── API_SERVER.md       # Documentation de l'API STT
```

## Développement

### Modification du code

1. Modifiez les fichiers sources (app.js, style.css, index.html)
2. Rechargez la page dans Wazo pour voir les changements

### Logs de débogage

Ouvrez la console développeur du navigateur pour voir les logs :
- Initialisation du plugin
- Chargement des voicemails
- Statut des transcriptions

## API utilisées

### API Wazo (calld)

- `GET /api/calld/1.0/users/me/voicemails/messages` - Liste des messages vocaux
- `GET /api/calld/1.0/users/me/voicemails/{voicemail_id}/messages/{message_id}/recording` - Téléchargement de l'audio

### API STT Server

- `GET /v1/audio/transcriptions/lookup` - Vérifier si une transcription existe
- `POST /v1/audio/transcriptions` - Soumettre une transcription
- `GET /v1/audio/transcriptions/{job_id}` - Récupérer le statut d'un job

Voir [API_SERVER.md](./API_SERVER.md) pour la documentation complète de l'API STT.

## Licence

MIT
