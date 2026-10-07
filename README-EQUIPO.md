# Logigator colaborativo — guía del equipo

Esta es una versión autohospedada y privada de [Logigator](https://github.com/logigator/logigator)
en la que **varias personas editan el mismo circuito a la vez**, como en un documento
compartido: cada quien ve lo que hacen los demás al instante, con su cursor y su color.

Nada de esto pasa por logigator.com. Todo corre en una máquina vuestra, y se entra por
una red privada de Tailscale.

---

## Índice

- [Qué se añadió al proyecto original](#qué-se-añadió-al-proyecto-original)
- [Lo que hace falta](#lo-que-hace-falta)
- [Instalación, paso a paso](#instalación-paso-a-paso)
- [Tailscale en los cinco equipos](#tailscale-en-los-cinco-equipos)
- [Cómo se usa](#cómo-se-usa)
- [Variables de entorno](#variables-de-entorno)
- [Operación diaria](#operación-diaria)
- [Qué hacer si algo falla](#qué-hacer-si-algo-falla)
- [Cómo funciona por dentro](#cómo-funciona-por-dentro)
- [Límites conocidos](#límites-conocidos)
- [Licencia](#licencia)

---

## Qué se añadió al proyecto original

| | |
|---|---|
| **Edición simultánea** | Agregar, borrar, mover, rotar, conectar y cambiar propiedades, todo al instante para todos. Incluye los componentes personalizados: cada uno abierto para editar es su propio documento compartido. |
| **Presencia** | Lista de quién está conectado, el cursor de cada quien sobre el lienzo con su nombre, y un recuadro del color de cada persona alrededor de lo que tiene seleccionado. |
| **Panel de actividad** | Qué ha ido cambiando y a qué hora. |
| **Deshacer por persona** | Tu Ctrl+Z deshace **lo tuyo**, nunca el trabajo de otro. |
| **Sin registro público** | Solo entran las cuentas que das de alta tú. La página de registro no existe. |
| **Proyectos del equipo** | Los proyectos son privados hacia fuera y compartidos entre los cinco: cualquiera puede abrir el de cualquiera. |
| **Aguanta cortes** | Si a alguien se le cae internet puede seguir editando; al volver, su trabajo y el de los demás se fusionan solos. El servidor puede reiniciarse sin perder nada. |

---

## Lo que hace falta

- **Una máquina que haga de servidor**, encendida mientras trabajéis. Vale cualquier
  computadora del equipo. Con 4 GB de RAM va justo pero funciona; 8 GB va cómodo.
- **Docker** con el complemento Compose, instalado en esa máquina.
- **Una cuenta de Tailscale** (la gratuita basta y sobra para 5 personas).

En los otros cuatro equipos **no hace falta instalar nada** salvo Tailscale: se entra
por el navegador.

---

## Instalación, paso a paso

Todo esto se hace **una sola vez**, en la máquina que vaya a ser el servidor.

### 1. Traer el código

```bash
git clone <la-url-de-vuestro-repositorio> logigator-colaborativo
cd logigator-colaborativo
```

### 2. Crear los archivos de configuración del backend

```bash
for f in logigator-backend/config/*.example; do cp -n "$f" "${f%.example}"; done
```

Luego hay que tocar dos cosas en `logigator-backend/config/`:

**`session.json`** — pon un secreto largo y aleatorio. Lo genera este comando:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**`domains.json`** — `rootUrl` tiene que ser la dirección por la que entraréis:

```json
{
  "rootUrl": "https://mi-pc.tu-tailnet.ts.net",
  "editor": "/editor",
  "editorLegacy": "/legacy-editor"
}
```

> Si no sabes todavía el nombre de Tailscale, haz primero el
> [paso de Tailscale](#tailscale-en-los-cinco-equipos) y vuelve aquí.

### 3. Crear el `.env`

```bash
cp .env.example .env
```

Ábrelo y rellena, como mínimo:

- `LOGIGATOR_HOST` — el nombre de Tailscale de esta máquina
- `LOGIGATOR_BIND` — su IP de Tailscale, que da `tailscale ip -4`
- `MYSQL_ROOT_PASSWORD` y `MYSQL_PASSWORD` — contraseñas tuyas
- `LOGIGATOR_TEAM` — las cinco personas

`LOGIGATOR_BIND` es importante: con el valor por defecto (`127.0.0.1`) el servidor solo
se ve a sí mismo y tus compañeros no llegarían. Poniendo ahí la IP de Tailscale, el
servidor queda visible **para los cinco y para nadie más**, ni siquiera para el resto
de tu red de casa.

Las contraseñas de MySQL del `.env` tienen que coincidir con las de
`logigator-backend/config/ormconfig.json`.

### 4. Levantarlo

```bash
docker compose -f docker-compose.equipo.yaml up -d --build
```

La primera vez tarda bastante, porque construye el editor desde el código fuente.
Para ver cómo va:

```bash
docker compose -f docker-compose.equipo.yaml logs -f
```

### 5. Preparar la base de datos

```bash
docker compose -f docker-compose.equipo.yaml exec app yarn migration:run
```

### 6. Dar de alta a las cinco personas

```bash
docker compose -f docker-compose.equipo.yaml exec app node tools/seed-team.js
```

Lee la lista de `LOGIGATOR_TEAM` y crea las cuentas, ya verificadas y listas para
entrar. Repetirlo no hace daño: una cuenta que ya existe se deja igual. Para cambiarle
la contraseña a alguien, edita el `.env` y añade `--update-password` al final.

### 7. Comprobar que está vivo

```bash
curl -s http://localhost/sync/health
```

Debe contestar algo como `{"status":"ok","rooms":0,"requireAuth":true}`.

---

## Tailscale en los cinco equipos

[Tailscale](https://tailscale.com/) crea una red privada entre vuestras computadoras,
estén donde estén. El tráfico entre ellas va cifrado y nadie de fuera puede entrar.

**En cada uno de los cinco equipos** (incluido el servidor):

1. Crear una cuenta en [tailscale.com](https://tailscale.com/) — una sola para todo el
   equipo; los demás entran con invitación.
2. Instalar la aplicación:
   - **Windows y macOS**: descargar de [tailscale.com/download](https://tailscale.com/download)
   - **Linux**: `curl -fsSL https://tailscale.com/install.sh | sh`
3. Iniciar sesión con la cuenta del equipo.

Para saber el nombre de la máquina servidor, en ella:

```bash
tailscale status
```

La primera línea es la suya: algo como `mi-pc.tigre-rana.ts.net`. Ese es el valor de
`LOGIGATOR_HOST`, y es la dirección que los cinco escribiréis en el navegador.

### HTTPS sin avisos del navegador (opcional)

Por omisión se entra por `http://`. Dentro de Tailscale **eso ya va cifrado** por
WireGuard, así que no viaja en claro por ninguna red ajena. Pero el navegador muestra
"No es seguro" en la barra, que incomoda.

Tailscale puede darte un certificado de Let's Encrypt **de verdad** para tu nombre
`.ts.net`, que todos los navegadores reconocen sin instalar nada:

```bash
mkdir -p certs
sudo tailscale cert --cert-file certs/$(tailscale status --json | python3 -c "import json,sys;print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))").crt \
                    --key-file certs/$(tailscale status --json | python3 -c "import json,sys;print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))").key \
                    $(tailscale status --json | python3 -c "import json,sys;print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
```

Después, descomenta la línea `tls` de `Caddyfile.equipo`, pon `https://` en el
`rootUrl` de `domains.json`, y reinicia:

```bash
docker compose -f docker-compose.equipo.yaml restart proxy app
```

Los certificados caducan; hay que repetir el comando cada pocos meses, o dejarlo en un
`cron`.

---

## Cómo se usa

1. Cada quien abre en su navegador `http://mi-pc.tu-tailnet.ts.net` (o `https://` si
   configuraste los certificados).
2. Inicia sesión con su usuario y contraseña.
3. Entra al editor y abre el proyecto.
4. Pulsa el botón **Colaborar** de la barra superior. Cuando ponga **En vivo**, ya
   estáis juntos.

A partir de ahí:

- Arriba a la derecha salen los círculos de colores de quienes están dentro.
- El cursor de cada quien se ve en el lienzo con su nombre.
- Lo que alguien tiene seleccionado sale rodeado de su color.
- Abajo a la izquierda, el panel **Actividad** cuenta qué ha ido pasando.

### Para probar que funciona

La forma más rápida de verlo sin molestar a nadie es con **dos navegadores distintos**
(por ejemplo Chrome y Firefox), o con dos perfiles del mismo navegador, y una cuenta
distinta en cada uno. Abre el mismo proyecto en los dos, activa **Colaborar** en ambos
y coloca una compuerta en uno: aparece en el otro al instante.

Con dos pestañas del *mismo* navegador también se ve la sincronización, pero saldrás
como la misma persona en los dos lados, porque la sesión se comparte.

---

## Variables de entorno

Todas van en el archivo `.env`.

### Acceso

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `LOGIGATOR_HOST` | `localhost` | Nombre por el que se entra. Con Tailscale, el nombre `.ts.net` de la máquina servidor. |
| `LOGIGATOR_BIND` | `127.0.0.1` | En qué dirección escucha. `127.0.0.1` = solo esta máquina. Pon la IP de Tailscale (`100.x.y.z`) para que entren los cinco. `0.0.0.0` abre a toda la red: evítalo. |
| `LOGIGATOR_HTTP_PORT` | `80` | Puerto HTTP del anfitrión. |
| `LOGIGATOR_HTTPS_PORT` | `443` | Puerto HTTPS del anfitrión. |

### Base de datos

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | — (obligatoria) | Contraseña de root de MySQL. |
| `MYSQL_DATABASE` | `logigator` | Nombre de la base. |
| `MYSQL_USER` | `logigator` | Usuario de la aplicación. |
| `MYSQL_PASSWORD` | — (obligatoria) | Su contraseña. Debe coincidir con `ormconfig.json`. |

### Equipo y sincronización

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `LOGIGATOR_TEAM` | — | Las personas autorizadas: `usuario:correo:contraseña`, separadas por comas. Solo la usa `seed-team.js`. |
| `SYNC_REQUIRE_AUTH` | `true` | Exige sesión iniciada para entrar a un documento. **Déjalo en `true`.** |

### Las que lee el servicio de sincronización por dentro

Están puestas en el compose y normalmente no hay que tocarlas:

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `SYNC_PORT` | `4444` | Puerto interno. |
| `SYNC_PERSISTENCE_DIR` | `/data/yjs` | Dónde guarda los documentos. Es un volumen. |
| `SYNC_BACKEND_URL` | `http://app:3000` | Contra quién valida las sesiones. |

### Configuración del backend (archivos JSON, no `.env`)

En `logigator-backend/config/environment.json`:

| Clave | Por defecto | Para qué sirve |
|---|---|---|
| `allowPublicRegistration` | `false` | Si se permite que cualquiera se registre. Para una instalación privada, **`false`**. |
| `teamWorkspace` | `false` | Con `true`, los proyectos y componentes son de los cinco y no de cada quien. Esta instalación lo lleva en `true`. |

---

## Operación diaria

```bash
# Arrancar
docker compose -f docker-compose.equipo.yaml up -d

# Parar (los datos se conservan)
docker compose -f docker-compose.equipo.yaml down

# Ver qué pasa
docker compose -f docker-compose.equipo.yaml logs -f sync
docker compose -f docker-compose.equipo.yaml logs -f app

# Actualizar tras cambiar el código
git pull
docker compose -f docker-compose.equipo.yaml up -d --build

# Cambiarle la contraseña a alguien (tras editar LOGIGATOR_TEAM en .env)
docker compose -f docker-compose.equipo.yaml exec app node tools/seed-team.js --update-password
```

### Copia de seguridad

Lo que no se puede perder son tres volúmenes de Docker:

| Volumen | Qué guarda |
|---|---|
| `mysql_data` | Usuarios, nombres de proyecto, permisos |
| `app_projects` y `app_components` | Los circuitos guardados (archivos JSON) |
| `app_previews` y `app_profiles` | Miniaturas y fotos de perfil |
| `sync_data` | El estado en vivo de los documentos compartidos |

```bash
docker run --rm \
  -v logigator-colaborativo_mysql_data:/origen:ro \
  -v "$PWD/respaldo":/destino \
  alpine tar czf /destino/mysql-$(date +%F).tar.gz -C /origen .
```

(Repite cambiando el nombre del volumen para los otros dos. El prefijo del volumen es
el nombre de la carpeta del proyecto.)

---

## Qué hacer si algo falla

**El botón dice "Sin conexión".**
Mira los registros del servicio de sincronización:
`docker compose -f docker-compose.equipo.yaml logs sync`.
Si dice `conexion sin sesion valida`, es que la sesión caducó: recarga la página e
inicia sesión otra vez.

**Un compañero no llega a la dirección.**
Que compruebe `tailscale status` en su equipo y que vea ahí al servidor. Si lo ve pero
el navegador no abre, casi seguro que `LOGIGATOR_BIND` sigue en `127.0.0.1`.

**"VersionMismatch" al guardar.**
Dos personas guardaron a la vez. Recarga y vuelve a guardar; no se pierde nada, porque
el estado compartido vive en el documento de sincronización, no en el guardado.

**Los cambios no llegan.**
Que los dos tengan el botón en **En vivo** y estén en el **mismo proyecto**. El
proyecto tiene que estar guardado en el servidor: uno sin guardar vive en una sala
propia de esa pestaña, y nadie más entra a ella.

**El servidor se quedó sin memoria al construir.**
El editor necesita bastante RAM para compilarse. Súbele la memoria a Docker, o
construye la imagen en otra máquina y pásala con `docker save` / `docker load`.

---

## Cómo funciona por dentro

```
   navegador de Ana  ─┐
   navegador de Luis ─┤
   ...               ─┴──► Tailscale ──► Caddy ─┬── /sync/*  ──► sync  (Yjs + LevelDB)
                                                └── el resto ──► app   ─┬─► MySQL
                                                                        ├─► Redis
                                                                        └─► disco
```

El circuito compartido vive en un documento **[Yjs](https://docs.yjs.dev)**, que es un
CRDT: una estructura pensada para que varias personas la editen a la vez sin un árbitro
central y acaben todas con el mismo resultado. El transporte es
**[y-websocket](https://github.com/yjs/y-websocket)**, y el estado se guarda con
**[y-leveldb](https://github.com/yjs/y-leveldb)** para que sobreviva a los reinicios.

Un documento abierto es una sala. El editor abre un `Project` por documento —el
proyecto principal y cada componente personalizado que se edite—, así que **editar un
subcircuito entre varios funciona por el mismo camino** que el circuito principal.

El servicio de sincronización **no tiene usuarios propios**: cuando el navegador abre el
WebSocket manda su cookie de sesión, y esa cookie se reenvía a `GET /api/user` del
backend. Si el backend la reconoce, se entra; si no, la conexión se rechaza antes de
llegar a existir.

Las piezas nuevas están en:

- `logigator-sync/` — el servidor de sincronización
- `logigator-editor/src/app/collab/` — el lado del editor
- `logigator-backend/tools/seed-team.js` — alta de las cuentas

---

## Límites conocidos

Cosas que **no** hace, dichas claramente para que nadie se lleve una sorpresa:

- **La autoría del panel de actividad es aproximada.** Yjs transporta el estado del
  documento, no quién lo escribió. Cuando hay una sola persona más en la sala, el
  cambio es suyo y se dice su nombre; cuando hay varias, pone "alguien".

- **Deshacer puede pisar trabajo ajeno en el mismo elemento.** Tu Ctrl+Z solo revierte
  acciones tuyas, pero si deshaces un movimiento de una compuerta que otro ha movido
  después, la devuelves a donde tú la tenías. Es inherente a deshacer por persona, y le
  pasa igual a los editores colaborativos conocidos.

- **Dos personas pueden dejar dos piezas en el mismo sitio.** Si colocáis en la misma
  casilla en el mismo instante, el documento se queda con las dos superpuestas: eso un
  CRDT no lo resuelve solo. Se ve enseguida y se arregla moviendo una.

- **Al entrar a una sala que ya tiene contenido, manda el documento compartido.** Lo que
  tuvieras abierto se descarta, igual que al abrir un documento compartido de texto.

- **La simulación es de cada quien.** Corre en el navegador de cada persona; lo que se
  comparte es el circuito, no la ejecución.

- **Las instancias ya colocadas de un componente personalizado no cambian solas** cuando
  alguien edita el maestro. Es el diseño del propio Logigator: las instancias guardan
  una copia congelada, y se actualizan cuando tú lo pides.

---

## Licencia

Logigator es de **Logigator** y está publicado bajo la
[GNU Affero General Public License v3.0](LICENSE). Este trabajo es una obra derivada y
**mantiene esa misma licencia**, con los avisos de copyright originales intactos.

La AGPL añade una condición que conviene saber: a quien use el programa **a través de
la red** hay que ofrecerle el código fuente, modificaciones incluidas. Como los usuarios
sois vosotros cinco, basta con que tengáis acceso a este repositorio. Si algún día lo
abrís a terceros, la obra derivada tiene que seguir siendo AGPL-3.0: no se puede
relicenciar.
