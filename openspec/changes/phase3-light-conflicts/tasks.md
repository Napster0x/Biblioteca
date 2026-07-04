# Tasks: Phase 3 Light Conflicts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–950 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 identidad/evidencia → PR2 casos 15–17 → PR3 casos 18–20 → PR4 matriz/reliability docs |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Identidad semántica y evidencia mínima | PR 1 | Base `main`; rollback: scripts de identidad/evidencia. |
| 2 | Casos 15–17 sin duplicados semánticos | PR 2 | Base PR1; fixtures, assertions y tests juntos. |
| 3 | Casos 18–20 coexistencia no destructiva | PR 3 | Base PR2; rango/grupo/overlap aislados. |
| 4 | Matriz, repetición y documentación | PR 4 | Base PR3; cierre de reporte y comandos. |

## Phase 1: Identidad y evidencia base

- [x] 1.1 Definir helpers en `apps/readest-app/scripts/assert-engine.mjs` para llaves `bookHash`, diccionario, cita, anotación y BookNote. AC: misma identidad colapsa; grupo/rango distinto no colapsa.
- [x] 1.2 Ampliar `apps/readest-app/scripts/sync-dev-state.mjs` para capturar `_replicas`/HLC, tombstones, `library.json`, `/books/index` y `Books/<hash>/config.json.booknotes`. AC: sin evidencia requerida no puede emitir `PASS`.
- [x] 1.3 Añadir tests unitarios enfocados para identidad/evidencia. Verificación placeholder: `pnpm --filter readest-app test -- <assert-engine|sync-dev-state>`.
- [x] 1.4 Documentar criterios PASS/WARN/AMBIGUOUS en comentarios cercanos al reporte. AC: `WARN`, `AMBIGUOUS`, timeout o bloqueo no cuentan como éxito.

## Phase 2: Casos 15–17 same-identity

- [ ] 2.1 Extender `apps/readest-app/scripts/dev-sync-fixture.mjs` para Case 15: mismo EPUB/hash con IDs/metadatos distintos y tombstone stale. AC: una entrada lógica por `hash`.
- [ ] 2.2 Añadir fixtures/assertions Case 16 en `dev-sync-fixture.mjs` y `assert-engine.mjs`: término+idioma normalizados, ocurrencias válidas coexistentes. AC: cero duplicados de entrada.
- [ ] 2.3 Añadir fixtures/assertions Case 17: `bookHash|cfi|text/contentHash`, `_replicas` y HLC visibles. AC: una cita lógica por rango/texto.
- [ ] 2.4 Añadir tests por caso 15–17 junto a cada helper modificado. Verificación placeholder: `pnpm --filter readest-app test -- phase3-light-conflicts`.

## Phase 3: Casos 18–20 coexistencia

- [ ] 3.1 Implementar Case 18 en fixture/assertions: edición semántica por HLC sin mover `config.json.booknotes` fijo. AC: rango/highlight idéntico post-sync.
- [ ] 3.2 Implementar Case 19: mismo rango con grupos `dictionaryEntryId`, `citeId`, `annotationId`. AC: todos coexisten; reporte prueba no colapso.
- [ ] 3.3 Implementar Case 20: rangos parcialmente solapados con repetición idempotente. AC: ambos rangos presentes y sin duplicados nuevos.
- [ ] 3.4 Añadir tests unit/harness para 18–20. Verificación placeholder: `pnpm --filter readest-app test -- range-group-overlap`.

## Phase 4: Matriz, reliability y cierre

- [ ] 4.1 Modificar `apps/readest-app/scripts/dev-sync-cycle.mjs` para ejecutar cada caso 15–20 en `desktop-first`, `android-first`, `concurrent` y `repeat`. AC: no hay casos espejo separados.
- [ ] 4.2 Añadir reporte de confiabilidad aislada `>80%` sin ejecutar real-device. Placeholder: `node apps/readest-app/scripts/dev-sync-cycle.mjs --phase3 --case 15 --repeat <N>`.
- [ ] 4.3 Actualizar documentación mínima del harness si existe junto a scripts. AC: lista comandos placeholder y evidencia requerida.
- [ ] 4.4 Marcar fuera de alcance cambios UI, rewrite amplio de sync o stores salvo fallo reproducible. AC: cualquier cambio en `src/store/*Store.ts` exige nueva tarea/spec.

## First Autonomous Slice

PR1: completar Phase 1. Es suficiente para `sdd-apply` porque no depende de fixtures 15–20, habilita aceptación estricta y deja rollback limpio.
