# Términos y condiciones de la plataforma

El superusuario encuentra **Términos y condiciones** en su menú. Escribe el título y el texto, marca la confirmación y publica una nueva versión. El texto se muestra sin interpretar HTML. No se incluye un contrato predeterminado: la organización debe proporcionar su contenido.

Los términos son comunes a todas las comunidades de la entidad (tenant). Cada cuenta debe aceptar individualmente, incluso si usa el mismo correo en varias comunidades. El superusuario también acepta la versión publicada.

Antes de la primera publicación el acceso funciona como antes. Después, las cuentas nuevas y existentes ven la pantalla de aceptación. Cada actualización requiere aceptar de nuevo, incluso en sesiones ya abiertas. Pueden cerrar sesión sin aceptar; el servidor bloquea las demás operaciones del módulo Afiliados. El portal OIDC y los módulos independientes del motor mantienen su acceso propio.

Cada aceptación registra la cuenta, comunidad, versión y fecha del servidor; la auditoría registra publicación y aceptación. Las versiones publicadas no se editan ni se borran desde la aplicación. Publicaciones concurrentes o aceptación de una versión obsoleta devuelven conflicto para exigir revisión del contenido vigente.

## Actualizar una instalación existente

1. Respaldar PostgreSQL y confirmar restauración antes de aplicar cambios productivos.
2. Aplicar la migración `202609290001_affiliate_terms` **antes de arrancar el código nuevo**.
3. En el perfil Railway de Afiliados, ejecutar el preparador actualizado con las credenciales administrativas por el procedimiento privado habitual: `node deploy/railway/prepare-db.cjs`. El preparador no se ejecuta automáticamente al arrancar. Es repetible y conserva los datos existentes. No usar bootstrap en una instalación existente.
4. En el motor completo, usar su recorrido habitual `prisma migrate deploy` con la conexión de propietario.
   El perfil local de Afiliados aplica también esta migración mediante `scripts/upgrade-affiliates.cjs`, invocado por su arranque habitual.
5. Generar Prisma y compilar, o dejar que la imagen Docker lo haga. Desplegar el servicio de Afiliados con su Dockerfile y comando actuales.
6. Verificar `/healthz`, inicio de sesión y funciones actuales. El superusuario publica el contenido final cuando esté listo. Esa publicación activa la aceptación obligatoria.

La actualización añade tablas; no cambia contraseñas, afiliados, formularios ni comunidades. Si se necesita volver al código anterior, conservar las tablas y registros de términos. El código anterior no exigirá la aceptación; por tanto, ese retorno suspende el control de términos.

## Comprobación

Pruebas unitarias: `npm test`. Regresión SQLite: `npm run affiliates:test`. Configuración: `node --test tests/integration/deploy-config.test.cjs`.

La prueba `tests/integration/affiliate-terms.test.ts` requiere `TEST_ADMIN_DATABASE_URL` y `TEST_RUNTIME_DATABASE_URL` hacia una base de pruebas preparada. Crea tenants aleatorios, prueba publicación/aceptación/permisos/RLS e inmutabilidad y elimina únicamente esos tenants al finalizar. No apuntarla a producción.

Las pruebas de interfaz comprueban el bloqueo antes de cargar información y el escape del texto. No garantizan capacidad de carga ni constituyen revisión jurídica del contenido.
