# Desplegar Afiliados en Railway y Vercel

Esta entrega prepara el módulo de Afiliados integrado con los modelos de SuperApp. No inicia los otros módulos de IA, pagos o GIS. Mantiene las fotos en PostgreSQL; no requiere discos persistentes en el backend. La instalación local sigue iniciándose con `npm run affiliates`.

## Distribución

- Railway: Node.js/NestJS, servicio permanente con una réplica, más PostgreSQL 17 con volumen persistente.
- Vercel: archivos públicos de `affiliates/web` y proxy de las rutas API hacia Railway.
- El navegador usa siempre el dominio de Vercel. Las cookies HttpOnly y la protección CSRF conservan el alcance de cada comunidad. Las respuestas API y fotos no se almacenan en caché.
- `DATABASE_URL` usa el rol `superapp_runtime`, sin superusuario ni bypass de RLS. Nunca colocar credenciales PostgreSQL en Vercel.

## 1. Preparar el repositorio

Descomprimir SuperApp-Engine.zip y subir la carpeta `superapp-engine` como raíz de un repositorio privado. No subir `affiliates/data`, `.tooling`, `.env*`, `node_modules` ni respaldos. No publicar el archivo privado `superapp-local.json`.

En ambos proveedores elegir esa misma raíz. Si se sube la carpeta contenedora, seleccionar `superapp-engine` como Root Directory. En Railway comprobar que la ruta del archivo de configuración apunta a `railway.json` dentro de esa raíz.

## 2. Crear PostgreSQL en Railway

Crear proyecto y servicio PostgreSQL 17 con almacenamiento persistente. Mantener el backend en el mismo proyecto y región. Habilitar respaldos y ensayar una restauración.

Para preparar o restaurar desde este PC, usar temporalmente la conexión pública TCP de PostgreSQL. Dentro de Railway se usará después su hostname privado. No confundir ambos hostnames.

Preparar las variables de ejemplo de `deploy/railway/environment.example` mediante el panel de Railway o un archivo local privado fuera del repositorio. Si usas el archivo, Node permite `node --env-file=RUTA_PRIVADA ...`. Nunca poner contraseñas literales en comandos compartidos.

`DATABASE_OWNER_URL` es la URL del propietario proporcionada por Railway. `RUNTIME_DB_PASSWORD` es una contraseña aleatoria nueva de al menos 24 caracteres. El preparador crea el rol limitado si no existe, pero no cambia silenciosamente la contraseña de uno existente.

En este PC se dispone de psql 17. Para los comandos de preparación:

```powershell
$env:PSQL_BIN = 'C:/Program Files/PostgreSQL/17/bin/psql.exe'
```

Elegir SOLO uno de los dos caminos siguientes.

### A. Trasladar las comunidades actuales (recomendado para esta instalación)

1. Respaldar desde la carpeta principal: `node scripts/backup-affiliates-core.cjs`. El `.dump` queda en la carpeta privada `affiliates/data`.
2. Con `DATABASE_OWNER_URL` apuntando exclusivamente a la nueva base Railway y `RUNTIME_DB_PASSWORD` configurados, ejecutar `node deploy/railway/prepare-db.cjs --roles-only`.
3. Restaurar el respaldo COMPLETO en la base Railway vacía con pg_restore 17 o superior. Usar `--no-owner --no-acl --exit-on-error --single-transaction`. No usar `--clean` ni restaurar sobre datos existentes. Por ejemplo, con PGDATABASE definido de forma privada como la URL de destino:

```powershell
$env:PGDATABASE = $env:DATABASE_OWNER_URL
& 'C:/Program Files/PostgreSQL/17/bin/pg_restore.exe' --dbname=$env:PGDATABASE --no-owner --no-acl --exit-on-error --single-transaction 'RUTA_DEL_RESPALDO.dump'
```

4. Ejecutar `node deploy/railway/prepare-db.cjs` para completar migraciones faltantes y permisos del rol limitado.
5. Conservar `tenantId` y `appId` de tu configuración local como `AFFILIATES_TENANT_ID` y `AFFILIATES_APP_ID`. Copiar solo esos identificadores al panel; no subir el archivo de configuración.
6. No ejecutar el bootstrap de instalación nueva. Usuarios, contraseñas, fotos, formularios y comunidades vienen en el respaldo. Volver a iniciar sesión en el nuevo dominio.
7. Para el traslado definitivo, detener temporalmente las nuevas altas en la instalación local, generar un respaldo final y validar conteos, formularios y fotos antes de cambiar el dominio. No operar ambas copias como si fueran una sola base.

### B. Instalación nueva, sin los datos actuales

1. Con las variables de propietario configuradas: `node deploy/railway/prepare-db.cjs`.
2. Configurar `DATABASE_URL` con la conexión pública temporal de Railway, usuario `superapp_runtime` y su contraseña. Codificar caracteres especiales de la contraseña para una URL. No usar la URL del propietario como conexión de la aplicación.
3. Generar dos UUID diferentes (`node -e "console.log(require('node:crypto').randomUUID())"`) y guardarlos en `AFFILIATES_TENANT_ID` y `AFFILIATES_APP_ID`.
4. Configurar `INITIAL_COMMUNITY_NAME`, `INITIAL_ROOT_NAME`, `INITIAL_ROOT_EMAIL`, `INITIAL_ROOT_PASSWORD` (mínimo 12 caracteres).
5. Ejecutar `npm ci`, `npx prisma generate`, `npm run build` y `npm run affiliates:bootstrap`.
6. Retirar las variables INITIAL_* al terminar. La comunidad inicial queda aprobada y su raíz es el superusuario. Las siguientes comunidades necesitan aprobación.

El preparador no usa `prisma migrate deploy`: despliega el perfil de Afiliados, que no requiere extensiones vector/PostGIS del motor completo. No mezclar estos procedimientos con una base del motor completo.

## 3. Backend en Railway

Crear servicio desde el repositorio. `railway.json` selecciona `deploy/railway/Dockerfile`, arranque y comprobación `/healthz`.

Variables permanentes:

| Variable | Valor |
|---|---|
| DATABASE_URL | URL INTERNA PostgreSQL con usuario superapp_runtime y su contraseña, base real de Railway |
| AFFILIATES_TENANT_ID | UUID de la entidad restaurada o recién creada |
| AFFILIATES_APP_ID | UUID de la comunidad principal |
| ALLOWED_ORIGINS | Origen exacto del frontend, por ejemplo https://mi-plataforma.vercel.app |
| NODE_ENV | production |
| SECURE_COOKIES | true (el arranque de producción también lo fuerza) |

Railway proporciona PORT automáticamente. El servidor escucha en 0.0.0.0. No necesita POSTGRES_BIN, rutas Windows ni superapp-local.json.

No dejar DATABASE_OWNER_URL ni RUNTIME_DB_PASSWORD ni INITIAL_ROOT_PASSWORD en las variables permanentes del backend. Solo DATABASE_URL contiene la credencial de ejecución limitada.

Generar dominio público HTTPS del backend y comprobar `/healthz`: debe responder 200 y `{"status":"ok"}`. El dominio es necesario para que Vercel pueda llegar a Railway. Mantener PostgreSQL por red privada para la aplicación y deshabilitar su exposición pública cuando ya no haga falta para administración.

Con una réplica el limitador de intentos por cuenta reside en memoria. Antes de aumentar réplicas, trasladarlo a un almacenamiento compartido. Revisar consumo de memoria, conexiones y concurrencia con datos representativos antes de dimensionar producción.

## 4. Frontend en Vercel

Importar el mismo repositorio y elegir la misma raíz. Preset: Other. `vercel.json` ya define el comando de compilación. No configurar otra carpeta de salida: se genera `.vercel/output` con la Build Output API v3.

Única variable requerida:

```
RAILWAY_BACKEND_URL=https://TU-BACKEND.up.railway.app
```

Debe ser solo el origen HTTPS, sin ruta, usuario ni contraseña. Es un destino público de API, no una credencial. No incluir DATABASE_URL ni secretos en Vercel.

El build copia únicamente `affiliates/web` y genera estas rutas:

- `/api/*` → Railway `/api/*`.
- `/affiliates/:tenantId/:appId/api/*` → la misma ruta de Railway.
- `/affiliates/:tenantId/:appId/` → interfaz de Vercel, manteniendo la URL.
- Recursos, manifest y service worker de cada comunidad → archivos públicos locales de Vercel.

Una vez conocido el dominio de Vercel, agregarlo exactamente en ALLOWED_ORIGINS de Railway y volver a desplegar el backend. Para dominio propio, actualizar también esa lista. Separar orígenes por comas; no usar comodines. Las previews deben usar un backend de pruebas o un origen autorizado explícitamente; no dar acceso automático de todas las previews a producción.

## 5. Comprobar antes de usar

- Abrir Vercel, entrar con la raíz y comprobar los datos restaurados.
- Abrir una comunidad por su URL directa y recargar; comprobar sesión y fotos.
- Registrar y editar un afiliado de prueba, revisar CSRF y que otra rama no pueda verlo.
- Comprobar solicitud, aprobación y suspensión de comunidad, acceso por nivel y dashboard.
- Instalar la PWA en un navegador compatible. Sin conexión solo se conserva la interfaz; los datos requieren el servidor.
- Android/iOS: volver a ejecutar `prepare-native.cjs` con el dominio HTTPS del frontend (y ruta de comunidad cuando corresponda), luego `cap sync`. Agregar los orígenes nativos necesarios en Railway. Probar dispositivos antes de firmar/publicar.

## Validación incluida

- Compilación TypeScript y pruebas de rutas Vercel.
- Arranque real del perfil de producción sobre una base PostgreSQL temporal aislada; preparación repetible, creación de raíz, healthcheck, login, cookies seguras, alcance de comunidad y rechazo de origen ajeno.
- No se ha desplegado ni transferido ningún dato a proveedores. Falta validar en sus servicios reales con tus cuentas y dominios.
- Docker no pudo ejecutarse en este PC porque el motor Docker no está disponible; la imagen debe compilarse en Railway o en un equipo con Docker activo.

Fuentes de configuración: https://docs.railway.com/config-as-code/reference , https://docs.railway.com/deployments/healthchecks , https://vercel.com/docs/build-output-api/configuration .
