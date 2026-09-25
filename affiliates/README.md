# Plataforma Afiliados

Aplicación integrada con SuperApp Engine: NestJS, PostgreSQL, Prisma, catálogo de aplicaciones, esquemas y registros dinámicos, auditoría y aislamiento por entidad. La instalación local ya migró sus datos desde SQLite. Consulta **INTEGRACION.md** para operación, respaldo y despliegue. SQLite se conserva únicamente como respaldo histórico y para la demostración/pruebas antiguas.

## Inicio y validación

Desde `superapp-engine`, ejecutar `npm run affiliates` y abrir http://localhost:4180. El inicio levanta la instancia PostgreSQL local y el módulo NestJS. Requiere las dependencias del proyecto y PostgreSQL 17. No ejecutar `node server.cjs` para trabajar con los datos actuales: ese comando corresponde a la versión SQLite anterior.

1. Crear la entidad y la cuenta raíz en la primera pantalla. No hay contraseña predeterminada en la base real.
2. Registrar dos afiliados debajo de la raíz y otro debajo del primero.
3. Abrir **Formulario de registro**, agregar campos y guardar. Los campos se aplican a nuevos registros y ediciones.
4. Abrir la ficha de un afiliado, editar y cargar una foto. Se convierte a JPG de hasta 600 píxeles antes de enviarla.
5. Cerrar sesión y entrar como el primer afiliado: solo debe ver su cuenta y sus descendientes. No debe aparecer la otra rama ni el editor del formulario.
6. Reiniciar el servidor y comprobar que los registros y las fotos siguen disponibles.

`npm run affiliates:demo` inicia otra base, solo en memoria, en http://127.0.0.1:4181. Todos sus registros son ficticios. Raíz: `raiz@example.test`; afiliada: `camila@example.test`; contraseña de demostración para ambas: `DemoAfiliados2026!`. Esta demostración se reinicia al detenerla y no escribe en la base real. Usar exactamente las direcciones indicadas para mantener separadas las cookies.

## Funcionalidades

- Árbol, directorio, búsqueda, fichas y exportación CSV de la rama visible.
- Raíz con acceso a toda la organización; afiliados con acceso a sí mismos y a sus descendientes. Las restricciones también se comprueban en el servidor para guardar datos y consultar fotos.
- Cada superior puede registrar y editar cuentas en su rama, cambiar contraseñas y desactivar cuentas. La desactivación afecta a esa cuenta, no a sus descendientes. No se puede desactivar la propia cuenta.
- Formulario global administrado por la raíz: texto, texto largo, correo, teléfono, número, fecha, lista y casilla; campos obligatorios opcionales. Nombre y correo son obligatorios para todas las cuentas.
- Los campos eliminados del formulario se ocultan, pero sus valores se conservan en la base. Cambiar el tipo de un campo puede requerir actualizar registros existentes. Los campos obligatorios nuevos se exigen en la siguiente edición.
- Fotos privadas guardadas en la base, contraseñas protegidas con scrypt, sesiones de 24 horas, protección CSRF y limitación de intentos de acceso.
- Sin cuota comercial de usuarios. La capacidad real depende del equipo; esta versión carga la rama completa y no ha sido sometida a pruebas de carga masiva.

## Datos y operación

Los datos actuales están en PostgreSQL, base `superapp_affiliates`, puerto local 54329. La instancia se guarda en `.tooling/pg-affiliates` desde la raíz del proyecto. El archivo `data/affiliates-before-superapp-consistent.sqlite` es el respaldo previo a la migración, no la base vigente. Ejecutar `node scripts/backup-affiliates-core.cjs` desde la raíz para respaldar los datos actuales. Los datos y credenciales locales se excluyen del repositorio, Docker y paquetes fuente.

Por defecto solo escucha en `127.0.0.1:4180`. Variables: `PORT`, `HOST`, `AFFILIATES_DB`, `SECURE_COOKIES=true` para HTTPS, y `ALLOWED_ORIGINS` con orígenes permitidos separados por comas. No hay recuperación de contraseña por correo, reubicación de ramas ni eliminación definitiva en esta versión. Se trabaja con una comunidad principal y comunidades adicionales sujetas a aprobación. Consulta INTEGRACION.md para permisos por nivel, fotos de comunidad y dashboard.

## PWA

Incluye manifest, iconos PNG de 192 y 512 píxeles y service worker. La instalación depende del navegador: menú **Instalar aplicación** en navegadores compatibles o **Añadir a pantalla de inicio** en iOS. En producción debe servirse por HTTPS. El service worker conserva únicamente la interfaz: nunca guarda respuestas de cuentas, fotos ni datos personales. Consultar y modificar la red requiere conexión con el servidor.

## Android e iOS

La misma interfaz se empaqueta con Capacitor 8. Los proyectos Android y Xcode ya están generados en `native/android` y `native/ios`. No usar `localhost` como servidor de datos de un teléfono. Primero publicar el servidor en un origen HTTPS propio.

Desde esta carpeta:

```powershell
npm install
node prepare-native.cjs https://afiliados.tu-dominio.com
npx cap add android
npx cap add ios
npx cap sync
```

Ejecutar `cap add` solo para plataformas todavía no creadas. `prepare-native.cjs` genera una copia de los recursos con el origen del servidor, sin modificar la configuración local. Configurar el servidor con `ALLOWED_ORIGINS=https://localhost,capacitor://localhost` y habilitar HTTPS. La sesión nativa usa un token temporal en memoria y pide iniciar sesión otra vez después de cerrar completamente la aplicación.

Abrir Android con `npm run native:android` y generar un Android App Bundle firmado en Android Studio. Para iOS usar macOS, Xcode y `npm run native:ios`; configurar equipo de firma y crear el archivo para App Store Connect. Cambiar el identificador `com.superapp.afiliados` por uno propio antes de publicar.

Antes del envío a las tiendas: validar dispositivos reales, configurar firma y cuentas de desarrollador, completar ficha y capturas, declarar privacidad y tratamiento de fotos/datos, e implementar la política y el mecanismo de eliminación de cuentas exigido por el canal de distribución. El proyecto preparado no equivale a una aplicación aprobada ni publicada en Google Play o App Store. No se generaron paquetes firmados en esta entrega.

Referencias: [Capacitor](https://capacitorjs.com/docs/getting-started), [instalación de PWA](https://web.dev/learn/pwa/installation).

## Pruebas

`npm run affiliates:test` desde el proyecto principal. La prueba de integración usa una base temporal y comprueba registro, aislamiento entre ramas, edición y fotos no autorizadas, configuración exclusiva de raíz, campos obligatorios, CSRF, desactivación, cierre de sesión y persistencia al reabrir la base.
