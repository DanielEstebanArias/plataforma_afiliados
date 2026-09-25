# Afiliados integrado con SuperApp

## Qué está conectado

- `App` y `Tenant`: la entidad y la aplicación están registradas en los modelos del motor.
- `DynamicSchema`: cada cambio del formulario crea un esquema central nuevo y aumenta la revisión de la aplicación. Se respeta la regla del motor que impide alterar esquemas históricos.
- `DynamicRecord`: cada alta o edición de afiliado guarda el registro correspondiente al formulario vigente en la misma transacción. Los registros de versiones anteriores permanecen como historial. Los nombres de columnas de campos adicionales se generan de forma estable para evitar colisiones; sus etiquetas y tipos de presentación se conservan en `AffiliateNetwork.fields`.
- `AffiliateNetwork`, `AffiliateMember`, `AffiliateSession`: organización jerárquica, credenciales protegidas, fotos y sesiones en PostgreSQL/Prisma.
- `AuditLog`: altas, cambios y versiones del formulario, con actor de sesión. La importación inicial tiene su propia entrada.
- Seguridad: rol PostgreSQL sin privilegios de superusuario ni evasión de RLS, contexto de entidad en cada transacción, claves compuestas para impedir padres en otra red, y validación de descendientes en el servidor.
- Portal central: `GET /api/apps` identifica el módulo. `GET /api/apps/:appId/affiliates` devuelve su resumen bajo la autorización OIDC habitual del motor. La tarjeta abre `/affiliates/:tenantId/:appId/`.
- Las cuentas de afiliado conservan su inicio de sesión propio, limitado a esta aplicación; no adquieren acceso administrativo a otras aplicaciones del tenant. Las cuentas OIDC del portal se administran por separado mediante `Membership`, como en el motor original.

La interfaz especializada del árbol usa el formulario del módulo. No se convirtió el árbol en un componente del intérprete Flutter SDUI. La preparación móvil sigue usando Capacitor con la misma interfaz web.

## Instalación actual en este PC

Abrir http://localhost:4180. `npm run affiliates` inicia PostgreSQL si hace falta y luego el perfil local NestJS de Afiliados. Este perfil utiliza los modelos y el aislamiento del motor; no inicia sus servicios de IA, pagos, Redis o GIS. Esos servicios conservan su configuración separada.

- PostgreSQL 17: `127.0.0.1:54329`, base `superapp_affiliates`.
- Archivos del clúster: `.tooling/pg-affiliates` desde la raíz del proyecto.
- Configuración privada: `affiliates/data/superapp-local.json` (no compartir ni incluir en repositorios).
- La importación conservó 2 cuentas, 4 campos y 1 sesión activa. No hubo fotos en la base de origen.
- Respaldo previo consistente: `affiliates/data/affiliates-before-superapp-consistent.sqlite`.
- El SQLite original es histórico. No usar el servidor antiguo para modificar datos después de la migración.

Para respaldar los datos vigentes, desde `superapp-engine`:

```powershell
node scripts/backup-affiliates-core.cjs
```

Se genera un archivo PostgreSQL `.dump` en la carpeta privada `affiliates/data`. Restaurarlo con `pg_restore` sobre una base de recuperación, preservando el rol de aplicación y las políticas RLS. No copiar el directorio de PostgreSQL mientras está funcionando.

## Despliegue con el motor completo

1. Mantener la configuración del motor original (PostgreSQL con sus extensiones, Redis, OIDC, etc.).
2. Generar Prisma y aplicar las migraciones, incluidas `202609240002_affiliates`, `202609240003_communities` y `202609240004_tree_index`.
3. Aprovisionar `Tenant`, `App`, un formulario mediante `createForm`, `AffiliateNetwork` y su cuenta raíz; el script de importación muestra el procedimiento transaccional. Para mover esta instalación, restaurar su respaldo en una base compatible o adaptar la importación a la conexión de destino: no volver a importar encima de datos existentes.
4. Iniciar `src/main.ts` compilado, como antes. El módulo se monta bajo `/affiliates/:tenantId/:appId/` y se abre desde el catálogo.
5. Servir mediante HTTPS, configurar `SECURE_COOKIES=true`, orígenes de aplicaciones móviles y las identidades OIDC del portal. La migración local no configura un proveedor OIDC.

El esquema local se aprovisionó con los modelos centrales necesarios y los mismos disparadores de formularios/registros. No representa una aplicación de todas las migraciones de IA/GIS y no debe señalarse como base completa al resto del motor sin provisionar esos módulos.

Para otra instalación local: instalar dependencias, disponer de PostgreSQL 17, crear inicialmente la entidad en el modo SQLite si aún no existe, detener ese servidor, respaldarla y ejecutar `node scripts/setup-affiliates-postgres.cjs`, `node scripts/upgrade-affiliates.cjs`, `node --import tsx scripts/import-affiliates.ts` y `npm run affiliates`. La importación se niega a sobrescribir una aplicación ya migrada.

## Árbol y dispositivos

Organigrama con tarjetas por nivel, conectores, estado, conteo de directos y descendientes, ramas contraíbles, zoom, ajuste a pantalla, arrastre y vista amplia. Búsqueda y directorio siguen disponibles. Cada vista utiliza exclusivamente la rama autorizada por el servidor.

Para preparar móvil con el servidor completo:

```powershell
node prepare-native.cjs https://tu-servidor/affiliates/TENANT_UUID/APP_UUID/
npx cap sync
```

Sustituir los identificadores por UUID reales y ejecutar desde `affiliates`. Sin servidor HTTPS configurado, el paquete muestra configuración pendiente. Continúan pendientes las compilaciones firmadas y la validación en dispositivos/tiendas.

## Verificación

- `npm run affiliates:core:test`: PostgreSQL real, aplicación y esquemas centrales, historial de formulario, registros dinámicos, bloqueo entre entidades por RLS, permisos de ramas y fotos privadas. Usa un tenant de prueba aleatorio; no modifica la entidad del usuario.
- `npm run affiliates:test`: compatibilidad del adaptador SQLite para demostraciones y recuperación histórica.
- `npm run build` y `npm test`: compilación y pruebas del motor original.
- Navegador: sesión del usuario conservada, dos cuentas presentes, panel SuperApp con esquema inicial y nuevo organigrama.

## Comunidades, niveles y paneles

La cuenta raíz de la comunidad principal es el superusuario de las comunidades de su entidad (tenant). Las solicitudes crean una comunidad PENDING y una cuenta raíz con el correo y contraseña actuales del solicitante; a partir de entonces son cuentas independientes. Solo el superusuario puede aprobar, rechazar o suspender. Una suspensión revoca sesiones. Las comunidades nuevas no reciben privilegios de superusuario.

En **Acceso por nivel**, la raíz configura el máximo de inicio de sesión (raíz = 0), o acceso sin límite. Los registros por debajo del límite siguen admitidos, con sus datos y foto; pueden crearse sin contraseña. Los permisos se verifican en cada solicitud. Si posteriormente se amplía el límite, la raíz o responsable de la rama debe asignar una contraseña a las cuentas que se registraron sin ella.

**Comunidades** permite solicitar una comunidad con foto y revisar su estado. El superusuario, su raíz y el solicitante autorizado pueden cambiar su foto. Los árboles y formularios de cada comunidad permanecen separados.

**Dashboard** guarda hasta 12 gráficas por usuario. Permite agrupar por campos del formulario, estado o mes; contar registros y sumar o promediar campos numéricos, con barras, anillos o indicadores. Los filtros y agregaciones siempre se restringen a la rama autorizada. Se muestran hasta 50 categorías, avisando cuando hay más; los totales incluyen todas.

El directorio usa páginas de 50 (API máximo 100), búsqueda y cursores. El árbol carga 25 hijos por petición y limita la vista a 500 fichas, permitiendo enfocar otra rama. Los totales y gráficas se calculan en PostgreSQL. La ascendencia indexada se mantiene por disparador de base de datos; no se admite mover ramas existentes. El CSV recorre las páginas autorizadas.

Validación local: 10.055 afiliados en una entidad de prueba aislada, sin mezclar datos reales. Página de 50: 41 ms; estadísticas: 30 ms; tres gráficas: 114 ms. Son mediciones de una ejecución local, no una prueba de concurrencia ni garantía de capacidad del alojamiento. Ejecutar con `npx tsx --test tests/integration/affiliates-scale.test.ts`.

## Despliegue separado

Para Railway (backend/PostgreSQL) y Vercel (frontend), consultar `../deploy/DEPLOY-RAILWAY-VERCEL.md`. El arranque de producción está separado del local; no lee archivos privados de este PC.
