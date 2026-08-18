# LockBox

[English](README.md) · **Español**

Un almacén de credenciales local para tus propios proyectos. Cada entrada guarda
una **aplicación**, una **URL**, un **usuario**, una **contraseña** y una **nota**
de texto libre, y opcionalmente puede marcarse como **favorita** y recibir un
**color**.

La URL es opcional. Un host sin esquema se guarda como `https://`, y todo lo que
no sea `http`/`https` se rechaza: el valor se muestra como enlace, así que un
esquema `javascript:` o `data:` sería un XSS almacenado esperando un clic.

## Favoritos y colores

Ambos son opcionales y vienen desactivados: una entrada nueva no es favorita y no
tiene color.

- **Favorita** fija la entrada al principio de la lista. La estrella de cada
  tarjeta la activa en un clic sin tocar nada más de la entrada.
- **Color** tiñe el enlace, la estrella y la banda de contraseña de la tarjeta. La
  paleta es una lista fija de catorce colores más "sin color", ordenada según el
  círculo cromático; solo se guarda el *nombre*, y la hoja de estilos es dueña de
  los valores reales, así que nada de lo que se escriba puede llegar al renderizado.

Para agregar un color, añadí un nombre a `ENTRY_COLORS` en `src/lib/entry.ts` **y**
una regla `.tone-<nombre>` en `src/app/globals.css`. `src/lib/colors.test.ts` falla
si falta cualquiera de las dos mitades, o si dos colores resuelven al mismo valor.
Nunca renombres ni elimines un nombre: hay filas guardadas que lo referencian.

Filtrá con el botón **Favorites** y con las muestras de color debajo del buscador.
Se combinan entre sí y con el texto de búsqueda. Solo se ofrecen los colores en uso,
así que la fila de filtros nunca muestra una muestra que no devolvería nada.

Nada sale de la máquina: la aplicación escucha en `127.0.0.1`, no hace llamadas de
red, y la base de datos es un único archivo SQLite dentro de `data/`.

## Requisitos

- **Node 24 o superior.** Dos cosas dependen de eso, y ninguna se degrada con
  elegancia en una versión anterior: el almacén se guarda con `node:sqlite`, así que
  no hay módulo nativo que compilar ni nada que instalar, y la suite de pruebas
  ejecuta archivos TypeScript directamente porque Node quita los tipos por su cuenta.
- **pnpm.** El lockfile es de pnpm. Otros gestores de paquetes resolverán un árbol
  de dependencias distinto.
- macOS, Linux o Windows para la aplicación web. El cliente de escritorio en
  `desktop_app/` es solo para macOS; mirá su propio README.

Verificá con `node --version` antes que nada. En una versión anterior el fallo es un
error de importación en medio de una traza, que se lee como un proyecto roto y no
como una versión equivocada.

## Cómo se arranca

Todos los comandos se ejecutan desde la raíz del repositorio.

### La primera vez

```bash
pnpm install
pnpm build
pnpm start
```

Abrí http://localhost:3000. La primera pantalla te pide crear la contraseña
maestra. No hay recuperación, así que elegí una que no vayas a perder.

### Todas las veces siguientes

```bash
pnpm start
```

Ese es todo el comando diario. Solo hace falta recompilar después de cambiar el
código:

```bash
pnpm build && pnpm start
```

Detené el servidor con `Ctrl-C` en la terminal donde corre.

La aplicación **no** arranca al iniciar sesión, a propósito: un almacén que siempre
está escuchando siempre está disponible para cualquier cosa que corra con tu
usuario. Arrancarlo a mano es parte de la frontera de confianza.

### Mientras se modifica el código

```bash
pnpm dev
```

Recarga en caliente, páginas más lentas, la misma base de datos. Reiniciar
cualquiera de los dos servidores vuelve a bloquear el almacén.

### Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm start` | Ejecuta la aplicación compilada en http://localhost:3000 |
| `pnpm build` | Compila para producción — necesario tras cambiar el código |
| `pnpm dev` | Servidor de desarrollo con recarga en caliente |
| `pnpm test` | Pruebas unitarias de criptografía, almacén y sesiones |
| `pnpm typecheck` | TypeScript, sin generar archivos |

Tanto `start` como `dev` escuchan en `127.0.0.1`, así que el almacén es inalcanzable
desde otras máquinas de tu red.

### Si el puerto 3000 está ocupado

```bash
PORT=3100 pnpm start
```

Usá la variable de entorno en lugar de un flag `-p`: `pnpm` reenvía `--` a Next tal
cual y Next lo interpreta como un argumento de directorio.

## Cómo funciona el cifrado

- La contraseña maestra **nunca se guarda**. De ella se deriva una clave de 32 bytes
  con scrypt (N=2^17, r=8, p=1) sobre una sal aleatoria por almacén. El almacén
  registra con qué conjunto de parámetros se construyó su clave, de modo que un
  almacén antiguo sigue abriéndose con los parámetros con los que se escribió — y se
  vuelve a derivar con los actuales la primera vez que se desbloquea, sin cambiar la
  contraseña maestra.
- Cada campo de cada entrada — aplicación, URL, usuario, contraseña, nota, favorita,
  color — se cifra con AES-256-GCM antes de llegar al disco. El archivo de base de
  datos no contiene texto plano. El ordenamiento y el filtrado ocurren por lo tanto
  en memoria después de descifrar, lo cual es adecuado a la escala para la que está
  pensado este almacén.
- El almacén guarda un breve token *verificador*: una cadena constante cifrada con la
  clave. Una contraseña maestra incorrecta no logra descifrarlo, y así se detecta un
  desbloqueo fallido sin comparar contraseñas nunca.
- La clave derivada vive únicamente en la memoria del proceso del servidor,
  referenciada por una cookie de sesión httpOnly. Desaparece cuando el proceso
  termina.

El almacén se vuelve a bloquear tras 30 minutos de inactividad, al presionar
**Lock**, y cada vez que el servidor se reinicia.

**No hay recuperación.** Si perdés la contraseña maestra, las entradas quedan
ilegibles. Cambiarla (con **Master password**) vuelve a cifrar cada entrada con la
clave nueva.

## Copias de seguridad

Presioná **Backup**. Escribe un único archivo autocontenido dentro de
`data/backups/` y te muestra la ruta. Copiá *ese* archivo a donde quieras: está
cifrado en reposo, así que una copia en un servicio de sincronización sigue siendo
ilegible sin la contraseña maestra.

Desde una terminal, lo mismo:

```bash
sqlite3 data/vault.db "VACUUM INTO 'vault-backup.db'"
```

**No copies `data/vault.db` por tu cuenta.** El almacén funciona en modo WAL de
SQLite, así que las escrituras van a parar a `data/vault.db-wal` y se quedan ahí
hasta que SQLite las incorpora al archivo principal — cosa que hace a las 1000
páginas o en un cierre limpio, y un almacén personal no llega a ninguna de las dos.
Una copia de `vault.db` por sí sola suele ser un archivo vacío, sin ninguna tabla
dentro. Peor todavía, falla en *silencio*: nada se queja hasta el día en que
intentás restaurarla.

Por la misma razón, no apuntes un cliente de sincronización a `data/` en sí. Copiar
`vault.db` y `vault.db-wal` en momentos distintos, o reescribirlos por debajo de una
aplicación en ejecución, puede corromper el almacén activo. Sincronizá el archivo de
copia, no el directorio que la aplicación está usando.

`data/` está en `.gitignore`, copias incluidas.

## Restauración

Presioná **Restore**, elegí una copia, confirmá. El contenido del almacén se
reemplaza y el almacén se bloquea.

**Restaurar se puede deshacer.** El almacén tal como está se respalda antes de
reemplazar nada, de modo que pasa a ser la entrada más reciente de esa misma lista.
Si elegís la copia equivocada, el costo es una segunda restauración, no los datos.

Se bloquea porque la copia trae consigo su propia sal y su propio verificador: tras
una restauración la contraseña maestra es la que estaba vigente cuando se tomó esa
copia, que no es necesariamente la que acabás de usar.

**No restaures copiando un archivo encima de `data/vault.db`.** Parece que funciona
y no funciona. Cualquier proceso que todavía tenga el almacén abierto — esta
aplicación, el cliente de escritorio — escribe después su propio registro
write-ahead sobre el archivo, y las filas que querías descartar vuelven sin que se
muestre ningún error. La restauración se hace dentro de SQLite en una sola
transacción precisamente para que eso no pueda ocurrir: o se completa, o deja el
almacén exactamente como estaba.

Una copia que no sea un almacén, o que no sea una base de datos, se rechaza antes de
borrar nada, y no a mitad de camino.

## Aplicación de escritorio

`desktop_app/` es un cliente nativo de macOS para este mismo almacén, escrito en
Flutter. Abre `data/vault.db` en su lugar — mismo esquema, misma criptografía,
mismas entradas — así que las dos aplicaciones son intercambiables. Mirá
`desktop_app/README.md`.

```bash
cd desktop_app && flutter run -d macos
```

## Lo que esto no es

Esto confía en la máquina donde se ejecuta. No defiende contra malware que ya esté
corriendo con tu usuario, y no está construido para exponerse a una red. No lo
pongas detrás de un nombre de host público.

## Desarrollo

```bash
pnpm test        # pruebas unitarias de criptografía, almacén y sesiones
pnpm typecheck
```

| Ruta | Rol |
| --- | --- |
| `src/lib/entry.ts` | Forma compartida de la entrada, lista de colores, normalización de URL |
| `src/lib/crypto.ts` | Derivación de clave y cifrado/descifrado AES-256-GCM |
| `src/lib/vault.ts` | Esquema, desbloqueo, CRUD de entradas, rotación de contraseña maestra, copias |
| `src/lib/session-store.ts` | Claves desbloqueadas en memoria con expiración deslizante |
| `src/lib/server.ts` | Singletons de base de datos y sesión, manejo de cookies |
| `src/app/actions.ts` | Server actions |
| `src/components/` | Interfaz |

## Seguridad

El modelo de amenaza, las debilidades conocidas y cómo reportar una vulnerabilidad
en privado están en [SECURITY.md](SECURITY.md). Leelo antes de confiarle algo que
importe.

## Licencia

MIT — mirá [LICENSE](LICENSE). Usalo, forkealo, cambialo.

Viene sin garantía, y acá eso no es una fórmula vacía: esta es una herramienta que
ejecutás vos, en tu propia máquina, guardando tus propios secretos. Leé el modelo de
amenaza de más arriba antes de confiarle algo que no puedas permitirte perder, y
mantené una copia de seguridad.

## Apoyar el proyecto

Gratis, y va a seguir siéndolo: no hay nada que desbloquear ni ninguna versión
superior a la que pasarse. Si te reemplaza una suscripción que estabas pagando,
podés [invitarme un café](https://buymeacoffee.com/hveitia86a).
