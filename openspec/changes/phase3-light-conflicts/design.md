# Design: Phase 3 Light Conflicts

## Enfoque técnico

La decisión principal es tratar Phase 3 como **matriz semántica de conflicto + capacidades acotadas del harness**, no como rediseño de producto. El spec delta aún no existe; este diseño depende de que `sdd-spec` formalice los MUST/SHALL sobre la base de la propuesta y exploración.

Ruta de revisión: 1) identidad/merge, 2) evidencia del harness, 3) ejecución simétrica, 4) slices `auto-chain`.

## Decisiones arquitectónicas

| Tema | Decisión | Tradeoff |
|---|---|---|
| Identidad semántica | Definir llaves lógicas por entidad antes de extender dedupe. | Más diseño inicial; evita colapsar datos legítimos. |
| Producto vs harness | Reusar CRDT/HLC actual y cambiar producto solo si una prueba especificada falla. | Menos “solución inmediata”; menor riesgo de regresión. |
| Conflictos | Los conflictos ligeros deben ser inspeccionables con PASS/WARN/FAIL, no UI nueva. | No resuelve UX avanzada; mantiene Phase 3 verificable. |
| Simetría | Cada caso ejecuta desktop-first, Android-first, concurrente y repeat; no fase mirror separada. | Más matriz por caso; menos duplicación de fases. |

## Identidad y merge

| Entidad | Identidad semántica | Inmutable | Editable por HLC | Tombstone/stale |
|---|---|---|---|---|
| Book | `hash` | archivo/fuente/hash | título, autor, cover, grupo, estado, progreso, metadata | `deletedAt` gana si HLC ≥ campo vivo; reimport más nuevo puede reactivar con evidencia. |
| Dictionary entry | `normalize(term)|normalize(language)` | term normalizado | display, definition, image, curiosity, enrichment | entrada borrada no debe resucitar con update stale; ocurrencias nuevas pueden coexistir. |
| Dictionary occurrence | `entryKey|bookHash|cfi|selectedText/context` | fuente, rango, texto seleccionado | ninguno en Phase 3 | delete borra ocurrencia exacta, no la entrada ni otras ocurrencias. |
| Quote | `bookHash|cfi|text/contentHash` | texto citado, libro, rango | contexto/metadatos no textuales si existen | quote borrada no borra highlight/anotación vinculada salvo acción semántica explícita. |
| Annotation | `bookHash|cfi|text` | texto seleccionado, libro, rango | `note`, `style`, `color` | edit vs delete usa HLC; stale edit no revive tombstone. |
| BookNote/highlight | `bookHash|id|type|cfi|{dictionaryEntryId|citeId|annotationId}` | rango, tipo, vínculo semántico | estilo/color/nota visual si aplica | soft delete en `config.json` debe concordar con tombstone semántica cuando sea delete semántico. |

## Política range/group

Mismo rango con distinto grupo semántico (`dictionaryEntryId`, `citeId`, `annotationId`) **coexiste**. Rangos solapados también coexisten. Solo es duplicado destructivo el mismo grupo + misma llave lógica. La evidencia debe incluir SQL/replica y `Books/<hash>/config.json.booknotes`; sin `config.json`, el veredicto máximo es WARN/AMBIGUOUS.

## Flujo de datos

```text
fixture desktop/android ─→ replicas/book config ─→ sync-execute
        │                       │                    │
        └──── state snapshots ←─┴──── assert-engine ←┘
```

## Cambios de archivos

| Archivo | Acción | Límite |
|---|---|---|
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modificar luego en spec/archive | Casos 15–20 y matriz. |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modificar | Añadir fixtures concurrentes, llaves lógicas, rangos/grupos; mantener operaciones simples. |
| `apps/readest-app/scripts/assert-engine.mjs` | Modificar | Dedupe por identidad semántica y coexistencia range/group. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modificar | Capturar BookNotes/rango/grupo y HLC/tombstones. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modificar | Matriz desktop-first, Android-first, concurrente, repeat >80%. |
| `apps/readest-app/src/services/sync/replicaFilter.ts` + standalone | Posible | Solo si spec exige dedupe fuera de dictionary-entry. |
| `apps/readest-app/src/store/*Store.ts` | Posible | Solo ante fallo reproducible de merge producto. |

## Harness y ejecución

Reusar: `--dict/--quote/--note`, `--edit`, `--delete`, `--semantic-delete`, `--hlc`, pull/push de replicas, fallback HTTP, repeat. Añadir: fixtures de “same logical different id”, same range/different group, overlap, stale-after-delete, y snapshots BookNote generalizados.

Modelo: cada caso corre `desktop-first`, `android-first`, `concurrent` y `repeat/idempotence`; los no-éxitos se reportan como FAIL si violan semántica y WARN si falta evidencia Android no esencial.

## Verificación

| Capa | Qué probar | Cómo |
|---|---|---|
| Unit | identidad, campos editables, tombstone/stale, coexistencia | tests focused en scripts y `replicaFilter` si cambia. |
| Harness | casos 15–20 por grupos | snapshots pre/post + reportes PASS/WARN/FAIL. |
| Real device | confiabilidad | repeat aislado con éxito >80%; WARN para non-success no semántico. |

No ejecutar builds/tests en esta fase.

## Slicing y rollback

Stacked-to-main: (1) identidad exacta, (2) campos editables, (3) range/group coexistence, (4) ordering/idempotence. Cada slice debe tener tests, evidencia propia y rollback por archivo/slice. Fuera de alcance: parser Markdown, runner monolítico, UI de conflictos y builds/redeploy automáticos.

## Preguntas abiertas

- [ ] `sdd-spec` debe fijar si quote/context metadata se considera editable o solo evidencia.
- [ ] Confirmar umbral exacto de WARN vs AMBIGUOUS cuando `run-as sqlite3` no existe pero HTTP replicas sí.
