/**
 * Panel de actividad en vivo: que ha ido pasando en el circuito y cuando.
 *
 * Una advertencia sobre la autoria, porque es facil prometer de mas: Yjs
 * transporta el **estado** del documento, no quien lo escribio. Cuando en la
 * sala solo hay otra persona, el cambio es suyo sin ambiguedad y se dice su
 * nombre. Cuando hay varias, no se puede saber cual de ellas lo hizo, y se dice
 * "alguien" en vez de adjudicarselo al azar a uno de los cinco.
 */

import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	signal
} from '@angular/core';

import { ActivityEntry, CollabService } from '../collab.service';

@Component({
	selector: 'app-activity-panel',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (collab.isCollaborating()) {
			<div class="activity">
				<button
					type="button"
					class="activity__header"
					(click)="toggle()"
					[attr.aria-expanded]="open()"
				>
					<i class="ph ph-pulse"></i>
					<span class="grow text-left">Actividad</span>
					@if (!open() && entries().length) {
						<span class="activity__badge">{{ entries().length }}</span>
					}
					<i class="ph" [class.ph-caret-down]="open()" [class.ph-caret-up]="!open()"></i>
				</button>

				@if (open()) {
					<ul class="activity__list">
						@for (entry of entries(); track entry.id) {
							<li class="activity__item">
								<span
									class="activity__dot"
									[style.background-color]="entry.color"
								></span>
								<span class="activity__text">
									<strong>{{ entry.who }}</strong> {{ entry.text }}
								</span>
								<time class="activity__time">{{ hora(entry) }}</time>
							</li>
						} @empty {
							<li class="activity__empty">Sin cambios todavía.</li>
						}
					</ul>
				}
			</div>
		}
	`,
	styles: `
		.activity {
			/* Abajo a la izquierda: a la derecha esta el minimapa, y el panel
			   quedaba por detras de el. */
			position: absolute;
			left: 0.75rem;
			bottom: 2.25rem;
			width: 16rem;
			border-radius: 0.5rem;
			background-color: var(--lg-surface-800, rgb(32 32 36 / 0.95));
			color: var(--lg-surface-0, #fff);
			box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
			overflow: hidden;
			font-size: 0.78rem;
			z-index: 5;
		}

		.activity__header {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			width: 100%;
			padding: 0.4rem 0.6rem;
			cursor: pointer;
			font-weight: 600;
		}

		.activity__badge {
			padding: 0 0.35rem;
			border-radius: 9999px;
			background-color: var(--lg-primary-400, #27ae60);
			color: #06240f;
			font-size: 0.7rem;
		}

		.activity__list {
			max-height: 13rem;
			overflow-y: auto;
			border-top: 1px solid rgb(255 255 255 / 0.08);
		}

		.activity__item {
			display: flex;
			align-items: baseline;
			gap: 0.4rem;
			padding: 0.3rem 0.6rem;
		}

		.activity__item + .activity__item {
			border-top: 1px solid rgb(255 255 255 / 0.05);
		}

		.activity__dot {
			flex: none;
			width: 0.5rem;
			height: 0.5rem;
			border-radius: 9999px;
			align-self: center;
		}

		.activity__text {
			flex: 1 1 auto;
			line-height: 1.3;
		}

		.activity__time {
			flex: none;
			opacity: 0.6;
			font-variant-numeric: tabular-nums;
			font-size: 0.7rem;
		}

		.activity__empty {
			padding: 0.5rem 0.6rem;
			opacity: 0.6;
		}
	`
})
export class ActivityPanelComponent {
	protected readonly collab = inject(CollabService);

	// Plegado al entrar: en vivo informa con el contador, y desplegado tapa
	// parte del circuito.
	private readonly _open = signal(false);
	protected readonly open = computed(this._open);
	protected readonly entries = computed(() => this.collab.activity());

	protected toggle(): void {
		this._open.update((v) => !v);
	}

	protected hora(entry: ActivityEntry): string {
		return new Date(entry.at).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});
	}
}
