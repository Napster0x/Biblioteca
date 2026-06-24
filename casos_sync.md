# Guía TDD para debugging de sincronización CRDT + HLC

## 1. Propósito del documento

Este documento define una guía de pruebas para depurar un sistema de sincronización basado en **CRDT + HLC** aplicado a una biblioteca personal.

El sistema sincroniza:

- Libros.
- Highlights asociados a libros.
- Palabras recogidas para el Diccionario.
- Frases asociadas a palabras del Diccionario.
- Imágenes asociadas a palabras del Diccionario.
- Citas recogidas en el módulo de Citas.
- Anotaciones recogidas en el módulo de Anotaciones.
- Texto seleccionado sobre el que se crea una cita, palabra o anotación.

La finalidad de este documento es servir como guía para el **primer ciclo SDD**, centrado exclusivamente en **testing TDD, observación del comportamiento, detección de inconsistencias y recogida de feedback**.

Este primer ciclo **no debe escribir ni modificar código de producción**. Su objetivo es construir una batería completa de pruebas, ejecutar escenarios de sincronización, registrar resultados y detectar fallos reales del sistema.

Después de este primer ciclo, se iniciará un **segundo ciclo SDD**, en el que sí se aplicarán correcciones sobre el código tomando como base los resultados obtenidos durante el ciclo TDD.

Los resultados del testeo deben guardarse en **Engram**, de forma que cada caso probado deje constancia de:

- Estado inicial.
- Operaciones ejecutadas.
- Orden de sincronización.
- Resultado esperado.
- Resultado obtenido.
- Logs relevantes.
- HLCs involucrados.
- Divergencias entre dispositivos.
- Decisión tomada o corrección pendiente.

---

## 2. Modelo conceptual del sistema

El modelo general puede representarse así:

```txt
Libro
 ├── Highlight Diccionario ───> Entrada Diccionario
 │                              ├── Palabra
 │                              ├── Frase que contiene la palabra
 │                              └── Imagen asociada
 │
 ├── Highlight Cita ──────────> Cita
 │                              └── Texto citado recogido
 │
 └── Highlight Anotación ─────> Anotación
                                └── Texto sobre el que se anota
```

El libro funciona como fuente de lectura y como soporte de highlights, pero los datos recogidos por el usuario tienen valor propio.

Por tanto, una regla fundamental del sistema es:

> Si un libro se borra, los datos recogidos por el usuario a partir de ese libro no se borran.

Esto incluye:

- Palabras metidas en el Diccionario.
- Frases que contienen esas palabras.
- Imágenes asociadas a esas palabras.
- Citas metidas en Citas.
- Anotaciones metidas en Anotaciones.
- Texto seleccionado sobre el que se hizo una anotación.
- Texto seleccionado sobre el que se hizo una cita.
- Texto seleccionado del que se extrajo una palabra.

El borrado de un libro puede eliminar o invalidar la relación visual con el libro local, pero **no debe destruir la memoria semántica recogida por el usuario**.

---

## 3. Notación usada en los casos

```txt
A | B -> resultado esperado en ambos
```

Símbolos:

```txt
L      = Libro
D      = Entrada de Diccionario
F_D    = Frase asociada a una palabra del Diccionario
IMG_D  = Imagen asociada a una palabra del Diccionario

C      = Cita
T_C    = Texto citado recogido

N      = Anotación
T_N    = Texto sobre el que se hizo la anotación

H_D    = Highlight asociado a Diccionario
H_C    = Highlight asociado a Citas
H_N    = Highlight asociado a Anotaciones

H_D -> D = highlight que apunta a una entrada de Diccionario
H_C -> C = highlight que apunta a una Cita
H_N -> N = highlight que apunta a una Anotación
```

Ejemplo:

```txt
A: L + H_D -> D + F_D + IMG_D
B: ∅
->
A: L + H_D -> D + F_D + IMG_D
B: L + H_D -> D + F_D + IMG_D
```

---

## 4. Invariantes generales

Después de cualquier sincronización, deben cumplirse estas invariantes:

```txt
1. A y B convergen al mismo estado lógico.
2. Sincronizar dos veces no produce cambios nuevos.
3. El orden de llegada de eventos no cambia el resultado final.
4. No aparecen duplicados lógicos.
5. No se pierden datos recogidos por el usuario.
6. No se pierde una edición más nueva frente a una más vieja.
7. Los tombstones se respetan.
8. Los updates viejos no resucitan estados eliminados incorrectamente.
9. Cada highlight mantiene su grupo correcto.
10. Cada dato conserva su identidad semántica.
11. Borrar un libro no borra Diccionario, Citas ni Anotaciones recogidas.
12. Los datos pueden sobrevivir aunque el libro ya no exista localmente.
13. No quedan referencias rotas sin marcar como archivadas, desvinculadas o unresolved.
14. Todos los conflictos quedan registrados de forma inspeccionable.
15. Todo resultado de test debe guardarse en Engram.
```

---

## 5. Política crítica: borrado de libros

Esta es una política central y debe estar explícitamente testeada.

### 5.1. Regla principal

```txt
Si se borra un libro, NO se borran los datos recogidos por el usuario.
```

Esto significa que el borrado de `L` no debe borrar:

```txt
D
F_D
IMG_D
C
T_C
N
T_N
```

El sistema puede borrar, ocultar o marcar como no resolubles los highlights visuales del libro, pero debe conservar la información extraída.

---

### 5.2. Estado recomendado tras borrar libro

Si existe:

```txt
L + H_D -> D + F_D + IMG_D
L + H_C -> C + T_C
L + H_N -> N + T_N
```

y se borra `L`, el resultado recomendado es:

```txt
D + F_D + IMG_D
C + T_C
N + T_N

con referencias de origen marcadas como:
  - bookDeleted
  - sourceUnavailable
  - detached
  - archived
  - unresolvedSource
```

El nombre exacto del estado puede variar, pero debe existir una forma explícita de saber que el dato sobrevivió a la eliminación del libro.

---

### 5.3. Lo que nunca debe ocurrir

```txt
delete L -> delete D
delete L -> delete C
delete L -> delete N
delete L -> delete F_D
delete L -> delete IMG_D
delete L -> delete T_C
delete L -> delete T_N
```

Salvo que el usuario ejecute una acción explícita de borrado sobre esos datos.

---

## 6. Ciclo SDD 1: TDD y recogida de feedback

Este documento pertenece al primer ciclo SDD.

### 6.1. Objetivo

Construir pruebas que demuestren el comportamiento real del sistema.

El objetivo no es arreglar todavía, sino observar.

```txt
Ciclo SDD 1:
  - No modificar código de producción.
  - Crear tests.
  - Ejecutar sincronizaciones controladas.
  - Registrar outputs.
  - Detectar divergencias.
  - Guardar resultados en Engram.
  - Clasificar bugs.
  - Preparar decisiones para el ciclo SDD 2.
```

---

### 6.2. Qué debe producir este ciclo

Al final del primer ciclo deben existir:

```txt
1. Lista de tests ejecutados.
2. Lista de tests fallidos.
3. Casos ambiguos o no definidos.
4. Bugs reproducibles.
5. Logs asociados.
6. Estados A/B antes y después.
7. Eventos CRDT generados.
8. HLCs de cada operación.
9. Decisiones pendientes.
10. Feedback guardado en Engram.
```

---

## 7. Ciclo SDD 2: aplicación de correcciones

El segundo ciclo SDD debe usar los resultados del primero.

```txt
Ciclo SDD 2:
  - Revisar resultados guardados en Engram.
  - Priorizar bugs.
  - Corregir lógica CRDT.
  - Corregir resolución HLC.
  - Corregir integridad relacional.
  - Repetir la suite TDD.
  - Confirmar convergencia.
```

El segundo ciclo no debe improvisar correcciones. Debe partir de los casos fallidos documentados en el primer ciclo.

---

# 8. Casos base de libros

## 8.1. Ninguno tiene nada

```txt
A: ∅
B: ∅
->
A: ∅
B: ∅
```

Debe ser idempotente.

---

## 8.2. A tiene libro, B no

```txt
A: L
B: ∅
->
A: L
B: L
```

---

## 8.3. B tiene libro, A no

```txt
A: ∅
B: L
->
A: L
B: L
```

---

## 8.4. Ambos tienen el mismo libro con el mismo ID

```txt
A: L(id=1)
B: L(id=1)
->
A: L(id=1)
B: L(id=1)
```

No debe duplicarse.

---

## 8.5. Ambos tienen el mismo libro lógico con distinto ID

```txt
A: L(id=A1, hash=XYZ)
B: L(id=B1, hash=XYZ)
->
resultado según política:
  opción 1: se fusionan
  opción 2: se conservan como duplicados controlados
```

Debe registrarse en Engram cuál es la política final.

---

## 8.6. Ambos tienen libros distintos con metadatos parecidos

```txt
A: L1(título="La Odisea", hash=AAA)
B: L2(título="La Odisea", hash=BBB)
->
A: L1 + L2
B: L1 + L2
```

No se deben fusionar libros solo por título.

---

# 9. Casos base de libro con datos completos

## 9.1. Libro con Diccionario completo

```txt
A: L + H_D -> D + F_D + IMG_D
B: ∅
->
A: L + H_D -> D + F_D + IMG_D
B: L + H_D -> D + F_D + IMG_D
```

---

## 9.2. Libro con Cita completa

```txt
A: L + H_C -> C + T_C
B: ∅
->
A: L + H_C -> C + T_C
B: L + H_C -> C + T_C
```

---

## 9.3. Libro con Anotación completa

```txt
A: L + H_N -> N + T_N
B: ∅
->
A: L + H_N -> N + T_N
B: L + H_N -> N + T_N
```

---

## 9.4. Libro con todos los grupos

```txt
A: L + H_D -> D + F_D + IMG_D + H_C -> C + T_C + H_N -> N + T_N
B: ∅
->
A: L + H_D -> D + F_D + IMG_D + H_C -> C + T_C + H_N -> N + T_N
B: L + H_D -> D + F_D + IMG_D + H_C -> C + T_C + H_N -> N + T_N
```

Este es uno de los tests principales.

---

## 9.5. A tiene libro, B tiene libro con datos

```txt
A: L
B: L + H_D -> D + F_D + IMG_D
->
A: L + H_D -> D + F_D + IMG_D
B: L + H_D -> D + F_D + IMG_D
```

Repetir para:

```txt
L + H_C -> C + T_C
L + H_N -> N + T_N
L + H_D -> D + F_D + IMG_D + H_C -> C + T_C
L + H_D -> D + F_D + IMG_D + H_N -> N + T_N
L + H_C -> C + T_C + H_N -> N + T_N
L + H_D -> D + F_D + IMG_D + H_C -> C + T_C + H_N -> N + T_N
```

---

# 10. Casos con datos sin libro

Estos casos son ahora válidos en determinados contextos porque los datos recogidos sobreviven al borrado del libro.

## 10.1. Diccionario sin libro disponible

```txt
A: D + F_D + IMG_D
B: ∅
->
A: D + F_D + IMG_D
B: D + F_D + IMG_D
```

Debe conservarse.

Debe marcarse origen como:

```txt
sourceBookMissing
sourceDeleted
detached
archived
```

Según el vocabulario del sistema.

---

## 10.2. Cita sin libro disponible

```txt
A: C + T_C
B: ∅
->
A: C + T_C
B: C + T_C
```

La cita debe sobrevivir aunque el libro no exista.

---

## 10.3. Anotación sin libro disponible

```txt
A: N + T_N
B: ∅
->
A: N + T_N
B: N + T_N
```

La anotación debe sobrevivir porque contiene el texto sobre el que se hizo.

---

## 10.4. Highlight sin libro disponible

```txt
A: H_D -> D
B: ∅
->
resultado esperado:
  D se conserva.
  H_D puede quedar como unresolved, detached o eliminarse visualmente.
```

El dato tiene prioridad sobre el highlight.

---

## 10.5. Dato con referencia a libro borrado

```txt
A: D + F_D + IMG_D + sourceBookId=L(deleted)
B: ∅
->
A: D + F_D + IMG_D + sourceBookId=L(deleted)
B: D + F_D + IMG_D + sourceBookId=L(deleted)
```

La referencia histórica puede conservarse, pero no debe exigir que el libro exista.

---

# 11. Casos donde falta una parte de la relación

## 11.1. Existe dato de Diccionario, pero no highlight

```txt
A: L + D + F_D + IMG_D
B: L
->
A: L + D + F_D + IMG_D
B: L + D + F_D + IMG_D
```

No es necesariamente inválido. Puede significar que el dato está archivado, desvinculado o importado.

---

## 11.2. Existe Cita, pero no highlight

```txt
A: L + C + T_C
B: L
->
A: L + C + T_C
B: L + C + T_C
```

La cita debe conservarse.

---

## 11.3. Existe Anotación, pero no highlight

```txt
A: L + N + T_N
B: L
->
A: L + N + T_N
B: L + N + T_N
```

La anotación debe conservarse.

---

## 11.4. Existe highlight, pero no dato asociado

```txt
A: L + H_D -> missing(D)
B: L
->
resultado esperado:
  no debe quedar H_D apuntando a la nada.
```

Opciones válidas:

```txt
1. Marcar H_D como unresolved.
2. Eliminar el highlight visual.
3. Esperar a que llegue D en otro lote.
```

Repetir para:

```txt
H_C -> missing(C)
H_N -> missing(N)
```

---

## 11.5. Llega primero el dato y después el libro

```txt
paso 1:
A recibe D + F_D + IMG_D, pero todavía no recibe L

paso 2:
A recibe L + H_D

resultado final:
A: L + H_D -> D + F_D + IMG_D
```

---

## 11.6. Llega primero el highlight y después el dato

```txt
paso 1:
A recibe L + H_D -> missing(D)

paso 2:
A recibe D + F_D + IMG_D

resultado final:
A: L + H_D -> D + F_D + IMG_D
```

---

# 12. Conflictos de creación

## 12.1. Ambos crean el mismo libro con el mismo ID

```txt
A: create L(id=1)
B: create L(id=1)
->
A: L(id=1)
B: L(id=1)
```

No debe duplicarse.

---

## 12.2. Ambos crean el mismo libro lógico con IDs distintos

```txt
A: create L(id=A1, hash=XYZ)
B: create L(id=B1, hash=XYZ)
->
según política:
  fusionar
  o conservar duplicado controlado
```

---

## 12.3. Ambos crean la misma palabra de Diccionario

```txt
A: L + H_D1 -> D1(palabra="zozobrar") + F_D1 + IMG_D1
B: L + H_D2 -> D2(palabra="zozobrar") + F_D2 + IMG_D2
->
A/B:
  D("zozobrar")
  F_D1
  F_D2
  IMG_D según política
  H_D1
  H_D2
```

Posible política recomendada:

```txt
Diccionario:
  una entrada global por palabra normalizada.
  múltiples apariciones/frases pueden apuntar a la misma palabra.
```

---

## 12.4. Ambos crean la misma cita desde el mismo rango

```txt
A: L + H_C1(range=100-120) -> C1 + T_C
B: L + H_C2(range=100-120) -> C2 + T_C
->
A/B:
  una cita lógica
  un texto citado recogido
  sin duplicados
```

---

## 12.5. Ambos crean la misma cita textual en libros distintos

```txt
A: L1 + H_C -> C(texto="...")
B: L2 + H_C -> C(texto="...")
->
A/B:
  C1 vinculada históricamente a L1
  C2 vinculada históricamente a L2
```

Mismo texto no implica misma cita si cambia la fuente.

---

## 12.6. Ambos crean anotaciones distintas sobre el mismo texto

```txt
A: L + H_N -> N("Idea A") + T_N
B: L + H_N -> N("Idea B") + T_N
->
según política:
  opción 1: dos anotaciones separadas
  opción 2: merge de texto
  opción 3: conflicto manual
  opción 4: gana HLC mayor
```

Para anotaciones personales, es recomendable evitar pérdida silenciosa.

---

# 13. Conflictos de edición

## 13.1. A edita un campo, B no toca nada

```txt
A: D(definición="nueva")
B: D(definición="vieja")
->
A/B: D(definición="nueva")
```

Repetir para:

```txt
Libro.título
Libro.autor
Libro.portada
Diccionario.palabra
Diccionario.definición
Diccionario.curiosidad
Diccionario.frase
Diccionario.imagen
Cita.texto
Cita.comentario
Anotación.texto
Highlight.color
Highlight.rango
Highlight.tipo
```

---

## 13.2. A y B editan campos distintos

```txt
A: D(definición="nueva", curiosidad="vieja")
B: D(definición="vieja", curiosidad="nueva")
->
A/B: D(definición="nueva", curiosidad="nueva")
```

Debe probarse merge por campo.

---

## 13.3. A y B editan el mismo campo

```txt
A: D(definición="versión A", hlc=10)
B: D(definición="versión B", hlc=11)
->
A/B: D(definición="versión B")
```

Si se usa LWW por campo, gana el HLC mayor.

---

## 13.4. A y B editan el mismo campo con mismo tiempo físico

```txt
A: D(definición="A", hlc=(1000, 1, nodeA))
B: D(definición="B", hlc=(1000, 1, nodeB))
->
A/B:
  gana desempate estable por nodeId
```

Debe ser determinista.

---

## 13.5. A edita el dato, B edita el highlight asociado

```txt
A: D(definición="nueva")
B: H_D(color="amarillo")
->
A/B:
  D(definición="nueva")
  H_D(color="amarillo")
```

No deben pisarse.

---

## 13.6. A edita cita, B edita texto recogido

```txt
A: C(comentario="nueva interpretación")
B: T_C(texto="texto citado corregido")
->
A/B:
  C(comentario="nueva interpretación")
  T_C(texto="texto citado corregido")
```

---

## 13.7. A edita anotación, B edita texto base de la anotación

```txt
A: N(texto="mi análisis nuevo")
B: T_N(textoSeleccionado="texto base corregido")
->
A/B:
  N(texto="mi análisis nuevo")
  T_N(textoSeleccionado="texto base corregido")
```

---

# 14. Conflictos de borrado

## 14.1. A borra libro, B no toca nada

```txt
A: delete L
B: L + H_D -> D + F_D + IMG_D + H_C -> C + T_C + H_N -> N + T_N
->
A/B:
  L eliminado
  D + F_D + IMG_D conservado
  C + T_C conservado
  N + T_N conservado
  highlights marcados como detached/unresolved o eliminados visualmente
```

Este test es obligatorio.

---

## 14.2. A borra libro, B añade palabra al mismo libro

```txt
A: delete L
B: L + create H_D -> D + F_D + IMG_D
->
A/B:
  L eliminado si delete gana sobre libro
  D + F_D + IMG_D conservado
  H_D detached/unresolved
```

Aunque el libro desaparezca, la palabra recogida no debe perderse.

---

## 14.3. A borra libro, B añade cita al mismo libro

```txt
A: delete L
B: L + create H_C -> C + T_C
->
A/B:
  L eliminado si delete gana sobre libro
  C + T_C conservado
  H_C detached/unresolved
```

---

## 14.4. A borra libro, B añade anotación al mismo libro

```txt
A: delete L
B: L + create H_N -> N + T_N
->
A/B:
  L eliminado si delete gana sobre libro
  N + T_N conservado
  H_N detached/unresolved
```

---

## 14.5. A borra entrada de Diccionario, B edita esa entrada

```txt
A: delete D
B: edit D(definición="nueva")
->
según política:
  delete gana si HLC mayor
  edit gana si HLC mayor
  o conflicto manual
```

Debe conservarse la trazabilidad en Engram.

---

## 14.6. A borra cita, B edita cita

```txt
A: delete C
B: edit C(comentario="nuevo")
->
según HLC/política:
  delete gana
  edit gana
  o conflicto manual
```

---

## 14.7. A borra anotación, B edita anotación

```txt
A: delete N
B: edit N(texto="nuevo")
->
según HLC/política:
  delete gana
  edit gana
  o conflicto manual
```

---

## 14.8. A borra highlight, B edita dato

```txt
A: delete H_D
B: edit D(definición="nueva")
->
A/B:
  H_D eliminado/detached
  D conservado con definición nueva
```

El dato no debe depender existencialmente del highlight.

---

## 14.9. A borra dato, B edita highlight

```txt
A: delete D
B: edit H_D(color="azul")
->
resultado esperado:
  no debe quedar H_D apuntando a un D eliminado sin estado explícito.
```

Opciones:

```txt
1. H_D queda unresolved.
2. H_D queda detached.
3. H_D se elimina visualmente.
4. D se restaura si la política add/update-wins lo permite.
```

---

## 14.10. Ambos borran lo mismo

```txt
A: delete C
B: delete C
->
A/B: C eliminado
```

Debe ser idempotente.

---

## 14.11. A borra y luego recrea el mismo objeto

```txt
A:
  delete D(id=1)
  create D(id=1)

B:
  D(id=1) viejo
->
resultado esperado:
  el tombstone viejo no debe destruir incorrectamente el objeto recreado.
```

Lo recomendable es que una recreación tenga nuevo ID o nueva época causal.

---

# 15. Conflictos específicos de highlights

## 15.1. Mismo rango, mismo grupo, mismo dato

```txt
A: H_D(range=100-110) -> D
B: H_D(range=100-110) -> D
->
A/B: un solo H_D -> D
```

---

## 15.2. Mismo rango, mismo grupo, distinto dato

```txt
A: H_D(range=100-110) -> D1
B: H_D(range=100-110) -> D2
->
según política:
  fusionar D1/D2
  o conservar dos apariciones separadas
```

---

## 15.3. Mismo rango, grupos distintos

```txt
A: H_D(range=100-110) -> D
B: H_C(range=100-110) -> C
->
A/B:
  H_D -> D
  H_C -> C
```

Mismo texto puede ser palabra de Diccionario y Cita al mismo tiempo.

---

## 15.4. Ranges solapados

```txt
A: H_C(range=100-150) -> C
B: H_N(range=120-180) -> N
->
A/B:
  H_C -> C
  H_N -> N
```

Los highlights no deben pisarse por solapamiento.

---

## 15.5. Range editado concurrentemente

```txt
A: H_C(range=100-150)
B: H_C(range=100-160)
->
según política:
  gana HLC mayor
  o conflicto manual
```

---

## 15.6. Highlight cambia de grupo

```txt
A: H_N -> N
B: cambia H_N a H_C -> C
->
conflicto fuerte
```

Política recomendada:

```txt
No mutar el tipo semántico de un highlight.
En su lugar:
  delete H_N
  create H_C
```

---

## 15.7. Highlight apunta al grupo equivocado

```txt
A: H_D -> C
B: L
->
estado inválido
```

Debe rechazarse o marcarse como inconsistente.

---

# 16. Casos específicos de Diccionario

## 16.1. Misma palabra, distinta capitalización

```txt
A: D("Zozobrar")
B: D("zozobrar")
->
según normalización:
  D("zozobrar")
```

---

## 16.2. Misma palabra con y sin acento

```txt
A: D("solo")
B: D("sólo")
->
según política lingüística:
  una entrada o dos entradas distintas
```

Debe decidirse explícitamente.

---

## 16.3. Misma palabra, definiciones distintas

```txt
A: D("esquife", definición="barca pequeña")
B: D("esquife", definición="embarcación ligera")
->
según política:
  merge
  HLC mayor
  historial
  conflicto manual
```

---

## 16.4. Misma palabra desde libros distintos

```txt
A: L1 + H_D1 -> D("zozobrar") + F_D1 + IMG_D
B: L2 + H_D2 -> D("zozobrar") + F_D2 + IMG_D
->
A/B:
  D("zozobrar")
  F_D1
  F_D2
  H_D1
  H_D2
  IMG_D
```

---

## 16.5. A borra palabra, B añade nueva aparición

```txt
A: delete D("zozobrar")
B: create H_D -> D("zozobrar") + F_D + IMG_D
->
conflicto fuerte
```

Opciones:

```txt
remove-wins:
  D desaparece

add-wins:
  D se restaura

soft-delete:
  D estaba archivada y la nueva aparición la reactiva
```

Para Diccionario, la política recomendada es:

```txt
soft-delete + reactivación por nueva aparición
```

---

## 16.6. Se borra libro de origen de una palabra

```txt
A: delete L
B: L + H_D -> D("abismo") + F_D + IMG_D
->
A/B:
  L eliminado
  D("abismo") conservada
  F_D conservada
  IMG_D conservada
  origen marcado como sourceBookDeleted
```

---

# 17. Casos específicos de Citas

## 17.1. Misma cita, mismo libro, mismo rango

```txt
A: L + H_C(range=100-140) -> C + T_C
B: L + H_C(range=100-140) -> C + T_C
->
A/B:
  una sola cita lógica
  T_C conservado
```

---

## 17.2. Misma cita textual, distinto libro

```txt
A: L1 + C("La misma frase") + T_C
B: L2 + C("La misma frase") + T_C
->
A/B:
  C1 desde L1
  C2 desde L2
```

---

## 17.3. Cita editada manualmente vs texto original del highlight

```txt
A: C(texto="frase corregida")
B: T_C(textoOriginal="frase original")
->
A/B:
  C(texto="frase corregida")
  T_C(textoOriginal="frase original")
```

Conviene separar:

```txt
selectedText = texto capturado del libro
quoteText = texto editable de la cita
```

---

## 17.4. Se borra libro de origen de una cita

```txt
A: delete L
B: L + H_C -> C + T_C
->
A/B:
  L eliminado
  C conservada
  T_C conservado
  origen marcado como sourceBookDeleted
```

---

## 17.5. A borra cita, B mantiene highlight

```txt
A: delete C
B: H_C -> C
->
resultado esperado:
  C queda eliminada si delete gana.
  H_C no debe quedar apuntando a C eliminada sin estado explícito.
```

---

# 18. Casos específicos de Anotaciones

## 18.1. Anotación creada en A, no en B

```txt
A: L + H_N -> N("mi comentario") + T_N
B: L
->
A/B:
  L + H_N -> N("mi comentario") + T_N
```

---

## 18.2. A y B editan la misma anotación

```txt
A: N("interpretación A")
B: N("interpretación B")
->
según política:
  CRDT de texto
  LWW por HLC
  conflicto manual
  conservar ambas versiones
```

Para texto libre personal, conviene evitar pérdida silenciosa.

---

## 18.3. A edita anotación, B borra anotación

```txt
A: N("texto nuevo")
B: delete N
->
según HLC/política:
  delete gana
  edit gana
  conflicto manual
```

---

## 18.4. Anotación vacía

```txt
A: H_N -> N("") + T_N
B: ∅
->
según validación:
  se conserva como borrador
  o se descarta
```

---

## 18.5. Se borra libro de origen de una anotación

```txt
A: delete L
B: L + H_N -> N("comentario") + T_N
->
A/B:
  L eliminado
  N conservada
  T_N conservado
  origen marcado como sourceBookDeleted
```

---

# 19. Casos mixtos entre grupos

## 19.1. A añade Diccionario, B añade Cita al mismo libro

```txt
A: L + H_D -> D + F_D + IMG_D
B: L + H_C -> C + T_C
->
A/B:
  L
  H_D -> D + F_D + IMG_D
  H_C -> C + T_C
```

---

## 19.2. A añade Diccionario, B añade Anotación

```txt
A: L + H_D -> D + F_D + IMG_D
B: L + H_N -> N + T_N
->
A/B:
  L
  H_D -> D + F_D + IMG_D
  H_N -> N + T_N
```

---

## 19.3. A añade Cita, B añade Anotación

```txt
A: L + H_C -> C + T_C
B: L + H_N -> N + T_N
->
A/B:
  L
  H_C -> C + T_C
  H_N -> N + T_N
```

---

## 19.4. A añade los tres grupos, B añade otros tres distintos

```txt
A: L + H_D1 -> D1 + F_D1 + IMG_D1 + H_C1 -> C1 + T_C1 + H_N1 -> N1 + T_N1
B: L + H_D2 -> D2 + F_D2 + IMG_D2 + H_C2 -> C2 + T_C2 + H_N2 -> N2 + T_N2
->
A/B:
  L
  H_D1 -> D1 + F_D1 + IMG_D1
  H_D2 -> D2 + F_D2 + IMG_D2
  H_C1 -> C1 + T_C1
  H_C2 -> C2 + T_C2
  H_N1 -> N1 + T_N1
  H_N2 -> N2 + T_N2
```

---

## 19.5. A borra libro, B añade datos mixtos

```txt
A: delete L
B: L + H_D -> D + F_D + IMG_D + H_C -> C + T_C + H_N -> N + T_N
->
A/B:
  L eliminado
  D + F_D + IMG_D conservado
  C + T_C conservado
  N + T_N conservado
  highlights detached/unresolved
```

---

# 20. Casos de orden de sincronización

## 20.1. Llega libro antes que datos

```txt
batch 1:
  L

batch 2:
  H_D -> D + F_D + IMG_D
  H_C -> C + T_C
  H_N -> N + T_N

resultado:
  estado completo
```

---

## 20.2. Llegan datos antes que libro

```txt
batch 1:
  D + F_D + IMG_D
  C + T_C
  N + T_N

batch 2:
  L + H_D + H_C + H_N

resultado:
  estado completo
```

---

## 20.3. Llega delete de libro antes que datos

```txt
batch 1:
  delete L

batch 2:
  D + F_D + IMG_D
  C + T_C
  N + T_N

resultado:
  L eliminado
  datos conservados
```

---

## 20.4. Llega update viejo después de update nuevo

```txt
batch 1:
  D(definición="nueva", hlc=20)

batch 2:
  D(definición="vieja", hlc=10)

resultado:
  D(definición="nueva")
```

---

## 20.5. Llega tombstone nuevo antes que update viejo

```txt
batch 1:
  tombstone C(hlc=20)

batch 2:
  update C(hlc=10)

resultado:
  C sigue eliminada
```

---

## 20.6. Sync interrumpida a mitad

```txt
A envía:
  L
  H_D
  D
  F_D
  IMG_D

B recibe solo:
  L
  H_D

se reintenta sync
->
B termina con:
  L + H_D -> D + F_D + IMG_D
```

---

# 21. Casos propios de HLC

## 21.1. Reloj de A adelantado

```txt
A clock físico: 2030
B clock físico: 2026

A edita D
B edita D después causalmente

resultado:
  HLC debe preservar causalidad, no solo reloj físico.
```

---

## 21.2. Reloj de A atrasado

```txt
A clock físico: 2020
B clock físico: 2026

A recibe evento de B y luego edita
->
A debe generar HLC mayor que el evento recibido.
```

---

## 21.3. Dos eventos en el mismo milisegundo

```txt
A: hlc=(1000, 0, nodeA)
B: hlc=(1000, 0, nodeB)
->
orden total estable por nodeId
```

---

## 21.4. Evento local después de evento remoto

```txt
A recibe update de B con hlc=50
A edita después
->
A produce hlc > 50
```

---

## 21.5. Repetición de eventos

```txt
A recibe el mismo update 3 veces
->
solo se aplica una vez
```

---

## 21.6. Eventos fuera de orden

```txt
A recibe:
  update hlc=30
  update hlc=10
  update hlc=20
->
estado final corresponde a hlc=30
```

---

# 22. Casos de duplicados

## 22.1. Mismo objeto recibido dos veces

```txt
A recibe D(id=1) dos veces
->
solo existe D(id=1)
```

---

## 22.2. Mismo highlight recibido dos veces

```txt
A recibe H_C(id=1) dos veces
->
solo existe H_C(id=1)
```

---

## 22.3. Misma cita con distinto ID pero mismo origen

```txt
A: C(id=A1, book=L, range=100-120)
B: C(id=B1, book=L, range=100-120)
->
según dedupe:
  una sola cita lógica
```

---

## 22.4. Misma palabra con distinto ID

```txt
A: D(id=A1, palabra="melancolía")
B: D(id=B1, palabra="melancolía")
->
según política:
  una entrada global
```

---

## 22.5. Misma imagen asociada a palabra

```txt
A: IMG_D(id=A1, url/hash=XYZ)
B: IMG_D(id=B1, url/hash=XYZ)
->
según política:
  una imagen lógica
  o dos imágenes asociadas a la misma palabra
```

---

# 23. Casos de relaciones múltiples

## 23.1. Una palabra aparece en varios libros

```txt
A: L1 + H_D1 -> D("zozobrar") + F_D1
B: L2 + H_D2 -> D("zozobrar") + F_D2
->
A/B:
  D("zozobrar")
  F_D1
  F_D2
  H_D1
  H_D2
```

---

## 23.2. Una cita pertenece históricamente a un libro borrado

```txt
A: delete L1
B: L1 + H_C -> C + T_C
->
A/B:
  L1 eliminado
  C + T_C conservado
  sourceBookId=L1 marcado como deleted
```

---

## 23.3. Una anotación pertenece históricamente a un texto recogido

```txt
A: L + H_N1 -> N + T_N
B: delete L
->
A/B:
  L eliminado
  N conservada
  T_N conservado
```

---

## 23.4. Se elimina una aparición, pero no la entrada global

```txt
A: delete H_D1
B: D("zozobrar") + H_D2 + F_D2
->
A/B:
  D("zozobrar") sigue existiendo
  H_D1 eliminado/detached
  H_D2 conservado
  F_D2 conservada
```

---

# 24. Casos de libro con versión distinta

## 24.1. Mismo libro, mismo hash

```txt
A: L(hash=XYZ) + H(range=100-120)
B: L(hash=XYZ)
->
highlight aplicable de forma segura
```

---

## 24.2. Mismo título, distinto hash

```txt
A: L(hash=AAA) + H(range=100-120)
B: L(hash=BBB)
->
no aplicar highlight ciegamente
```

---

## 24.3. Libro actualizado y highlight viejo

```txt
A: L(version=2)
B: L(version=1) + H(range viejo)
->
validar si el anchor sigue siendo resoluble
```

---

## 24.4. Highlight no resoluble

```txt
A: L + H(anchor inválido)
B: L
->
resultado:
  H queda unresolved
  dato asociado se conserva
```

---

## 24.5. Libro borrado y highlight no resoluble

```txt
A: delete L
B: L + H_C -> C + T_C
->
A/B:
  L eliminado
  H_C unresolved/detached
  C + T_C conservado
```

---

# 25. Casos de schema y validación

## 25.1. Falta campo obligatorio

```txt
A recibe D sin palabra
->
rechazar, reparar o marcar inválido
```

---

## 25.2. Tipo incorrecto

```txt
A recibe H(type="quote") apuntando a D
->
rechazar o marcar inconsistente
```

---

## 25.3. ID colisionado entre tablas

```txt
A: D(id=123)
B: C(id=123)
->
no debe confundirse si los IDs están namespaced
```

Recomendación:

```txt
book:...
highlight:...
dictionary:...
quote:...
annotation:...
image:...
selectedText:...
```

---

## 25.4. Texto recogido vacío

```txt
A: C + T_C("")
B: ∅
->
según validación:
  conservar como borrador
  o marcar inválido
```

---

## 25.5. Imagen inválida

```txt
A: D + IMG_D(url rota)
B: ∅
->
D se conserva
IMG_D se marca como unavailable/broken
```

La imagen no debe hacer fallar la entrada de Diccionario.

---

# 26. Plantilla de registro en Engram

Cada test debe guardarse en Engram con una estructura similar:

```md
# Test CRDT-HLC: <ID del caso>

## Estado
- Pendiente
- Pasado
- Fallido
- Ambiguo
- Requiere decisión

## Caso
<nombre del caso>

## Objetivo
<qué intenta demostrar>

## Estado inicial A
```txt
...
```

## Estado inicial B
```txt
...
```

## Operaciones ejecutadas
```txt
...
```

## Orden de sincronización
```txt
...
```

## HLCs relevantes
```txt
...
```

## Resultado esperado
```txt
...
```

## Resultado obtenido
```txt
...
```

## Divergencia detectada
```txt
...
```

## Logs relevantes
```txt
...
```

## Diagnóstico provisional
...

## Decisión o corrección pendiente
...

## Notas
...
```

---

# 27. Suite mínima recomendada

Para empezar el primer ciclo TDD, esta sería la suite mínima:

```txt
01. ∅ | ∅ -> ∅
02. L | ∅ -> L en ambos
03. L + H_D -> D + F_D + IMG_D | ∅ -> todo en ambos
04. L + H_C -> C + T_C | ∅ -> todo en ambos
05. L + H_N -> N + T_N | ∅ -> todo en ambos
06. L + todos los grupos | ∅ -> todo en ambos

07. L | L + H_D -> D + F_D + IMG_D -> ambos completos
08. L | L + H_C -> C + T_C -> ambos completos
09. L | L + H_N -> N + T_N -> ambos completos

10. D + F_D + IMG_D sin L -> se conserva
11. C + T_C sin L -> se conserva
12. N + T_N sin L -> se conserva

13. delete L | L + H_D -> D + F_D + IMG_D -> L borrado, D/F/IMG conservados
14. delete L | L + H_C -> C + T_C -> L borrado, C/T_C conservados
15. delete L | L + H_N -> N + T_N -> L borrado, N/T_N conservados
16. delete L | L + todos los grupos -> datos conservados

17. mismo libro mismo ID -> no duplica
18. mismo libro distinto ID mismo hash -> dedupe o duplicado controlado
19. mismo título distinto hash -> no fusionar incorrectamente

20. ambos crean misma palabra -> una entrada o conflicto controlado
21. ambos crean misma cita mismo rango -> no duplicar
22. ambos crean anotaciones distintas mismo texto -> merge/conflicto

23. A edita D, B edita H_D -> ambos cambios sobreviven
24. A edita C, B edita H_C -> ambos cambios sobreviven
25. A edita N, B edita H_N -> ambos cambios sobreviven

26. A y B editan mismo campo de D -> gana HLC/política
27. A y B editan mismo campo de C -> gana HLC/política
28. A y B editan mismo texto de N -> CRDT texto o conflicto

29. delete D | edit D -> delete/update según HLC
30. delete C | edit C -> delete/update según HLC
31. delete N | edit N -> delete/update según HLC

32. llegada fuera de orden: datos antes que libro
33. llegada fuera de orden: delete libro antes que datos
34. update viejo llega después de update nuevo
35. tombstone nuevo llega antes que update viejo

36. HLC con reloj adelantado
37. HLC con reloj atrasado
38. HLC mismo timestamp, distinto nodeId
39. eventos duplicados
40. eventos fuera de orden

41. mismo rango, distinto grupo: H_D y H_C conviven
42. ranges solapados -> ambos conviven
43. highlight cambia de grupo -> conflicto controlado
44. libro mismo título distinto hash -> no aplicar highlights ciegamente

45. sync interrumpida a mitad y reintentada
46. sync repetida dos veces -> idempotencia
47. imagen rota asociada a palabra -> no rompe D
48. texto recogido existe aunque libro se borre
```

---

# 28. Resumen final

Los grupos de pruebas principales son:

```txt
1. Existencia básica.
2. Sincronización de libro con datos.
3. Datos sobreviviendo sin libro.
4. Creación concurrente.
5. Edición concurrente.
6. Borrado concurrente.
7. Borrado de libro sin borrado de datos.
8. Integridad relacional.
9. Duplicados.
10. Highlights y rangos.
11. Diccionario global.
12. Citas con texto recogido.
13. Anotaciones con texto recogido.
14. Orden de llegada de eventos.
15. HLC y causalidad.
16. Validación de schema.
17. Reintentos e idempotencia.
18. Registro de resultados en Engram.
```

La regla más importante de esta guía es:

> El libro puede desaparecer, pero la memoria recogida por el usuario no.

Por tanto, el sistema debe tratar Diccionario, Citas y Anotaciones como datos persistentes de usuario, no como meros hijos desechables del libro.

El primer ciclo SDD debe demostrar con tests si esta regla se cumple. El segundo ciclo SDD debe corregir todo aquello que la contradiga.

---

# 29. Batería ampliada de 120 casos quisquillosos

Esta sección amplía la guía con una batería agresiva de pruebas. La intención es probar ciclos completos, no solo estados simples.

Notación:

```txt
O = Ordenador
M = Móvil
sync O→M = sincronización desde ordenador hacia móvil
sync M→O = sincronización desde móvil hacia ordenador
sync O↔M = sincronización bidireccional
L = Libro
D = Entrada de Diccionario
F_D = Frase asociada a palabra de Diccionario
IMG_D = Imagen asociada a palabra de Diccionario
C = Cita
T_C = Texto citado recogido
N = Anotación
T_N = Texto sobre el que se hizo la anotación
H_D / H_C / H_N = Highlights de Diccionario, Citas y Anotaciones
```

Regla clave de esta sección:

> El tombstone de un libro borrado no debe convertirse en una maldición eterna. Debe bloquear eventos antiguos, pero no una reimportación posterior legítima.

Para soportarlo, conviene distinguir:

```txt
bookIdentity   = identidad lógica del contenido, por ejemplo hash estable
bookInstanceId = instancia concreta importada
bookGeneration = generación de creación/restauración
tombstone      = borrado de una instancia/generación concreta
```

Si el sistema solo usa `bookId + tombstone permanente`, puede ocurrir el bug peligroso: borrar el libro una vez impide que vuelva a sincronizarse cuando se reimporta.

## 29.1. Ciclos de vida de libros, tombstones y reimportaciones

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T001 | Importar libro en ordenador | O: ∅, M: ∅ → O importa L → sync O→M | O y M tienen L. Sin duplicados. |
| T002 | Importar libro en móvil | O: ∅, M: ∅ → M importa L → sync M→O | O y M tienen L. Sin duplicados. |
| T003 | Borrar en móvil y propagar | O: L, M: L → M borra L → sync M→O | L desaparece también de O. Se guarda tombstone. |
| T004 | Borrar en ordenador y propagar | O: L, M: L → O borra L → sync O→M | L desaparece también de M. Se guarda tombstone. |
| T005 | Borrar en móvil y reimportar en ordenador | O importa L → sync → M borra L → sync → O reimporta L → sync | L vuelve a aparecer en M. El tombstone antiguo no bloquea la nueva creación. |
| T006 | Borrar en ordenador y reimportar en móvil | M importa L → sync → O borra L → sync → M reimporta L → sync | L vuelve a aparecer en O. |
| T007 | Importar y borrar antes de sincronizar | O importa L → O borra L → sync O→M | M no muestra L. No aparece libro fantasma. |
| T008 | Importar, borrar y reimportar antes de sincronizar | O importa L → O borra L → O reimporta L → sync O→M | M muestra L. La creación final gana al delete intermedio. |
| T009 | Reimportar inmediatamente tras recibir delete remoto | M borra L → sync M→O → O reimporta L → sync O→M | O y M muestran L nuevo. |
| T010 | Doble delete y reimportación posterior | O borra L y M borra L offline → sync → O reimporta L → sync | O y M muestran L. Dos tombstones viejos no bloquean create nuevo. |
| T011 | Reimportación con mismo hash y nuevo instanceId | M borra L(instance=1) → sync → O importa L(hash igual, instance=2) → sync | M recibe L(instance=2). Delete de instance=1 no mata instance=2. |
| T012 | Reimportación con mismo ID lógico y nueva generación | M borra book:XYZ gen=1 → sync → O reimporta book:XYZ gen=2 → sync | O y M muestran gen=2. Necesario distinguir generación. |
| T013 | Reimportación con distinto hash pero mismo título | M borra L(hash=AAA) → sync → O importa L(hash=BBB, mismo título) → sync | M recibe L(hash=BBB). No se confunde con el borrado de AAA. |
| T014 | Delete remoto viejo llega después de reimportación nueva | M borra gen=1 offline → O reimporta gen=2 offline → sync con delete atrasado | Gen=2 permanece. Delete de gen=1 no debe matar gen=2. |
| T015 | Create viejo llega después de delete nuevo | M borra L HLC=20 → llega create antiguo HLC=10 | L sigue borrado. Create viejo no resucita. |
| T016 | Create nuevo llega después de delete viejo | M borra L HLC=10 → O reimporta L HLC=20 → sync | L existe en ambos. Create nuevo gana. |
| T017 | Sync repetida tras delete | M borra L → sync M→O → repetir sync varias veces | L sigue ausente. Un único tombstone lógico. |
| T018 | Sync repetida tras reimportación | O reimporta L → sync O→M → repetir sync | L único en ambos. Sin duplicados. |
| T019 | Borrar libro con ordenador apagado | O offline con L → M borra L → O vuelve → sync | O elimina L al recibir tombstone. |
| T020 | Reimportar tras limpiar caché local | M borra L → sync → O limpia caché → O reimporta archivo → sync | M recibe L nuevo. Limpiar caché no debe impedir create. |

## 29.2. Borrado de libro conservando datos del usuario

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T021 | Borrar libro con palabra de Diccionario | L + H_D→D + F_D + IMG_D en ambos → M borra L → sync | L desaparece; D, F_D e IMG_D permanecen en ambos. |
| T022 | Borrar libro con cita | L + H_C→C + T_C en ambos → O borra L → sync | L desaparece; C y T_C permanecen. |
| T023 | Borrar libro con anotación | L + H_N→N + T_N en ambos → M borra L → sync | L desaparece; N y T_N permanecen. |
| T024 | Borrar libro con todos los grupos | L + D/F/IMG + C/T_C + N/T_N → borrar L → sync | Solo desaparece L como presencia de biblioteca. Todos los datos quedan. |
| T025 | Reimportar libro tras conservar datos | Datos detached existen → O reimporta mismo hash → sync | Libro aparece; datos siguen; highlights se reenganchan si anchor resuelve. |
| T026 | Reenganchar Diccionario tras reimportar | D + F_D + IMG_D con sourceBookDeleted → reimportar mismo hash | Se crea/recupera H_D si la frase/anchor es resoluble. |
| T027 | No reenganchar si anchor no resuelve | C + T_C detached → reimportar mismo hash pero anchor inválido | C y T_C siguen; H_C queda unresolved/detached. |
| T028 | No reenganchar a libro distinto | Datos de hash AAA → importar mismo título hash BBB | Datos siguen detached. No reenganchar por título. |
| T029 | Borrar libro no borra imagen local | L + D + IMG_D(local) → borrar L → sync | IMG_D permanece disponible o marcada missing si falta archivo. |
| T030 | Borrar libro no borra texto base de anotación | L + N + T_N → borrar L → sync | N y T_N permanecen. |
| T031 | Borrar libro no borra texto citado | L + C + T_C → borrar L → sync | C y T_C permanecen. |
| T032 | Dato creado justo antes de borrar libro | M crea D/F/IMG → M borra L → sync | D/F/IMG sobreviven aunque L no. |
| T033 | Dato creado desde selección cacheada tras borrar libro | M borra L → UI intenta crear D desde caché → sync | O rechaza limpiamente o conserva D detached. Nunca corrupción. |
| T034 | Editar cita conservada sin libro | C + T_C detached → M edita C → sync | Edición de C converge en ambos. |
| T035 | Editar palabra conservada sin libro | D detached → O edita definición → sync | D editada converge. |
| T036 | Editar anotación conservada sin libro | N + T_N detached → M edita N → sync | N editada converge. |
| T037 | Borrar libro y luego borrar dato explícitamente | L + D → borrar L → sync → borrar D → sync | Primero D sobrevive; después D se borra porque el usuario lo borró explícitamente. |
| T038 | Borrar libro y restaurar dato archivado | L borrado, D archived → usuario restaura D → sync | D queda activa en ambos aunque L no exista. |
| T039 | Borrar libro con varias apariciones de misma palabra | L1 y L2 contienen D → borrar L1 → sync | D permanece por L2; aparición de L1 queda detached/deleted según política. |
| T040 | Borrar último libro que referenciaba palabra | Solo L referencia D → borrar L → sync | D permanece como entrada de usuario sin libro. |

## 29.3. Creaciones concurrentes y deduplicación

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T041 | Ambos importan el mismo libro offline | O importa L(hash=XYZ), M importa L(hash=XYZ), sync | Un solo libro lógico o duplicado controlado según política. |
| T042 | Ambos importan mismo título distinto hash | O importa hash AAA, M importa hash BBB, sync | Deben existir ambos libros. |
| T043 | Ambos crean misma palabra misma frase | O y M crean D("umbral") + F_D igual, sync | D y F_D únicos. Sin duplicados visuales. |
| T044 | Ambos crean misma palabra frases distintas | O crea D+F1, M crea D+F2, sync | Una D global; F1 y F2 conservadas. |
| T045 | Ambos crean misma palabra imágenes distintas | O crea IMG1, M crea IMG2, sync | D única; imágenes fusionadas o principal por política. |
| T046 | Ambos crean misma cita mismo rango | O y M crean C sobre range igual, sync | Una cita lógica. Sin duplicado. |
| T047 | Ambos crean cita misma frase distinto libro | O crea C en L1, M crea C en L2, sync | Dos citas: fuente distinta. |
| T048 | Ambos crean anotación mismo texto mismo rango | O crea N, M crea N igual, sync | Una N lógica o duplicado controlado según política. |
| T049 | Ambos crean anotaciones distintas mismo rango | O crea N("A"), M crea N("B"), sync | Dos notas o conflicto/merge visible. No perder una. |
| T050 | Palabra y cita sobre mismo rango | O crea H_D→D, M crea H_C→C sobre mismo rango, sync | Ambos highlights conviven. |
| T051 | Cita y anotación con rangos solapados | O crea C 100-150, M crea N 120-180, sync | Ambos conviven. |
| T052 | Dos palabras distintas mismo rango | O marca palabra A, M marca palabra B en mismo rango, sync | Ambas entradas o conflicto visible si rango incompatible. |
| T053 | Misma palabra con mayúsculas/minúsculas | O crea "Abismo", M crea "abismo", sync | Normalización definida: una entrada o dos explícitas. |
| T054 | Misma palabra con acento distinto | O crea "solo", M crea "sólo", sync | Política lingüística explícita. No dedupe accidental si no corresponde. |
| T055 | Misma imagen por hash distinto URL | O IMG url1 hash X, M IMG url2 hash X, sync | Una imagen lógica o dos fuentes. |

## 29.4. Ediciones concurrentes

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T056 | Editar título y portada | O edita título, M edita portada, sync | Ambos cambios sobreviven. |
| T057 | Editar mismo título | O título=A, M título=B, sync | Gana HLC o conflicto visible. |
| T058 | Editar definición y curiosidad | O edita definición, M curiosidad, sync | Merge por campo. |
| T059 | Editar misma definición | O definición=A, M definición=B, sync | Gana HLC o conflicto visible. |
| T060 | Editar imagen principal concurrentemente | O IMG principal=A, M IMG principal=B, sync | Principal por HLC/política; no borrar imágenes sin razón. |
| T061 | Editar cita y texto citado | O edita comentario de C, M corrige T_C, sync | Ambos cambios sobreviven. |
| T062 | Editar anotación y texto base | O edita N, M corrige T_N, sync | N y T_N actualizados. |
| T063 | Editar highlight y dato | O cambia color H_D, M edita D, sync | Color y D editado sobreviven. |
| T064 | Editar highlight y borrar libro | O cambia color H_D, M borra L, sync | L borrado; D conserva; H_D detached/unresolved si se conserva metadata. |
| T065 | Editar dato y borrar highlight | O edita D, M borra H_D, sync | D conserva edición; H_D eliminado/detached. |
| T066 | Editar libro y borrar libro | O renombra L, M borra L, sync | Según política: remove-wins, HLC o conflicto. Registrar en Engram. |
| T067 | Editar cita y borrar libro | O edita C, M borra L, sync | L borrado; C editada permanece. |
| T068 | Editar anotación y borrar libro | O edita N, M borra L, sync | L borrado; N editada permanece. |
| T069 | Editar palabra y borrar libro | O edita D, M borra L, sync | L borrado; D editada permanece. |
| T070 | Editar dos campos del mismo highlight | O cambia color, M cambia rango, sync | Merge por campo o conflicto si rango/color son atómicos. |

## 29.5. Borrados explícitos, deletes vs updates y dependencias

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T071 | Borrar palabra vs editar palabra | O borra D, M edita D, sync | Resultado por HLC/política. No media entrada. |
| T072 | Borrar cita vs editar cita | O borra C, M edita C, sync | Delete/update/conflicto según política. |
| T073 | Borrar anotación vs editar anotación | O borra N, M edita N, sync | Delete/update/conflicto según política. |
| T074 | Borrar imagen vs editar palabra | O borra IMG_D, M edita D, sync | D editada; imagen por HLC/política. |
| T075 | Borrar frase vs editar palabra | O borra F_D, M edita D, sync | D editada; F_D según política. |
| T076 | Borrar libro y borrar cita | O borra L, M borra C, sync | L borrado; C borrada explícitamente; T_C según política. |
| T077 | Borrar libro y borrar palabra | O borra L, M borra D, sync | L borrado; D borrada solo porque hubo delete explícito de D. |
| T078 | Borrar libro y borrar anotación | O borra L, M borra N, sync | L borrado; N borrada si delete explícito gana. |
| T079 | Delete viejo no borra dato nuevo | M delete D gen1 HLC10, O create D gen2 HLC20, sync | D gen2 existe. |
| T080 | Delete nuevo borra dato viejo | O update HLC10, M delete HLC20, sync | Dato eliminado. |
| T081 | Borrar highlight no borra Diccionario | O borra H_D, sync | D/F/IMG permanecen. |
| T082 | Borrar highlight de cita | O borra H_C, sync | C/T_C permanecen o quedan detached según política. |
| T083 | Borrar highlight de anotación | O borra H_N, sync | N/T_N permanecen o quedan detached según política. |
| T084 | Borrar texto base de anotación | O borra T_N explícitamente, M edita N, sync | N no debe apuntar a T_N inexistente sin estado explícito. |
| T085 | Borrar texto citado explícitamente | O borra T_C, M edita C, sync | C no debe apuntar a T_C inexistente sin estado explícito. |

## 29.6. Orden de llegada, paquetes parciales y retries

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T086 | Llega libro antes que datos | M recibe L → luego D/F/IMG → luego H_D | Estado final completo. |
| T087 | Llegan datos antes que libro | M recibe D/F/IMG → luego L → luego H_D | Estado final completo. |
| T088 | Llega highlight antes que dato | M recibe L+H_C→missing → luego C/T_C | Se resuelve H_C→C. |
| T089 | Llega delete de libro antes que datos | M recibe delete L → luego D/C/N | L no aparece; datos se conservan detached. |
| T090 | Llega delete de dato antes que create viejo | delete D HLC20 → create D HLC10 | D sigue eliminado. |
| T091 | Llega create nuevo después de delete viejo | delete gen1 HLC10 → create gen2 HLC20 | Gen2 existe. |
| T092 | Sync cortada tras enviar libro | O envía L, corte, reintento envía datos/highlights | Estado completo final. |
| T093 | Sync cortada tras enviar datos | O envía D/C/N, corte, reintento envía L/highlights | Estado completo final. |
| T094 | Mismo paquete aplicado dos veces | M aplica paquete P y luego P otra vez | Sin duplicados. |
| T095 | Paquetes fuera de orden | Recibe update HLC30, luego 10, luego 20 | Estado final HLC30. |
| T096 | Sync bidireccional con cambios cruzados | O crea D, M crea C, sync O↔M | Ambos tienen D+C. |
| T097 | Sync bidireccional con borrados cruzados | O borra D, M borra C, sync | Ambos borrados aplicados. |
| T098 | Evento desconocido de entidad hija | M recibe H_D de book desconocido | H_D queda pendiente/unresolved, no crash. |
| T099 | Evento hijo repetido sin padre | M recibe D tres veces antes de L | D única; se enlaza cuando llegue L/H. |
| T100 | Reintento después de error de escritura local | M falla guardando IMG, reintenta paquete completo | D/F/IMG terminan consistentes o IMG missing sin borrar D. |

## 29.7. HLC, relojes y causalidad

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T101 | Reloj ordenador adelantado | O clock 2030 crea D → sync → M edita D | Edición de M debe poder ser causalmente posterior. |
| T102 | Reloj móvil atrasado | M clock 2020 recibe C de O y edita | HLC nuevo de M > HLC recibido. |
| T103 | Dos eventos mismo milisegundo | O y M editan D en t=1000 | Desempate determinista por counter/nodeId. |
| T104 | Muchas operaciones rápidas | O edita D 20 veces rápido → sync | M queda con edición 20. HLC monotónico. |
| T105 | Evento remoto mayor que reloj local | M recibe HLC enorme y luego crea N | HLC(N) > remoto. |
| T106 | NodeId estable como desempate | HLC igual salvo nodeId → repetir sync | Siempre mismo ganador. |
| T107 | HLC no retrocede al reiniciar app | O crea HLC50 → reinicia → crea C | HLC(C)>50. |
| T108 | HLC no retrocede al reiniciar móvil | M crea HLC70 → reinicia → edita | Nuevo HLC>70. |
| T109 | HLC persistido tras cierre brusco | O crea D HLC80 → crash → abre → crea C | HLC(C)>80 o se recupera contador correctamente. |
| T110 | HLC y delete/recreate | delete L HLC100 → recreate L HLC101 | Recreate gana; no queda bloqueado. |

## 29.8. Caché, reinstalación, assets e idempotencia

| ID | Caso | Secuencia | Resultado esperado / comprobación |
|---|---|---|---|
| T111 | Móvil reinstala app | O tiene L+D+C+N, M DB vacía → sync | M restaura estado completo. |
| T112 | Ordenador reinstala app | M tiene L+D+C+N, O DB vacía → sync | O restaura estado completo. |
| T113 | Reinstalar después de borrar libro | O tiene D+C+N pero L borrado, M DB vacía → sync | M recibe datos, no recibe L. |
| T114 | Archivo físico falta en ordenador | O DB tiene L pero archivo falta, M tiene L válido → sync | No borrar L global; marcar missingLocalFile en O. |
| T115 | Imagen local falta en móvil | O tiene IMG, M referencia sin archivo → sync | M recupera o marca missingAsset; D no se borra. |
| T116 | Borrar caché de highlights | M borra caché visual de highlights → sync | No interpretar caché vacía como deletes reales. |
| T117 | Parser de libro falla | M no puede abrir EPUB/PDF → sync | No borrar L; marcar parseError local. |
| T118 | Cambio de ruta local | O mueve archivo de path → sync | No crear duplicado. La identidad no depende solo de path. |
| T119 | Sync sin cambios repetida | O y M iguales → sync 10 veces | Sin cambios, sin HLC nuevo innecesario, sin duplicados. |
| T120 | Ciclo largo completo | O importa L + D; sync; M crea C; sync; O borra L; sync; M edita D/C; M reimporta L; sync | L existe al final; D/C sobreviven y están editadas; highlights reenganchados si procede. |

---

# 30. Checklist obligatoria por cada caso

Cada caso debe guardarse en Engram con esta información mínima:

```txt
[ ] ID del caso
[ ] Estado inicial de O
[ ] Estado inicial de M
[ ] Operaciones ejecutadas en O
[ ] Operaciones ejecutadas en M
[ ] Orden real de sincronización
[ ] HLC de cada operación
[ ] Payload CRDT emitido
[ ] Payload CRDT recibido
[ ] Estado final de O
[ ] Estado final de M
[ ] ¿Convergen?
[ ] ¿Hay duplicados?
[ ] ¿Hay datos perdidos?
[ ] ¿Hay tombstones bloqueando creates nuevos?
[ ] ¿Hay referencias rotas no marcadas?
[ ] ¿Hay highlights huérfanos?
[ ] ¿Los datos sobreviven al borrado del libro?
[ ] ¿La reimportación posterior funciona?
[ ] ¿La sync repetida es idempotente?
[ ] Resultado guardado en Engram
```

---

# 31. Suite prioritaria de regresión

Si no se pueden ejecutar los 120 casos siempre, estos deberían ejecutarse como regresión mínima cada vez que se toque sincronización:

```txt
T003 — Borrar en móvil y propagar al ordenador
T004 — Borrar en ordenador y propagar al móvil
T005 — Borrar en móvil y reimportar en ordenador
T006 — Borrar en ordenador y reimportar en móvil
T008 — Importar, borrar y reimportar antes de sincronizar
T014 — Delete remoto viejo no mata reimportación nueva
T016 — Create nuevo vence delete viejo
T021 — Borrar libro conserva Diccionario
T022 — Borrar libro conserva Cita
T023 — Borrar libro conserva Anotación
T024 — Borrar libro conserva todos los grupos
T025 — Reimportar libro tras conservar datos
T032 — Dato creado justo antes de borrar libro
T041 — Ambos importan mismo libro offline
T043 — Ambos crean misma palabra
T046 — Ambos crean misma cita mismo rango
T056 — Ediciones concurrentes en campos distintos
T066 — Editar libro y borrar libro concurrentemente
T086 — Libro antes que datos
T087 — Datos antes que libro
T089 — Delete de libro antes que datos
T094 — Mismo paquete aplicado dos veces
T101 — Reloj físico adelantado
T107 — HLC no retrocede tras reiniciar app
T116 — Borrar caché de highlights no borra datos
T119 — Sync sin cambios repetida
T120 — Ciclo largo completo
```

---

# 32. Regla final de validación

Todo ciclo debe responder tres preguntas:

```txt
1. ¿El estado visible de libros es correcto?
2. ¿Los datos recogidos por el usuario siguen existiendo?
3. ¿Los tombstones solo bloquean eventos antiguos, pero no creaciones nuevas?
```

Si una de esas tres falla, la sincronización todavía no está bien.

Frase resumen:

> Borrar un libro debe borrar su presencia en la biblioteca, no la memoria que el usuario extrajo de él; y reimportarlo después debe ser una creación legítima, no una resurrección bloqueada por un tombstone antiguo.

---

# 33. Clasificación por frecuencia de uso real

Esta sección ordena los casos de **más habitual** (uso diario) a **más rebuscado** (condiciones de carrera, HLC, reinstalaciones). Sirve como guía para priorizar la ejecución de ciclos harness.

## 🥇 Capa 1 — Uso diario (lo que un usuario hace siempre)

El usuario lee en un dispositivo, recoge datos, sincroniza.

| # | Grupo | Casos | Ref. |
|---|-------|-------|------|
| 1 | Sync de libro básico | L\|∅ → L en ambos, ∅\|∅ → ∅, mismo ID no duplica | §8.1-8.4 |
| 2 | Diccionario en un dispositivo | L + H_D→D+F_D+IMG_D \| ∅ → converge | §9.1 |
| 3 | Cita en un dispositivo | L + H_C→C+T_C \| ∅ → converge | §9.2 |
| 4 | Anotación en un dispositivo | L + H_N→N+T_N \| ∅ → converge | §9.3 |
| 5 | Todos los grupos en un dispositivo | L + D + C + N \| ∅ → converge | §9.4 |
| 6 | Sync bidireccional normal | A tiene L, B tiene L + datos → ambos completos | §9.5 |
| 7 | Sync repetida sin cambios | Idempotencia — sync dos veces no produce cambios nuevos | §12, T119 |
| 8 | Dato creado y sync inmediata | Crear D/F_D/C/N → sync → llega al otro lado | §9.x |

## 🥈 Capa 2 — Frecuente (ediciones y borrados normales)

El usuario edita lo que recogió o borra un libro.

| # | Grupo | Casos | Ref. |
|---|-------|-------|------|
| 9 | Editar campo en UN dispositivo | Cambiar definición, comentario, color, título | §13.1 |
| 10 | Borrar libro conserva datos | delete L → D/C/N sobreviven | §14.1-14.4 |
| 11 | Datos sin libro (detached) | D/F_D/IMG_D, C, N sin L → sobreviven | §10.1-10.5 |
| 12 | Editar dato conservado sin libro | Editar D detached, C detached, N detached | §17.5, §18.3 |
| 13 | Reimportar libro tras borrarlo | delete L → reimport → sync → L vuelve | T005-T006 |
| 14 | Borrar highlight y conservar dato | delete H_D → D permanece | §14.8-14.9 |

## 🥉 Capa 3 — Ocasional (conflictos ligeros)

Dos dispositivos, uso normal, pero sin coordinación.

| # | Grupo | Casos | Ref. |
|---|-------|-------|------|
| 15 | Mismo libro desde cada dispositivo | mismo ID no duplica, mismo hash distinto ID | §8.4-8.6 |
| 16 | Misma palabra desde dos dispositivos | D("zozobrar") desde L1 y L2 → una entrada global | §16.4 |
| 17 | Misma cita mismo rango desde dos dispositivos | Una cita lógica, sin duplicados | §17.1 |
| 18 | Editar highlight y dato por separado | A cambia color, B edita D → ambos sobreviven | §13.5-13.7 |
| 19 | Mismo rango, grupos distintos | H_D y H_C sobre mismo texto → conviven | §15.3 |
| 20 | Rangos solapados | H_C 100-150 y H_N 120-180 → conviven | §15.4 |

## 🏅 Capa 4 — Raro (conflictos reales)

Dos personas editando lo mismo o condiciones de carrera.

| # | Grupo | Casos | Ref. |
|---|-------|-------|------|
| 21 | Editar mismo campo | Gana HLC mayor o conflicto visible | §13.3-13.4 |
| 22 | Editar vs borrar | delete D vs edit D, delete C vs edit C | §14.5-14.7 |
| 23 | Creaciones concurrentes | Ambos crean misma cita, misma palabra | §12.1-12.6 |
| 24 | Anotaciones distintas mismo rango | N("A") y N("B") sobre mismo texto | §12.6 |
| 25 | Highlight cambia de grupo | conflicto fuerte — no mutar tipo semántico | §15.6 |
| 26 | Highlight apunta a grupo equivocado | H_D→C → estado inválido | §15.7 |

## 🧠 Capa 5 — Muy rebuscado (HLC, tombstones, orden, reinstalaciones)

Casos de sistema, borde, que casi ningún usuario encontrará.

| # | Grupo | Casos | Ref. |
|---|-------|-------|------|
| 27 | Orden de llegada | datos antes que libro, delete antes que datos | §20.1-20.6 |
| 28 | Tombstones y reimportación | delete no bloquea create nuevo | T005-T020 |
| 29 | HLC reloj adelantado/atrasado | Clock skew, mismo timestamp | §21.1-21.6 |
| 30 | Paquetes parciales y reintentos | Sync cortada y reintentada | T092-T100 |
| 31 | Reinstalación de app | DB vacía → sync restaura estado completo | T111-T112 |
| 32 | Eventos duplicados y fuera de orden | Mismo paquete dos veces, orden revuelto | §22, §20.4-20.6 |
| 33 | Schema y validación | ID colisionado, tipo incorrecto, campo faltante | §25.1-25.5 |
| 34 | Versión de libro distinta | Mismo título distinto hash, anchor no resoluble | §24.1-24.5 |
| 35 | Batería completa T001-T120 | Cobertura total de casos quisquillosos | §29.1-29.8 |

## Orden de ejecución recomendado para ciclos harness

```txt
Fase 1 — Capa 1 (uso diario):      ~12 casos  ← EMPEZAMOS AQUÍ
Fase 2 — Capa 2 (frecuente):        ~15 casos
Fase 3 — Capa 3 (ocasional):        ~12 casos
Fase 4 — Capa 4 (raro):             ~10 casos
Fase 5 — Capa 5 (muy rebuscado):    ~40 casos
                                   ─────────
                   Total:           ~89 casos
```

Cada caso sigue el ciclo harness definido en `ciclo_harness.md`. Cuando un caso no pasa como debería, se inicia un **ciclo SDD completo** (proposal → specs → design → tasks → apply → verify → archive) con los parámetros: automático, híbrido, autochain stacked-to-main. Tras el fix, se repite el ciclo harness para confirmar.
