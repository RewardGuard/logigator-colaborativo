/**
 * La capa de presencia que se dibuja encima del lienzo.
 *
 * Muestra donde tiene el cursor cada quien y que tiene seleccionado, cada cual
 * con su color. Son elementos del DOM colocados sobre el canvas, no objetos de
 * la escena de PixiJS, y eso es deliberado: la presencia es informacion
 * efimera de interfaz, no parte del circuito. Metiendola en la escena habria
 * que pasar por el renderizador compartido, el indice espacial y el recorte por
 * vista, y un cursor ajeno acabaria contando como contenido del proyecto en el
 * minimapa o en la exportacion a imagen.
 *
 * La conversion de coordenadas es la del propio editor, leida de
 * `ViewportController.viewportState`:
 *
 *     pantalla = (rejilla - origenDeRejilla) * escala * tamanoDeCuadro
 */

import {
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	ElementRef,
	inject,
	Injector,
	OnInit,
	signal
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Rectangle } from 'pixi.js';

import { environment } from '../../../environments/environment';
import { ProjectService } from '../../project/project.service';
import { CollabService } from '../collab.service';

/** Cursor ajeno ya convertido a pixeles de pantalla. */
interface ScreenCursor {
	clientId: number;
	name: string;
	color: string;
	left: number;
	top: number;
}

/** Recuadro de algo que otra persona tiene seleccionado. */
interface ScreenSelection {
	clientId: number;
	color: string;
	name: string;
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Cada cuanto se publica la posicion del cursor, como mucho. */
const CURSOR_THROTTLE_MS = 60;

@Component({
	selector: 'app-collab-overlay',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			@for (sel of selections(); track sel.clientId + ':' + sel.left + ':' + sel.top) {
				<div
					class="collab-selection"
					[style.left.px]="sel.left"
					[style.top.px]="sel.top"
					[style.width.px]="sel.width"
					[style.height.px]="sel.height"
					[style.border-color]="sel.color"
					[style.background-color]="sel.color + '22'"
				></div>
			}

			@for (cursor of cursors(); track cursor.clientId) {
				<div
					class="collab-cursor"
					[style.left.px]="cursor.left"
					[style.top.px]="cursor.top"
				>
					<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
						<path
							d="M2 1 L2 14 L5.5 10.8 L7.8 16 L10.3 14.9 L8 9.8 L12.6 9.6 Z"
							[attr.fill]="cursor.color"
							stroke="rgba(0,0,0,0.45)"
							stroke-width="1"
						/>
					</svg>
					<span class="collab-cursor__name" [style.background-color]="cursor.color">
						{{ cursor.name }}
					</span>
				</div>
			}
		</div>
	`,
	styles: `
		.collab-cursor {
			position: absolute;
			display: flex;
			align-items: flex-start;
			transform: translate(-2px, -2px);
			will-change: transform, left, top;
			transition:
				left 80ms linear,
				top 80ms linear;
		}

		.collab-cursor__name {
			margin-left: 0.1rem;
			margin-top: 0.75rem;
			padding: 0.05rem 0.35rem;
			border-radius: 0.25rem;
			color: #fff;
			font-size: 0.7rem;
			font-weight: 600;
			line-height: 1.3;
			white-space: nowrap;
			box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
		}

		.collab-selection {
			position: absolute;
			border: 2px solid;
			border-radius: 2px;
			transition:
				left 80ms linear,
				top 80ms linear;
		}
	`
})
export class CollabOverlayComponent implements OnInit {
	private readonly collab = inject(CollabService);
	private readonly projects = inject(ProjectService);
	private readonly host = inject(ElementRef<HTMLElement>);
	private readonly destroyRef = inject(DestroyRef);
	private readonly injector = inject(Injector);

	/** Cambia en cada movimiento de camara, para recalcular las posiciones. */
	private readonly _viewportTick = signal(0);

	protected readonly cursors = computed<ScreenCursor[]>(() => {
		this._viewportTick();
		const project = this.projects.activeProject();
		if (!project) return [];
		const state = project.viewport.viewportState;
		const factor = state.scale * environment.gridSize;

		const out: ScreenCursor[] = [];
		for (const peer of this.collab.peers()) {
			if (!peer.cursor) continue;
			out.push({
				clientId: peer.clientId,
				name: peer.name,
				color: peer.color,
				left: (peer.cursor.x - state.gridOrigin.x) * factor,
				top: (peer.cursor.y - state.gridOrigin.y) * factor
			});
		}
		return out;
	});

	protected readonly selections = computed<ScreenSelection[]>(() => {
		this._viewportTick();
		const project = this.projects.activeProject();
		const session = project ? this.collab.sessionFor(project) : null;
		if (!project || !session) return [];

		const state = project.viewport.viewportState;
		const factor = state.scale * environment.gridSize;
		const out: ScreenSelection[] = [];

		for (const peer of this.collab.peers()) {
			for (const gid of peer.selection ?? []) {
				const bounds = boundsForGid(project, session, gid);
				if (!bounds) continue;
				out.push({
					clientId: peer.clientId,
					color: peer.color,
					name: peer.name,
					left: (bounds.x - state.gridOrigin.x) * factor,
					top: (bounds.y - state.gridOrigin.y) * factor,
					width: bounds.width * factor,
					height: bounds.height * factor
				});
			}
		}
		return out;
	});

	public ngOnInit(): void {
		const element = this.host.nativeElement.parentElement ?? this.host.nativeElement;

		// --- publicar mi cursor
		let lastSent = 0;
		const onPointerMove = (event: PointerEvent) => {
			const now = performance.now();
			if (now - lastSent < CURSOR_THROTTLE_MS) return;
			lastSent = now;

			const project = this.projects.activeProject();
			if (!project) return;
			const session = this.collab.sessionFor(project);
			if (!session) return;

			const rect = element.getBoundingClientRect();
			const state = project.viewport.viewportState;
			const factor = state.scale * environment.gridSize;
			this.collab.publishCursor(project, {
				x: (event.clientX - rect.left) / factor + state.gridOrigin.x,
				y: (event.clientY - rect.top) / factor + state.gridOrigin.y
			});
		};
		const onPointerLeave = () => {
			const project = this.projects.activeProject();
			if (project) this.collab.publishCursor(project, undefined);
		};

		element.addEventListener('pointermove', onPointerMove, { passive: true });
		element.addEventListener('pointerleave', onPointerLeave, { passive: true });
		this.destroyRef.onDestroy(() => {
			element.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('pointerleave', onPointerLeave);
		});

		// --- recolocar lo ajeno cuando se mueve la camara
		//
		// Se vuelve a suscribir cada vez que cambia el proyecto activo: este
		// componente se crea una sola vez y sobrevive a abrir otro documento, asi
		// que una suscripcion fija quedaria atada al proyecto que hubiera al
		// arrancar, y los cursores dejarian de seguir a la camara.
		let viewportSub: Subscription | null = null;
		effect(
			() => {
				const project = this.projects.activeProject();
				viewportSub?.unsubscribe();
				viewportSub = project
					? project.viewport.viewportChange$.subscribe(() =>
							this._viewportTick.update((n) => n + 1)
						)
					: null;
			},
			{ injector: this.injector }
		);
		this.destroyRef.onDestroy(() => viewportSub?.unsubscribe());
	}
}

/** Los limites en rejilla del elemento al que apunta un id global. */
function boundsForGid(
	project: { getComponentById: (id: number) => { gridBounds: Rectangle } | undefined; getWireById: (id: number) => { gridBounds: Rectangle } | undefined },
	session: { bridges: { components: { localOf: (g: string) => number | undefined }; wires: { localOf: (g: string) => number | undefined } } },
	gid: string
): Rectangle | null {
	const componentId = session.bridges.components.localOf(gid);
	if (componentId !== undefined) {
		return project.getComponentById(componentId)?.gridBounds ?? null;
	}
	const wireId = session.bridges.wires.localOf(gid);
	if (wireId !== undefined) {
		return project.getWireById(wireId)?.gridBounds ?? null;
	}
	return null;
}
