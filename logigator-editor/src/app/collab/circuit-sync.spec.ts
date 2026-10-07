/**
 * Pruebas del motor de sincronizacion.
 *
 * Son puras: dos `Y.Doc` en memoria haciendo de dos personas, sin servidor, sin
 * navegador y sin PixiJS. Lo que se comprueba no es "llamo a la funcion y no
 * explota", sino las propiedades que de verdad tienen que cumplirse cuando
 * cinco personas editan la misma CPU:
 *
 *  - convergencia: tras intercambiar cambios, los dos lados ven lo mismo;
 *  - nadie pierde su trabajo por culpa de un cambio simultaneo del otro;
 *  - los ids locales de cada editor no se estorban entre si.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SerializedComponent } from '../components/serialized-component.model';
import { SerializedWire } from '../wires/serialized-wire.model';
import {
	CircuitSnapshot,
	diffSnapshots,
	emptySnapshot,
	isEmptyDiff
} from './circuit-snapshot';
import {
	Bridges,
	createBridges,
	isEmptyPlan,
	planReconcile,
	publishDiff,
	ReconcilePlan
} from './circuit-sync';
import { readCircuit } from './yjs-circuit';

const ORIGIN = 'prueba-local';

function comp(
	id: number,
	type: number,
	x: number,
	y: number,
	options: Record<string, unknown> = {}
): SerializedComponent {
	return { id, type, pos: [x, y], options };
}

function wire(
	id: number,
	x: number,
	y: number,
	direction = 0,
	length = 3
): SerializedWire {
	return { id, pos: [x, y], direction, length };
}

function snapshotOf(
	components: SerializedComponent[],
	wires: SerializedWire[] = []
): CircuitSnapshot {
	return {
		components: new Map(components.map((c) => [c.id, c])),
		wires: new Map(wires.map((w) => [w.id, w]))
	};
}

/**
 * Un editor de mentira: mantiene su instantanea local, publica sus cambios y
 * aplica los planes que le tocan. Es el minimo necesario para ejercitar el
 * motor sin arrastrar el editor real.
 */
class FakeEditor {
	public readonly doc = new Y.Doc();
	public readonly bridges: Bridges;
	public snapshot: CircuitSnapshot = emptySnapshot();
	/** Imita el asignador de ids del editor: un contador por sesion. */
	private _nextLocalId = 1;

	constructor(public readonly nombre: string) {
		this.bridges = createBridges(this.doc.clientID);
	}

	/** Coloca un componente, como haria el usuario, y lo publica. */
	public addComponent(
		type: number,
		x: number,
		y: number,
		options: Record<string, unknown> = {}
	): number {
		const id = this._nextLocalId++;
		const next = cloneLocal(this.snapshot);
		next.components.set(id, comp(id, type, x, y, options));
		this.commit(next);
		return id;
	}

	public addWire(x: number, y: number, direction = 0, length = 3): number {
		const id = this._nextLocalId++;
		const next = cloneLocal(this.snapshot);
		next.wires.set(id, wire(id, x, y, direction, length));
		this.commit(next);
		return id;
	}

	public moveComponent(id: number, x: number, y: number): void {
		const next = cloneLocal(this.snapshot);
		const before = next.components.get(id);
		if (!before) throw new Error(`no existe el componente ${id}`);
		next.components.set(id, { ...before, pos: [x, y] });
		this.commit(next);
	}

	public setOption(id: number, key: string, value: unknown): void {
		const next = cloneLocal(this.snapshot);
		const before = next.components.get(id);
		if (!before) throw new Error(`no existe el componente ${id}`);
		next.components.set(id, {
			...before,
			options: { ...before.options, [key]: value }
		});
		this.commit(next);
	}

	public removeComponent(id: number): void {
		const next = cloneLocal(this.snapshot);
		next.components.delete(id);
		this.commit(next);
	}

	/** Publica la diferencia contra lo ultimo publicado. */
	public commit(next: CircuitSnapshot): void {
		const diff = diffSnapshots(this.snapshot, next);
		this.snapshot = next;
		if (!isEmptyDiff(diff)) {
			publishDiff(this.doc, diff, this.bridges, ORIGIN);
		}
	}

	/** Aplica a la instantanea local lo que diga el documento. */
	public applyRemote(): ReconcilePlan {
		const plan = planReconcile(this.doc, this.snapshot, this.bridges);
		const next = cloneLocal(this.snapshot);

		for (const { gid, body } of plan.addComponents) {
			const id = this._nextLocalId++;
			this.bridges.components.link(gid, id);
			next.components.set(id, { ...body, id });
		}
		for (const { localId, body } of plan.updateComponents) {
			next.components.set(localId, { ...body, id: localId });
		}
		for (const id of plan.removeComponentIds) {
			next.components.delete(id);
			this.bridges.components.unlinkLocal(id);
		}
		for (const { gid, body } of plan.addWires) {
			const id = this._nextLocalId++;
			this.bridges.wires.link(gid, id);
			next.wires.set(id, { ...body, id });
		}
		for (const { localId, body } of plan.updateWires) {
			next.wires.set(localId, { ...body, id: localId });
		}
		for (const id of plan.removeWireIds) {
			next.wires.delete(id);
			this.bridges.wires.unlinkLocal(id);
		}

		this.snapshot = next;
		return plan;
	}

	/** El circuito como lo ve este editor, sin ids locales, para comparar. */
	public visible(): {
		components: unknown[];
		wires: unknown[];
	} {
		const strip = (o: Record<string, unknown>) => {
			const { id: _id, ...rest } = o;
			return rest;
		};
		return {
			components: [...this.snapshot.components.values()]
				.map((c) => strip(c as unknown as Record<string, unknown>))
				.sort(byJson),
			wires: [...this.snapshot.wires.values()]
				.map((w) => strip(w as unknown as Record<string, unknown>))
				.sort(byJson)
		};
	}
}

const byJson = (a: unknown, b: unknown) =>
	JSON.stringify(a).localeCompare(JSON.stringify(b));

function cloneLocal(s: CircuitSnapshot): CircuitSnapshot {
	return {
		components: new Map(s.components),
		wires: new Map(s.wires)
	};
}

/** Intercambia cambios entre dos editores hasta que no quede nada por mandar. */
function sync(a: FakeEditor, b: FakeEditor): void {
	for (let i = 0; i < 5; i++) {
		Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
		Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));
		b.applyRemote();
		a.applyRemote();
	}
}

describe('diferencia de instantaneas', () => {
	it('no ve cambios donde no los hay', () => {
		const s = snapshotOf([comp(1, 2, 3, 4, { numInputs: 2 })], [wire(2, 0, 0)]);
		const diff = diffSnapshots(s, snapshotOf([...s.components.values()], [...s.wires.values()]));
		expect(isEmptyDiff(diff)).toBe(true);
	});

	it('distingue agregar, cambiar y borrar', () => {
		const antes = snapshotOf([comp(1, 2, 0, 0), comp(2, 3, 5, 5)]);
		const despues = snapshotOf([comp(1, 2, 9, 9), comp(3, 4, 1, 1)]);
		const diff = diffSnapshots(antes, despues);

		expect(diff.addedComponents.map((c) => c.id)).toEqual([3]);
		expect(diff.changedComponents.map((c) => c.id)).toEqual([1]);
		expect(diff.removedComponentIds).toEqual([2]);
	});

	it('trata la direccion ausente y el Este como lo mismo', () => {
		const antes = snapshotOf([{ ...comp(1, 2, 0, 0), direction: 0 }]);
		const despues = snapshotOf([comp(1, 2, 0, 0)]);
		expect(isEmptyDiff(diffSnapshots(antes, despues))).toBe(true);
	});

	it('detecta un cambio dentro de un valor de opcion compuesto', () => {
		const antes = snapshotOf([comp(1, 9, 0, 0, { rom: [1, 2, 3] })]);
		const despues = snapshotOf([comp(1, 9, 0, 0, { rom: [1, 2, 4] })]);
		expect(diffSnapshots(antes, despues).changedComponents).toHaveLength(1);
	});
});

describe('sincronizacion entre dos editores', () => {
	it('lo que uno coloca aparece en el otro', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');

		ana.addComponent(2, 4, 4, { numInputs: 2 });
		ana.addWire(0, 4, 0, 4);
		sync(ana, luis);

		expect(luis.snapshot.components.size).toBe(1);
		expect(luis.snapshot.wires.size).toBe(1);
		expect(luis.visible()).toEqual(ana.visible());
	});

	it('los ids locales de cada uno no se estorban', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');

		// Los dos colocan su primer componente: ambos usan el id local 1.
		const idAna = ana.addComponent(2, 0, 0);
		const idLuis = luis.addComponent(3, 10, 10);
		expect(idAna).toBe(idLuis);

		sync(ana, luis);

		// Y aun asi acaban con los dos componentes, no con uno pisando al otro.
		expect(ana.snapshot.components.size).toBe(2);
		expect(luis.snapshot.components.size).toBe(2);
		expect(ana.visible()).toEqual(luis.visible());
	});

	it('dos movimientos simultaneos convergen al mismo sitio', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');
		ana.addComponent(2, 0, 0);
		sync(ana, luis);

		const idEnAna = [...ana.snapshot.components.keys()][0];
		const idEnLuis = [...luis.snapshot.components.keys()][0];

		// Sin hablarse, cada uno lo arrastra a un sitio distinto.
		ana.moveComponent(idEnAna, 5, 5);
		luis.moveComponent(idEnLuis, 9, 1);
		sync(ana, luis);

		const posAna = ana.snapshot.components.get(idEnAna)!.pos;
		const posLuis = luis.snapshot.components.get(idEnLuis)!.pos;
		// No se parte en dos versiones: los dos ven la MISMA posicion.
		expect(posAna).toEqual(posLuis);
	});

	it('cambios a la vez en campos distintos del mismo componente se conservan los dos', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');
		ana.addComponent(2, 0, 0, { numInputs: 2 });
		sync(ana, luis);

		const idEnAna = [...ana.snapshot.components.keys()][0];
		const idEnLuis = [...luis.snapshot.components.keys()][0];

		// Ana lo mueve mientras Luis le cambia el numero de entradas.
		ana.moveComponent(idEnAna, 7, 7);
		luis.setOption(idEnLuis, 'numInputs', 4);
		sync(ana, luis);

		const resultado = ana.snapshot.components.get(idEnAna)!;
		expect(resultado.pos).toEqual([7, 7]);
		expect(resultado.options['numInputs']).toBe(4);
		expect(ana.visible()).toEqual(luis.visible());
	});

	it('borrar gana sobre editar a la vez, y no resucita el componente', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');
		ana.addComponent(2, 0, 0);
		sync(ana, luis);

		const idEnAna = [...ana.snapshot.components.keys()][0];
		const idEnLuis = [...luis.snapshot.components.keys()][0];

		luis.removeComponent(idEnLuis);
		ana.moveComponent(idEnAna, 3, 3);
		sync(ana, luis);

		expect(ana.snapshot.components.size).toBe(0);
		expect(luis.snapshot.components.size).toBe(0);
	});

	it('un cambio ajeno no vuelve a publicarse como propio', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');
		ana.addComponent(2, 1, 1);
		sync(ana, luis);

		// Tras asentarse, a ninguno le queda nada pendiente que aplicar: si el
		// motor devolviera ecos, este plan no estaria vacio.
		expect(isEmptyPlan(luis.applyRemote())).toBe(true);
		expect(isEmptyPlan(ana.applyRemote())).toBe(true);
		expect(readCircuit(ana.doc).components.size).toBe(1);
	});

	it('cinco personas colocando a la vez acaban viendo lo mismo', () => {
		const equipo = ['Ana', 'Luis', 'Pedro', 'Sara', 'Gio'].map(
			(n) => new FakeEditor(n)
		);
		equipo.forEach((editor, i) => editor.addComponent(i + 1, i * 3, i * 3));

		// Todos contra todos, varias rondas, hasta asentarse.
		for (let ronda = 0; ronda < 3; ronda++) {
			for (const a of equipo) for (const b of equipo) if (a !== b) sync(a, b);
		}

		const referencia = equipo[0].visible();
		for (const editor of equipo) {
			expect(editor.snapshot.components.size).toBe(5);
			expect(editor.visible()).toEqual(referencia);
		}
	});

	it('el cable que el editor parte en dos viaja como tal, sin volver a partirse', () => {
		const ana = new FakeEditor('Ana');
		const luis = new FakeEditor('Luis');

		// Ana dibuja un cable largo.
		const largo = ana.addWire(0, 5, 0, 10);
		sync(ana, luis);
		expect(luis.snapshot.wires.size).toBe(1);

		// Coloca una compuerta encima: el editor real quita el cable largo y
		// mete dos cortos. Aqui reproducimos ese resultado, que es lo que
		// publica la diferencia.
		const next = cloneLocal(ana.snapshot);
		next.wires.delete(largo);
		const a = 100;
		const b = 101;
		next.wires.set(a, wire(a, 0, 5, 0, 4));
		next.wires.set(b, wire(b, 6, 5, 0, 4));
		next.components.set(50, comp(50, 2, 4, 5));
		ana.commit(next);
		sync(ana, luis);

		// Luis ve exactamente dos cables y una compuerta: ni tres cables, ni el
		// largo resucitado.
		expect(luis.snapshot.wires.size).toBe(2);
		expect(luis.snapshot.components.size).toBe(1);
		expect(luis.visible()).toEqual(ana.visible());
	});
});
