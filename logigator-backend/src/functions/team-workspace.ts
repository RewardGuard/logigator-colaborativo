import {Container} from 'typedi';
import {ConfigService} from '../services/config.service';

/**
 * Modo "espacio de equipo".
 *
 * Esta instalacion es privada: no hay registro publico y las unicas cuentas que
 * existen son las que dio de alta quien administra el servidor
 * (`tools/seed-team.js`). En ese escenario, el filtro por propietario de
 * Logigator estorba mas de lo que protege: impediria que un companero abriera
 * el proyecto de otro, que es justo lo que el equipo necesita.
 *
 * Con `teamWorkspace: true` en `config/environment.json`, los proyectos y los
 * componentes son del equipo entero. Siguen siendo privados hacia fuera —
 * `public` sigue en false y nadie sin sesion entra—, lo que cambia es que el
 * limite pasa a ser el equipo en vez de la persona.
 *
 * Con `teamWorkspace: false` (el valor por defecto, y el comportamiento
 * original de Logigator) cada quien solo ve y edita lo suyo.
 */
export function isTeamWorkspace(): boolean {
	return (
		Container.get(ConfigService).getConfig('environment').teamWorkspace === true
	);
}
