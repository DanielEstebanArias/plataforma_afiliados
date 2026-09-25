# Validación realizada — 24 de septiembre de 2026

## Actualización: integración con SuperApp

La instalación vigente usa NestJS y PostgreSQL/Prisma. Se migraron 2 cuentas, 4 campos y 1 sesión activa, con respaldo SQLite consistente. Se verificaron registros y esquemas dinámicos, versiones de formulario, auditoría, RLS y permisos de ramas en PostgreSQL real. La ruta del módulo montada en el motor también se prueba con cookies limitadas a la aplicación. Consulta `INTEGRACION.md` para operación y alcance. El árbol actual incorpora organigrama, conectores, zoom, arrastre y ramas contraíbles.

Los apartados siguientes documentan la validación previa de la primera versión SQLite.

## Resultado

La aplicación web local quedó operativa. Se generaron los proyectos nativos Capacitor Android e iOS. No se compilaron ni firmaron AAB/APK/IPA y no se publicaron en tiendas.

## Comprobado

- Prueba automatizada de integración con base temporal: creación de raíz, cuentas y descendientes; denegación de lectura de fotos y modificación de otra rama; formulario exclusivo de raíz; campos obligatorios y opciones; rechazo de mutaciones sin CSRF; desactivación y revocación de sesión; contraseñas incorrectas; cierre de sesión; reapertura de base con registros, formulario y fotos conservados.
- Compilación del motor original y sus 19 pruebas existentes: correctas.
- Navegador en vivo sobre base de demostración separada: acceso como raíz; árbol inicial de seis personas; creación del campo Ocupación desde la interfaz; registro de Valentina Ejemplo debajo de Camila; actualización a siete personas.
- Entrada como Camila: cuatro personas visibles (ella y tres descendientes), sin la rama de Andrés ni acceso al editor del formulario.
- Vista móvil de 390 píxeles: contenido principal ajustado sin desbordamiento horizontal del documento. El árbol tiene desplazamiento interno para ramas profundas.
- Los datos ficticios se mantuvieron separados de la base real. Al cierre se comprobó que la entidad real ya estaba configurada por el usuario.

## Alcance pendiente antes de producción

- Servidor HTTPS público, configuración de acceso nativo, copias de seguridad y operación supervisada.
- Compilación y pruebas en dispositivos Android/iOS reales, firma y proceso de revisión de tiendas.
- Pruebas de concurrencia y carga del alojamiento definitivo. Se validaron 10.055 afiliados; el árbol y el directorio ahora se cargan por páginas.
- Adaptar políticas de privacidad, conservación y eliminación de cuentas a la entidad y canal de distribución.

La instalación actual usa PostgreSQL/Prisma y los modelos de SuperApp. Las pruebas affiliates-core y affiliates-scale validan aislamiento, registros centrales, aprobación de comunidades, fotos, niveles y agregaciones. SQLite queda como respaldo histórico y modo de prueba independiente.
