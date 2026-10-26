# DevTools-assisted residual collection (no Chrome restart)

Supported **without** CDP / `--remote-debugging-port` / `debugger` permission:

| Dato | Cómo en Chrome DevTools | Visible desde la página host? |
|------|-------------------------|-------------------------------|
| Requests post-close | Network panel, Preserve log, watch ≥5s after Emergency close | **No** de forma completa — PerformanceObserver solo ve recursos del **documento** |
| Dedicated workers vivos | Sources → Threads (o Application) | **No** — el registry del host solo ve `window.Worker` |
| Nested Worker (hijo) | Threads: workers adicionales / árbol de workers | **No** vía wrapper; hace falta observación DevTools |
| Relación padre/hijo | UI de Threads (Chrome reciente) o CDP Target | No automatizable aquí sin CDP |

## Procedimiento mínimo (sesión actual)

1. Tras **Emergency close now**, pulsa **Start 8s page-only watch** (fieldset D) — solo suplemento de página.  
2. En paralelo: Network + Threads a pantalla completa.  
3. Rellena visibilidad `full_window` solo si miraste **toda** la ventana.  
4. Introduce conteos reales (no inventes 0).  
5. **Build residual draft JSON** — si falta visibilidad o marcas “infer from host wrapper”, el builder **REJECT**.  
6. Guarda el draft con nombre único; **no** sobrescribas el canónico `…3765641.json`.

## Futura sesión CDP (no activar ahora)

Ver `cdp-residual-observation.PLAN.md` Option A: Chrome **nuevo perfil** con `--remote-debugging-port` (no mata la sesión actual). Requiere autorización explícita antes de attach.
