#!/bin/sh
set -e

# Remplacer le placeholder par la variable d'environnement
# Valeur par defaut: http://localhost:8000
STT_SERVER_URL=${STT_SERVER_URL:-http://localhost:8000}

# Remplacer dans overlay.js
sed -i "s|__STT_SERVER_URL__|${STT_SERVER_URL}|g" /usr/share/nginx/html/overlay.js

echo "STT Server URL configured: ${STT_SERVER_URL}"

# Demarrer nginx
exec "$@"
