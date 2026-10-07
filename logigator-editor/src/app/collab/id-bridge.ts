/**
 * Puente entre los ids del editor y los ids del documento compartido.
 *
 * El editor numera sus elementos con un contador por clase que empieza en cero
 * en cada pestana (`Component._idAllocator`, `Wire._idAllocator`, ver
 * `utils/id-allocator.ts`). Eso basta mientras edita una sola persona, pero en
 * cuanto hay cinco, dos que coloquen una compuerta a la vez obtienen el mismo
 * numero, y el CRDT no tendria forma de distinguirlas.
 *
 * En vez de tocar ese asignador —de el dependen la persistencia, el
 * portapapeles, el historial y el compilador de simulacion— cada elemento
 * recibe ademas un **id global** de la forma `<clientID de Yjs>-<n>`, unico
 * entre todos los participantes sin necesidad de coordinarse. Este puente
 * guarda la correspondencia en los dos sentidos.
 */

/** Id global de un elemento dentro del documento compartido. */
export type Gid = string;

export class IdBridge {
	private readonly _localByGid = new Map<Gid, number>();
	private readonly _gidByLocal = new Map<number, Gid>();
	private _counter = 0;

	/**
	 * @param clientId el `clientID` del Y.Doc, unico por sesion de edicion
	 */
	constructor(private readonly clientId: number) {}

	/** Acuna un id global nuevo, que nadie mas puede generar. */
	public mint(): Gid {
		return `${this.clientId}-${this._counter++}`;
	}

	/** Asocia un id global con un id local del editor. */
	public link(gid: Gid, localId: number): void {
		// Si alguno de los dos ya estaba asociado a otra cosa, deshacemos esa
		// asociacion primero para que el puente no quede con restos.
		const previousLocal = this._localByGid.get(gid);
		if (previousLocal !== undefined) this._gidByLocal.delete(previousLocal);
		const previousGid = this._gidByLocal.get(localId);
		if (previousGid !== undefined) this._localByGid.delete(previousGid);

		this._localByGid.set(gid, localId);
		this._gidByLocal.set(localId, gid);
	}

	public localOf(gid: Gid): number | undefined {
		return this._localByGid.get(gid);
	}

	public gidOf(localId: number): Gid | undefined {
		return this._gidByLocal.get(localId);
	}

	public hasGid(gid: Gid): boolean {
		return this._localByGid.has(gid);
	}

	public hasLocal(localId: number): boolean {
		return this._gidByLocal.has(localId);
	}

	public unlinkGid(gid: Gid): void {
		const localId = this._localByGid.get(gid);
		this._localByGid.delete(gid);
		if (localId !== undefined) this._gidByLocal.delete(localId);
	}

	public unlinkLocal(localId: number): void {
		const gid = this._gidByLocal.get(localId);
		this._gidByLocal.delete(localId);
		if (gid !== undefined) this._localByGid.delete(gid);
	}

	public get size(): number {
		return this._localByGid.size;
	}

	public clear(): void {
		this._localByGid.clear();
		this._gidByLocal.clear();
	}

	/** Todos los pares conocidos, para depuracion y pruebas. */
	public entries(): IterableIterator<[Gid, number]> {
		return this._localByGid.entries();
	}
}
