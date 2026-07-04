# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

### Requirement: Phase 3 Symmetry Matrix

Los casos 15–20 MUST ejecutarse como matriz integrada, NO como fase espejo separada: desktop-first, Android-first, concurrente y repetición idempotente aislada. Un `WARN` MUST NOT contarse como éxito.

| Eje | Criterio verificable |
|-----|----------------------|
| desktop-first / Android-first | Mismo estado lógico final en ambos dispositivos. |
| concurrente | Orden de llegada no cambia el resultado. |
| repetición | Segunda sincronización no crea operaciones ni duplicados nuevos. |

#### Scenario: Matriz simétrica sin fase espejo
- GIVEN cualquier caso Phase 3 preparado en ambos dispositivos
- WHEN se ejecutan los cuatro ejes de la matriz
- THEN cada eje emite `PASS`, `FAIL`, `WARN` o `AMBIGUOUS`
- AND no existe un caso espejo separado para cubrir la dirección inversa

### Requirement: Case 15 Same Book Identity

El harness MUST tratar el mismo libro de ambos dispositivos como una identidad lógica por `hash`. Metadatos concurrentes SHALL converger por timestamp/HLC observable; tombstones más nuevos MUST vencer estados vivos stale.

#### Scenario: Mismo libro creado desde ambos dispositivos
- GIVEN desktop y Android crean/importan el mismo EPUB hash con metadatos observables
- WHEN sincronizan bajo la matriz Phase 3
- THEN ambos convergen a una sola entrada lógica de libro
- AND evidencia muestra `library.json`, `/books/index`, hash y timestamps/HLC usados

### Requirement: Cases 16 and 17 Semantic Same-Identity Dedupe

El harness MUST detectar duplicados semánticos sin borrar datos válidos. Diccionario usa término normalizado+idioma; cita usa bookHash+CFI/rango+texto/contentHash. No MUST existir identidad semántica duplicada tras convergencia.

#### Scenario: Case 16 misma palabra desde ambos dispositivos
- GIVEN ambos dispositivos crean la misma palabra con capitalización/acento equivalente e idioma igual
- WHEN sincronizan concurrentemente
- THEN existe una sola entrada lógica de diccionario
- AND ocurrencias distintas MAY coexistir si su fuente/rango difiere

#### Scenario: Case 17 misma cita y mismo rango desde ambos dispositivos
- GIVEN ambos dispositivos crean la misma cita para el mismo libro y rango
- WHEN sincronizan en cualquier orden
- THEN existe una sola identidad lógica de cita
- AND `_replicas` y HLC prueban la resolución sin duplicados semánticos

### Requirement: Cases 18–20 Non-destructive Semantic Coexistence

El harness MUST preservar rangos, grupos y datos semánticos legítimos. Editar un dato semántico SHALL NOT mover el highlight fijo. Mismo rango con grupos diferentes MUST coexistir. Rangos solapados MUST coexistir sin colapso destructivo.

#### Scenario: Case 18 dato semántico editado con highlight fijo
- GIVEN un BookNote/highlight fijo referencia un dato semántico editable
- WHEN un dispositivo edita nota/definición/campo editable y sincroniza
- THEN el dato converge por HLC aplicable
- AND BookConfig `config.json` mantiene el mismo rango/highlight

#### Scenario: Case 19 mismo rango con grupos semánticos distintos
- GIVEN diccionario, cita y/o anotación comparten el mismo rango
- WHEN sincronizan desde ambos dispositivos
- THEN todos los grupos semánticos legítimos coexisten
- AND el reporte prueba que no hubo colapso por rango compartido

#### Scenario: Case 20 rangos solapados coexisten
- GIVEN dos highlights tienen rangos parcialmente solapados pero identidades distintas
- WHEN sincronizan concurrentemente y se repite la sync
- THEN ambos rangos permanecen presentes en ambos dispositivos
- AND la repetición no crea duplicados ni elimina rangos por solapamiento

### Requirement: Phase 3 Evidence and Reliability Gate

Un `PASS` Phase 3 MUST incluir evidencia de ambos dispositivos: `_replicas`/HLC cuando aplique, `BookConfig/config.json` para BookNotes/highlights, ausencia de identidades semánticas duplicadas y ausencia de colapso destructivo de solapamientos. La suite SHALL apuntar a confiabilidad real-device `>80%` con casos aislados; `WARN`, `AMBIGUOUS`, timeout o bloqueo cuentan como no-éxito.

#### Scenario: Evidencia mínima para PASS
- GIVEN un caso 15–20 reporta convergencia
- WHEN se genera el reporte
- THEN cita rutas/evidencia desktop y Android suficientes para el dominio
- AND sin esa evidencia el veredicto MUST NOT ser `PASS`

#### Scenario: Límites de alcance
- GIVEN una implementación Phase 3 requiere UI nueva, rewrite amplio de sync o UI pesada Phase 4+
- WHEN se evalúa contra esta especificación
- THEN se marca fuera de alcance salvo requisito explícito posterior
- AND no se ejecutan builds, tests ni corridas real-device durante esta fase SPEC
