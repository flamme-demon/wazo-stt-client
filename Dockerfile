# Utilise nginx pour servir les fichiers statiques
FROM nginx:alpine

# Copier la configuration nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copier les fichiers du plugin
COPY manifest.json /usr/share/nginx/html/
COPY index.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY overlay.js /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/
COPY icon.svg /usr/share/nginx/html/

# Copier le script d'entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Variable d'environnement pour l'URL du serveur STT
ENV STT_SERVER_URL=http://localhost:8000

# Exposer le port 80
EXPOSE 80

# Utiliser l'entrypoint pour configurer l'URL au demarrage
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
