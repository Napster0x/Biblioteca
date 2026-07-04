# Road Phase 3: conflictos ligeros y convergencia concurrente

Este artefacto deja planificada la Fase 3 antes de tocar producto o harness. La fase debe definir primero la semántica esperada para conflictos ligeros y luego ejecutar variantes simétricas/concurrentes en dispositivos reales.

## Resultado esperado

La Fase 3 debe demostrar convergencia desktop↔Android cuando ambos dispositivos producen cambios compatibles o conflictivos sobre el mismo dato lógico, sin crear una “fase espejo” separada.

## Alcance

### Incluido

- Roadmap de planificación para casos 15–20.
- Prerrequisito administrativo para cerrar ruido activo de Fase 2.
- Necesidad de especificación semántica antes de implementar código.
- Matriz de ejecución con variantes de simetría y concurrencia.
- Criterios de verificación en dispositivos reales.
- Salidas documentales y de archivo esperadas.

### Fuera de alcance

- Cambios de producto.
- Cambios de harness.
- Builds, tests o reruns reales.
- Implementación de casos 15–20.

## Prerrequisito administrativo

Antes de iniciar Fase 3, se debe reconciliar y cerrar el ruido activo de `fix-phase2-sync-failures`.

| Bloqueo | Motivo | Salida esperada |
|---------|--------|-----------------|
| `fix-phase2-sync-failures` activo | Mezcla deuda de verificación de Fase 2 con el próximo trabajo de Fase 3. | Cerrar, archivar o dejar explícitamente documentado qué queda fuera de Fase 3. |
| Evidencia `WARN` de Fase 2 | Un `WARN` no puede contarse como éxito para abrir una fase de conflictos. | Separar advertencias ambientales de fallos semánticos reales. |

## Especificación semántica requerida antes de código

La Fase 3 necesita una delta spec semántica antes de cualquier implementación. El objetivo no es “hacer que pase el harness”; el objetivo es definir qué significa converger.

La spec debe responder, como mínimo:

| Pregunta | Decisión requerida |
|----------|--------------------|
| Identidad lógica | ¿Cuándo dos libros, palabras o citas representan el mismo dato lógico creado en paralelo? |
| Idempotencia concurrente | ¿Qué debe pasar si ambos dispositivos crean el mismo dato antes de sincronizar? |
| Ediciones semánticas | ¿Qué campos son semánticos y cuáles son derivados o de presentación? |
| Rangos | ¿Cómo se comparan rangos iguales, diferentes y solapados? |
| Grupos | ¿Un mismo rango en grupos distintos converge, se duplica o se mantiene separado? |
| Evidencia | ¿Qué prueba mínima convierte un caso en `PASS` y qué debe quedar como `WARN`? |

## Matriz de ejecución

No crear una fase espejo independiente. Cada caso debe ejecutarse con variantes de simetría y concurrencia dentro del mismo marco.

| Variante | Descripción | Propósito |
|----------|-------------|-----------|
| Desktop primero | Desktop crea/edita, luego Android converge. | Control base desde desktop. |
| Android primero | Android crea/edita, luego desktop converge. | Simetría real sin duplicar fase. |
| Concurrente A/B | Ambos dispositivos cambian antes de sincronizar. | Conflictos ligeros reales. |
| Repetición aislada | Cada caso se repite sin heredar estado de otros casos. | Evitar falsos `PASS` por estado residual. |

## Casos naturales 15–20

| Caso | Nombre | Intención semántica | Resultado que se debe especificar |
|------|--------|---------------------|-----------------------------------|
| 15 | Mismo libro desde ambos dispositivos | Desktop y Android incorporan el mismo libro lógico antes de sincronizar. | Un solo libro convergente, sin duplicados visibles ni resurrecciones inconsistentes. |
| 16 | Misma palabra desde ambos dispositivos | Ambos crean o actualizan la misma entrada de diccionario. | Una entrada lógica convergente con reglas claras para definición/campos editables. |
| 17 | Misma cita / mismo rango desde ambos dispositivos | Ambos crean una cita sobre el mismo rango textual. | Una cita lógica o una duplicación justificada por identidad; la spec debe fijarlo. |
| 18 | Editar dato semántico con highlight fijo | El rango/highlight permanece fijo mientras cambia el dato semántico asociado. | El highlight no debe moverse; el dato semántico debe converger según HLC/campo. |
| 19 | Mismo rango, grupos distintos | El mismo rango aparece asociado a grupos/categorías distintas. | Definir si grupos distintos son identidad separada o metadato mergeable. |
| 20 | Rangos solapados | Dos rangos no idénticos se superponen parcialmente. | Mantener coexistencia o resolver conflicto con regla explícita; nunca colapsar accidentalmente. |

## Orden de implementación sugerido

1. Cerrar o archivar `fix-phase2-sync-failures` para dejar una línea base limpia.
2. Crear delta spec de Fase 3 con criterios `PASS`/`WARN` por caso.
3. Diseñar identidad lógica y reglas de convergencia por entidad: libro, palabra, cita/anotación y rangos.
4. Implementar primero casos de identidad exacta: 15, 16, 17.
5. Implementar después edición semántica con geometría fija: 18.
6. Implementar casos de divergencia estructural: 19 y 20.
7. Ejecutar verificación real aislada por caso y variante.
8. Documentar resultados, advertencias y decisiones de archivo.

## Verificación en dispositivos reales

| Criterio | Regla |
|----------|-------|
| Repetición | Cada caso debe repetirse en ejecución acotada. |
| Umbral | Éxito real requiere `>80%` de ejecuciones definitivas `PASS`. |
| WARN | `WARN` no cuenta como éxito. Debe conservar diagnóstico y dominio de fallo. |
| Aislamiento | Cada caso debe poder ejecutarse aislado; no depender del estado dejado por otro caso. |
| Evidencia | Guardar rutas de reportes, snapshots relevantes y razón de aceptación/rechazo. |

## Salidas documentales y archivo

- Delta spec semántica de Fase 3 en `openspec/changes/<fase-3>/specs/.../spec.md`.
- `design.md` con decisiones de identidad, merge y evidencia.
- `tasks.md` con orden de implementación y forecast de revisión.
- Reporte de verificación real con tasa, intentos, `PASS`/`FAIL`/`WARN` y rutas de evidencia.
- Archivo final que sincronice lo decidido hacia `openspec/specs/` y conserve auditoría de casos 15–20.

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Confundir duplicado accidental con entidad legítima | Definir identidad lógica antes de implementar. |
| Contar advertencias ambientales como éxito | Mantener `WARN` fuera del numerador de éxito. |
| Crear una fase espejo redundante | Usar matriz de variantes dentro de cada caso. |
| Heredar estado contaminado de Fase 2 | Cerrar/reconciliar `fix-phase2-sync-failures` antes de iniciar. |
