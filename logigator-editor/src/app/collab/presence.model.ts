/**
 * Lo que cada persona publica sobre si misma en la sala.
 *
 * Viaja por el **awareness** de Yjs (https://github.com/yjs/y-protocols), no por
 * el documento: es informacion efimera —donde tengo el cursor, que tengo
 * seleccionado— que no debe guardarse en disco ni entrar en el historial. Si
 * alguien cierra la pestana o pierde la conexion, su estado desaparece solo.
 */

/** Estado de presencia tal y como viaja por el awareness. */
export interface PresenceState {
	name: string;
	color: string;
	/** Cursor en coordenadas de rejilla del circuito, no en pixeles de pantalla. */
	cursor?: { x: number; y: number };
	/** Ids globales de los elementos seleccionados. */
	selection?: string[];
}

/**
 * Colores de participante.
 *
 * Elegidos para distinguirse entre si y para leerse sobre el fondo oscuro y el
 * claro del editor. Se reparten por `clientID`, que Yjs asigna al azar, asi que
 * con cinco personas la probabilidad de repetir color es baja; si se repitiera,
 * el nombre junto al cursor sigue desambiguando.
 */
export const PRESENCE_COLORS: readonly string[] = [
	'#e8524f', // rojo
	'#2fa8df', // azul
	'#f0a33a', // ambar
	'#8e6fd8', // violeta
	'#27ae60', // verde
	'#e2679e', // rosa
	'#19b3a6', // turquesa
	'#c0803a' // bronce
];
