/**
 * Conexion WebSocket de Yjs: una sala por documento.
 *
 * Esto es una adaptacion de `setupWSConnection` del servidor oficial de Yjs
 * (https://github.com/yjs/y-websocket-server, paquete `@y/websocket-server`,
 * licencia MIT). Su README dice explicitamente: "fork it, copy it, or adapt
 * setupWSConnection into your own Node server". Lo adaptamos porque el paquete
 * oficial depende de `yjs@^14.0.0-7` (prelanzamiento) y de `@y/protocols`,
 * mientras que el cliente `y-websocket@3` pide `yjs@^13.5.6` estable; usar la
 * misma linea estable en los dos lados evita mezclar protocolos.
 *
 * Cambios respecto al original:
 *  - imports de `y-protocols/*` en vez de `@y/protocols/*` (linea yjs 13);
 *  - se elimina el `callbackHandler` (no lo usamos);
 *  - `setupWSConnection` recibe el nombre de sala ya resuelto y validado por
 *    `server.js`, en vez de deducirlo de la URL sin comprobar nada.
 *
 * Protocolo de sincronizacion: https://github.com/yjs/y-protocols
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

/** Tipos de mensaje del protocolo de y-websocket. */
const messageSync = 0;
const messageAwareness = 1;

/**
 * Capa de persistencia activa.
 * @type {{bindState: (docName: string, doc: WSSharedDoc) => Promise<void>, writeState: (docName: string, doc: WSSharedDoc) => Promise<unknown>} | null}
 */
let persistence = null;

/** @param {typeof persistence} value */
export const setPersistence = (value) => {
	persistence = value;
};

/**
 * Documentos vivos en memoria, por nombre de sala.
 * @type {Map<string, WSSharedDoc>}
 */
export const docs = new Map();

/**
 * @param {Uint8Array} update
 * @param {unknown} _origin
 * @param {WSSharedDoc} doc
 */
const updateHandler = (update, _origin, doc) => {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, messageSync);
	syncProtocol.writeUpdate(encoder, update);
	const message = encoding.toUint8Array(encoder);
	doc.conns.forEach((_, conn) => send(doc, conn, message));
};

/** Un Y.Doc compartido por todas las conexiones de una sala. */
export class WSSharedDoc extends Y.Doc {
	/** @param {string} name */
	constructor(name) {
		// El recolector de basura de Yjs queda activo: no usamos snapshots.
		super({ gc: true });
		this.name = name;
		/**
		 * Conexion -> clientIDs que controla, para limpiar su presencia al cerrar.
		 * @type {Map<object, Set<number>>}
		 */
		this.conns = new Map();
		this.awareness = new awarenessProtocol.Awareness(this);
		this.awareness.setLocalState(null);

		const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
			const changedClients = added.concat(updated, removed);
			if (conn !== null) {
				const controlled = this.conns.get(conn);
				if (controlled !== undefined) {
					added.forEach((clientId) => controlled.add(clientId));
					removed.forEach((clientId) => controlled.delete(clientId));
				}
			}
			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, messageAwareness);
			encoding.writeVarUint8Array(
				encoder,
				awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
			);
			const buff = encoding.toUint8Array(encoder);
			this.conns.forEach((_, c) => send(this, c, buff));
		};

		this.awareness.on('update', awarenessChangeHandler);
		this.on('update', updateHandler);
	}
}

/**
 * Devuelve el Y.Doc de una sala, cargandolo de disco la primera vez.
 * @param {string} docname
 * @return {WSSharedDoc}
 */
export const getYDoc = (docname) =>
	map.setIfUndefined(docs, docname, () => {
		const doc = new WSSharedDoc(docname);
		if (persistence !== null) persistence.bindState(docname, doc);
		docs.set(docname, doc);
		return doc;
	});

/**
 * @param {object} conn
 * @param {WSSharedDoc} doc
 * @param {Uint8Array} message
 */
const messageListener = (conn, doc, message) => {
	try {
		const encoder = encoding.createEncoder();
		const decoder = decoding.createDecoder(message);
		const messageType = decoding.readVarUint(decoder);
		switch (messageType) {
			case messageSync:
				encoding.writeVarUint(encoder, messageSync);
				syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
				// Longitud 1 = solo la cabecera, sin contenido que devolver.
				if (encoding.length(encoder) > 1) {
					send(doc, conn, encoding.toUint8Array(encoder));
				}
				break;
			case messageAwareness:
				awarenessProtocol.applyAwarenessUpdate(
					doc.awareness,
					decoding.readVarUint8Array(decoder),
					conn
				);
				break;
		}
	} catch (err) {
		console.error('[sync] error procesando mensaje:', err);
		doc.emit('error', [err]);
	}
};

/**
 * @param {WSSharedDoc} doc
 * @param {object} conn
 */
const closeConn = (doc, conn) => {
	if (doc.conns.has(conn)) {
		const controlledIds = doc.conns.get(conn);
		doc.conns.delete(conn);
		awarenessProtocol.removeAwarenessStates(
			doc.awareness,
			Array.from(controlledIds),
			null
		);
		// Ultima conexion fuera: volcamos a disco y soltamos el documento.
		if (doc.conns.size === 0 && persistence !== null) {
			persistence.writeState(doc.name, doc).then(() => doc.destroy());
			docs.delete(doc.name);
		}
	}
	conn.close();
};

/**
 * @param {WSSharedDoc} doc
 * @param {import('ws').WebSocket} conn
 * @param {Uint8Array} m
 */
const send = (doc, conn, m) => {
	if (
		conn.readyState !== wsReadyStateConnecting &&
		conn.readyState !== wsReadyStateOpen
	) {
		closeConn(doc, conn);
		return;
	}
	try {
		conn.send(m, {}, (err) => err != null && closeConn(doc, conn));
	} catch {
		closeConn(doc, conn);
	}
};

const pingTimeout = 30000;

/**
 * Engancha una conexion ya autenticada a la sala indicada.
 *
 * @param {import('ws').WebSocket} conn
 * @param {string} docName nombre de sala, ya validado por el servidor
 */
export const setupWSConnection = (conn, docName) => {
	conn.binaryType = 'arraybuffer';
	const doc = getYDoc(docName);
	doc.conns.set(conn, new Set());

	conn.on('message', (message) =>
		messageListener(conn, doc, new Uint8Array(message))
	);

	// Latido: si el cliente deja de responder, cerramos para liberar su presencia.
	let pongReceived = true;
	const pingInterval = setInterval(() => {
		if (!pongReceived) {
			if (doc.conns.has(conn)) closeConn(doc, conn);
			clearInterval(pingInterval);
		} else if (doc.conns.has(conn)) {
			pongReceived = false;
			try {
				conn.ping();
			} catch {
				closeConn(doc, conn);
				clearInterval(pingInterval);
			}
		}
	}, pingTimeout);

	conn.on('close', () => {
		closeConn(doc, conn);
		clearInterval(pingInterval);
	});
	conn.on('pong', () => {
		pongReceived = true;
	});

	// Paso 1 del protocolo: le mandamos nuestro vector de estado.
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, messageSync);
	syncProtocol.writeSyncStep1(encoder, doc);
	send(doc, conn, encoding.toUint8Array(encoder));

	// Y el estado de presencia que ya conocemos.
	const awarenessStates = doc.awareness.getStates();
	if (awarenessStates.size > 0) {
		const awarenessEncoder = encoding.createEncoder();
		encoding.writeVarUint(awarenessEncoder, messageAwareness);
		encoding.writeVarUint8Array(
			awarenessEncoder,
			awarenessProtocol.encodeAwarenessUpdate(
				doc.awareness,
				Array.from(awarenessStates.keys())
			)
		);
		send(doc, conn, encoding.toUint8Array(awarenessEncoder));
	}
};
