# Verificación de la entrega

Fecha: 24 de septiembre de 2026. Entorno local: Windows, Node.js 22.15.1, Prisma 6.19.0 y Flutter 3.29.3 / Dart 3.7.2.

| Comprobación | Resultado |
|---|---|
| Validación y generación de Prisma | Correctas |
| Compilación estricta TypeScript del backend | Correcta |
| Pruebas de backend | 19 aprobadas, 0 fallidas |
| Analizador Flutter | Sin advertencias ni errores |
| Pruebas Flutter | 3 aprobadas, 0 fallidas |
| Sintaxis del portal JavaScript | Correcta |
| Sintaxis de scripts Bash | Correcta |
| Compilación sintáctica del configurador Python | Correcta |
| Migración SQL inicial | Generada; ejecución pendiente en PostgreSQL |
| Prueba real PostgreSQL RLS y espejo de tablas | Omitida localmente: motor Docker no disponible |
| Vista del portal en navegador | No verificada visualmente: navegador de la herramienta no disponible |
| Cobros, Responses API, FCM, MQTT y webhooks externos | Sin llamadas reales; requieren credenciales y servicios |
| Compilación `.aab` / `.ipa` y firma | No ejecutada; requiere Android SDK / macOS-Xcode y secretos de firma |

Las pruebas de backend verifican validación de metadatos, límites del árbol, formularios, formatos de hardware, separación de contexto asíncrono, referencias de secretos, autorización de topics MQTT, firmas de parámetros, idempotencia enviada a Stripe, captura PayPal simulada y rechazo de pagos con referencia/importe/moneda diferentes. Los tests de proveedor usan respuestas simuladas; no demuestran la aceptación del proveedor real.

Las pruebas Flutter verifican versión del contrato, duplicados de ID y aceptación de un árbol válido. No ejercitan sensores, permisos, pagos ni GPS en dispositivos físicos.

La tarea `database` de `.github/workflows/check.yml` levanta PostgreSQL con pgvector y PostGIS, ejecuta las migraciones y la prueba de RLS con un rol sin privilegios de bypass. Esa tarea quedó preparada, pero no se ha ejecutado en GitHub desde esta sesión.

No debe considerarse un despliegue de producción certificado. Antes de operarlo se deben ejecutar las pruebas pendientes, adaptar reglas fiscales y de negocio, configurar identidad/secretos, habilitar monitorización/backups y comprobar comportamiento móvil en cada plataforma. Las limitaciones concretas de tracking, brokers y almacenamiento se detallan en `README.md`.
