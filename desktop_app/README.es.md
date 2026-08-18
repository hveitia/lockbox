# LockBox Desktop

[English](README.md) · **Español**

Una interfaz nativa de macOS para el mismo almacén que usa la aplicación web. Abre
`data/vault.db` en su lugar — sin copias, sin sincronización, sin servidor. Una
entrada agregada acá está la próxima vez que se abra la aplicación web, y al revés
también.

## Requisitos

- Flutter (canal stable) con el escritorio de macOS habilitado
- Herramientas de línea de comandos de Xcode

## Cómo se ejecuta

Desde esta carpeta:

```bash
flutter run -d macos
```

Para un paquete de aplicación independiente:

```bash
flutter build macos --release
open build/macos/Build/Products/Release/LockBox.app
```

## Primer arranque

La aplicación no adivina dónde vive el almacén. En el primer arranque pide el
archivo:

1. Hacé clic en **Choose vault.db…**
2. Elegí `vault/data/vault.db` — el mismo archivo que lee la aplicación web
3. Ingresá la contraseña maestra

La ruta se recuerda, así que los arranques posteriores van directo a la pantalla de
desbloqueo. Si el archivo del almacén se movió o se borró, la aplicación vuelve a la
pantalla de selección.

Si el archivo elegido todavía no contiene un almacén, la aplicación ofrece crear uno
— el mismo flujo de configuración que muestra la aplicación web en una instalación
nueva.

## Qué comparte con la aplicación web

Ambas aplicaciones leen y escriben el mismo archivo SQLite con el mismo formato, así
que la aplicación de escritorio no es un visor: es un segundo cliente completo.

- **Derivación de clave**: scrypt sobre la contraseña maestra normalizada con NFKC y
  la sal almacenada, clave de 32 bytes. El almacén registra con qué conjunto de
  parámetros se construyó su clave — los almacenes nuevos usan N=2^17, r=8, p=1, y
  uno escrito con parámetros más débiles se vuelve a derivar con los actuales la
  próxima vez que se desbloquea. La normalización es determinante: macOS puede
  entregarle a esta aplicación una `ñ` descompuesta donde el navegador da una
  compuesta, y sin ella la misma contraseña tecleada deriva una clave distinta y el
  desbloqueo falla.
- **Cifrado**: AES-256-GCM por campo, con un IV nuevo por valor
- **Verificador**: la misma fila de sondeo cifrada, de modo que una contraseña
  incorrecta se rechaza antes de descifrar nada
- **Campos**: aplicación, usuario, contraseña, url, comentario, favorita, color
- **Orden**: primero las favoritas, después alfabético por aplicación
- **Manejo de URL**: los hosts sin esquema reciben `https://`, y los esquemas de
  scripting (`javascript:`, `data:`, `vbscript:`, `file:`) se rechazan

Las filas escritas antes de que existieran `url`, `favorite` o `color` se siguen
leyendo correctamente.

## Copias de seguridad

**Backup** abre un panel de guardado y escribe un único archivo autocontenido donde
le indiques. Copiá ese archivo a donde quieras: no necesita ningún archivo
acompañante.

**No copies el archivo del almacén por tu cuenta.** El almacén funciona en modo WAL
de SQLite, así que las escrituras van a parar a un `.db-wal` que queda al lado y se
quedan ahí hasta que SQLite las incorpora, cosa que hace a las 1000 páginas o en un
cierre limpio — y un almacén personal no llega a ninguna de las dos. Una copia del
`.db` por sí sola suele ser un archivo vacío, sin ninguna tabla dentro, y falla en
silencio: nada se queja hasta que intentás restaurarla.

La aplicación web escribe sus copias en `data/backups/` porque un servidor no tiene
selector de archivos. Acá elegís la ubicación, que es la mejor respuesta: una copia
que queda al lado del original no sobrevive a la pérdida del disco. Los dos clientes
nombran el archivo de forma idéntica, y `vault_repository_test.dart` verifica que
coincidan.

**Restore** elige una copia, confirma, reemplaza el almacén y lo bloquea. El bloqueo
no es una cortesía: la copia trae consigo su propia sal y su propio verificador, así
que después la contraseña maestra es la que estaba vigente cuando se tomó esa copia.

Restaurar se puede deshacer. El almacén tal como está se respalda en `backups/`, al
lado del archivo del almacén, antes de reemplazar nada, y la ruta se muestra cuando
la restauración termina. Elegir la copia equivocada cuesta una segunda restauración,
no los datos.

La restauración se ejecuta dentro de SQLite como una única transacción, no como una
copia de archivos. Copiar una copia encima del archivo del almacén parece que
funciona y no funciona: cualquier proceso que todavía tenga el almacén abierto
escribe después su propio registro write-ahead encima, y las filas descartadas
vuelven sin que se muestre ningún error. Una copia que no sea un almacén se rechaza
antes de borrar nada.

Cualquiera de los dos clientes puede restaurar una copia escrita por el otro.

## Pruebas

```bash
flutter test
```

La suite está orientada a la interoperabilidad. `test/fixtures/interop_vault.db` es
un almacén real escrito por la implementación de Node, y
`test/fixtures/crypto_vectors.json` contiene claves y textos cifrados producidos por
Node. El código Dart se verifica contra ambos: si las dos implementaciones alguna
vez se separan, estas pruebas fallan.

Los fixtures se regeneran con los scripts de `tool/`. Los de Node se ejecutan desde
la raíz del repositorio:

```bash
node desktop_app/tool/generate_fixtures.ts          # vectores criptográficos desde el código Node
node desktop_app/tool/make_interop_db.ts <ruta>     # un almacén escrito por el código Node
```

Y los de Dart desde esta carpeta:

```bash
dart run tool/emit_dart_vectors.dart        # los mismos vectores, desde el código Dart
dart run tool/write_interop_entry.dart      # una fila escrita por el código Dart
```

`tool/bench_scrypt.dart` mide la derivación de clave en esta máquina — útil si el
paso de desbloqueo alguna vez empieza a sentirse lento.

## Notas

- Hacer clic en la url de una entrada la abre en el navegador predeterminado. La
  aplicación sigue sin abrir sockets propios: la dirección va al sistema operativo,
  que lanza el navegador. Solo se entregan `http` y `https`; cualquier otra cosa se
  copia al portapapeles, así que un `file://` guardado o un esquema personalizado
  nunca puede lanzar una aplicación con un clic.
- La ventana se abre maximizada al área visible de la pantalla
  (`MainFlutterWindow.swift`), no en un Space de pantalla completa de macOS — el
  almacén queda a un Cmd+Tab de aquello que estabas haciendo cuando necesitaste una
  contraseña.
- La derivación de clave corre en un isolate en segundo plano, así que la ventana
  nunca se congela durante el costo de scrypt del desbloqueo (~690ms con los
  parámetros actuales en esta máquina — medí la tuya con
  `dart run tool/bench_scrypt.dart`, que cronometra todas las versiones con las que
  el almacén puede escribirse).
- La contraseña maestra se mantiene en memoria únicamente mientras la aplicación
  está desbloqueada. Cerrar la aplicación, o hacer clic en **Lock**, la descarta.
- La aplicación nunca habla con la red. No hay nada que configurar ni nada que
  publicar.
