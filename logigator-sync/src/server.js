/**
 * Servidor de sincronizacion en tiempo real de Logigator colaborativo.
 *
 * Un documento = una sala = un Y.Doc. Los clientes se conectan con
 * `y-websocket` (https://github.com/yjs/y-websocket) a
 *
 *     ws(s)://<host>/sync/<sala>
 *
 * El estado se guarda con y-leveldb (https://github.com/yjs/y-leveldb) en el
 * directorio que indique SYNC_PERSISTENCE_DIR, de modo que un reinicio del
 * servidor no pierde nada: al volver, la sala se rehidrata desde disco.
 *
 * Variables de entorno (todas con valor por defecto util en desarrollo):
 *   SYNC_PORT              puerto de escucha                 (4444)
 *   SYNC_PERSISTENCE_DIR   directorio de la base LevelDB      (./data/yjs)
 *   SYNC_BACKEND_URL       base del backend de Logigator      (http://backend:3000)
 *   SYNC_REQUIRE_AUTH      'false' desactiva la autenticacion (true)
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { LeveldbPersistence } from 'y-leveldb';
import * as Y from 'yjs';

import { setupWSConnection, setPersistence, docs } from './ws-connection.js';
import { authenticate, isValidRoom } from './auth.js';

const PORT = Number(process.env.SYNC_PORT ?? 4444);
const PERSISTENCE_DIR = process.env.SYNC_PERSISTENCE_DIR ?? './data/yjs';
const BACKEND_URL = process.env.SYNC_BACKEND_URL ?? 'http://backend:3000';
const REQUIRE_AUTH = process.env.SYNC_REQUIRE_AUTH !== 'false';

// --- Persistencia -----------------------------------------------------------

const ldb = new LeveldbPersistence(PERSISTENCE_DIR);

setPersistence({
	/**
	 * Carga el estado guardado dentro del documento recien creado y, a partir de
	 * ahi, va anadiendo cada actualizacion a LevelDB. Es el patron que documenta
	 * y-leveldb en su README.
	 */
	bindState: async (docName, ydoc) => {
		// El oyente se engancha ANTES de cualquier `await`, y esto es
		// deliberado: `bindState` se invoca sin esperarla (igual que en el
		// servidor oficial), asi que entre un `await` y el siguiente el cliente
		// ya puede haber mandado su primer cambio. Si el oyente se registrara al
		// final —como hace el ejemplo de y-leveldb— ese cambio llegaria al
		// documento, se difundiria a los demas y se veria en pantalla, pero
		// nunca se escribiria en disco: reaparece todo hasta que el servidor se
		// reinicia, y entonces se pierde en silencio.
		ydoc.on('update', (update) => {
			ldb.storeUpdate(docName, update).catch((err) =>
				console.error(`[sync] no se pudo guardar ${docName}:`, err.message)
			);
		});

		const persisted = await ldb.getYDoc(docName);
		const persistedUpdate = Y.encodeStateAsUpdate(persisted);
		// Lo que ya hubiera en memoria antes del registro se guarda aparte.
		await ldb.storeUpdate(docName, Y.encodeStateAsUpdate(ydoc));
		// Esto vuelve a disparar el oyente y reescribe lo ya guardado: las
		// actualizaciones de Yjs son idempotentes, asi que no hace dano.
		Y.applyUpdate(ydoc, persistedUpdate);
	},
	/**
	 * Al irse el ultimo cliente compactamos el historial en una sola instantanea,
	 * para que la base no crezca sin limite.
	 */
	writeState: async (docName) => {
		await ldb.flushDocument(docName);
	}
});

// --- HTTP -------------------------------------------------------------------

const server = http.createServer((req, res) => {
	// Caddy nos entrega la ruta completa (`/sync/health`); en desarrollo directo
	// llega como `/health`. Aceptamos las dos.
	const path = (req.url ?? '').split('?')[0].replace(/^\/sync(?=\/|$)/, '');
	if (path === '/health' || path === '/') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				status: 'ok',
				rooms: docs.size,
				requireAuth: REQUIRE_AUTH
			})
		);
		return;
	}
	res.writeHead(404);
	res.end('not found');
});

// --- WebSocket --------------------------------------------------------------

// `noServer` para poder autenticar antes de completar el upgrade: una conexion
// sin sesion valida nunca llega a existir como WebSocket.
const wss = new WebSocketServer({ noServer: true });

/**
 * Saca el nombre de sala de la URL. Caddy nos pasa la ruta completa
 * (`/sync/<sala>`), y en desarrollo directo puede llegar como `/<sala>`.
 *
 * @param {string | undefined} url
 * @returns {string | null}
 */
function roomFromUrl(url) {
	if (!url) return null;
	const path = url.split('?')[0].replace(/^\/+/, '');
	const room = path.startsWith('sync/') ? path.slice('sync/'.length) : path;
	return decodeURIComponent(room) || null;
}

server.on('upgrade', async (req, socket, head) => {
	const room = roomFromUrl(req.url);

	if (!room || !isValidRoom(room)) {
		console.warn(`[sync] sala rechazada: ${JSON.stringify(room)}`);
		socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
		socket.destroy();
		return;
	}

	let user = null;
	if (REQUIRE_AUTH) {
		user = await authenticate(req.headers.cookie, BACKEND_URL);
		if (!user) {
			console.warn(`[sync] conexion sin sesion valida a ${room}`);
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}
	}

	wss.handleUpgrade(req, socket, head, (ws) => {
		const who = user ? `${user.username} (${user.id})` : 'anonimo';
		console.log(`[sync] ${who} entra a ${room}`);
		setupWSConnection(ws, room);
	});
});

server.listen(PORT, () => {
	console.log(`[sync] escuchando en :${PORT}`);
	console.log(`[sync] persistencia en ${PERSISTENCE_DIR}`);
	console.log(
		REQUIRE_AUTH
			? `[sync] autenticacion contra ${BACKEND_URL}/api/user`
			: '[sync] AUTENTICACION DESACTIVADA (SYNC_REQUIRE_AUTH=false)'
	);
});

// Cierre ordenado: volcamos lo que quede en memoria antes de salir.
const shutdown = async () => {
	console.log('[sync] cerrando...');
	for (const name of docs.keys()) {
		await ldb.flushDocument(name).catch(() => {});
	}
	server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
