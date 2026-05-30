# Biblioteca — Ficha de reconocimiento: Módulo Diccionario

## Versión conceptual

Documento de reconocimiento y comprensión previa para discutir la incorporación del módulo **Diccionario** dentro de **Biblioteca**, actualmente basada en una versión profundamente modificada de Readest.

Esta ficha no define todavía una implementación cerrada. Su propósito es orientar al equipo de desarrollo en la comprensión del concepto, el análisis del código existente y la identificación de decisiones técnicas necesarias antes de convertir la idea en una ficha de implementación.

---

# 1. Propósito de esta ficha

Esta ficha tiene como objetivo que el equipo comprenda correctamente qué se espera del módulo **Diccionario** dentro de Biblioteca.

El documento debe servir para:

- Alinear al equipo sobre la idea funcional.
- Diferenciar Diccionario de un lector, una colección o una nota.
- Identificar qué partes de Readest pueden aprovecharse.
- Identificar qué partes de Readest deben evitarse, sustituirse o eliminarse.
- Preparar una discusión técnica sobre arquitectura, modelo de datos, UI y flujo de usuario.
- Detectar riesgos antes de implementar.
- Abrir preguntas concretas para la siguiente fase.

Esta no es todavía una ficha de desarrollo cerrada. Es una ficha de **reconocimiento, comprensión y discusión técnica**.

---

# 2. Contexto actual

Biblioteca parte de una base originalmente derivada de Readest, pero ya ha sido modificada de forma importante.

El objetivo actual de Biblioteca no es conservar Readest como producto, sino usar su sustancia técnica para construir una aplicación propia de lectura, memoria y extracción conceptual.

En este punto:

- Biblioteca ya tiene una base funcional derivada de Readest.
- Se ha eliminado parte del bloatware no útil para el proyecto.
- La app avanza en torno a la versión `0.12.0`.
- El lector, el mosaico de libros y la infraestructura existente son la base sobre la que se quiere construir.
- El siguiente módulo relevante será **Diccionario**.

Diccionario será el primer módulo especial de Biblioteca.

---

# 3. Idea esencial de Diccionario

Diccionario será un **libro virtual** dentro del mosaico principal de Biblioteca.

Aparecerá como el primer libro del mosaico, junto al resto de libros reales del usuario.

Visualmente, debe comportarse como un libro más:

```text
[Diccionario] [Libro 1] [Libro 2] [Libro 3] ...
```

Tendrá:

- portada;
- título;
- información propia;
- presencia permanente en la biblioteca;
- posición preferente como primer elemento;
- comportamiento de entrada al hacer click o doble click.

Pero funcionalmente no será un libro normal.

Al entrar en Diccionario no se abrirá el lector estándar de EPUB/PDF. Se abrirá una interfaz propia: **DictionaryView** o equivalente.

---

# 4. Naturaleza de Diccionario

Diccionario no debe entenderse como:

- un EPUB;
- un PDF;
- un libro importado;
- una colección normal;
- una carpeta;
- una nota aislada;
- una función externa.

Debe entenderse como:

```text
Entidad virtual permanente del sistema
  → representada visualmente como libro
  → alimentada por acciones de lectura
  → abierta mediante una vista propia
  → dedicada a almacenar y presentar palabras extraídas
```

En otras palabras:

> Diccionario es un libro especial que no se lee: se consulta.

---

# 5. Flujo de usuario esperado

El flujo base es el siguiente:

```text
1. El usuario abre un libro normal.
2. El usuario selecciona o subraya una palabra o fragmento.
3. Aparece el menú contextual de acciones del lector.
4. Entre los iconos aparece un nuevo icono propio de Diccionario.
5. El usuario pulsa el icono de Diccionario.
6. Biblioteca captura la selección.
7. La selección se transforma en una entrada o aparición lexicográfica.
8. Esa información se guarda en el sistema.
9. Al entrar en Diccionario, la palabra aparece allí.
```

La acción nuclear del módulo es:

```text
selección de texto + acción Diccionario = material para Diccionario
```

---

# 6. Diferencia con un diccionario tradicional

Este módulo no debe entenderse inicialmente como un diccionario cerrado que define palabras de forma automática.

Tampoco debe depender, en esta primera conceptualización, de un servicio externo o de un LLM.

El Diccionario de Biblioteca nace de la lectura.

Primero recoge palabras, fragmentos o expresiones.

Después, en fases posteriores, podrá enriquecerlas con:

- definición;
- uso;
- curiosidad;
- imagen;
- etimología;
- comentarios;
- fuente;
- relaciones;
- generación asistida por LLM.

Pero la primera intuición es más simple:

> El usuario encuentra algo que quiere recordar. Lo manda a Diccionario. Diccionario lo guarda y lo muestra.

---

# 7. Primer libro del mosaico

Diccionario debe aparecer como el primer libro del mosaico principal.

Esto implica discutir técnicamente:

- si Diccionario se inyecta como elemento virtual en la lista de libros;
- si se guarda como entidad especial en la base de datos;
- si se genera automáticamente si no existe;
- si puede ocultarse o no;
- si puede borrarse o no;
- si puede moverse de posición o debe quedar fijado;
- cómo se diferencia internamente de un libro real.

La expectativa conceptual es:

```text
Diccionario siempre existe.
Diccionario siempre aparece primero.
Diccionario abre una vista especial.
```

---

# 8. Relación con Readest

La tarea del equipo no es asumir que Readest ya ofrece la solución.

La tarea es investigar qué piezas de Readest pueden ser aprovechadas.

El equipo debe estudiar especialmente:

## 8.1. Mosaico / biblioteca

Investigar:

- cómo Readest representa los libros en el mosaico;
- qué modelo de datos usa para cada libro;
- cómo ordena los libros;
- cómo renderiza portadas;
- cómo abre un libro;
- dónde se decide qué vista se abre;
- si existe una abstracción `Book`, `LibraryItem`, `Document`, `Publication` o equivalente.

Preguntas clave:

```text
¿Podemos insertar Diccionario como un item virtual?
¿Hace falta guardarlo como libro real?
¿Hay una forma limpia de distinguir libros normales de libros especiales?
¿Dónde se controla el evento de apertura de un libro?
```

---

## 8.2. Lector

Investigar:

- cómo se abre el lector;
- cómo se pasa el libro seleccionado al lector;
- cómo diferencia Readest entre EPUB, PDF u otros formatos;
- qué componentes son reutilizables;
- qué componentes deben permanecer intactos;
- si la navegación entre biblioteca y lector permite una tercera vista especial.

Preguntas clave:

```text
¿Dónde se decide que un libro se abre con ReaderView?
¿Podemos interceptar la apertura de Diccionario y redirigirla a DictionaryView?
¿Existe un router o estado global que podamos extender?
```

---

## 8.3. Sistema de selección y subrayado

Investigar:

- cómo Readest detecta selección de texto;
- cómo muestra el menú contextual;
- qué acciones aparecen tras seleccionar/subrayar;
- cómo están definidos los iconos;
- cómo se crean highlights;
- cómo se guardan anotaciones;
- si las acciones del menú son extensibles;
- si existe una acción de diccionario previa que convenga eliminar o reemplazar.

Preguntas clave:

```text
¿Dónde se define el menú de acciones del highlight?
¿Podemos añadir un icono propio?
¿La acción Diccionario debe crear también un highlight visual?
¿O solo debe capturar la selección?
¿Qué objeto de datos existe en el momento de pulsar el icono?
```

---

## 8.4. Anotaciones / highlights

Investigar:

- modelo de datos de highlights;
- almacenamiento local;
- identificadores;
- relación con libro de origen;
- localización dentro del libro;
- soporte para notas;
- soporte para colores;
- sincronización, si todavía existe;
- serialización de anotaciones;
- diferencias entre EPUB y PDF.

Preguntas clave:

```text
¿Una entrada de Diccionario debe depender de un highlight existente?
¿O debe ser una entidad independiente?
¿Se debe reutilizar el modelo Annotation?
¿Se debe crear DictionaryEntry como modelo separado?
¿Hay riesgo de acoplar Diccionario demasiado al sistema actual de highlights?
```

---

## 8.5. Persistencia

Investigar:

- dónde se guardan libros;
- dónde se guardan anotaciones;
- si Readest usa IndexedDB, SQLite, localStorage, archivos, Tauri storage, Turso/libSQL u otra solución;
- qué parte ya ha sido modificada en Biblioteca;
- si conviene extender la base existente o crear una capa propia.

Preguntas clave:

```text
¿Dónde debería vivir Diccionario?
¿En la misma base que libros y annotations?
¿En una tabla propia?
¿Como JSON local?
¿Como entidad derivada de highlights?
¿Como parte futura de Cogito Core?
```

---

# 9. Concepto de entrada de Diccionario

Una entrada de Diccionario puede entenderse de dos formas distintas.

Esta decisión debe discutirse.

---

## 9.1. Entrada como palabra única

Ejemplo:

```text
hierofante
```

El sistema trata el texto seleccionado como una palabra o expresión principal.

Ventajas:

- más limpio;
- encaja con un diccionario clásico;
- permite fusionar apariciones;
- permite ordenar alfabéticamente;
- facilita definir, comentar e ilustrar.

Desventajas:

- no todos los subrayados serán palabras únicas;
- puede perder contexto;
- requiere normalización.

---

## 9.2. Entrada como aparición

Ejemplo:

```text
Texto seleccionado: "hierofante"
Libro: El libro del nuevo sol
Contexto: "El hierofante avanzó..."
Posición: capítulo/página/locator
```

Aquí el sistema no asume todavía que existe una única palabra consolidada. Solo guarda una aparición.

Ventajas:

- captura fielmente el acto de lectura;
- evita decisiones prematuras;
- permite guardar varias apariciones de la misma palabra;
- conserva fuente y contexto.

Desventajas:

- requiere una fase posterior de consolidación;
- Diccionario puede llenarse de duplicados si no se diseña bien.

---

## 9.3. Propuesta conceptual inicial

Para una implementación robusta, se recomienda pensar en dos niveles:

```text
DictionaryEntry
  → la palabra o expresión consolidada

DictionaryOccurrence
  → cada vez que esa palabra aparece en una lectura
```

Ejemplo:

```text
DictionaryEntry: "hierofante"
  ├── definición
  ├── imagen
  ├── estado
  └── occurrences:
      ├── aparición en Libro A
      ├── aparición en Libro B
      └── aparición en Libro C
```

Esto permitiría que el usuario mande varias veces la misma palabra a Diccionario sin perder contexto ni crear caos conceptual.

---

# 10. Datos mínimos a capturar

Cuando el usuario pulse el icono de Diccionario, conviene capturar, si es posible:

```text
- texto seleccionado;
- texto normalizado;
- libro de origen;
- autor, si está disponible;
- identificador interno del libro;
- localización dentro del libro;
- formato del libro: EPUB/PDF/etc.;
- contexto anterior y posterior;
- fecha de captura;
- idioma, si existe o puede inferirse;
- estado de procesamiento;
- referencia al highlight, si se crea uno;
- usuario/perfil, si la app lo contempla en el futuro.
```

No todos estos datos tienen que mostrarse de inmediato.

Pero cuanto más contexto se pierda en la captura inicial, menos potente será Diccionario después.

---

# 11. Estado inicial de una palabra

Una palabra enviada a Diccionario no tiene por qué estar completa.

Puede nacer en estado:

```text
pendiente
```

Estados posibles a discutir:

```text
pending       → capturada, sin trabajar
reviewed      → revisada por el usuario
defined       → tiene definición
enriched      → tiene definición, curiosidad, imagen, etc.
ignored       → descartada sin borrar necesariamente
merged        → fusionada con otra entrada
```

Para la primera fase, podría bastar con:

```text
pending
completed
```

---

# 12. El icono de Diccionario

El icono debe aparecer como una acción más en el menú contextual del lector.

Pero debe diferenciarse conceptualmente de:

- highlight normal;
- nota;
- copiar;
- traducir;
- buscar;
- diccionario nativo anterior de Readest.

La acción no debe llamarse internamente igual que la función antigua de diccionario si esta se elimina.

Propuesta de naming interno:

```text
sendToDictionary
createDictionaryOccurrence
dictionaryCapture
```

La intención debe ser clara:

> No se está consultando un diccionario externo.  
> Se está enviando una selección al Diccionario personal del usuario.

---

# 13. Pregunta clave: ¿crea highlight visual?

Debe discutirse si pulsar el icono de Diccionario:

## Opción A: Solo captura

La palabra se guarda en Diccionario, pero no queda subrayada visualmente en el libro.

Ventajas:

- evita contaminar el libro con marcas visuales;
- Diccionario funciona como captura silenciosa.

Desventajas:

- el usuario puede no recordar qué envió;
- no hay marca visible de que esa palabra pertenece a Diccionario.

---

## Opción B: Captura y crea highlight especial

La palabra se guarda en Diccionario y además queda marcada en el libro.

Ventajas:

- el usuario ve que esa palabra fue enviada a Diccionario;
- se puede usar un color/icono especial;
- refuerza la relación lectura → Diccionario.

Desventajas:

- exige modificar mejor el sistema de annotations;
- puede saturar visualmente el texto;
- requiere decidir cómo se diferencia de otros highlights.

---

## Opción C: Usa annotation existente con metadata especial

Se crea un highlight normal, pero con una metadata interna:

```text
kind: dictionary
```

o

```text
tags: ["Diccionario"]
```

Ventajas:

- reutiliza el sistema de highlights;
- permite filtrar;
- mantiene un único modelo de anotación;
- encaja con evoluciones futuras.

Desventajas:

- puede acoplar Diccionario demasiado al modelo de annotation de Readest;
- si el sistema de annotations cambia, Diccionario podría romperse.

---

# 14. Pregunta clave: ¿palabra o fragmento?

Diccionario nace de palabras, pero el usuario puede seleccionar fragmentos más largos.

Deben definirse reglas:

```text
- ¿Se permite una sola palabra?
- ¿Se permiten expresiones?
- ¿Se permiten frases?
- ¿Hay límite de caracteres?
- ¿Se recorta automáticamente?
- ¿Se pregunta al usuario qué palabra extraer?
```

Ejemplos:

```text
"hierofante"                  → palabra
"distancia astronómica"        → expresión
"el hierofante levantó..."     → fragmento
```

Una decisión razonable:

- permitir palabras y expresiones;
- permitir fragmentos solo si se tratan como contexto;
- no forzar todavía una UX compleja.

---

# 15. Visualización futura del Diccionario

Todavía no está decidido el display.

Opciones a discutir:

## Opción A: Lista alfabética

```text
A
  autarca
  averno

H
  hierofante

F
  fulgurador
```

Ventajas:

- simple;
- familiar;
- fácil de buscar.

---

## Opción B: Tarjetas

```text
[Hierofante]
Fuente: Libro X
Estado: pendiente
```

Ventajas:

- visual;
- encaja con Biblioteca;
- permite estado, imagen y contexto.

---

## Opción C: Libro simulado

Diccionario se muestra como páginas de un diccionario antiguo.

Ventajas:

- muy coherente con la estética;
- experiencia especial.

Desventajas:

- más caro de implementar;
- menos eficiente para edición y búsqueda.

---

## Opción D: Panel de gestión

Vista práctica para revisar palabras pendientes.

Ventajas:

- útil para trabajar;
- clara para MVP.

Desventajas:

- menos poética.

---

# 16. Recomendación para primera discusión

Antes de diseñar la UI final, se recomienda definir:

```text
1. Cómo se captura una palabra.
2. Qué datos se guardan.
3. Cómo se evita perder contexto.
4. Cómo se gestiona duplicados.
5. Cómo se abre Diccionario como libro virtual.
6. Cómo se separa Diccionario del lector normal.
```

La visualización puede madurar después.

Primero debe quedar bien resuelta la ontología del módulo.

---

# 17. Posible modelo conceptual

Modelo inicial sugerido para discusión:

```text
VirtualBook
  id
  type: "dictionary"
  title: "Diccionario"
  cover
  description
  position: 0

DictionaryEntry
  id
  lemma
  normalizedLemma
  status
  createdAt
  updatedAt

DictionaryOccurrence
  id
  entryId
  selectedText
  contextBefore
  contextAfter
  bookId
  bookTitle
  author
  locator
  sourceFormat
  annotationId
  createdAt
```

Relación:

```text
VirtualBook Diccionario
  → abre DictionaryView
  → lista DictionaryEntry
  → cada DictionaryEntry contiene DictionaryOccurrence
```

---

# 18. Preguntas de investigación para el equipo

El equipo debe investigar en el código de Biblioteca/Readest:

## Biblioteca / mosaico

```text
- ¿Dónde se obtiene la lista de libros?
- ¿Dónde se ordena?
- ¿Dónde se renderiza la portada?
- ¿Dónde se maneja el click/doble click?
- ¿Qué estructura mínima necesita un item para aparecer como libro?
```

## Apertura de libros

```text
- ¿Dónde se decide abrir ReaderView?
- ¿Existe routing interno?
- ¿Se puede redirigir según type?
- ¿Dónde vive el estado del libro activo?
```

## Menú contextual del lector

```text
- ¿Dónde se define el menú que aparece al seleccionar texto?
- ¿Dónde se definen los iconos?
- ¿Cómo se añade o elimina una acción?
- ¿Qué información recibe cada acción?
```

## Highlights

```text
- ¿Cómo se crea un highlight?
- ¿Cómo se guarda?
- ¿Se puede añadir metadata?
- ¿Cómo se localiza dentro de EPUB/PDF?
- ¿Cómo se recupera al volver a abrir el libro?
```

## Persistencia

```text
- ¿Qué almacenamiento usa la versión actual?
- ¿Qué se ha mantenido de Readest?
- ¿Qué se ha eliminado?
- ¿Dónde conviene guardar Diccionario?
```

---

# 19. Decisiones pendientes

Esta ficha no resuelve todavía:

```text
- estructura definitiva de tablas;
- UI final de Diccionario;
- icono definitivo;
- color o marca visual;
- gestión final de duplicados;
- integración con LLM;
- generación automática de definiciones;
- imágenes;
- etimologías;
- import/export;
- relación futura con Cogito Aeternam;
- relación futura con SiYuan o módulos de escritura.
```

Estas decisiones pertenecen a una ficha técnica posterior.

---

# 20. Criterio de éxito de esta fase

Esta fase será exitosa si el equipo puede responder con claridad:

```text
1. Qué es Diccionario.
2. Cómo aparece dentro de Biblioteca.
3. Cómo se alimenta desde el lector.
4. Qué piezas de Readest/Biblioteca hay que investigar.
5. Qué decisiones técnicas quedan abiertas.
6. Qué riesgos existen.
7. Qué debe implementarse primero.
```

No se espera que el equipo salga de esta ficha con una implementación cerrada.

Se espera que salga con un mapa mental común.

---

# 21. Resumen ejecutivo

Diccionario será el primer libro virtual de Biblioteca.

Aparecerá como primer elemento del mosaico y tendrá portada propia.

Al abrirlo, no se abrirá el lector normal, sino una vista especial de Diccionario.

El usuario alimentará Diccionario desde la lectura: seleccionará una palabra o fragmento y pulsará un icono específico de Diccionario en el menú contextual del lector.

Esa acción deberá guardar la selección, su fuente y su contexto.

La implementación concreta aún debe discutirse.

El equipo debe investigar el código heredado de Readest para decidir qué aprovechar:

- mosaico;
- apertura de libros;
- menú contextual;
- highlights;
- annotations;
- persistencia.

La idea central es:

```text
Biblioteca permite leer.
Diccionario permite conservar lo encontrado al leer.
```
