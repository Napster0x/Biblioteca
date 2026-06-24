
**IMPORTANTE: SI HAY ALGUNA ACCION QUE NO SE PUEDA REALIZAR CON EL HARNESS ACTUAL SE NOTIFICA AL USUARIO.**

1. Arrancar entorno real: dev:server + dev:tauri + dev:android
2. Conectar desktop y Android por USB
3. Verificar que ambos dispositivos se ven correctamente

En cada caso debe aplicarse el CICLO HARNESS.


# CICLO HARNESS

1. Limpiar ambos lados hasta estado vacío
2. Crear datos realistas como lo haría un usuario
3. Ejecutar una o varias sincronizaciones
4. Capturar estados antes/después
5. Comparar resultados contra expectativas CRDT+HLC
6. Reportar evidencia, diagnóstico y conclusión
7. Limpiar todo para dejar listo el entorno siguiente

Si las conclusiones no son exitosas para el caso, es decir, no pasa como debería. Se inicia un pequeño ciclo SDD con parámetros: automático, híbrido, autochain stacked to main. Donde se aplicara el fix del caso usando TODAS las conclusiones sacadas del ciclo harness, donde los testeos serán usando las herramientas del harness. Y al final se volverá a realizar el ciclo harness para el caso y ver si las conclusiones son exitosas.

# Casos a estudiar.

Los casos a estudiar se encuentra en la ficha casos_sync.md en la raiz del proyecto.

Cualquier duda debe consultar este archivo o el ideal_harness.md en la raiz del proyecto.