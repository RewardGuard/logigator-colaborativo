/**
 * El circuito dentro de un documento Yjs.
 *
 * Esquema (https://docs.yjs.dev/api/shared-types):
 *
 *   Y.Map "components"  gid -> Y.Map { type, x, y, dir, options: Y.Map, negIn, negOut }
 *   Y.Map "wires"       gid -> Y.Map { x, y, dir, len }
 *
 * Cada elemento es un `Y.Map` propio, no un objeto plano, y eso es a proposito:
 * asi dos personas que tocan **el mismo** componente a la vez —una lo mueve y
 * la otra le cambia el numero de entradas— conservan ambos cambios, en vez de
 * que el ultimo en llegar pise el objeto entero. Lo mismo con `options`, que es
 * otro `Y.Map` anidado: cambiar dos opciones distintas del mismo componente no
 * provoca perdida.
 *
 * Cuando dos personas escriben literalmente el mismo campo del mismo elemento,
 * Yjs resuelve por su regla determinista de "ultimo escritor" y **todos los
 * participantes acaban con el mismo valor**, que es la garantia que importa:
 * el documento nunca se parte en dos versiones distintas.
 */

import * as Y from 'yjs';

import { SerializedComponent } from '../components/serialized-component.model';
import { SerializedWire } from '../wires/serialized-wire.model';
import { Gid } from './id-bridge';

export const COMPONENTS_KEY = 'components';
export const WIRES_KEY = 'wires';
export const META_KEY = 'meta';

/** Marca de origen de las transacciones propias, para no reaccionar a ellas. */
export const LOCAL_ORIGIN = 'logigator-local';

/** Un componente sin su id local: el id que vale en el documento es el gid. */
export type ComponentBody = Omit<SerializedComponent, 'id'>;
export type WireBody = Omit<SerializedWire, 'id'>;

export type YComponent = Y.Map<unknown>;
export type YWire = Y.Map<unknown>;

export function componentsMap(doc: Y.Doc): Y.Map<YComponent> {
	return doc.getMap<YComponent>(COMPONENTS_KEY);
}

export function wiresMap(doc: Y.Doc): Y.Map<YWire> {
	return doc.getMap<YWire>(WIRES_KEY);
}

export function metaMap(doc: Y.Doc): Y.Map<unknown> {
	return doc.getMap(META_KEY);
}

// --- Escritura --------------------------------------------------------------

/** Crea el `Y.Map` de un componente a partir de su forma serializada. */
export function buildYComponent(body: ComponentBody): YComponent {
	const map = new Y.Map<unknown>();
	map.set('type', body.type);
	map.set('x', body.pos[0]);
	map.set('y', body.pos[1]);
	map.set('dir', body.direction ?? 0);
	map.set('negIn', body.negInputs ?? []);
	map.set('negOut', body.negOutputs ?? []);
	const options = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(body.options)) {
		options.set(key, value);
	}
	map.set('options', options);
	return map;
}

/** Crea el `Y.Map` de un cable. */
export function buildYWire(body: WireBody): YWire {
	const map = new Y.Map<unknown>();
	map.set('x', body.pos[0]);
	map.set('y', body.pos[1]);
	map.set('dir', body.direction);
	map.set('len', body.length);
	return map;
}

/**
 * Actualiza un componente ya presente, escribiendo **solo** los campos que de
 * verdad cambian. Escribir un campo con el mismo valor generaria trafico y, mas
 * importante, haria que el otro lado creyera que hubo un cambio.
 */
export function updateYComponent(map: YComponent, body: ComponentBody): void {
	setIfChanged(map, 'type', body.type);
	setIfChanged(map, 'x', body.pos[0]);
	setIfChanged(map, 'y', body.pos[1]);
	setIfChanged(map, 'dir', body.direction ?? 0);
	setIndicesIfChanged(map, 'negIn', body.negInputs ?? []);
	setIndicesIfChanged(map, 'negOut', body.negOutputs ?? []);

	let options = map.get('options');
	if (!(options instanceof Y.Map)) {
		options = new Y.Map<unknown>();
		map.set('options', options);
	}
	const yOptions = options as Y.Map<unknown>;
	for (const [key, value] of Object.entries(body.options)) {
		if (!deepEqual(yOptions.get(key), value)) yOptions.set(key, value);
	}
	// Una opcion que desaparece del componente (cambio de tipo de un custom)
	// tiene que desaparecer tambien del documento.
	for (const key of [...yOptions.keys()]) {
		if (!(key in body.options)) yOptions.delete(key);
	}
}

/** Actualiza un cable ya presente. */
export function updateYWire(map: YWire, body: WireBody): void {
	setIfChanged(map, 'x', body.pos[0]);
	setIfChanged(map, 'y', body.pos[1]);
	setIfChanged(map, 'dir', body.direction);
	setIfChanged(map, 'len', body.length);
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
	if (map.get(key) !== value) map.set(key, value);
}

function setIndicesIfChanged(
	map: Y.Map<unknown>,
	key: string,
	value: number[]
): void {
	const current = map.get(key);
	if (!Array.isArray(current) || !sameNumbers(current, value)) {
		map.set(key, value);
	}
}

function sameNumbers(a: unknown[], b: number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
	}
	return false;
}

// --- Lectura ----------------------------------------------------------------

/**
 * Lee un componente del documento. Devuelve `null` si al `Y.Map` le falta algo
 * imprescindible: un documento puede venir de una version distinta del editor,
 * y es preferible ignorar un elemento que romper la sesion de los cinco.
 */
export function readYComponent(map: YComponent): ComponentBody | null {
	const type = map.get('type');
	const x = map.get('x');
	const y = map.get('y');
	if (
		typeof type !== 'number' ||
		typeof x !== 'number' ||
		typeof y !== 'number'
	) {
		return null;
	}

	const dir = map.get('dir');
	const negIn = map.get('negIn');
	const negOut = map.get('negOut');
	const rawOptions = map.get('options');
	const options: Record<string, unknown> =
		rawOptions instanceof Y.Map
			? (Object.fromEntries(rawOptions.entries()) as Record<string, unknown>)
			: {};

	return {
		type,
		pos: [x, y],
		...(typeof dir === 'number' && dir !== 0 ? { direction: dir } : {}),
		options,
		...(Array.isArray(negIn) && negIn.length
			? { negInputs: negIn as number[] }
			: {}),
		...(Array.isArray(negOut) && negOut.length
			? { negOutputs: negOut as number[] }
			: {})
	} as ComponentBody;
}

/** Lee un cable del documento, o `null` si esta incompleto. */
export function readYWire(map: YWire): WireBody | null {
	const x = map.get('x');
	const y = map.get('y');
	const dir = map.get('dir');
	const len = map.get('len');
	if (
		typeof x !== 'number' ||
		typeof y !== 'number' ||
		typeof dir !== 'number' ||
		typeof len !== 'number' ||
		len <= 0
	) {
		return null;
	}
	return { pos: [x, y], direction: dir, length: len } as WireBody;
}

/** Todo el circuito del documento, por gid. Util para pruebas y para cargar. */
export function readCircuit(doc: Y.Doc): {
	components: Map<Gid, ComponentBody>;
	wires: Map<Gid, WireBody>;
} {
	const components = new Map<Gid, ComponentBody>();
	for (const [gid, map] of componentsMap(doc).entries()) {
		const body = readYComponent(map);
		if (body) components.set(gid, body);
	}
	const wires = new Map<Gid, WireBody>();
	for (const [gid, map] of wiresMap(doc).entries()) {
		const body = readYWire(map);
		if (body) wires.set(gid, body);
	}
	return { components, wires };
}
