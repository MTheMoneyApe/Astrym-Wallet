import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

// --- SECURITY LOCKS ---
const EXPECTED_VERSION = '0.3.0';
const TRUSTED_SHA256 = 'PENDING_HUMAN_AUDIT'; // CRITICAL: Do not invent a hash. Must be verified independently.

const SOURCE_FILE = 'node_modules/@nymproject/mix-tunnel/dist/esm/index.js';
const PKG_FILE = 'node_modules/@nymproject/mix-tunnel/package.json';
const TARGET_FILE = 'packages/extension/public/nym-worker.js';

function runPipeline() {
  console.log('[Nym Pipeline] Iniciando extracción estricta del worker...');

  if (TRUSTED_SHA256 === 'PENDING_HUMAN_AUDIT') {
    console.error('[Nym Pipeline] BLOQUEO DE SEGURIDAD: La huella criptográfica del worker aún no ha sido auditada.');
    console.error('[Nym Pipeline] Deteniendo extracción.');
    process.exit(1);
  }

  // 1. Validar exactamente la versión
  if (!fs.existsSync(PKG_FILE)) {
    console.error(`[Nym Pipeline] Error: No se encontró ${PKG_FILE}`);
    process.exit(1);
  }
  
  const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf-8'));
  if (pkg.version !== EXPECTED_VERSION) {
    console.error(`[Nym Pipeline] Error: Incompatibilidad de versión. Se esperaba ${EXPECTED_VERSION}, se encontró ${pkg.version}`);
    process.exit(1);
  }

  // 2. Comprobar existencia del archivo fuente
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`[Nym Pipeline] Error: No se encontró el archivo fuente ${SOURCE_FILE}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(SOURCE_FILE, 'utf-8');

  // 3. Exigir una única coincidencia del patrón
  // La expresión asume la firma exacta generada por Rollup en el build de Nym
  const regex = /createBase64WorkerFactory\(['"]([A-Za-z0-9+/=]+)['"](?:,\s*[^)]*)?\)/g;
  const matches = [...sourceCode.matchAll(regex)];

  if (matches.length !== 1) {
    console.error(`[Nym Pipeline] Error Estructural: Se esperaba exactamente 1 coincidencia del patrón Base64, pero se encontraron ${matches.length}.`);
    process.exit(1);
  }

  // 4. Validar el Base64 y decodificación
  const base64String = matches[0][1];
  if (base64String.length < 1000000) {
    console.error(`[Nym Pipeline] Error Estructural: El tamaño del Base64 (${base64String.length}) es sospechosamente pequeño.`);
    process.exit(1);
  }

  const decodedBuffer = Buffer.from(base64String, 'base64');
  const decodedWorker = decodedBuffer.toString('utf-8');

  // 5. Validar estructura del worker (cabecera esperada del plugin de rollup)
  if (!decodedWorker.includes('/* rollup-plugin-web-worker-loader */')) {
    console.error('[Nym Pipeline] Error de Contenido: El worker decodificado no contiene la cabecera esperada.');
    process.exit(1);
  }

  // 6 & 7. Calcular SHA-256 y comparar con huella de confianza
  const computedHash = crypto.createHash('sha256').update(decodedBuffer).digest('hex');
  if (computedHash !== TRUSTED_SHA256) {
    console.error(`[Nym Pipeline] VIOLACIÓN DE INTEGRIDAD:`);
    console.error(`[Nym Pipeline] Hash esperado: ${TRUSTED_SHA256}`);
    console.error(`[Nym Pipeline] Hash calculado: ${computedHash}`);
    process.exit(1);
  }

  // 8. Escribir el archivo final solo si todas las comprobaciones pasan
  // (Esta fase no ejecutará el script, pero lo prepara para la futura fase)
  fs.mkdirSync(path.dirname(TARGET_FILE), { recursive: true });
  fs.writeFileSync(TARGET_FILE, decodedBuffer);
  
  console.log(`[Nym Pipeline] Extracción verificada y completada. Archivo generado en ${TARGET_FILE}`);
}

runPipeline();
