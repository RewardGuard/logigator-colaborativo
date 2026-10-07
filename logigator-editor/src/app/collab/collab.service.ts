/**
 * La sesion colaborativa del editor.
 *
 * Une tres piezas que ya existen por separado:
 *
 *   `Project` del editor  <->  motor de sincronizacion  <->  documento Yjs
 *
 * Un documento abierto = una sala. El editor abre un `Project` por documento
 * (el proyecto principal y cada componente personalizado que se edita, ver
 * `project/project.service.ts`), asi que cada uno tiene su propia sala y su
 * propia conexion: editar un subcircuito entre varios funciona igual que editar
 * el circuito principal, sin codigo aparte.
 *
 * Como se evita el bucle de realimentacion: lo que publicamos lleva la marca
 * `LOCAL_ORIGIN`, y al llegar un cambio comprobamos esa marca. Ademas, los
 * cambios remotos se aplican **sin** pasar por el `ActionManager`, asi que no
 * disparan `actionChange$` y no se vuelven a publicar como si fueran nuestros.
 *
 * Documentacion de las librerias usadas:
 *   Yjs          https://docs.yjs.dev
 *   y-websocket  https://github.com/yjs/y-websocket
 *   awareness    https://github.com/yjs/y-protocols
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { ComponentProviderService } from '../components/component-provider.service';
import { LoggingService } from '../logging/logging.service';
import { Project } from '../project/project';
import {
	cloneSnapshot,
	diffSnapshots,
	emptySnapshot,
	isEmptyDiff
} from './circuit-snapshot';
import {
	Bridges,
	createBridges,
	isEmptyPlan,
	planReconcile,
	publishDiff
} from './circuit-sync';
import { applyPlanToProject, readProject } from './project-bridge';
import { LOCAL_ORIGIN, metaMap } from './yjs-circuit';
import { PresenceState, PRESENCE_COLORS } from './presence.model';

/** Estado de la conexion con el servidor de sincronizacion. */
export type CollabStatus = 'desconectado' | 'conectando' | 'conectado';

/** Quien esta en la sala, segun el awareness de Yjs. */
export interface Peer {
	clientId: number;
	name: string;
	color: string;
	/** Posicion del cursor en coordenadas de rejilla, si la esta compartiendo. */
	cursor?: { x: number; y: number };
	/** Ids globales de lo que tiene seleccionado. */
	selection?: string[];
}

/** Una entrada del panel de actividad. */
export interface ActivityEntry {
	id: number;
	at: number;
	who: string;
	color: string;
	text: string;
}

const MAX_ACTIVITY = 60;

/** Lo que mantiene viva una sala. */
interface Session {
	project: Project;
	room: string;
	doc: Y.Doc;
	provider: WebsocketProvider;
	bridges: Bridges;
	/** Lo ultimo que publicamos: la base de la siguiente comparacion. */
	published: ReturnType<typeof emptySnapshot>;
	/**
	 * Falso hasta que termina la primera sincronizacion con el servidor.
	 *
	 * Mientras tanto no se publica NADA. Sin esta guarda, un cambio local que
	 * ocurra entre la conexion y la primera sincronizacion compara el circuito
	 * entero contra una base vacia y lo publica completo, encima de un documento
	 * que ya lo contenia: el circuito aparece dos veces, y con el acuerdo de
	 * todos los participantes, porque el CRDT hace bien su trabajo sobre datos
	 * que ya llegaron mal.
	 */
	ready: boolean;
	dispose: () => void;
}

@Injectable({ providedIn: 'root' })
export class CollabService {
	private readonly provider = inject(ComponentProviderService);
	private readonly logging = inject(LoggingService);

	private readonly _sessions = new Map<Project, Session>();

	private readonly _status = signal<CollabStatus>('desconectado');
	private readonly _peers = signal<Peer[]>([]);
	private readonly _activity = signal<ActivityEntry[]>([]);
	private readonly _self = signal<Peer | null>(null);

	/** Estado de la conexion, para la barra superior. */
	public readonly status = computed(this._status);
	/** Los demas participantes, sin incluirse uno mismo. */
	public readonly peers = computed(this._peers);
	/** Quien soy yo en la sala (nombre y color). */
	public readonly self = computed(this._self);
	/** Historial reciente de lo que hizo cada quien. */
	public readonly activity = computed(this._activity);
	public readonly isCollaborating = computed(
		() => this._status() === 'conectado'
	);

	private _activityCounter = 0;

	/** La sala del proyecto activo, para que la presencia sepa a quien escuchar. */
	private _primary: Session | null = null;

	/**
	 * Entra en una sala para un proyecto.
	 *
	 * @param project el documento abierto en el editor
	 * @param room nombre de sala (`project:<id>`, `custom:<id>` o `local:<id>`)
	 * @param me nombre con el que aparecer ante los demas
	 * @param url base del servidor de sincronizacion (`wss://host/sync`)
	 */
	public connect(
		project: Project,
		room: string,
		me: string,
		url: string
	): void {
		if (this._sessions.has(project)) return;

		this._status.set('conectando');

		const doc = new Y.Doc();
		const bridges = createBridges(doc.clientID);
		const provider = new WebsocketProvider(url, room, doc, { connect: true });

		const color = PRESENCE_COLORS[doc.clientID % PRESENCE_COLORS.length];
		const self: Peer = { clientId: doc.clientID, name: me, color };

		const session: Session = {
			project,
			room,
			doc,
			provider,
			bridges,
			published: emptySnapshot(),
			ready: false,
			dispose: () => undefined
		};

		// --- local -> documento
		const actionSub = project.actionManager.actionChange$.subscribe(() =>
			this._publishLocal(session)
		);

		// --- documento -> local
		// Yjs puede emitir varias actualizaciones seguidas por una sola accion
		// ajena (pegar cien componentes, por ejemplo). Reconciliar en cada una
		// seria recorrer el circuito entero otras tantas veces, asi que se juntan
		// en un solo pase por fotograma, que ademas es el ritmo al que el editor
		// repinta.
		let pendiente = 0;
		const onUpdate = (
			_update: Uint8Array,
			origin: unknown,
			_doc: Y.Doc,
			_tr: Y.Transaction
		) => {
			if (origin === LOCAL_ORIGIN) return; // es nuestro, ya esta aplicado
			if (pendiente) return;
			pendiente = requestAnimationFrame(() => {
				pendiente = 0;
				this._applyRemote(session);
			});
		};
		doc.on('update', onUpdate);

		// --- presencia: mi seleccion, publicada cuando cambia
		// Se suscribe aqui y no en la capa visual porque aqui tenemos el
		// `Project` correcto: el componente del lienzo se crea una sola vez y
		// sobrevive al cambio de proyecto, asi que suscribirse alli ataria la
		// escucha al proyecto que hubiera en ese instante.
		const selectionSub =
			project.selectionManager.selectionChange$.subscribe(() =>
				this.publishSelection(project)
			);

		const awareness = provider.awareness;
		awareness.setLocalState({ name: me, color } satisfies PresenceState);
		const onAwareness = () => this._refreshPeers(session);
		awareness.on('change', onAwareness);

		const onStatus = (event: { status: string }) => {
			this._status.set(
				event.status === 'connected'
					? 'conectado'
					: event.status === 'connecting'
						? 'conectando'
						: 'desconectado'
			);
		};
		provider.on('status', onStatus);

		// La primera sincronizacion decide quien siembra el documento.
		const onSync = (isSynced: boolean) => {
			if (isSynced) this._onFirstSync(session);
		};
		provider.on('sync', onSync);

		session.dispose = () => {
			if (pendiente) cancelAnimationFrame(pendiente);
			actionSub.unsubscribe();
			selectionSub.unsubscribe();
			doc.off('update', onUpdate);
			awareness.off('change', onAwareness);
			provider.off('status', onStatus);
			provider.off('sync', onSync);
			provider.destroy();
			doc.destroy();
		};

		this._sessions.set(project, session);
		this._primary ??= session;
		this._self.set(self);
		this.logging.debug(`entrando a la sala ${room} como ${me}`, 'CollabService');
	}

	/** Sale de la sala de un proyecto. */
	public disconnect(project: Project): void {
		const session = this._sessions.get(project);
		if (!session) return;
		session.dispose();
		this._sessions.delete(project);
		if (this._primary === session) {
			this._primary = this._sessions.values().next().value ?? null;
		}
		if (this._sessions.size === 0) {
			this._status.set('desconectado');
			this._peers.set([]);
			this._self.set(null);
		}
	}

	/** Sale de todas las salas. */
	public disconnectAll(): void {
		for (const project of [...this._sessions.keys()]) this.disconnect(project);
	}

	/**
	 * Publica donde tengo el cursor, en coordenadas de rejilla.
	 *
	 * Va por el awareness, no por el documento: es informacion de un instante,
	 * no debe guardarse en disco ni entrar en el historial, y desaparece sola
	 * cuando alguien cierra la pestana. `undefined` lo retira (el puntero salio
	 * del lienzo).
	 */
	public publishCursor(
		project: Project,
		cursor: { x: number; y: number } | undefined
	): void {
		const session = this._sessions.get(project);
		if (!session) return;
		// `setLocalStateField` y no `setLocalState`: escribir el estado entero
		// desde una copia leida antes pisaria lo que la otra publicacion
		// (la seleccion) hubiera escrito mientras tanto.
		session.provider.awareness.setLocalStateField(
			'cursor',
			cursor
				? // Media rejilla basta para que se vea donde apunta; mas
					// precision solo genera trafico.
					{
						x: Math.round(cursor.x * 2) / 2,
						y: Math.round(cursor.y * 2) / 2
					}
				: undefined
		);
	}

	/** Publica que tengo seleccionado, en ids globales. */
	public publishSelection(project: Project): void {
		const session = this._sessions.get(project);
		if (!session) return;

		const selection: string[] = [];
		for (const component of project.selectionManager.selectedComponents) {
			const gid = session.bridges.components.gidOf(component.id);
			if (gid) selection.push(gid);
		}
		for (const wire of project.selectionManager.selectedWires) {
			const gid = session.bridges.wires.gidOf(wire.id);
			if (gid) selection.push(gid);
		}

		session.provider.awareness.setLocalStateField('selection', selection);
	}

	/** La sesion de un proyecto, para la capa de presencia. */
	public sessionFor(project: Project): {
		doc: Y.Doc;
		provider: WebsocketProvider;
		bridges: Bridges;
	} | null {
		return this._sessions.get(project) ?? null;
	}

	/** La sala del proyecto activo. */
	public get primarySession(): {
		doc: Y.Doc;
		provider: WebsocketProvider;
		bridges: Bridges;
		project: Project;
	} | null {
		return this._primary;
	}

	// --- interno --------------------------------------------------------------

	/**
	 * La primera sincronizacion con el servidor: aqui ya sabemos si la sala
	 * tenia contenido.
	 *
	 * Si lo tenia, manda el documento: el editor se reconcilia contra el. Si
	 * estaba vacia, sembramos con lo que tengamos abierto y dejamos constancia
	 * de quien sembro, para que dos personas que abran el mismo proyecto vacio
	 * a la vez no acaben con todo duplicado.
	 */
	private _onFirstSync(session: Session): void {
		const meta = metaMap(session.doc);
		const yaSembrado = meta.get('seededBy');

		if (yaSembrado === undefined) {
			session.doc.transact(() => {
				meta.set('seededBy', session.doc.clientID);
			}, LOCAL_ORIGIN);
			session.ready = true;
			this._publishLocal(session);
			this.logging.debug(
				`sala ${session.room} vacia: sembrada con el circuito local`,
				'CollabService'
			);
			return;
		}

		// La sala ya tenia contenido: **manda el documento compartido**, y lo que
		// tengamos abierto se descarta.
		//
		// Es lo mismo que hace un documento compartido de texto: al entrar ves lo
		// que hay en el documento, no tu copia. Y aqui ademas es obligado: el
		// editor acaba de cargar el proyecto desde el servidor, asi que tiene los
		// mismos elementos que el documento pero con ids locales que no se
		// corresponden con ningun id global. Sin descartar, cada elemento
		// aparaceria dos veces, una por cada procedencia.
		this._adoptDocument(session);
	}

	/**
	 * Descarta el circuito local y adopta el del documento compartido.
	 *
	 * Tambien vacia el historial de deshacer: sus entradas apuntan a elementos
	 * que acaban de dejar de existir, y deshacerlas reviviria copias sueltas que
	 * nadie mas tiene.
	 */
	private _adoptDocument(session: Session): void {
		const local = readProject(session.project);
		for (const id of local.components.keys()) {
			session.project.removeComponent(id);
		}
		for (const id of local.wires.keys()) {
			session.project.removeWire(id);
		}
		session.bridges.components.clear();
		session.bridges.wires.clear();
		session.project.actionManager.clear();
		session.published = emptySnapshot();
		session.ready = true;

		this._applyRemote(session);

		this.logging.debug(
			`sala ${session.room}: adoptado el circuito compartido ` +
				`(${session.bridges.components.size} componentes, ${session.bridges.wires.size} cables)`,
			'CollabService'
		);
	}

	/** Publica al documento lo que haya cambiado en el editor. */
	private _publishLocal(session: Session): void {
		if (!session.ready) return;
		const current = readProject(session.project);
		const diff = diffSnapshots(session.published, current);
		if (isEmptyDiff(diff)) return;

		publishDiff(session.doc, diff, session.bridges, LOCAL_ORIGIN);
		session.published = cloneSnapshot(current);
	}

	/** Trae al editor lo que diga el documento. */
	private _applyRemote(session: Session): void {
		const current = readProject(session.project);
		const plan = planReconcile(session.doc, current, session.bridges);
		if (isEmptyPlan(plan)) {
			session.published = cloneSnapshot(current);
			return;
		}

		const applied = applyPlanToProject(
			session.project,
			plan,
			session.bridges,
			this.provider
		);

		// Despues de aplicar, lo aplicado pasa a ser nuestra base: si no, la
		// siguiente comparacion local lo veria como un cambio nuestro y lo
		// volveria a publicar.
		session.published = cloneSnapshot(readProject(session.project));

		this._recordActivity(session, applied);
	}

	/** Traduce lo aplicado a frases para el panel de actividad. */
	private _recordActivity(
		session: Session,
		applied: ReturnType<typeof applyPlanToProject>
	): void {
		const states = session.provider.awareness.getStates();
		// No sabemos cual de los participantes hizo cada cambio concreto: Yjs
		// transporta el estado, no la autoria. Cuando solo hay otra persona en la
		// sala, es suya; cuando hay varias, lo decimos sin nombre en vez de
		// adjudicarselo a alguien al azar.
		const otros = [...states.entries()].filter(
			([id]) => id !== session.doc.clientID
		);
		const quien =
			otros.length === 1
				? ((otros[0][1] as PresenceState)?.name ?? 'alguien')
				: 'alguien';
		const color =
			otros.length === 1
				? ((otros[0][1] as PresenceState)?.color ?? '#9aa0a6')
				: '#9aa0a6';

		const frases: string[] = [];
		if (applied.addedComponents.length) {
			frases.push(
				`agrego ${describeCount(applied.addedComponents.length, 'componente', 'componentes')}`
			);
		}
		if (applied.removedComponentIds.length) {
			frases.push(
				`borro ${describeCount(applied.removedComponentIds.length, 'componente', 'componentes')}`
			);
		}
		if (applied.updatedComponents.length) {
			frases.push(
				`modifico ${describeCount(applied.updatedComponents.length, 'componente', 'componentes')}`
			);
		}
		if (applied.addedWires.length) {
			frases.push(
				`tendio ${describeCount(applied.addedWires.length, 'cable', 'cables')}`
			);
		}
		if (applied.removedWireIds.length) {
			frases.push(
				`quito ${describeCount(applied.removedWireIds.length, 'cable', 'cables')}`
			);
		}

		if (frases.length === 0) return;

		const entry: ActivityEntry = {
			id: ++this._activityCounter,
			at: Date.now(),
			who: quien,
			color,
			text: frases.join(', ')
		};
		this._activity.update((list) => [entry, ...list].slice(0, MAX_ACTIVITY));
	}

	/** Recalcula la lista de participantes a partir del awareness. */
	private _refreshPeers(session: Session): void {
		const states = session.provider.awareness.getStates();
		const peers: Peer[] = [];
		for (const [clientId, raw] of states.entries()) {
			if (clientId === session.doc.clientID) continue;
			const state = raw as PresenceState | undefined;
			if (!state?.name) continue;
			peers.push({
				clientId,
				name: state.name,
				color: state.color ?? '#9aa0a6',
				cursor: state.cursor,
				selection: state.selection
			});
		}
		peers.sort((a, b) => a.clientId - b.clientId);
		this._peers.set(peers);
	}
}

function describeCount(n: number, singular: string, plural: string): string {
	return n === 1 ? `un ${singular}` : `${n} ${plural}`;
}
