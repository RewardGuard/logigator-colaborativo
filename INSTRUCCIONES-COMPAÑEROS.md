# Cómo entrar — instrucciones para el equipo

Vamos a diseñar la CPU los cinco a la vez, en el mismo circuito, viendo lo que
hace cada quien en tiempo real.

**No tienes que instalar nada.** El programa corre en la computadora de Giovan y
tú entras por el navegador, como a cualquier página.

Son dos minutos.

---

## Paso 1 — Conéctate a la misma WiFi que Giovan

Mientras probamos, el servidor está en la computadora de Giovan y se llega por la
red de casa/clase. **Tienes que estar en la misma WiFi que él.**

Si vais a trabajar desde vuestras casas, hace falta Tailscale: está explicado más
abajo, en [Para trabajar desde casa](#para-trabajar-desde-casa).

---

## Paso 2 — Abre la dirección

En tu navegador (Chrome, Firefox, Edge o Safari) escribe:

```
http://192.168.4.22:9000
```

> **No olvides el `:9000` del final.** Sin él no carga.

Si no abre, lo más probable es que no estéis en la misma WiFi. Compruébalo con
Giovan.

---

## Paso 3 — Inicia sesión

Pulsa **Login** arriba a la derecha y entra con el usuario y la contraseña que te
dio Giovan.

> Si el navegador dice "No es seguro", **ignóralo**: sale porque la dirección es
> interna de la red y no tiene certificado público. No sale de vuestra WiFi.

---

## Paso 4 — Ponte a trabajar con los demás

1. Arriba a la derecha hay un botón que dice **Colaborar**. **Pulsalo.**
2. Cuando ponga **En vivo**, ya estás dentro de la sesión compartida.
3. Abre el proyecto de la CPU: menú **File → Open**.

A partir de ahí:

- Arriba a la derecha salen **los círculos de colores** de quienes están dentro.
  Pasa el ratón por encima para ver el nombre.
- **Verás el cursor de los demás** moviéndose por el lienzo, con su nombre al
  lado y en su color.
- Lo que alguien tenga seleccionado sale **rodeado de su color**, para que no se
  lo muevas sin querer.
- Abajo a la izquierda, el botón **Actividad** te cuenta qué se ha ido cambiando
  y a qué hora.

---

## Cosas que conviene saber

**Tu Ctrl+Z solo deshace lo tuyo.** Puedes deshacer tranquilo: no vas a borrar el
trabajo de nadie más.

**Si se te cae el internet, sigue trabajando.** Cuando vuelva la conexión, lo que
hiciste se junta solo con lo que hicieron los demás. No se pierde nada.

**No hace falta guardar todo el rato.** Lo que editas se comparte al instante.
Guardar (Ctrl+S) sirve para dejar una copia en el servidor, y basta con que lo
haga uno de vosotros de vez en cuando.

**Si dos tocáis la misma pieza a la vez**, el programa decide por una de las dos
y **todos acabáis viendo lo mismo** — no se parte en dos versiones distintas. Lo
único que puede pasar es que dos piezas queden una encima de otra si las ponéis
en el mismo hueco en el mismo instante; se ve enseguida y se arregla moviendo una.

**La simulación es tuya.** Cuando le das a "Start simulation" la corres en tu
navegador; lo que se comparte es el circuito, no la ejecución.

---

## Si algo no funciona

| Qué ves | Qué hacer |
|---|---|
| El navegador no abre la página | Comprueba que estás en la **misma WiFi** que Giovan y que escribiste el `:9000` del final. |
| El botón dice **Sin conexión** | Recarga la página (Ctrl+R / Cmd+R) y vuelve a iniciar sesión. |
| La computadora de Giovan se apagó o se durmió | No hay servidor: nadie puede entrar hasta que la encienda. |
| No veo lo que hacen los demás | Comprueba que tu botón dice **En vivo** y que estáis en **el mismo proyecto**. Tiene que ser un proyecto guardado en el servidor, no uno nuevo sin guardar. |
| "No es seguro" en la barra | Normal, ignóralo. Ver el paso 3. |
| El editor se ve raro o a medias | Haz una recarga forzada: Ctrl+Shift+R (Windows/Linux) o Cmd+Shift+R (Mac). |

Si nada de eso lo arregla, dile a Giovan qué dice exactamente la pantalla.

---

# Para trabajar desde casa

Lo de arriba solo funciona estando en la misma WiFi. Para entrar desde vuestras
casas hace falta Tailscale, que conecta las computadoras entre sí aunque estén en
sitios distintos. Giovan os avisará cuando esté listo.

## Acepta la invitación de Tailscale

Giovan te va a mandar una invitación por correo. Ábrela y acéptala.

Si te pide crear cuenta, puedes entrar con tu cuenta de Google, Microsoft o
GitHub; no hace falta inventar contraseña nueva.

> **¿Qué es Tailscale?** Una red privada entre nuestras computadoras. Es como si
> las cinco estuvieran conectadas al mismo cable, aunque estemos en casas
> distintas. Nadie de fuera puede entrar, y no abre tu computadora a internet.

---

## Instala Tailscale

### Windows

1. Entra a **https://tailscale.com/download/windows**
2. Descarga e instala (dale "Sí" cuando Windows pregunte).
3. Al abrirse, pulsa **Log in** e inicia sesión con la cuenta del paso 1.
4. Ya está: aparece un iconito en la barra de abajo, junto al reloj.

### Mac

1. Entra a **https://tailscale.com/download/mac**
2. Descarga e instala.
3. Ábrelo, pulsa **Log in** e inicia sesión con la cuenta del paso 1.
4. macOS te va a pedir permiso para añadir una configuración de VPN: acéptala.
   Te pedirá la contraseña de administrador de tu Mac.

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Te sale un enlace en la terminal: ábrelo e inicia sesión con la cuenta del paso 1.

---

## Comprueba que estás conectado

Abre la aplicación de Tailscale. Tienes que ver en la lista la computadora de
Giovan (el servidor). Si la ves, vas bien.

---

## Entra al editor (con Tailscale)

Abre tu navegador (Chrome, Firefox o Edge — **Safari también sirve**) y escribe
la dirección que te pasó Giovan. Se ve parecido a esto:

```
http://NOMBRE-DEL-SERVIDOR.NUESTRA-RED.ts.net
```

Pulsa **Login** arriba a la derecha y entra con el usuario y la contraseña que te
dio Giovan.

> Si el navegador dice "No es seguro" en la barra de direcciones, **ignóralo**.
> El tráfico ya va cifrado por Tailscale; ese aviso sale solo porque la dirección
> es interna y no tiene certificado público.

---

