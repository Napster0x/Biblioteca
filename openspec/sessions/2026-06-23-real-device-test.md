# Handoff — Sesión 2026-06-23: Real Device Sync Test

## Estado del proyecto

El cambio SDD `sync-crdt-hlc-ideal-harness` está **completado al 100%**:
- PR1–PR6 aplicados, verificados, archivados
- 14/14 tareas
- 147 tests en `devSyncHarness.test.ts`
- Archive final: `openspec/changes/archive/2026-06-22-sync-crdt-hlc-ideal-harness/archive-report.md`
- Engram: topic key `sdd/sync-crdt-hlc-ideal-harness/archive-report`

## Prueba real ejecutada

Se ejecutó ciclo completo con La sombra del torturador (Gene Wolfe) en desktop + Android real:

```
doctor → clean → prepare → fixture (dict+quote+note) → state before → trigger → state after → diagnóstico
```

### Resultados
- ✅ Libro sincronizado a Android (library.json)
- ❌ Highlights de Diccionario/Citas/Anotaciones NO llegaron a Android
- Causa probable: falta `dev:tauri` (backend Rust) para procesar transferencia real

### Bugs encontrados en el harness
1. **`dev-sync-fixture.mjs`**: `injectDictionary/injectQuote/injectAnnotation` ignoran return de `injectRows` — devuelven `ok:true` aunque la inyección SQL falle
2. **No crea tablas SQLite**: el fixture asume que las tablas existen, pero tras `clean` la DB está vacía
3. **Columna `selected_text`**: el fixture de anotaciones inserta columna que no existe en el schema de `annotations.db`

### Lecciones
- Doctor funciona perfectamente para diagnóstico pre-vuelo
- Clean es seguro: dry-run default, markers, paths ambiguos rechazados
- Prepare book funciona bien
- Sync trigger dispara pero necesita Tauri para procesar datos
- El harness sirve para exponer bugs reales — esa es su función principal

## Procesos activos (no matar)
- dev:server PID 1023260 → http://localhost:3000
- dev:android PID 1023900 → app en Android serial 30beb826
- ADB forward: tcp:7878 → tcp:7878

## Preparado para
- Crear casos de estudio en .md
- Arreglar bugs del fixture
- Probar sync con Tauri corriendo
- Ejecutar el ciclo de 15 pasos de ideal_harness.md completo
