# Seguridad

[English](SECURITY.md) · **Español**

> GitHub solo lee `SECURITY.md`. Esta traducción existe para quien la necesite;
> la versión en inglés es la canónica y es la que alimenta la pestaña Security
> del repositorio.

Esto es un almacén de contraseñas, así que vale la pena ser preciso sobre contra
qué protege y contra qué no.

## Reportar una vulnerabilidad

Reportá en privado, no en un issue público.

Usá **Security → Report a vulnerability** en este repositorio, que abre un aviso
privado que solo ve quien mantiene el proyecto. Si esa opción no estuviera
disponible, abrí un issue público pidiendo un canal privado —sin ningún detalle—
y se te dará uno.

Incluí lo necesario para que el problema sea concreto: la versión o el commit,
los pasos, y qué obtiene un atacante. Una prueba de concepto ayuda, pero una
descripción clara del mecanismo vale más que un script.

Esperá una primera respuesta dentro de una semana. Este es un proyecto personal
mantenido en tiempo libre; no hay recompensa económica ni acuerdo de nivel de
servicio, y pretender lo contrario sería deshonesto.

Por favor no pruebes contra el almacén de otra persona. Este software solo se
ejecuta en la máquina de su propio usuario, así que no hay ningún sistema
compartido donde probar ni razón alguna para tocar datos ajenos.

## Versiones soportadas

El último commit en `main`. No hay versiones publicadas ni retroportes.

## Qué es esto

Un almacén de un solo usuario que se ejecuta en tu propia máquina. La aplicación
web escucha en `127.0.0.1`; la aplicación de escritorio es un cliente nativo
sobre el mismo archivo. Ninguna de las dos hace ninguna petición de red —
verificado por inspección, y no hay cliente HTTP en ninguna de las dos bases de
código.

Cada campo de cada entrada —aplicación, URL, usuario, contraseña, nota, favorita,
color— se cifra con AES-256-GCM bajo una clave derivada de tu contraseña maestra
con scrypt (N=2^17, r=8, p=1 — el piso actual de OWASP) sobre una sal aleatoria
por almacén. El almacén registra con qué conjunto de parámetros se construyó su
clave, y un almacén creado con parámetros más débiles se vuelve a derivar con los
actuales la próxima vez que se desbloquea. La contraseña maestra nunca se guarda.
La clave derivada existe únicamente en la memoria del proceso y desaparece cuando
el proceso termina.

## Contra qué protege

- **Que alguien lea el archivo del almacén.** Una notebook robada, una copia en un
  servicio de sincronización, un disco descartado. El archivo no contiene texto
  plano: ni siquiera en qué aplicaciones tenés cuenta.
- **Que se manipule el archivo del almacén.** GCM está autenticado; un texto
  cifrado modificado falla al descifrarse en vez de devolver datos alterados.
- **Una contraseña maestra incorrecta.** La rechaza un verificador cifrado antes
  de descifrar nada más.
- **Otras máquinas de tu red.** Tanto `dev` como `start` escuchan solo en la
  interfaz de loopback.

## Contra qué no protege

Estos son límites de diseño, no errores. Los reportes sobre ellos se cerrarán como
comportamiento esperado.

- **Malware que ya esté corriendo con tu usuario.** Puede leer la clave de la
  memoria del proceso mientras el almacén está desbloqueado, o registrar la
  contraseña maestra mientras la escribís. Nada que corra en espacio de usuario
  puede defenderse de esto, y esto no lo intenta.
- **Cualquiera que tenga tu contraseña maestra.** No hay segundo factor.
- **Una contraseña maestra olvidada.** No hay recuperación ni puerta trasera. Si la
  perdés, las entradas quedan ilegibles: eso es el diseño funcionando.
- **La exposición a una red.** No pongas esto detrás de un nombre de host público
  ni de un proxy inverso. No tiene limitación de tasa, ni bloqueo de cuenta, ni
  registro de auditoría, porque no está construido para enfrentar nada que no sea
  localhost.
- **Otros usuarios locales en una máquina compartida.** Los permisos del archivo son
  los que tu sistema operativo le dé a un archivo en tu directorio personal.

## Debilidades conocidas

Ya se conocen, así que no hace falta reportarlas. Están escritas acá en lugar de
dejarlas para que alguien las descubra.

- **El mínimo de la contraseña maestra es de 8 caracteres**, que es poco para el
  único secreto del que depende todo lo demás. Usá una frase de contraseña.
- **La aplicación de macOS se ejecuta sin el App Sandbox**, para poder abrir un
  archivo de almacén en cualquier ubicación que le indiques y volver a abrirlo en
  el siguiente arranque. La compila desde el código quien la ejecuta.
- **La búsqueda y el ordenamiento ocurren en memoria** después de descifrar cada
  fila, porque los campos cifrados no se pueden indexar. Adecuado para un almacén
  personal; no es un diseño que escale.

## Criptografía

Nada de criptografía propia. La aplicación web usa `node:crypto` de Node; la de
escritorio usa PointyCastle. Las dos están fijadas entre sí mediante vectores de
prueba —ver `src/lib/interop.test.ts` y
`desktop_app/test/vault_crypto_test.dart`— de modo que ninguna implementación
puede derivar hacia ser sutilmente distinta de la otra.

Si encontrás un defecto en cómo se usan, ese es exactamente el tipo de reporte que
este documento está pidiendo.
