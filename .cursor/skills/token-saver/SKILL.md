---
name: token-saver
description: Ahorra tokens filtrando salidas largas con ctx sift, consultando el grafo AST con ctx graph, buscando historial con ctx search y aplicando disciplina de código quirúrgico. Úsalo siempre antes de leer archivos grandes o ejecutar comandos largos.
---

# Reglas de Ahorro de Tokens y Disciplina de Código

1. **Recorte de terminal (ctx sift):** Siempre que ejecutes comandos con salida extensa (git diff, git log, suites de tests, builds o logs), envuélvelos con ctx sift -- <comando> para filtrar ruido.
2. **Exploración por grafo (ctx graph):** Antes de leer archivos completos para rastrear dependencias o llamadas a funciones, consulta el grafo con ctx graph search <símbolo> o ctx graph impact <id>. Si el proyecto aún no tiene .graf/index.db, indexa primero con ctx graph index . y actualiza tras editar con ctx graph update.
3. **Memoria de sesiones (ctx search / ctx blame):** Antes de repetir investigaciones o preguntar decisiones previas, busca en el historial local con ctx search "<término>" o ctx blame file <ruta>.
4. **Disciplina de código (Karpathy + Ponytail):**
   - Declara suposiciones y aclara ambigüedades antes de escribir código.
   - Reutiliza funciones nativas o de la librería estándar antes de crear código nuevo.
   - Haz únicamente cambios quirúrgicos en las líneas estrictamente necesarias sin refactorizar código adyacente sano.
