# Ideal Harness para Sync CRDT+HLC

Este documento define el objetivo correcto del harness de pruebas para la sincronización CRDT+HLC. El harness ideal **no es un runner monolítico de escenarios** ni un parser de Markdown. Es una **caja de herramientas CLI componible** que permite simular acciones reales de usuario sobre el entorno real de pruebas: desktop, Android y conexión USB.

---

## Resumen ejecutivo

El harness debe permitir que un agente u operador pueda preparar, ejecutar, observar y limpiar pruebas reales de sincronización entre dispositivos.

El ciclo esperado es:

```txt
1. Arrancar entorno real: dev:server + dev:tauri + dev:android
2. Conectar desktop y Android por USB
3. Verificar que ambos dispositivos se ven correctamente
4. Limpiar ambos lados hasta estado vacío
5. Crear datos realistas como lo haría un usuario
6. Ejecutar una o varias sincronizaciones
7. Capturar estados antes/después
8. Comparar resultados contra expectativas CRDT+HLC
9. Reportar evidencia, diagnóstico y conclusión
10. Limpiar todo para dejar listo el entorno siguiente
```

La idea clave es que el harness debe ofrecer **herramientas individuales y seguras**, no un único flujo rígido. Esas herramientas se combinan por CLI para construir pruebas simples, complejas o encadenadas.

---

## Principio central

> El harness ideal debe parecerse a un usuario real actuando sobre dos dispositivos reales, pero con control, repetibilidad y evidencia inspeccionable.

Eso significa que no basta con comprobar que un endpoint responde `200`. El harness debe poder:

- Meter libros reales.
- Crear datos reales derivados de esos libros.
- Crear highlights especiales de Diccionario, Citas y Anotaciones.
- Modificar datos en desktop, Android o ambos.
- Ejecutar sincronizaciones a voluntad.
- Observar convergencia, divergencia, tombstones, HLCs y duplicados.
- Limpiar completamente el entorno entre pruebas.

---

## Entorno real esperado

El harness opera sobre este entorno:

```txt
dev:server  +  dev:tauri  +  dev:android
        ↓              ↓
   Desktop app     Android app
        └────── USB / ADB / local sync ──────┘
```

Antes de ejecutar pruebas significativas, deben estar disponibles:

| Elemento | Expectativa |
|---|---|
| `dev:server` | Servidor web/dev activo. |
| `dev:tauri` | App desktop activa contra entorno dev. |
| `dev:android` | App Android activa contra entorno dev. |
| USB/ADB | Android visible por ADB. |
| Port forwarding | Túnel activo para que desktop y Android se comuniquen. |
| Discovery/toggle | Ambos dispositivos deben poder verse como peers. |
| Health checks | Endpoints desktop/Android deben responder con metadatos suficientes. |

La validación de conectividad no es accesoria. Si los dispositivos no se ven, el harness puede capturar datos locales, pero no puede validar sincronización real con confianza.

---

## Qué NO es el harness

El harness ideal **no** debe ser:

- Un parser de Markdown.
- Un sistema que lee un TODO y ejecuta todo automáticamente.
- Un único comando gigante que oculta los pasos.
- Un sustituto de entender el dominio CRDT+HLC.
- Una prueba superficial de endpoints.

Ese enfoque sería frágil. Sería como construir una casa solo con una máquina que promete hacerlo todo: cómodo al principio, imposible de diagnosticar cuando algo falla.

---

## Qué SÍ es el harness

El harness ideal es una caja de herramientas con comandos pequeños, combinables y seguros.

| Herramienta | Responsabilidad |
|---|---|
| `doctor` | Verifica que entorno, dispositivos, endpoints, ADB y túneles están listos. |
| `state` | Captura estado desktop/Android sin mutar datos. |
| `reset` / `clean` | Limpia el entorno con guards estrictos. |
| `prepare` | Mete libros reales en uno o ambos dispositivos. |
| `action` / `inject` | Crea o modifica datos realistas de usuario. |
| `trigger` | Dispara una sincronización concreta. |
| `cycle` | Compone varios pasos: preparar, sincronizar, capturar, comparar. |
| `assert` | Compara estados y valida expectativas. |
| `report` | Guarda evidencia, diagnóstico y veredicto. |

Estas herramientas permiten construir pruebas a medida sin acoplar el diseño a un único escenario.

---

## Ciclo operativo ideal

Una prueba representativa debería seguir esta forma:

```txt
clean
doctor
state --label before

prepare book --target desktop --file libro.epub
action dictionary-highlight --target desktop --book <book-id> --text "palabra"

trigger sync
state --label after-sync-1
assert convergence

action quote-highlight --target android --book <book-id> --range <range>
trigger sync
state --label after-sync-2
assert convergence

report
clean
```

La prueba puede tener una sola sincronización o muchas sincronizaciones encadenadas. Lo importante es que cada paso deje evidencia.

---

## Acciones realistas que debe poder simular

### 1. Libros reales

El harness debe poder:

- Importar un EPUB real en desktop.
- Importar o preparar un libro equivalente en Android.
- Verificar `library.json`.
- Verificar assets copiados.
- Verificar hash, metadata y rutas.
- Borrar libros.
- Diferenciar entre libro borrado y datos derivados conservados.

Ejemplo conceptual:

```txt
A: ∅
B: ∅

desktop importa L
sync

esperado:
A: L
B: L
```

---

### 2. Highlight de Diccionario

Desde un libro real, el harness debe poder crear una acción equivalente a:

```txt
Usuario selecciona texto en un libro
→ crea entrada de Diccionario
→ se genera highlight asociado
→ se conserva contexto/frase/origen
```

Modelo conceptual:

```txt
L + H_D -> D + F_D + IMG_D/opcional
```

Donde:

- `L` = libro.
- `H_D` = highlight asociado a Diccionario.
- `D` = entrada de Diccionario.
- `F_D` = frase/contexto donde aparece la palabra.
- `IMG_D` = imagen/enrichment si aplica.

Debe poder hacerse en desktop, Android o ambos antes de sincronizar.

---

### 3. Highlight de Cita

El harness debe poder simular:

```txt
Usuario selecciona texto en un libro
→ guarda una cita
→ se genera highlight de cita
→ se conserva texto seleccionado y origen
```

Modelo conceptual:

```txt
L + H_C -> C + T_C
```

Donde:

- `H_C` = highlight asociado a Citas.
- `C` = cita.
- `T_C` = texto citado/seleccionado.

---

### 4. Highlight de Anotación

El harness debe poder simular:

```txt
Usuario selecciona texto
→ crea una anotación
→ se genera highlight de anotación
→ se conserva texto base y comentario
```

Modelo conceptual:

```txt
L + H_N -> N + T_N
```

Donde:

- `H_N` = highlight asociado a Anotaciones.
- `N` = anotación.
- `T_N` = texto base sobre el que se anotó.

---

### 5. Modificaciones concurrentes

El harness debe poder crear conflictos representativos:

```txt
Desktop edita una cita
Android edita la misma cita
sync
verificar política CRDT/HLC
```

O también:

```txt
Desktop borra libro
Android crea highlight de Diccionario en ese libro antes de recibir el delete
sync
verificar que el libro se borra, pero el dato recogido sobrevive
```

---

## Sincronizaciones encadenadas

Una prueba realista no siempre es:

```txt
pre → sync → post
```

Muchas pruebas deben ser cadenas:

```txt
Estado vacío
→ Desktop crea libro + palabra de Diccionario
→ sync
→ Android añade cita al mismo libro
→ sync
→ Desktop borra libro
→ Android añade anotación antes de recibir el delete
→ sync
→ Verificar convergencia final
→ Reportar
→ Limpiar
```

Este tipo de pruebas son esenciales porque CRDT+HLC no se valida solo con estados simples. Se valida observando causalidad, orden, tombstones, conflictos y repetición de eventos.

---

## Evidencia mínima por prueba

Cada prueba debe producir evidencia suficiente para diagnosticar el resultado sin tener que repetirla a ciegas.

Como mínimo:

- Estado inicial desktop.
- Estado inicial Android.
- Operaciones ejecutadas.
- Orden de sincronización.
- Estado final desktop.
- Estado final Android.
- HLCs relevantes.
- Tombstones relevantes.
- Cambios en `library.json`.
- Cambios en SQLite.
- Cambios en replica payloads.
- Divergencias detectadas.
- Veredicto: `PASS`, `FAIL`, `WARN` o `AMBIGUOUS`.
- Diagnóstico.
- Cleanup ejecutado.

---

## Cómo debe ser un buen reporte

Un reporte útil no dice solamente:

```txt
Falló la prueba
```

Debe decir algo como:

```txt
Falló porque Android recibió el libro, pero no recibió dictionary_occurrences.

Observaciones:
- library.json converge correctamente.
- dictionary_entries converge correctamente.
- dictionary_occurrences falta en Android.
- El HLC mayor pertenece a desktop.
- No hay tombstone que justifique la pérdida.

Diagnóstico probable:
- El bug está en serialización, transporte o merge de dictionary_occurrences.

Veredicto:
FAIL
```

Ese nivel de reporte permite tomar decisiones técnicas, no solo repetir comandos.

---

## Invariantes que el harness debe ayudar a validar

El harness debe facilitar pruebas para validar estos principios:

- Ambos dispositivos convergen al mismo estado lógico.
- Sincronizar dos veces no produce cambios nuevos.
- El orden de llegada de eventos no cambia el resultado final.
- No aparecen duplicados lógicos.
- No se pierden datos recogidos por el usuario.
- No se pierde una edición más nueva frente a una más vieja.
- Los tombstones se respetan.
- Un update viejo no resucita incorrectamente un estado eliminado.
- Cada highlight mantiene su grupo semántico correcto.
- Borrar un libro no borra Diccionario, Citas ni Anotaciones recogidas desde él.
- Los datos pueden sobrevivir aunque el libro ya no exista localmente.
- Las referencias rotas quedan marcadas como `detached`, `unresolved`, `sourceUnavailable` o equivalente.
- Los conflictos quedan registrados de forma inspeccionable.

---

## Casos mínimos que debe poder construir

El harness debe permitir construir, como mínimo, estas familias de pruebas:

| Familia | Ejemplo |
|---|---|
| Empty sync | `∅ | ∅ → ∅` |
| One-way book create | `L | ∅ → L en ambos` |
| One-way dictionary highlight | `L + H_D -> D | ∅ → todo en ambos` |
| One-way quote highlight | `L + H_C -> C | ∅ → todo en ambos` |
| One-way annotation highlight | `L + H_N -> N | ∅ → todo en ambos` |
| Todos los grupos | `L + H_D + H_C + H_N → converge` |
| Datos sin libro | `D/C/N sin L → se conservan` |
| Delete libro | `delete L | L + datos → L borrado, datos conservados` |
| Edición concurrente | `A edita campo, B edita campo → política HLC/CRDT` |
| Duplicados | mismo libro/palabra/cita recibido dos veces → sin duplicado lógico |
| Orden fuera de secuencia | datos antes que libro, tombstone antes que update, etc. |
| Sync interrumpida | retry completa el estado final |

---

## Discovery/toggle entre dispositivos

Una parte crítica del harness es validar que los dispositivos se ven.

El doctor o una herramienta equivalente debe poder responder:

```txt
- ¿ADB ve el dispositivo Android?
- ¿Está activo el port forward?
- ¿Android /health responde?
- ¿Desktop /api/dev-sync/health responde?
- ¿Desktop puede disparar sync?
- ¿Android expone manifest/replicas?
- ¿El toggle/discovery detecta el peer?
- ¿El estado de UI coincide con el estado real de conectividad?
```

Si el toggle dice que hay conexión pero los endpoints fallan, el harness debe reportarlo como inconsistencia.

Si los endpoints están vivos pero el toggle no permite sincronizar, el harness debe aislar ese problema.

---

## Seguridad y limpieza

El harness debe ser potente, pero no peligroso.

Reglas obligatorias:

- Toda operación destructiva requiere guard explícito.
- El entorno debe estar marcado como dev/test.
- Nunca limpiar rutas ambiguas como `/`, `$HOME` o directorios sin marker.
- Reset debe ser dry-run por defecto.
- La limpieza debe declarar exactamente qué borra y qué conserva.
- Después de limpiar, debe verificarse que el estado queda realmente limpio.

El ciclo correcto es:

```txt
clean --dry-run
clean --confirm DELETE_DEV_SYNC_STATE --no-dry-run
state
assert clean
```

---

## Diferencia entre el estado actual y el ideal

El estado actual del proyecto ya tiene una buena base:

- Doctor no destructivo.
- Reset/clean con guards.
- Captura de estado desktop/Android.
- Captura SQLite parcial.
- Trigger de sync.
- Cycle con retry y reportes JSON.
- Smoke cases descriptivos.
- Tests extensos del propio harness.

Pero el ideal requiere añadir o fortalecer la capa de acciones realistas:

| Capacidad | Estado ideal |
|---|---|
| Importar libros reales | Debe estar disponible por CLI. |
| Crear highlights Diccionario | Debe estar disponible por CLI en desktop/Android. |
| Crear highlights Citas | Debe estar disponible por CLI en desktop/Android. |
| Crear highlights Anotaciones | Debe estar disponible por CLI en desktop/Android. |
| Editar datos existentes | Debe poder hacerse por CLI. |
| Borrar libros/datos/highlights | Debe poder hacerse por CLI. |
| Ejecutar chains de sync | Debe soportarse como composición de pasos. |
| Reporte semántico | Debe explicar divergencias, no solo counts. |
| Toggle/discovery robusto | Debe verificarse y diagnosticarse. |

---

## Definición de éxito

El harness será suficientemente bueno cuando permita ejecutar una prueba como esta sin tocar manualmente la UI:

```txt
1. Limpiar desktop y Android.
2. Importar un EPUB real en desktop.
3. Crear una palabra de Diccionario desde un rango del libro.
4. Crear una cita desde otro rango.
5. Crear una anotación desde otro rango.
6. Sincronizar.
7. Verificar que Android tiene libro, highlights y datos derivados.
8. En Android, editar la cita y añadir otra anotación.
9. Sincronizar.
10. Verificar convergencia en desktop.
11. En desktop, borrar el libro.
12. Sincronizar.
13. Verificar que el libro queda borrado en ambos, pero Diccionario, Citas y Anotaciones sobreviven.
14. Generar reporte con HLCs, tombstones, divergencias y veredicto.
15. Limpiar ambos lados.
```

Si podemos hacer eso de forma repetible, observable y segura, entonces tenemos un harness útil para depurar CRDT+HLC de verdad.

---

## Principio crítico: fidelidad del code path

> **El harness debe ejecutar el MISMO code path que la UI real.**

Esto significa que cualquier lógica de filtrado, deduplicación, merge o gestión de `_replicas` que existe en el harness debe existir también en `runSyncCycle()` de la UI — o, idealmente, ambas deben usar el mismo módulo compartido.

Si el harness implementa una optimización o protección que la UI real no tiene (como `filterUnchangedReplicas()` con `semantic_key`), los tests del harness pueden dar **falsos positivos**: pasan en el entorno de pruebas pero no reflejan el comportamiento real de la app.

### Reglas de fidelidad

1. **No puede haber código de sync CRDT+HLC que solo exista en el harness.** Cualquier función de filtrado, merge, dedup o gestión de réplicas debe estar disponible para `runSyncCycle()` o debe moverse al Rust compartido (`visible_repo.rs`).
2. **La tabla `_replicas` debe mantenerse en ambos lados** (desktop y Android), no solo donde el harness la usa.
3. **El semantic dedup (`normalizeTerm()`, `computeSemanticKey()`, `filterUnchangedReplicas()`) debe existir en el pipeline de push/pull de la UI real**, no solo en el harness.
4. **Si una optimización solo es posible en el harness** (ej. leer SQLite directo vs. vía Zustand), debe documentarse explícitamente como divergencia conocida y tener un plan para cerrarla.
5. **Todo nuevo caso de prueba debe validarse** contra la UI real al menos una vez antes de darse por válido, no solo contra el harness.

### Consecuencia para el diseño

El principio de fidelidad implica que la arquitectura del harness y la UI deben converger hacia:

```txt
Capa compartida (TypeScript o Rust):
  - normalizeTerm() / computeSemanticKey()
  - filterUnchangedReplicas() / writeReplicaMetadata()
  - Per-field HLC merge
  - _replicas management

         ↙                    ↘
  Harness (Node.js)      UI (Zustand → Tauri)
  - misma lógica          - misma lógica
  - SQLite directo         - vía servicios/app
  - inyección de backend   - inyección de backend
```

Si el harness y la UI usan la misma implementación de `filterUnchangedReplicas`, `writeReplicaMetadata`, y semantic dedup, entonces un test que pasa en el harness **garantiza** que la UI real se comportará igual.

---

## Conclusión

El harness ideal no automatiza por automatizar. Su objetivo es dar control.

Debe permitir que el agente construya pruebas ricas con comandos pequeños, observe el sistema como una caja transparente y produzca conclusiones técnicas defendibles.

La fórmula final es:

```txt
entorno real
+ acciones realistas de usuario
+ sincronización controlada
+ observabilidad profunda
+ reporte semántico
+ limpieza segura
+ code path FIEL a la UI real
= harness CRDT+HLC útil
```

---

## Herramientas actuales del harness

Esta sección documenta el inventario completo de herramientas del harness disponibles actualmente en el proyecto. Se actualiza a medida que se añaden nuevas capacidades.

### CLI de entorno (`dev:*`)

Estos comandos no ejecutan casos por sí solos; preparan el entorno real sobre el que trabaja el harness.

| Comando | Script package.json | Uso dentro del harness |
|---------|---------------------|------------------------|
| `dev:server` | `dotenv -e .env.tauri -- next dev -H 0.0.0.0 -p 3000` | Servidor dev accesible para desktop/Android. |
| `dev:tauri` | `tauri dev --config src-tauri/tauri-dev.conf.json` | App desktop real contra configuración dev. |
| `dev:android` | `tauri android dev --features devtools --host 127.0.0.1` | App Android real contra configuración dev. |
| `dev:tauri:shared` | `tauri dev --config src-tauri/tauri-dev-shared.conf.json` | Variante desktop con configuración shared. |
| `dev:android:shared` | `tauri android dev --features devtools --host 127.0.0.1` | Variante Android shared; hoy equivale al comando Android dev. |

### CLI entry points (comandos `dev:sync:*`)

Estos comandos son la interfaz estable del harness. Deben ejecutarse desde
`apps/readest-app/` con `BIBLIOTECA_DEV_SYNC_HARNESS=1` cuando mutan estado.

| # | Comando | Archivo | Tests? | Responsabilidad | Targets |
|---|---------|---------|--------|------------------|---------|
| 1 | `dev:sync:doctor` | `scripts/dev-sync-doctor.mjs` | ✅ | Preflight de entorno, ADB, Android HTTP, desktop health y Phase 2 gate | desktop, android |
| 2 | `dev:sync:state` | `scripts/dev-sync-state.mjs` | ✅ | Captura estado desktop/Android y evidencia HTTP/SQLite | desktop, android |
| 3 | `dev:sync:reset` | `scripts/dev-sync-reset.mjs` | ✅ indirecto | Limpieza destructiva con guards y reinit Android post-`pm clear` | tmp, desktop-db, android-db, all |
| 4 | `dev:sync:clean` | `scripts/dev-sync-clean.mjs` | ✅ indirecto | Limpieza no destructiva/operativa por targets | desktop-db, android-db |
| 5 | `dev:sync:prepare` | `scripts/dev-sync-prepare.mjs` | ✅ | Importa EPUB en desktop usando `prepare-engine` | desktop |
| 6 | `dev:sync:fixture` | `scripts/dev-sync-fixture.mjs` | ✅ | Crea/edita/borra datos, libros, metadata y semantic deletes | desktop, android-http |
| 7 | `dev:sync:trigger` | `scripts/dev-sync-trigger.mjs` | ⚠️ | Dispara sync desde desktop | desktop |
| 8 | `dev:sync:cycle` | `scripts/dev-sync-cycle.mjs` | ✅ | Orquesta ciclo harness, casos Phase 2, repeat/reliability y reportes | desktop, android |
| 9 | `dev:sync:assert` | `scripts/dev-sync-assert.mjs` | ⚠️ | Compara snapshots/expectativas | desktop, android |
| 10 | `dev:sync:report` | `scripts/dev-sync-report.mjs` | ⚠️ | Genera reportes estructurados | N/A |
| 11 | `dev:sync:smoke` | `scripts/dev-sync-smoke.mjs` | ⚠️ | Planner/smoke descriptivo | N/A |
| 12 | `dev:sync:up` | `scripts/dev-sync-up.mjs` | ✅ | Enciende toggles, reinyecta settings y espera readiness Android/desktop | desktop, android |
| 13 | `dev:sync:plan` | `scripts/dev-sync-plan.mjs` | ⚠️ | Planificador de pasos harness | N/A |
| 14 | `dev:sync:down` | `scripts/dev-sync-down.mjs` | ⚠️ | Apaga toggle/estado dev sync local | desktop |
| 15 | `dev:sync:inject` | `scripts/sync-dev-inject.mjs` | ✅ | Inyección SQLite directa para desktop y fallback ADB | desktop, android-adb |

Nota de revisión: `scripts/sync-dev-inject.mjs` aparece también como módulo compartido porque es entry point de `dev:sync:inject` y helper usado por `dev-sync-fixture.mjs`.

### Standalone scripts

| # | Archivo | Tests? | Propósito |
|---|---------|--------|-----------|
| 16 | `scripts/sync-execute.mjs` | ✅ | Ciclo completo push/pull sync desktop↔Android, books/index merge, tombstones y metadata |
| 17 | `scripts/run-all-cases.mjs` | ⚠️ | Runner legado/automatizado para casos base; no sustituye el ciclo harness granular |
| 18 | `scripts/sync-phase2-preflight.mjs` | ✅ | Gate explícito antes de ejecutar casos Phase 2 |

### Módulos compartidos / engine

| # | Módulo | Tests? | Propósito |
|---|--------|--------|-----------|
| 19 | `scripts/sync-dev-env.mjs` | ✅ vía consumidores | Utilidades de entorno: ADB, package detection, health checks, forwards y parsing |
| 20 | `scripts/android-clean-reinit.mjs` | ✅ | Reinit Android tras `pm clear`: settings, app start, health, manifest, replicas API |
| 21 | `scripts/sync-dev-state.mjs` | ✅ | Captura desktop/Android, HTTP fallback cuando Android no tiene `sqlite3`, book facts y semantic evidence |
| 22 | `scripts/sync-dev-inject.mjs` | ✅ | Inyección SQLite directa desktop y operaciones ADB legacy |
| 23 | `scripts/sync-dev-inject-http.mjs` | ✅ | Inyección HTTP Android: replicas, libros, metadata, import/reimport, BookConfig y semantic delete |
| 24 | `scripts/sync-dev-sqlite.mjs` | ✅ | Operaciones SQLite: captura, updateRow, softDeleteRow, duplicados, stale checks |
| 25 | `scripts/sync-filter-standalone.mjs` | ✅ vía sync | Normalización de términos, dedup semántico, gestión `_replicas` |
| 26 | `scripts/assert-engine.mjs` | ⚠️ | Comparación de snapshots y estado semántico |
| 27 | `scripts/clean-engine.mjs` | ⚠️ | Verificación de estado limpio post-reset |
| 28 | `scripts/prepare-engine.mjs` | ✅ | Descriptor EPUB, import desktop, reimport same-hash tras tombstone |
| 29 | `scripts/report-engine.mjs` | ⚠️ | Constructor de informes estructurados |

### Archivos de test

| Archivo | Prueba |
|---------|--------|
| `scripts/__tests__/dev-sync-doctor.test.mjs` | Diagnósticos doctor: package/process/forward/health/preflight |
| `scripts/__tests__/phase2-preflight.test.mjs` | Gate Phase 2 y checks obligatorios |
| `scripts/__tests__/android-clean-reinit.test.mjs` | Helper Android clean+reinit, bounded waits y diagnósticos |
| `scripts/__tests__/android-clean-reinit-integration.test.mjs` | Integración reset/cycle/up con reinit/preflight |
| `scripts/__tests__/dev-sync-cycle.test.mjs` | Ciclo harness, Phase 2 actions, repeat/reliability, case isolation |
| `scripts/__tests__/sync-dev-state.test.mjs` | captureAndroidState con manifest.data |
| `scripts/__tests__/sync-execute.test.mjs` | pushBookAssets, push de assets |
| `scripts/__tests__/sync-dev-inject-http.test.mjs` | injectReplicasViaHttp, injectBookViaHttp, HTTP edit/delete helpers |
| `scripts/__tests__/dev-sync-fixture.test.mjs` | fixture CLI parsing/routing: create, edit, delete, delete-book, HLC |
| `scripts/__tests__/prepare-engine.test.mjs` | Descriptor/import/reimport EPUB y tombstone resurrection |
| `scripts/__tests__/sync-dev-inject.test.mjs` | Inyección directa SQLite/fixture helpers |
| `scripts/__tests__/sync-dev-sqlite.test.mjs` | Operaciones SQLite y checks de staleness |

### Capacidades actuales

| Operación | Desktop | Android (HTTP) | Android (ADB) |
|-----------|---------|----------------|---------------|
| Health check | ✅ /api/dev-sync/health | ✅ /health | ❌ |
| State capture | ✅ SQLite directo | ✅ /replicas/:kind, /books/index, manifest/config | ⚠️ sqlite3 run-as si existe; HTTP fallback preferido |
| Reset/clean | ✅ Borrado de DB + assets | ✅ `pm clear` + reinit + readiness | ⚠️ solo transporte |
| Importar EPUB | ✅ `dev:sync:prepare` | ✅ `fixture --target android-http --import-book <epub>` | ⚠️ no recomendado |
| Reimport same-hash tras tombstone | ✅ `prepare-engine` limpia tombstone | ✅ import HTTP con `deletedAt:null` y timestamps nuevos | ❌ |
| Crear D (diccionario) | ✅ `fixture --dict` | ✅ `fixture --target android-http --dict` | ⚠️ |
| Crear C (cita) | ✅ `fixture --quote` | ✅ `fixture --target android-http --quote` | ⚠️ |
| Crear N (anotación) | ✅ `fixture --note` | ✅ `fixture --target android-http --note` | ⚠️ |
| Crear highlight (BookNote) | ⚠️ sintético por BookConfig cuando el caso lo requiere | ⚠️ sintético por BookConfig HTTP cuando el caso lo requiere | ❌ |
| Sync trigger | ✅ POST /api/sync-trigger | ❌ (no puede iniciar sync) | ❌ |
| **Editar datos** | ✅ `fixture --edit table:id:field=value` | ✅ `fixture --target android-http --edit ...` | ❌ |
| **Editar metadata de libro** | ✅ `fixture --edit books:<hash>:title=...` | ✅ `fixture --target android-http --edit books:<hash>:title=...` | ❌ |
| **Borrar datos (soft-delete)** | ✅ `fixture --delete table:id` | ✅ `fixture --target android-http --delete ...` | ❌ |
| **Borrar libro** | ✅ `fixture --delete-book <hash>` | ✅ `fixture --target android-http --delete-book <hash>` | ❌ |
| **Borrado semántico highlight→dato** | ✅ `fixture --semantic-delete ...` | ✅ `fixture --target android-http --semantic-delete ...` | ❌ |
| Sync bidireccional | ✅ `sync-execute.mjs` con merge books/index, tombstones, metadata y replicas | | |
| Phase 2 preflight | ✅ `sync-phase2-preflight` | ✅ doctor + HTTP readiness | ❌ |
| Reliability >80% | ✅ `dev:sync:cycle --repeat ... --min-success-rate 0.8` | ✅ real-device repeat con aislamiento por caso | ❌ |

### Capacidades Phase 2 añadidas recientemente

Estas capacidades desbloquearon la Fase 2 bidireccional completa:

| Caso | Capacidad | Herramienta principal | Fiabilidad verificada |
|------|-----------|-----------------------|-----------------------|
| `9Ma` | Editar metadata de libro en Android y converger a desktop | `dev:sync:fixture --target android-http --edit books:<hash>:title=...` | ✅ 5/5 |
| `13Ma` | Import/reimport EPUB en Android, incluso mismo hash tras tombstone | `dev:sync:fixture --target android-http --import-book <epub>` | ✅ 5/5 |
| `14a/b/c` | Borrado semántico BookNote/highlight→D/C/N en desktop | `dev:sync:fixture --semantic-delete ...` | ✅ 15/15 acumulado |
| `14Ma/Mb/Mc` | Borrado semántico BookNote/highlight→D/C/N en Android | `dev:sync:fixture --target android-http --semantic-delete ...` | ✅ 15/15 acumulado |
| Todos | Medición real-device repetida con aislamiento por caso | `dev:sync:cycle --repeat 5 --min-success-rate 0.8 --case-ref ...` | ✅ 40/40, 100% |

### Reliability runner

El runner de fiabilidad evita falsos positivos mediante estas reglas:

- Cada `case-ref` se ejecuta aislado; los casos separados por coma no comparten estado final.
- Cada intento tiene timeout acotado.
- El reporte separa dominios de fallo: `environment`, `harness`, `product`, `timeout`, `unknown`.
- `WARN` no cuenta como éxito definitivo.
- El target de Fase 2 para capacidades nuevas es **>80%** de éxito real-device.

Ejemplo:

```bash
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle -- \
  --repeat 5 \
  --repeat-timeout-ms 120000 \
  --case-ref 9Ma,13Ma,14a,14b,14c,14Ma,14Mb,14Mc \
  --min-success-rate 0.8 \
  --clean-android
```

Última evidencia aceptada: `40/40`, `100%`.

```txt
/tmp/biblioteca-dev-sync/dev-sync-cycle-1783061589013-repeat.json
```
