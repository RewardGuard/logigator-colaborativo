/**
 * La barra de participantes de la barra superior.
 *
 * Muestra el interruptor de colaboracion, el estado de la conexion y quien esta
 * dentro, cada quien con su color. Ese mismo color es el que lleva su cursor en
 * el lienzo y el resalte de lo que tiene seleccionado, para que mirar la barra y
 * mirar el circuito cuenten la misma historia.
 */

import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject
} from '@angular/core';
import { LgTooltip } from '@logigator/ui';

import { CollabService } from '../collab.service';
import { CollabSessionService } from '../collab-session.service';

@Component({
	selector: 'app-presence-bar',
	imports: [LgTooltip],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="flex items-center gap-2">
			@if (collab.isCollaborating()) {
				<div class="flex items-center -space-x-2" role="list">
					@if (collab.self(); as yo) {
						<span
							role="listitem"
							class="presence-dot ring-2 ring-primary-400"
							[style.background-color]="yo.color"
							[lgTooltip]="yo.name + ' (tú)'"
							tooltipPosition="bottom"
							>{{ initial(yo.name) }}</span
						>
					}
					@for (peer of collab.peers(); track peer.clientId) {
						<span
							role="listitem"
							class="presence-dot ring-2 ring-primary-400"
							[style.background-color]="peer.color"
							[lgTooltip]="peer.name"
							tooltipPosition="bottom"
							>{{ initial(peer.name) }}</span
						>
					}
				</div>
				<span class="text-xs opacity-80">{{ countLabel() }}</span>
			}

			<button
				type="button"
				class="presence-toggle"
				[class.presence-toggle--on]="session.enabled()"
				[lgTooltip]="toggleTooltip()"
				tooltipPosition="bottom"
				(click)="session.toggle()"
			>
				<i class="ph" [class.ph-users-three]="true"></i>
				<span class="text-xs font-medium">{{ statusLabel() }}</span>
			</button>
		</div>
	`,
	styles: `
		.presence-dot {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.75rem;
			height: 1.75rem;
			border-radius: 9999px;
			color: #fff;
			font-size: 0.75rem;
			font-weight: 700;
			text-transform: uppercase;
			user-select: none;
		}

		.presence-toggle {
			display: inline-flex;
			align-items: center;
			gap: 0.35rem;
			padding: 0.25rem 0.6rem;
			border-radius: 9999px;
			border: 1px solid currentColor;
			opacity: 0.75;
			cursor: pointer;
		}

		.presence-toggle:hover {
			opacity: 1;
		}

		.presence-toggle--on {
			opacity: 1;
			background-color: rgb(0 0 0 / 0.15);
		}
	`
})
export class PresenceBarComponent {
	protected readonly collab = inject(CollabService);
	protected readonly session = inject(CollabSessionService);

	protected readonly statusLabel = computed(() => {
		if (!this.session.enabled()) return 'Colaborar';
		switch (this.collab.status()) {
			case 'conectado':
				return 'En vivo';
			case 'conectando':
				return 'Conectando…';
			default:
				return 'Sin conexión';
		}
	});

	protected readonly toggleTooltip = computed(() =>
		this.session.enabled()
			? 'Salir de la sesión colaborativa'
			: 'Editar este circuito junto a tu equipo, en tiempo real'
	);

	protected readonly countLabel = computed(() => {
		const otros = this.collab.peers().length;
		if (otros === 0) return 'solo tú';
		return otros === 1 ? '1 más' : `${otros} más`;
	});

	protected initial(name: string): string {
		return name.trim().charAt(0) || '?';
	}
}
