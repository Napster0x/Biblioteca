# Sync Dev Harness — Non-Hot Boundaries & Recovery

Documento de referencia para operadores y agentes que trabajan con el arnés
de desarrollo de sincronización (`dev:sync:*`).

---

## Qué es hot y qué no lo es

| Boundary | Hot? | Qué significa |
|---|---|---|
| **TypeScript/Next.js** (rutas, componentes, servicios) | ✅ Hot | Next HMR recarga sin reiniciar. Editar y seguir. |
| **Next API routes** (`src/app/api/dev-sync/`) | ✅ Hot | El servidor Next recarga automáticamente. |
| **Scripts Node** (`scripts/dev-sync-*.mjs`) | ✅ Hot | Son scripts CLI; ejecutar de nuevo basta. |
| **Tauri desktop shell** (Rust) | ⚠️ Parcial | Cambios en Rust requieren rebuild. Cambios en web usan dev server. |
| **Android Rust server** (`src-tauri/src/local_sync_server.rs`) | ❌ No-hot | Requiere rebuild + redeploy completo del APK. |
| **Android WebView JS** | ⚠️ Mixto | Hot si apunta a dev server; no-hot si va empaquetado en APK. |
| **ADB/túnel, scripts de túnel** | ✅ Hot | Editar script → ejecutar de nuevo. Sin reiniciar app. |

---

## Rebuild de Rust (template, NO ejecutar sin autorización)

Solo cuando se modifican archivos en `src-tauri/src/`:

```bash
# 1. Test unitarios Rust (rápido, sin dispositivo)
cargo test -p Biblioteca --lib -- local_sync

# 2. Verificar formato y lint
cargo fmt -p Biblioteca -- --check
cargo clippy -p Biblioteca --no-deps -- -D warnings
```

**Regla**: nunca ejecutar estos comandos automáticamente. El operador humano los autoriza.

---

## Redeploy de Android (template, NO ejecutar sin autorización)

Solo cuando el APK cambió (rebuild Rust, cambios en WebView empaquetado, o assets nativos):

```bash
# 1. Build del APK (debug)
cd apps/readest-app
pnpm tauri android build --debug --features devtools

# 2. Instalar en dispositivo vía ADB
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk

# 3. Iniciar la app
adb shell am start -n io.github.Napster0x.biblioteca/.MainActivity

# 4. Forward del puerto del servidor Android
adb forward tcp:7878 tcp:7878
```

---

## Cómo verificar después de redeploy

Después de rebuild + redeploy, ejecutar en orden:

```bash
# 1. Verificar que ADB ve el dispositivo
adb devices

# 2. Verificar que el forward está activo
adb forward --list | grep 7878

# 3. Verificar que el servidor Android responde
curl http://localhost:7878/health

# 4. Pasar el doctor completo
pnpm dev:sync:doctor --json
```

**Qué buscar en el doctor después de redeploy**:
- `android.health`: debe ser `pass` y mostrar `serverVersion` y `startedAt` si el servidor los expone.
- Si `android.health` es `pass` pero no muestra `serverVersion`/`startedAt`, el doctor reporta `warn` — el servidor funciona pero no expone metadatos de versión (no es blocker, pero dificulta verificar que el APK correcto está corriendo).
- `android.runAs`: debe ser `pass`.
- `android.readestDir`: debe ser `pass`.

---

## Flujo de recuperación típico

```
1. doctor --json          → ¿todo pass/warn? Seguir. ¿fail? Diagnosticar.
2. [cambios Rust]         → Autorizar rebuild (template arriba).
3. [redeploy Android]     → Autorizar redeploy (template arriba).
4. doctor --json          → Re-verificar.
5. dev:sync:cycle         → Ejecutar caso de sincronización.
6. Inspeccionar reporte   → /tmp/biblioteca-dev-sync/<runId>.json
```

---

## Dónde está la evidencia

- Reportes de ciclo: `/tmp/biblioteca-dev-sync/` (sobreescribible con `BIBLIOTECA_DEV_CYCLE_REPORT_DIR`).
- Snapshots de estado: salida de `dev:sync:state --json`.
- Logs del servidor Android: `adb logcat | grep -E 'local_sync|DebugSync'`.
- Logs del doctor: `dev:sync:doctor --json`.

### Evidence paths / rutas de evidencia

Para un smoke seguro, guardar la salida exacta de cada comando:

```bash
mkdir -p /tmp/biblioteca-dev-sync/smoke
pnpm dev:sync:doctor --json > /tmp/biblioteca-dev-sync/smoke/doctor.json
pnpm dev:sync:state --json > /tmp/biblioteca-dev-sync/smoke/state.json
pnpm dev:sync:clean --target all --dry-run > /tmp/biblioteca-dev-sync/smoke/clean-dry-run.json
```

Si cualquier salida contiene `WARN` o `AMBIGUOUS`, documentar el campo exacto y la ruta de evidencia antes de continuar.

---

## Manual vs CLI / responsabilidad manual

El operador humano mantiene el control de todo lo que cambia el entorno. El CLI solo automatiza diagnósticos seguros y pasos explícitos.

| Responsabilidad | Dueño | Regla |
|---|---|---|
| Conectar USB y aceptar prompts RSA de Android | Manual | El CLI puede diagnosticar, no aceptar prompts. |
| `dev:sync:doctor --json` | CLI | Seguro: no muta estado. |
| `dev:sync:state --json` | CLI | Seguro: captura evidencia. |
| `dev:sync:clean --target all --dry-run` | CLI | Seguro: declara limpieza sin borrar. |
| Builds, installs, redeploys, restarts | Manual autorizado | **NO BUILD / no install / no redeploy / no restart** sin autorización explícita. |
| Limpieza destructiva | Manual autorizado | No destructive clean sin `--no-dry-run` + token + autorización humana. |
| Trigger real de sync | Manual autorizado | No ejecutar `dev:sync:trigger` ni `dev:sync:cycle` real sin confirmación del operador. |

---

## Cleanup checklist / checklist de limpieza

- [ ] Ejecutar `pnpm dev:sync:clean --target all --dry-run` y guardar evidencia.
- [ ] Revisar `deleted`, `preserved` y `verification.residuals`.
- [ ] Confirmar que todos los paths son dev-sync scoped y tienen marcador `.biblioteca-dev-sync` cuando aplica.
- [ ] No usar `--no-dry-run` salvo autorización explícita del operador.
- [ ] Después de una limpieza autorizada, ejecutar `pnpm dev:sync:state --json` para verificar estado limpio.

---

## Scripts del arnés

| Script | Comando | Qué hace |
|---|---|---|
| Doctor | `pnpm dev:sync:doctor` | Verifica prerequisitos sin mutar datos. |
| Estado | `pnpm dev:sync:state` | Captura snapshot desktop + Android (no destructivo). |
| Ciclo | `pnpm dev:sync:cycle` | Orquesta pre-state → trigger sync → post-state → reporte. |
| Reset | `pnpm dev:sync:reset` | Limpieza destructiva (requiere `--confirm DELETE_DEV_SYNC_STATE`). |
| Smoke | `pnpm dev:sync:smoke --json` | Emite plan seguro: doctor, state y clean dry-run; no ejecuta builds, installs, restarts ni trigger real. |
