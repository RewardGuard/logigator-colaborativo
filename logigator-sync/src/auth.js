/**
 * Autenticacion del servidor de sincronizacion.
 *
 * No tenemos usuarios propios: reutilizamos la sesion del backend de Logigator
 * (Passport + sesiones en Redis). El navegador abre el WebSocket contra el mismo
 * origen que la aplicacion, asi que manda su cookie de sesion en la peticion de
 * upgrade. Reenviamos esa cookie tal cual a `GET /api/user` del backend, que
 * esta protegido por `CheckAuthenticatedApiMiddleware`:
 *
 *  - 200 -> la sesion es valida; la respuesta trae el id y el nombre del usuario
 *  - 401 -> no hay sesion; rechazamos el upgrade
 *
 * De este modo la lista de quien puede entrar la sigue mandando el backend, y
 * aqui no se guarda ninguna credencial.
 */

/**
 * @typedef {{ id: string, username: string }} SyncUser
 */

/** Respuestas del backend cacheadas un instante, por cookie. */
const cache = new Map();
const CACHE_TTL_MS = 10_000;

/**
 * Comprueba la cookie contra el backend y devuelve el usuario, o null.
 *
 * @param {string | undefined} cookieHeader cabecera `Cookie` de la peticion
 * @param {string} backendUrl base del backend, p. ej. http://backend:3000
 * @returns {Promise<SyncUser | null>}
 */
export async function authenticate(cookieHeader, backendUrl) {
	if (!cookieHeader) return null;

	const cached = cache.get(cookieHeader);
	if (cached && cached.expires > Date.now()) return cached.user;

	let user = null;
	try {
		const response = await fetch(`${backendUrl}/api/user`, {
			headers: { cookie: cookieHeader, accept: 'application/json' }
		});
		if (response.ok) {
			const body = await response.json();
			// El backend envuelve las respuestas de la API en { status, data }
			// (ApiInterceptor); aceptamos las dos formas por si eso cambia.
			const data = body?.data ?? body;
			if (data?.id) {
				user = { id: String(data.id), username: String(data.username ?? '') };
			}
		}
	} catch (err) {
		console.error('[sync] no se pudo consultar al backend:', err.message);
		return null;
	}

	cache.set(cookieHeader, { user, expires: Date.now() + CACHE_TTL_MS });
	return user;
}

/**
 * Nombres de sala permitidos.
 *
 * Una sala es un documento editable: el proyecto principal (`project:<id>`) o
 * un componente personalizado maestro abierto para editar (`custom:<id>`).
 * `local:<id>` cubre los documentos que todavia no se han guardado en el
 * servidor, para poder colaborar antes del primer guardado.
 *
 * Restringimos el formato para que un nombre de sala no pueda convertirse en
 * una ruta de disco inesperada en la capa de persistencia.
 */
const ROOM_PATTERN = /^(project|custom|local):[A-Za-z0-9_-]{1,64}$/;

/**
 * @param {string} room
 * @returns {boolean}
 */
export function isValidRoom(room) {
	return ROOM_PATTERN.test(room);
}
