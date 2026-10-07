# Colaboración en tiempo real

Cómo el editor comparte un circuito entre varias personas. El resto de la
documentación de `docs/` está en inglés porque es del proyecto original; esta
página es de este fork y está en español, como el equipo que lo mantiene.

> Guía de instalación y uso: [`README-EQUIPO.md`](../../README-EQUIPO.md).

## El mapa

```
Project (PixiJS)  ──readProject──►  CircuitSnapshot  ──diffSnapshots──►  SnapshotDiff
      ▲                                                                       │
      │                                                                 publishDiff
applyPlanToProject                                                            │
      ▲                                                                       ▼
ReconcilePlan  ◄──planReconcile──  Y.Doc  ◄───── y-websocket ─────►  servicio `sync`
```

| Archivo | Qué hace |
|---|---|
| `circuit-snapshot.ts` | Instantánea del circuito y comparación entre dos. Datos puros. |
| `id-bridge.ts` | Correspondencia entre el id numérico local y el id global del documento. |
| `yjs-circuit.ts` | El esquema del documento Yjs: cómo se escribe y se lee un componente o un cable. |
| `circuit-sync.ts` | El motor: `publishDiff` hacia fuera, `planReconcile` hacia dentro. Sin dependencias del editor. |
| `project-bridge.ts` | Lo único que toca el `Project` real: leerlo y aplicarle un plan. |
| `collab.service.ts` | La sesión: conexión, presencia, panel de actividad. |
| `collab-session.service.ts` | Decide a qué sala conectarse y cuándo. |
| `collab-overlay/` | Cursores y selección ajena, dibujados sobre el lienzo. |
| `activity-panel/` | Qué ha cambiado y cuándo. |
| `presence-bar/` | Quién está conectado, en la barra superior. |

## Las cuatro decisiones que explican el resto

### 1. Se compara el estado, no se traducen las acciones

Lo intuitivo sería traducir cada `Action` del editor a una operación del CRDT.
No se hace, por dos razones:

- **Deshacer y rehacer no pasan por el gancho de grabación.** `ActionManager.undo()`
  llama a `action.undo(project)` directamente, sin tocar `onBeforeRecord`. Una
  traducción por acción se los perdería enteros.
- **Habría que mantenerla.** Hoy son once tipos de acción más `ActionContainer`;
  cada acción nueva del proyecto original sería un agujero silencioso.

En su lugar, en cada `actionChange$` se lee el circuito entero, se compara con lo
último publicado y se manda la diferencia. Agregar, borrar, mover, rotar,
conectar, cambiar propiedades, pegar, deshacer, rehacer y la reparación
automática de cables acaban todas en un estado, y el estado es lo que se compara.

El coste es recorrer el circuito una vez por operación del usuario. Para un
circuito de unos miles de elementos son unos pocos milisegundos, y solo ocurre
cuando alguien hace algo, no por fotograma.

### 2. Los ids del editor no se tocan

`Component._idAllocator` y `Wire._idAllocator` son contadores que empiezan en
cero en cada pestaña (`utils/id-allocator.ts`). Dos personas que coloquen una
compuerta a la vez obtienen el mismo número.

Cambiar ese asignador habría tocado la persistencia, el portapapeles, el
historial y el compilador de simulación. En vez de eso, cada elemento recibe
**además** un id global `<clientID de Yjs>-<n>`, y `IdBridge` mantiene la
correspondencia en los dos sentidos. El editor sigue viendo sus números de
siempre.

### 3. Los cambios remotos no pasan por el historial

`applyPlanToProject` muta el `Project` directamente, sin crear `Action`s. Eso da
dos cosas a la vez:

- **Deshacer por persona**: tu pila solo contiene lo tuyo, así que tu Ctrl+Z
  nunca deshace el trabajo de otro.
- **Topología de cables coherente**: el editor parte y fusiona cables en cada
  cambio estructural (`project/wire-topology.ts`). Quien hizo la edición ya corrió
  esa integración y su resultado viaja en el documento. Volver a integrarlo al
  recibirlo partiría cables ya partidos, y los dos lados llegarían a resultados
  distintos.

### 4. La presencia va por awareness, no por el documento

Dónde está el cursor y qué hay seleccionado es información de este instante. Si
viviera en el documento se guardaría en disco, entraría en el historial y
quedaría colgada cuando alguien cierra la pestaña. El awareness de Yjs
(`y-protocols`) está hecho justo para esto y se limpia solo.

## Dos carreras que costaron un rato encontrar

Las dos se vieron solo probando con dos navegadores de verdad, y las dos
producían **duplicación del circuito entero**. Las describo porque el síntoma
engaña: el CRDT fusiona sin quejarse, así que todo el mundo acaba de acuerdo…
sobre un circuito duplicado.

**Publicar antes de la primera sincronización.** Entre conectar y sincronizar, un
cambio local comparaba el circuito contra una base vacía y publicaba el circuito
completo encima de un documento que ya lo tenía. Lo arregla la bandera `ready`
de la sesión: hasta la primera sincronización no se publica nada.

**Entrar a una sala que ya tiene contenido.** El editor acababa de cargar el
proyecto del servidor, así que tenía los mismos elementos que el documento pero
con ids locales que no correspondían a ningún id global. Lo arregla
`_adoptDocument`: al entrar a una sala con contenido manda el documento y lo
local se descarta, igual que al abrir un documento compartido de texto.

Hay una tercera, del lado del servidor, documentada en `logigator-sync/src/server.js`:
el oyente de actualizaciones de `bindState` se registra **antes** de los `await`,
porque si no, lo que llegue en esa ventana se ve en pantalla pero no se escribe en
disco, y desaparece al reiniciar.

## Pruebas

```bash
# Motor de sincronización (Vitest, sin navegador: dos Y.Doc en memoria)
docker compose exec editor yarn test --watch=false --include='**/collab/*.spec.ts'

# Servidor de sincronización (node --test, de punta a punta con clientes reales)
docker compose exec sync yarn test
```

`circuit-sync.spec.ts` no comprueba que las funciones no exploten, sino las
propiedades que importan cuando cinco personas editan la misma CPU:
convergencia, que nadie pierda su trabajo por un cambio simultáneo ajeno, que
los contadores de ids de cada quien no se estorben, y que un cable partido viaje
como tal sin volver a partirse.

## Lo que no hace

Está en [README-EQUIPO.md](../../README-EQUIPO.md#límites-conocidos), y conviene
leerlo antes de prometer nada: autoría aproximada en el panel de actividad,
deshacer capaz de pisar una edición posterior de otro sobre el mismo elemento,
dos piezas posibles en la misma casilla, y simulación local a cada navegador.
