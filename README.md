# SuperApp Engine

## Plataforma Afiliados

La aplicación de afiliación está integrada con el núcleo PostgreSQL/Prisma en `src/affiliates/`, con interfaz en `affiliates/web/`. Ejecutar `npm run affiliates` y abrir http://localhost:4180 para usar la instalación ya migrada. Incluye catálogo central, registros dinámicos, versiones de formulario, auditoría, fotos, permisos por rama y un organigrama con zoom. Consulta `affiliates/INTEGRACION.md` para desplegar o preparar otra instalación. Los proyectos Capacitor para Android e iOS están en `affiliates/native/`; requieren servidor HTTPS y firma antes de distribuirse.

Demostración ficticia: `npm run affiliates:demo`, http://127.0.0.1:4181. Pruebas: `npm run affiliates:test`.

Base ejecutable de una plataforma SaaS con NestJS, PostgreSQL, Prisma, Redis, agente IA, portal web y cliente Flutter SDUI. Los seis pasos solicitados están organizados en módulos reales; los servicios externos necesitan credenciales y los binarios móviles necesitan herramientas y firma de cada plataforma.

## Estructura y orden de implementación

1. `prisma/schema.prisma`: tenants, membresías, aplicaciones, espacios IA, historial, RAG, pantallas, tablas dinámicas, flujos, pagos, auditoría, archivos y compilaciones. La migración incluye pgvector, PostGIS, RLS y funciones de aprovisionamiento.
2. `src/contracts/app-config.schema.ts`: contrato Zod versionado, componentes recursivos, límites de complejidad, acciones, hardware, formularios y proveedores de pago.
3. `src/ai/`: Responses API, herramientas validadas, contexto aislado, memoria, historial, búsqueda vectorial y notificaciones Socket.IO.
4. `src/core/`, `src/payments/`, `src/security/`: metadatos, cola transaccional de flujos, archivos, GIS, pagos y autorización.
5. `mobile/lib/`: intérprete SDUI, registro extensible de widgets, puente de hardware, inicio de sesión y cola SQLite por usuario/tenant/app.
6. `infra/`: Fastlane, runner de compilación, configuración de proyectos nativos, Docker y CI.

`portal/` contiene el portal administrativo, sin dependencias de frontend. Utiliza Authorization Code + PKCE y conserva el access token únicamente en memoria.

## Puesta en marcha

Requisitos: Node.js 22, Docker con contenedores Linux y un proveedor OIDC. Para compilar Android se necesita Flutter 3.29.3, JDK y Android SDK; para iOS, macOS, Xcode y CocoaPods. Ruby/Bundler, AWS CLI y Python 3 son necesarios para el runner.

```sh
cp .env.example .env
# Configurar contraseñas aleatorias y datos del proveedor OIDC.
npm ci
docker compose up -d db redis
npx prisma migrate deploy
npx prisma generate
npm run bootstrap -- empresa identificador-del-usuario-en-oidc
npm run build
npm start
```

En PowerShell, usa `Copy-Item .env.example .env` y `npm.cmd`/`npx.cmd` si la política de scripts lo requiere. Carga las variables de `.env` en el proceso antes de ejecutar el servidor (Node: `node --env-file=.env dist/src/main.js`). Prisma carga `.env` automáticamente.

Abre `http://localhost:3000`. El inicio de sesión requiere la configuración OIDC; el portal no inventa usuarios ni datos cuando falta una conexión.

La migración usa `DIRECT_DATABASE_URL` con el rol propietario. La aplicación utiliza `DATABASE_URL` con `superapp_runtime`, un rol `NOSUPERUSER NOBYPASSRLS`. El servidor rechaza el arranque si el rol puede saltarse RLS o si faltan las políticas. Nunca distribuyas el URL de migración al contenedor de la API; Compose lo reemplaza por el rol limitado para ese contenedor.

## Identidad y aislamiento

El emisor OIDC debe emitir JWT firmados RS256/ES256 con `iss`, `aud`, `sub`, `exp` y un claim `tenant_id` UUID asignado administrativamente. No permitas que un usuario edite su `tenant_id` en el perfil del proveedor. Los dispositivos también requieren `app_id`.

Las autorizaciones reales se leen de `Membership`: `OWNER`, `ADMIN`, `VIEWER`, `DEVICE` o `BUILDER`. El claim de rol del cliente no se utiliza. Registra las membresías mediante una operación administrativa de aprovisionamiento. El cliente del portal debe admitir PKCE, CORS en el endpoint de token y la redirección exacta `/`. El móvil necesita un cliente público independiente con redirección `bundle.id:/oauthredirect`. El runner usa un cliente confidencial con `client_credentials`, claim de tenant y membresía `BUILDER`.

Cada operación de datos se ejecuta en una transacción que fija `app.tenant_id` con alcance **local a la transacción**. Las claves foráneas compuestas incluyen tenant. Redis incluye tenant, app y revisión en sus claves. Socket.IO autentica la conexión antes de unirla a una sala del tenant y limita su duración a cinco minutos; los mensajes GIS vuelven a validar el token. El adaptador Redis distribuye eventos entre réplicas.

El espacio IA es uno por aplicación, vinculado también al tenant. Historial y fragmentos vectoriales no se comparten entre aplicaciones. Los documentos recuperados se incluyen como datos no confiables; las herramientas se validan independientemente del texto que genere el modelo.

El aislamiento cubre operaciones servidas por la API. No equivale a proteger una base comprometida por un superusuario ni a contenedores físicos por cliente. Los propietarios de infraestructura siguen siendo de confianza.

## Tablas dinámicas

`buildDatabaseTable` crea `DynamicSchema`. Un trigger limitado crea una tabla física `tenant_<uuid>/table_<uuid>` con columnas tipadas, RLS forzada y nombres escapados. Las escrituras de `DynamicRecord` se reflejan en esa tabla dentro de la misma transacción. El runtime no recibe permisos DDL ni escritura directa sobre las tablas físicas.

Tipos: texto, correo, número, booleano, fecha ISO, archivo, firma y ubicación. El validador rechaza campos extra, valores fuera de rango y cambios de tipos. Para cambiar columnas, crea una versión nueva y migra los registros con una operación administrativa; no se destruyen datos automáticamente. Los esquemas físicos vacíos se conservan tras eliminar metadatos para evitar DDL destructivo implícito.

## Agente IA

La Assistants API dejó de estar disponible el 26 de agosto de 2026. Esta implementación usa **Responses API**, `store:false`, historial propio y el modelo configurable `gpt-4o`. Fuentes oficiales:

- https://developers.openai.com/api/docs/assistants/migration
- https://developers.openai.com/api/docs/guides/function-calling

Herramientas: `createScreenFromPrompt`, `buildDatabaseTable`, `configurePaymentGateway`, `attachHardwareHandler`. El tenant y el app ID nunca provienen de los argumentos del modelo. `ModelFactory.register()` permite integrar proveedores compatibles con la interfaz interna.

Cada turno reserva 100.000 tokens de cuota y contabiliza el consumo reportado del modelo al terminar. Se limitan contexto y rondas. Una caída abrupta mantiene la reserva de forma conservadora; una tarea administrativa debe reconciliar reservas con la facturación del proveedor. Las cuotas actuales del tenant son acumuladas, no se reinician automáticamente con el ciclo de facturación. La ingesta de embeddings está limitada en tamaño y frecuencia, pero su facturación requiere un presupuesto adicional en el proveedor.

Secretos por tenant: `TENANT_<UUID_SIN_GUIONES_EN_MAYÚSCULAS>_<REFERENCIA>`. Por ejemplo, la referencia `OPENAI_API_KEY` resuelve únicamente en el prefijo del tenant autenticado. No pegues llaves en la conversación con el agente. El punto de integración `SecretsService` permite sustituir variables inyectadas por un gestor de secretos.

## Pagos

Los cinco adaptadores implementan checkout alojado. No se reciben PAN/CVV ni se introducen claves privadas en el JSON móvil. El administrador crea una oferta con precio fijo; el cliente envía `offerId`, nunca un importe autorizado por sí mismo. Monedas con dos decimales: USD, COP, EUR, MXN, BRL, PEN y ARS, sujetas a la compatibilidad de cada proveedor/cuenta.

La referencia de secreto de cada pasarela contiene un objeto JSON de strings:

| Proveedor | Credenciales |
|---|---|
| Stripe | `secretKey` |
| Wompi Colombia | `publicKey`, `privateKey`, `integritySecret`, `environment` |
| Mercado Pago | `accessToken`, `environment` |
| PayPal | `clientId`, `clientSecret`, `environment` |
| PayU Latam | `merchantId`, `accountId`, `apiKey`, `apiLogin`, `environment` |

`environment=production` activa producción; el resto usa sandbox cuando el proveedor ofrece un host o URL separado. PayU usa formulario POST firmado con SHA-256; el ejemplo corresponde a productos exentos de IVA (`tax=0`) y documentos CC: adapta el cálculo fiscal y datos locales antes de vender otros productos o países.

`POST /api/apps/:appId/payments/:paymentId/reconcile` consulta al proveedor y compara referencia, importe y moneda antes de registrar `PAID`. PayPal captura órdenes aprobadas. Wompi necesita el ID de la transacción devuelto en la redirección. Un pago no se confirma por lo que dice el navegador. El evento `ON_PAYMENT_SUCCESS` se crea en la misma transacción que el cambio de estado.

La conciliación se invoca desde el móvil, un cliente administrativo autenticado o los callbacks de proveedores. Configura en cada proveedor `https://TU_HOST/api/payment-events/TENANT/APP/PROVEEDOR/TOKEN`, donde `TOKEN` es un secreto aleatorio de al menos 32 bytes codificado base64url (43 caracteres), guardado como `webhookToken` en las credenciales. El endpoint comprueba ese secreto y consulta la API del proveedor; nunca confía en el estado del evento por sí solo. Excluye esta ruta de logs de URLs y rota el token si se expone. Se reciben eventos de sesión Stripe, transacción Wompi, pago Mercado Pago, confirmación PayU y captura PayPal. Configura esos eventos en los paneles de cada proveedor. Un timeout al crear checkout deja el pago `UNKNOWN`; el callback puede recuperarlo por referencia, y la conciliación administrativa admite `providerId` cuando aún no se almacenó. No hay un barrido periódico de pagos abandonados: usa reintentos del proveedor y una conciliación operativa diaria.

Documentación de referencia: [Stripe](https://docs.stripe.com/api/checkout/sessions/create), [Wompi](https://docs.wompi.co/docs/colombia/widget-checkout-web/), [Mercado Pago](https://www.mercadopago.com.co/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post), [PayPal](https://developer.paypal.com/api/orders/v2), [PayU](https://developers.payulatam.com/latam/en/docs/integrations/webcheckout-integration/payment-form.html).

## Flujos y archivos

`WorkflowEvent` actúa como cola transaccional. El worker reclama filas con `SKIP LOCKED`, guarda cada paso terminado y aplica reintentos exponenciales, con un máximo de ocho. Configura `WORKER_TENANTS` con los tenants asignados a esa instancia. Particiona esta lista entre grupos de workers al crecer.

Los webhooks salientes incluyen clave de idempotencia, timestamp y firma HMAC-SHA256. El receptor debe verificar la firma y rechazar replays. La entrega es **al menos una vez**: una caída después de enviar pero antes de guardar el paso puede repetir una notificación. FCM envía notificaciones Android y APNs mediante Firebase; configura credenciales Google y la llave APNs del proyecto. Los PDF se generan con JavaScript desactivado, red bloqueada y texto escapado.

`OUTBOUND_HOSTS` limita destinos; aplica además una política de salida de red que bloquee IP privadas, loopback y metadatos cloud después de resolver DNS. El backend rechaza redirecciones. Redis debe estar en red privada. HTTPS termina en el ingress. El volumen de archivos debe compartirse entre réplicas o sustituirse por object storage; implementa backups, retención y cifrado de volumen según tu operación.

Archivos móviles se cargan por streaming, hasta 100 MiB, con SHA-256 y pertenencia a app/tenant. Los registros referencian `assetId`. Firmas incluyen PNG, SVG y hash del SVG: la integridad criptográfica no constituye por sí sola una firma electrónica certificada. No insertes el SVG recibido como HTML sin sanitización.

## Hardware y offline

- Cámara/foto HD, video con límite de duración, timestamp, GPS y EXIF de fotos. El video lleva un archivo JSON complementario; no se reescribe su contenedor.
- Firma vectorial, PNG y SHA-256.
- AAC/M4A con visualización de amplitud.
- Ubicación mediante el servicio nativo del paquete `location`, geocercas calculadas por el cliente y transmisión Socket.IO o MQTT TLS.
- Escáner de cámara y NFC NDEF/ISO según las capacidades del dispositivo. RFID UHF requiere un lector externo y otro adaptador registrado.
- SQLite con partición por tenant, usuario y aplicación. Cola de envíos con idempotencia y conservación de rechazos; tokens en Keychain/Keystore.

El sistema operativo puede suspender el proceso móvil: esta base no promete tracking después de forzar el cierre, reiniciar el dispositivo o retirar permisos. MQTT requiere un broker con autenticación JWT y ACL de publicación `superapp/<tenant_id>/<app_id>/positions`; bloquea suscripciones para dispositivos. Define `MQTT_URL=mqtts://...`, `MQTT_SERVICE_USERNAME` y `MQTT_SERVICE_PASSWORD` en el backend para activar el consumidor hacia PostGIS. La cuenta de servicio necesita suscribirse a `superapp/+/+/positions`. Cada mensaje vuelve a validar JWT, tenant, aplicación y coordenadas. En el runner, `MQTT_HOST` fija el único host al que el móvil puede enviar credenciales; los metadatos no pueden cambiarlo. Se usa TLS con validación de certificado. No se entrega un broker en Compose: conecta uno administrado. La ruta Socket.IO y el fallback HTTP también llegan al backend incluido. Para uso GIS continuo con el proceso terminado se necesita un SDK nativo especializado y validación de batería/políticas de tienda.

OpenStreetMap se usa como capa de demostración. Sustituye el proveedor de tiles o contrata el servicio apropiado antes de generar tráfico de producción. El contrato y `SduiWidgetFactory.register()` permiten agregar componentes. Los widgets desconocidos muestran un estado explícito, sin ejecutar código remoto.

## Compilación de un clic

`POST /api/builds` encola un build con la revisión inmutable `TEMPLATE_REVISION`. El runner autenticado reclama su siguiente trabajo y comunica el resultado mediante un callback HTTPS. Un trabajo sin resultado durante dos horas se marca como fallido al reclamar otro trabajo; revisa causas antes de reintentarlo.

Publica este directorio como raíz de un repositorio de plantilla y configura `TEMPLATE_REPOSITORY`. El runner hace checkout del SHA exacto, genera los proyectos nativos Flutter, inyecta nombre/bundle/version, configura permisos y firma, valida Flutter y ejecuta Fastlane. Los assets se descargan desde hosts permitidos, con tamaño máximo y SHA-256. Nunca se ejecutan comandos recibidos de los metadatos.

Variables comunes del runner: `ENGINE_URL`, `OIDC_TOKEN_URL`, `RUNNER_CLIENT_ID`, `RUNNER_CLIENT_SECRET`, `OIDC_AUDIENCE`, `TEMPLATE_REPOSITORY`, `PLATFORM`, `ARTIFACT_BUCKET`, `ARTIFACT_PUBLIC_PREFIX`, `MOBILE_OIDC_ISSUER`, `MOBILE_OIDC_CLIENT_ID`, `PAYMENT_RETURN_URL`, `ASSET_HOSTS`. AWS CLI utiliza la identidad del runner. `RUN_ONCE=true` procesa como máximo un trabajo.

Android: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Monta el keystore como secreto. `docker build -f infra/Dockerfile.android -t superapp-compiler .` genera la imagen del runner Android.

iOS: ejecuta `infra/compiler_runner.sh` en macOS. Variables: `IOS_CERTIFICATE_PATH`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROFILE_PATH`, `IOS_PROFILE_NAME`, `APPLE_TEAM_ID`, `KEYCHAIN_PASSWORD`. El perfil debe permitir NFC y corresponder al bundle generado. Para TestFlight: `UPLOAD_TESTFLIGHT=true`, `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_KEY_PATH`. Docker Linux no puede producir un IPA firmado.

Los `.aab`/`.ipa` se suben a un bucket privado. `ARTIFACT_PUBLIC_PREFIX` debe apuntar a una distribución autenticada; no hagas público el bucket por conveniencia. La subida a Google Play y la contratación/configuración de cuentas de tienda son operaciones externas, no se ejecutan automáticamente.

## Verificación

```sh
npx prisma validate
npm run build
npm test
# Con PostgreSQL de pruebas ya migrado:
TEST_ADMIN_DATABASE_URL=... TEST_RUNTIME_DATABASE_URL=... npm run test:integration
cd mobile
flutter pub get
flutter analyze
flutter test
```

Consulta `VERIFICATION.md` para los resultados ejecutados en este entorno y sus límites. La existencia de código, tests y CI no sustituye una validación de carga, revisión de seguridad, sandbox de pagos ni pruebas de hardware y firma en equipos reales.
