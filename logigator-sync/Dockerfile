FROM node:24-slim

WORKDIR /app

# Las dependencias primero, para que una edicion del codigo no invalide la capa
# de instalacion. classic-level (dependencia nativa de y-leveldb) trae binarios
# precompilados para linux/arm64 y linux/amd64, asi que no hace falta compilador.
COPY ["package.json", "yarn.lock", ".yarnrc.yml", "./"]
RUN corepack enable && yarn install --immutable --inline-builds

COPY ["src", "./src"]

# El estado de los documentos vive aqui; en el compose se monta un volumen.
ENV SYNC_PERSISTENCE_DIR=/data/yjs
VOLUME ["/data"]

EXPOSE 4444

CMD ["node", "src/server.js"]
