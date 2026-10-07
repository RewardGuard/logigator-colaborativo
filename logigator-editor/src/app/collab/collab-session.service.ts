/**
 * Decide cuando y a que sala se conecta el editor.
 *
 * `CollabService` sabe sincronizar un `Project` con una sala; aqui se decide
 * **cual** es esa sala y cuando entrar y salir, para que el resto de la
 * aplicacion no tenga que saber nada de Yjs.
 *
 * Nombre de sala por documento:
 *
 *   proyecto guardado en el servidor   `project:<uuid>`
 *   componente personalizado maestro   `custom:<id>`
 *   proyecto aun sin guardar            `local:<id de sesion>`
 *
 * El ultimo caso permite empezar a colaborar antes del primer guardado; en
 * cuanto el proyecto se guarda y recibe su id del servidor, la sala cambia y
 * la sesion se reabre sobre la definitiva.
 */

import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { ProjectService } from '../project/project.service';
import { ProjectMetadataStore } from '../persistence/project-metadata.store';
import { UserService } from '../user/user.service';
import { LoggingService } from '../logging/logging.service';
import { CollabService } from './collab.service';

/** Clave de `localStorage` donde se recuerda si la colaboracion esta activa. */
const ENABLED_KEY = 'logigator.collab.enabled';

@Injectable({ providedIn: 'root' })
export class CollabSessionService {
	private readonly projects = inject(ProjectService);
	private readonly metadata = inject(ProjectMetadataStore);
	private readonly users = inject(UserService);
	private readonly collab = inject(CollabService);
	private readonly logging = inject(LoggingService);

	private readonly _enabled = signal(readStoredEnabled());
	/** Si el usuario quiere colaborar en esta pestana. */
	public readonly enabled = computed(this._enabled);

	/** Sala a la que estamos conectados ahora mismo, si alguna. */
	private _currentRoom: string | null = null;

	constructor() {
		// Un unico efecto gobierna la conexion: reacciona al interruptor, al
		// proyecto activo y a que ese proyecto reciba su id al guardarse.
		effect(() => {
			const quiere = this._enabled();
			const project = this.projects.mainProject();

			if (!quiere || !project) {
				this.collab.disconnectAll();
				this._currentRoom = null;
				return;
			}

			const room = this._roomFor();
			if (room === this._currentRoom) return;

			this.collab.disconnectAll();
			this.collab.connect(project, room, this._displayName(), syncUrl());
			this._currentRoom = room;
		});
	}

	public setEnabled(value: boolean): void {
		this._enabled.set(value);
		try {
			localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
		} catch {
			// Modo privado o almacenamiento bloqueado: la sesion sigue, solo que
			// no se recuerda la preferencia al recargar.
		}
	}

	public toggle(): void {
		this.setEnabled(!this._enabled());
	}

	/** El nombre de sala del proyecto activo. */
	private _roomFor(): string {
		const project = this.projects.mainProject();
		if (!project) return 'local:sin-proyecto';
		const meta = this.metadata.getMetadata(project);
		const id = meta?.id ?? '';
		if (!id) return `local:${sessionRoomId()}`;
		return meta?.source === 'browser' ? `local:${id}` : `project:${id}`;
	}

	/** Con que nombre aparezco ante los demas. */
	private _displayName(): string {
		const user = this.users.user();
		if (user?.username) return user.username;
		// Sin sesion no se puede entrar al servidor de sincronizacion, pero el
		// nombre se calcula igual para no dejarlo vacio en desarrollo.
		this.logging.warn(
			'colaborando sin usuario identificado',
			'CollabSessionService'
		);
		return 'invitado';
	}
}

/**
 * Identificador estable de esta pestana, para que un proyecto todavia sin
 * guardar tenga una sala propia y no choque con la de otro proyecto nuevo.
 */
function sessionRoomId(): string {
	const KEY = 'logigator.collab.sessionRoom';
	try {
		const existing = sessionStorage.getItem(KEY);
		if (existing) return existing;
		const fresh = Math.random().toString(36).slice(2, 10);
		sessionStorage.setItem(KEY, fresh);
		return fresh;
	} catch {
		return 'temporal';
	}
}

function readStoredEnabled(): boolean {
	try {
		return localStorage.getItem(ENABLED_KEY) === '1';
	} catch {
		return false;
	}
}

/**
 * Direccion del servidor de sincronizacion.
 *
 * Se deriva del origen desde el que se sirve el editor, no de una constante:
 * asi funciona igual en `localhost`, en `logigator.test` y en el nombre de
 * Tailscale de la maquina que hospeda el servidor, sin recompilar. Caddy
 * enruta `/sync` hacia el servicio.
 */
export function syncUrl(): string {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${location.host}/sync`;
}
