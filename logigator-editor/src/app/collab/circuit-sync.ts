/**
 * El motor de sincronizacion, en los dos sentidos y sin dependencias del
 * editor: datos puros, para poder probarlo entero sin navegador ni PixiJS.
 *
 *   local -> documento   `publishDiff`    publica lo que cambio en el editor
 *   documento -> local   `planReconcile`  dice que hay que hacerle al editor
 *
 * La asimetria es deliberada. Hacia fuera publicamos una diferencia; hacia
 * dentro no aplicamos diferencias sino que calculamos un plan contra el estado
 * real del editor, porque entre que llega un cambio remoto y se aplica, el
 * editor pudo haber cambiado por su cuenta.
 *
 * Importante sobre los cables: el editor parte y fusiona cables solo, cada vez
 * que algo estructural cambia cerca (`project/wire-topology.ts`). Quien hace la
 * edicion ya corrio esa integracion, y el resultado —el cable que desaparecio y
 * los dos que nacieron— viaja en la misma diferencia. Por eso al aplicar un
 * cambio remoto **no** se vuelve a integrar: se copia el conjunto de elementos
 * tal cual esta en el documento. Integrar otra vez duplicaria el trabajo y
 * llevaria a los dos lados a resultados distintos.
 */

import * as Y from 'yjs';

import {
	CircuitSnapshot,
	SnapshotDiff,
	sameComponent,
	sameWire
} from './circuit-snapshot';
import { Gid, IdBridge } from './id-bridge';
import {
	ComponentBody,
	WireBody,
	buildYComponent,
	buildYWire,
	componentsMap,
	readYComponent,
	readYWire,
	updateYComponent,
	updateYWire,
	wiresMap,
	YComponent,
	YWire
} from './yjs-circuit';

/** Los dos puentes de ids de un documento: los componentes y los cables se numeran aparte. */
export interface Bridges {
	components: IdBridge;
	wires: IdBridge;
}

export function createBridges(clientId: number): Bridges {
	return {
		components: new IdBridge(clientId),
		wires: new IdBridge(clientId)
	};
}

// --- local -> documento -----------------------------------------------------

/**
 * Vuelca una diferencia local en el documento compartido, dentro de **una sola
 * transaccion**: los demas la reciben como un unico cambio, no como una lluvia
 * de cambios sueltos, y asi nadie ve un estado intermedio incoherente (por
 * ejemplo el cable ya partido pero la compuerta aun sin colocar).
 *
 * @param doc documento Yjs destino
 * @param diff lo que cambio en el editor
 * @param bridges correspondencia de ids, que esta funcion mantiene al dia
 * @param origin marca de origen, para distinguir luego lo propio de lo ajeno
 */
export function publishDiff(
	doc: Y.Doc,
	diff: SnapshotDiff,
	bridges: Bridges,
	origin: unknown
): void {
	const components = componentsMap(doc);
	const wires = wiresMap(doc);

	doc.transact(() => {
		for (const component of diff.addedComponents) {
			const { id, ...body } = component;
			const gid = bridges.components.mint();
			bridges.components.link(gid, id);
			components.set(gid, buildYComponent(body));
		}

		for (const component of diff.changedComponents) {
			const { id, ...body } = component;
			const gid = bridges.components.gidOf(id);
			if (gid === undefined) continue;
			const existing = components.get(gid);
			// Si otro lo borro mientras lo editabamos, no lo resucitamos: el
			// borrado gana, que es lo menos sorprendente para quien lo borro.
			if (!existing) {
				bridges.components.unlinkLocal(id);
				continue;
			}
			updateYComponent(existing, body);
		}

		for (const localId of diff.removedComponentIds) {
			const gid = bridges.components.gidOf(localId);
			if (gid === undefined) continue;
			components.delete(gid);
			bridges.components.unlinkLocal(localId);
		}

		for (const wire of diff.addedWires) {
			const { id, ...body } = wire;
			const gid = bridges.wires.mint();
			bridges.wires.link(gid, id);
			wires.set(gid, buildYWire(body));
		}

		for (const wire of diff.changedWires) {
			const { id, ...body } = wire;
			const gid = bridges.wires.gidOf(id);
			if (gid === undefined) continue;
			const existing = wires.get(gid);
			if (!existing) {
				bridges.wires.unlinkLocal(id);
				continue;
			}
			updateYWire(existing, body);
		}

		for (const localId of diff.removedWireIds) {
			const gid = bridges.wires.gidOf(localId);
			if (gid === undefined) continue;
			wires.delete(gid);
			bridges.wires.unlinkLocal(localId);
		}
	}, origin);
}

// --- documento -> local -----------------------------------------------------

/** Lo que hay que hacerle al editor para que coincida con el documento. */
export interface ReconcilePlan {
	addComponents: { gid: Gid; body: ComponentBody }[];
	updateComponents: { gid: Gid; localId: number; body: ComponentBody }[];
	removeComponentIds: number[];
	addWires: { gid: Gid; body: WireBody }[];
	updateWires: { gid: Gid; localId: number; body: WireBody }[];
	removeWireIds: number[];
}

export function isEmptyPlan(plan: ReconcilePlan): boolean {
	return (
		plan.addComponents.length === 0 &&
		plan.updateComponents.length === 0 &&
		plan.removeComponentIds.length === 0 &&
		plan.addWires.length === 0 &&
		plan.updateWires.length === 0 &&
		plan.removeWireIds.length === 0
	);
}

/**
 * Calcula que le falta o le sobra al editor respecto del documento.
 *
 * `local` es el estado real del editor en este instante, no una copia vieja:
 * asi un elemento que el documento ya tiene y el editor tambien se deja en paz,
 * y no se toca nada que no haga falta tocar (mover un componente destruye y
 * recrea los puntos de union a su alrededor, asi que tocar de mas se ve).
 */
export function planReconcile(
	doc: Y.Doc,
	local: CircuitSnapshot,
	bridges: Bridges
): ReconcilePlan {
	const plan: ReconcilePlan = {
		addComponents: [],
		updateComponents: [],
		removeComponentIds: [],
		addWires: [],
		updateWires: [],
		removeWireIds: []
	};

	const seenComponentGids = new Set<Gid>();
	for (const [gid, map] of componentsMap(doc).entries()) {
		seenComponentGids.add(gid);
		const body = readYComponent(map as YComponent);
		if (!body) continue; // elemento incompleto: lo ignoramos a proposito

		const localId = bridges.components.localOf(gid);
		const current = localId === undefined ? undefined : local.components.get(localId);
		if (current === undefined) {
			// O es nuevo para nosotros, o el puente apunta a algo que ya no
			// existe en el editor: en ambos casos hay que crearlo.
			plan.addComponents.push({ gid, body });
		} else if (!sameComponent(current, { ...body, id: current.id })) {
			// Solo lo que de verdad cambio: mover un componente destruye y
			// recrea los puntos de union a su alrededor, asi que tocar de mas
			// se nota en pantalla.
			plan.updateComponents.push({ gid, localId: localId as number, body });
		}
	}

	for (const [gid, localId] of bridges.components.entries()) {
		if (!seenComponentGids.has(gid) && local.components.has(localId)) {
			plan.removeComponentIds.push(localId);
		}
	}

	const seenWireGids = new Set<Gid>();
	for (const [gid, map] of wiresMap(doc).entries()) {
		seenWireGids.add(gid);
		const body = readYWire(map as YWire);
		if (!body) continue;

		const localId = bridges.wires.localOf(gid);
		const current = localId === undefined ? undefined : local.wires.get(localId);
		if (current === undefined) {
			plan.addWires.push({ gid, body });
		} else if (!sameWire(current, { ...body, id: current.id })) {
			plan.updateWires.push({ gid, localId: localId as number, body });
		}
	}

	for (const [gid, localId] of bridges.wires.entries()) {
		if (!seenWireGids.has(gid) && local.wires.has(localId)) {
			plan.removeWireIds.push(localId);
		}
	}

	return plan;
}
