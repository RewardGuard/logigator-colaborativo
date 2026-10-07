/**
 * El puente entre el motor de sincronizacion (datos puros) y el `Project` real
 * del editor (objetos de la escena de PixiJS).
 *
 * Son las dos unicas funciones que tocan el editor de verdad:
 *
 *   `readProject`      el circuito vivo -> instantanea comparable
 *   `applyPlanToProject`  plan de reconciliacion -> mutaciones en el proyecto
 *
 * Aplicar cambios remotos **no** pasa por el `ActionManager`, y eso es
 * deliberado por dos razones. La primera es que el historial de deshacer debe
 * contener solo lo que hizo uno mismo: si lo que hace otro entrara en mi pila,
 * mi Ctrl+Z desharia su trabajo. La segunda es que el editor reintegra la
 * topologia de cables en cada cambio estructural, y quien hizo la edicion ya
 * corrio esa integracion: su resultado viaja en el documento compartido. Volver
 * a integrarla aqui partiria cables ya partidos.
 */

import { Point } from 'pixi.js';

import { Component } from '../components/component';
import { ComponentProviderService } from '../components/component-provider.service';
import { Project } from '../project/project';
import { Wire } from '../wires/wire';
import { WireDirection } from '../wires/wire-direction.enum';
import { Direction } from '../utils/direction';
import { CircuitSnapshot } from './circuit-snapshot';
import { Bridges, ReconcilePlan } from './circuit-sync';

/** Lee el circuito vivo como instantanea comparable. */
export function readProject(project: Project): CircuitSnapshot {
	const components = new Map<number, ReturnType<typeof Component.serialize>>();
	for (const component of project.components) {
		components.set(component.id, Component.serialize(component));
	}
	const wires = new Map<number, ReturnType<typeof Wire.serialize>>();
	for (const wire of project.wires) {
		wires.set(wire.id, Wire.serialize(wire));
	}
	return { components, wires };
}

/** Lo que se aplico, para informar al panel de actividad. */
export interface AppliedChanges {
	addedComponents: Component[];
	removedComponentIds: number[];
	updatedComponents: Component[];
	addedWires: Wire[];
	removedWireIds: number[];
	updatedWires: Wire[];
}

/**
 * Aplica un plan al proyecto. Devuelve lo que realmente se aplico, que puede
 * ser menos de lo pedido: un componente de un tipo que este editor no conoce
 * —un componente personalizado que todavia no se ha cargado— se omite en vez de
 * romper la sesion.
 */
export function applyPlanToProject(
	project: Project,
	plan: ReconcilePlan,
	bridges: Bridges,
	provider: ComponentProviderService
): AppliedChanges {
	const applied: AppliedChanges = {
		addedComponents: [],
		removedComponentIds: [],
		updatedComponents: [],
		addedWires: [],
		removedWireIds: [],
		updatedWires: []
	};

	// Primero los borrados: si alguien movio una compuerta al sitio que deja
	// libre otra que se borra, hacerlo al reves daria una colision falsa.
	for (const localId of plan.removeComponentIds) {
		project.removeComponent(localId);
		bridges.components.unlinkLocal(localId);
		applied.removedComponentIds.push(localId);
	}
	for (const localId of plan.removeWireIds) {
		project.removeWire(localId);
		bridges.wires.unlinkLocal(localId);
		applied.removedWireIds.push(localId);
	}

	for (const { gid, body } of plan.addComponents) {
		const config = provider.getComponent(body.type);
		if (!config) continue; // tipo desconocido aqui: lo dejamos pasar
		const component = Component.deserialize(body, config);
		// `deferConnectionPoints`: los puntos de union se recalculan una sola
		// vez al final, no una vez por elemento.
		project.addComponent(component, true);
		bridges.components.link(gid, component.id);
		applied.addedComponents.push(component);
	}

	for (const { gid, body } of plan.addWires) {
		const wire = Wire.deserialize(body);
		project.addWire(wire, true);
		bridges.wires.link(gid, wire.id);
		applied.addedWires.push(wire);
	}

	for (const { localId, body } of plan.updateComponents) {
		const component = project.getComponentById(localId);
		if (!component) continue;

		const targetDirection = (body.direction ?? Direction.E) as Direction;
		const position = new Point(body.pos[0], body.pos[1]);
		if (component.direction !== targetDirection) {
			project.rotateComponent(localId, targetDirection, position);
		} else if (
			component.position.x !== position.x ||
			component.position.y !== position.y
		) {
			project.moveComponent(localId, position);
		}

		for (const [key, value] of Object.entries(body.options)) {
			const option = component.options[key];
			if (option && option.value !== value) {
				option.value = value;
			}
		}

		component.setNegations(body.negInputs ?? [], body.negOutputs ?? []);
		applied.updatedComponents.push(component);
	}

	for (const { localId, body } of plan.updateWires) {
		const wire = project.getWireById(localId);
		if (!wire) continue;
		// Las coordenadas serializadas son enteras; el cable vive desplazado
		// medio cuadro (ver `Wire.deserialize`).
		project.setWireGeometry(
			localId,
			new Point(body.pos[0] + 0.5, body.pos[1] + 0.5),
			body.direction as WireDirection
		);
		if (wire.length !== body.length) {
			// La longitud no tiene mutador propio en `Project`: se reemplaza el
			// cable por uno con la geometria correcta, conservando su gid.
			const gid = bridges.wires.gidOf(localId);
			project.removeWire(localId);
			bridges.wires.unlinkLocal(localId);
			const replacement = Wire.deserialize(body);
			project.addWire(replacement, true);
			if (gid !== undefined) bridges.wires.link(gid, replacement.id);
			applied.updatedWires.push(replacement);
		} else {
			applied.updatedWires.push(wire);
		}
	}

	project.recomputeConnectionPoints();
	project.triggerTicker('single');

	return applied;
}
