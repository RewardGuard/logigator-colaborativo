/**
 * Instantanea del circuito y comparacion entre instantaneas.
 *
 * Es la base de la sincronizacion: en vez de traducir cada `Action` del editor
 * a una operacion del CRDT —once tipos hoy, mas los que se anadan manana, mas
 * `ActionContainer`, y nada que cubra deshacer/rehacer, que no pasan por el
 * gancho de grabacion— comparamos el estado del circuito contra lo ultimo que
 * publicamos y mandamos solo la diferencia.
 *
 * Eso cubre de un golpe agregar, borrar, mover, rotar, conectar, cambiar
 * propiedades, pegar, deshacer, rehacer y la reparacion automatica de cables
 * (que parte y fusiona cables por su cuenta en cada cambio estructural, ver
 * `project/wire-topology.ts`): todas acaban en un estado, y el estado es lo que
 * se compara.
 *
 * Aqui no se importa nada de Angular ni de PixiJS a proposito: son datos puros
 * y funciones puras, para poder probarlos sin navegador.
 */

import { SerializedComponent } from '../components/serialized-component.model';
import { SerializedWire } from '../wires/serialized-wire.model';

/** El circuito en un instante, indexado por el id numerico local. */
export interface CircuitSnapshot {
	components: Map<number, SerializedComponent>;
	wires: Map<number, SerializedWire>;
}

/** Instantanea vacia, el punto de partida de una sesion. */
export function emptySnapshot(): CircuitSnapshot {
	return { components: new Map(), wires: new Map() };
}

/** Lo que cambio entre dos instantaneas. */
export interface SnapshotDiff {
	addedComponents: SerializedComponent[];
	removedComponentIds: number[];
	/** Solo los componentes cuyo contenido cambio (mismo id, distintos datos). */
	changedComponents: SerializedComponent[];
	addedWires: SerializedWire[];
	removedWireIds: number[];
	changedWires: SerializedWire[];
}

/** Cierto cuando la diferencia no contiene nada que publicar. */
export function isEmptyDiff(diff: SnapshotDiff): boolean {
	return (
		diff.addedComponents.length === 0 &&
		diff.removedComponentIds.length === 0 &&
		diff.changedComponents.length === 0 &&
		diff.addedWires.length === 0 &&
		diff.removedWireIds.length === 0 &&
		diff.changedWires.length === 0
	);
}

/**
 * Compara dos valores de opcion. Las opciones son `unknown`: numeros, textos,
 * booleanos y, en componentes como la ROM, arreglos de numeros. Comparamos por
 * valor para no publicar un cambio donde no lo hubo.
 */
function sameOptionValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => sameOptionValue(v, b[i]));
	}
	if (
		typeof a === 'object' &&
		typeof b === 'object' &&
		a !== null &&
		b !== null
	) {
		const ka = Object.keys(a as object);
		const kb = Object.keys(b as object);
		if (ka.length !== kb.length) return false;
		return ka.every((k) =>
			sameOptionValue(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k]
			)
		);
	}
	return false;
}

function sameIndices(a: number[] | undefined, b: number[] | undefined): boolean {
	const xs = a ?? [];
	const ys = b ?? [];
	return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
}

/** Cierto si los dos componentes son identicos en todo lo que se sincroniza. */
export function sameComponent(
	a: SerializedComponent,
	b: SerializedComponent
): boolean {
	if (a.type !== b.type) return false;
	if (a.pos[0] !== b.pos[0] || a.pos[1] !== b.pos[1]) return false;
	// `direction` se omite cuando mira al Este, asi que 0 y ausente son iguales.
	if ((a.direction ?? 0) !== (b.direction ?? 0)) return false;
	if (!sameIndices(a.negInputs, b.negInputs)) return false;
	if (!sameIndices(a.negOutputs, b.negOutputs)) return false;

	const keys = new Set([...Object.keys(a.options), ...Object.keys(b.options)]);
	for (const key of keys) {
		if (!sameOptionValue(a.options[key], b.options[key])) return false;
	}
	return true;
}

/** Cierto si los dos cables son identicos. */
export function sameWire(a: SerializedWire, b: SerializedWire): boolean {
	return (
		a.pos[0] === b.pos[0] &&
		a.pos[1] === b.pos[1] &&
		a.direction === b.direction &&
		a.length === b.length
	);
}

/**
 * Diferencia de `previous` a `next`. El id numerico es la identidad: el
 * asignador del editor (`utils/id-allocator.ts`) nunca reutiliza un numero
 * dentro de una sesion, y deshacer vuelve a meter las mismas instancias, asi
 * que un id que reaparece es el mismo elemento, no otro distinto.
 */
export function diffSnapshots(
	previous: CircuitSnapshot,
	next: CircuitSnapshot
): SnapshotDiff {
	const diff: SnapshotDiff = {
		addedComponents: [],
		removedComponentIds: [],
		changedComponents: [],
		addedWires: [],
		removedWireIds: [],
		changedWires: []
	};

	for (const [id, component] of next.components) {
		const before = previous.components.get(id);
		if (before === undefined) diff.addedComponents.push(component);
		else if (!sameComponent(before, component))
			diff.changedComponents.push(component);
	}
	for (const id of previous.components.keys()) {
		if (!next.components.has(id)) diff.removedComponentIds.push(id);
	}

	for (const [id, wire] of next.wires) {
		const before = previous.wires.get(id);
		if (before === undefined) diff.addedWires.push(wire);
		else if (!sameWire(before, wire)) diff.changedWires.push(wire);
	}
	for (const id of previous.wires.keys()) {
		if (!next.wires.has(id)) diff.removedWireIds.push(id);
	}

	return diff;
}

/** Copia profunda de una instantanea, para guardarla como referencia. */
export function cloneSnapshot(snapshot: CircuitSnapshot): CircuitSnapshot {
	const components = new Map<number, SerializedComponent>();
	for (const [id, c] of snapshot.components) {
		components.set(id, {
			...c,
			pos: [c.pos[0], c.pos[1]],
			options: { ...c.options },
			...(c.negInputs ? { negInputs: [...c.negInputs] } : {}),
			...(c.negOutputs ? { negOutputs: [...c.negOutputs] } : {})
		});
	}
	const wires = new Map<number, SerializedWire>();
	for (const [id, w] of snapshot.wires) {
		wires.set(id, { ...w, pos: [w.pos[0], w.pos[1]] });
	}
	return { components, wires };
}
