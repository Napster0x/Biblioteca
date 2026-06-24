# Smoke Cases — Entorno dev sync CRDT+HLC

Casos operativos mínimos para validar el arnés dev de sincronización.
**Descriptivos únicamente. No se auto-ejecutan.**
El operador humano los traduce a comandos `dev:sync:*` y los ejecuta manualmente.

## Smoke seguro por defecto

El comando `pnpm dev:sync:smoke --json` NO dispara sincronización real. Su contrato por defecto es listar únicamente diagnósticos no mutantes:

```bash
pnpm dev:sync:doctor --json
pnpm dev:sync:state --json
pnpm dev:sync:clean --target all --dry-run
```

No builds, no installs, no redeploy, no restarts, no destructive clean, no real sync trigger sin autorización explícita del operador. Guardar evidencia en:

- `/tmp/biblioteca-dev-sync/smoke/doctor.json`
- `/tmp/biblioteca-dev-sync/smoke/state.json`
- `/tmp/biblioteca-dev-sync/smoke/clean-dry-run.json`

Si aparece `WARN` o `AMBIGUOUS`, anotar el campo exacto, el comando y la ruta de evidencia antes de ejecutar cualquier caso manual.

---

## Caso 1: Sincronización vacía (empty sync)

**Descripción**: Ambos dispositivos no tienen datos nuevos. La sincronización debe ser idempotente y no producir cambios.

**Precondiciones**:
- Desktop y Android ambos con estado limpio (`dev:sync:reset`).
- Túnel USB activo (`adb forward`).
- Servidor Android `/health` responde.
- `dev:sync:doctor --json` reporta `status: pass` o `warn`.

**Pasos**:
1. Ejecutar `dev:sync:state --json` → capturar snapshot pre (ambos lados vacíos).
2. Ejecutar `dev:sync:cycle --case-name "empty-sync"` → trigger + report.
3. Verificar que el reporte muestra `verdict: pass` y `attempts[0].ok: true`.
4. Ejecutar `dev:sync:state --json` post → snapshots iguales al pre.

**Resultado esperado**:
```
A: ∅
B: ∅
→
A: ∅
B: ∅
```
Idempotente. Sin payloads generados. Sin cambios en `library.json` ni DB.

---

## Caso 2: Agregar en desktop, sincronizar a Android (add desktop)

**Descripción**: Se agrega un libro en desktop. Al sincronizar, Android recibe el libro.

**Precondiciones**:
- Ambos dispositivos limpios.
- Libro `lorem-ipsum.epub` importado en desktop (arrastrar a la UI o copiar a `Readest/Books/`).
- `dev:sync:doctor --json` confirma conectividad.

**Pasos**:
1. `dev:sync:state --json` → snapshot pre: desktop 1 libro, Android 0.
2. `dev:sync:cycle --case-name "add-desktop"` → trigger desde desktop.
3. `dev:sync:state --json` → snapshot post: ambos lados 1 libro.
4. Verificar `library.json` en ambos lados contiene el mismo ID de libro.
5. Verificar que el archivo `.epub` fue copiado al filesystem Android vía sync.

**Resultado esperado**:
```
A: L
B: ∅
→
A: L
B: L
```
Convergencia en un ciclo. HLCs coherentes. Sin duplicados.

---

## Caso 3: Propagación de borrado (delete propagation)

**Descripción**: Un libro eliminado en desktop propaga el tombstone a Android. El libro se marca como eliminado en ambos lados, pero los datos de usuario (diccionario, citas, anotaciones) sobreviven.

**Precondiciones**:
- Ambos dispositivos tienen el mismo libro sincronizado (post-Caso 2).
- El libro tiene al menos una cita o anotación asociada (crear manualmente en UI).

**Pasos**:
1. `dev:sync:state --json` → snapshot pre: ambos 1 libro + datos de usuario.
2. Eliminar el libro en desktop (UI o eliminar entrada de `library.json`).
3. `dev:sync:cycle --case-name "delete-propagation"` → trigger.
4. `dev:sync:state --json` → snapshot post: libro eliminado en ambos.
5. Verificar que el tombstone existe (`_deleted: true` o similar) en ambos `library.json`.
6. Verificar que las citas/anotaciones del libro eliminado **siguen presentes** en `citas.db`/`annotations.db` de ambos lados.

**Resultado esperado**:
```
A: L(DEL)
B: L
→
A: L(DEL)
B: L(DEL)
```
Tombstone respetado. Datos de usuario no eliminados. Referencias marcadas como `sourceUnavailable` o `deleted`.

---

## Cómo usar estos casos

Estos casos NO se ejecutan automáticamente. El operador humano:
1. Prepara el entorno con `dev:sync:doctor`.
2. Traduce cada caso a comandos del arnés (`dev:sync:state`, `dev:sync:cycle`, `dev:sync:reset`).
3. Pasa `--case-ref` y `--case-name` para trazabilidad.
4. Inspecciona los reportes JSON en `/tmp/biblioteca-dev-sync/`.

Listar casos disponibles: `pnpm dev:sync:smoke` desde `apps/readest-app`.
