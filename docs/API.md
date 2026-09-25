# API de administración y dispositivos

Todas las rutas, salvo los callbacks de pago y la configuración pública OIDC, requieren `Authorization: Bearer <JWT>`. El tenant se obtiene del JWT verificado, nunca de un header libre. Los clientes DEVICE requieren `app_id` y su membresía.

| Método | Ruta | Uso |
|---|---|---|
| GET / POST | `/api/apps` | Listar / crear aplicaciones |
| PATCH | `/api/apps/:appId` | Actualizar nombre, versión y tokens de tema |
| GET | `/api/apps/:appId/metadata` | Configuración móvil con ETag |
| POST | `/api/apps/:appId/screens` | Crear/actualizar pantalla validada |
| POST / GET | `/api/apps/:appId/schemas` | Definir / consultar tablas |
| POST / GET | `/api/apps/:appId/records/:schemaId` | Guardar / paginar registros |
| POST | `/api/apps/:appId/ai/prompt` | Ejecutar agente con `{prompt}` |
| POST | `/api/apps/:appId/ai/knowledge` | Indexar `{source,content}` |
| PATCH | `/api/apps/:appId/ai/workspace` | Actualizar prompt, memoria, proveedor o modelo |
| POST | `/api/apps/:appId/gateways` | Configurar referencia de credenciales |
| POST | `/api/apps/:appId/payments/offers` | Crear oferta de precio fijo |
| POST | `/api/apps/:appId/payments/checkout` | Crear checkout con `{offerId,customer}` |
| POST | `/api/apps/:appId/payments/:paymentId/reconcile` | Verificar y confirmar pago |
| POST | `/api/apps/:appId/workflows` | Registrar trigger y acciones |
| POST | `/api/apps/:appId/assets` | Archivo binario; Content-Type admitido |
| GET | `/api/apps/:appId/assets/:id` | Descargar archivo autorizado |
| POST | `/api/apps/:appId/gis/positions` | Guardar punto en PostGIS |
| POST | `/api/apps/:appId/gis/geofence` | Informar entrada en geocerca |
| POST / GET | `/api/builds` | Encolar / consultar builds |
| POST | `/api/builds/claim` | Reclamar trabajo (BUILDER) |
| POST | `/api/builds/:buildId/status` | Callback del runner (BUILDER) |

Registros y checkout requieren `Idempotency-Key` de 8–100 caracteres. Los archivos requieren UUID como clave. No reuses una clave para otra operación. Los callbacks externos de pagos usan una ruta protegida con un secreto de alta entropía y siempre verifican el pago contra la API del proveedor.

Crear una tabla:

```json
{"name":"inspections","fields":[{"name":"description","type":"text","required":true,"max":500},{"name":"score","type":"number","required":true,"min":0,"max":10},{"name":"photo","type":"file"},{"name":"signature","type":"signature"}]}
```

Crear una pantalla después de obtener el `schemaId` de la tabla (sustituye el UUID por el real):

```json
{
  "route":"/",
  "title":"Inspección",
  "tree":{
    "id":"inspection_form",
    "type":"FORM",
    "schemaId":"11111111-1111-4111-8111-111111111111",
    "children":[
      {"id":"description_input","type":"INPUT_TEXT","field":"description","label":"Descripción","inputType":"text","required":true},
      {"id":"score_input","type":"INPUT_TEXT","field":"score","label":"Puntuación","inputType":"number","required":true},
      {"id":"photo_button","type":"HARDWARE_BUTTON","field":"photo","label":"Tomar foto","handler":{"kind":"camera","mode":"photo","quality":"hd","exif":true,"gps":true,"timestamp":true}},
      {"id":"signature_canvas","type":"SIGNATURE_CANVAS","field":"signature","handler":{"kind":"signature","formats":["png","svg"],"hash":"sha256"}}
    ]
  }
}
```

El formulario incorpora su propio botón Enviar. Los eventos Socket.IO del portal llegan en `/portal`, evento `app.updated`, con `{appId,revision}`. La conexión lleva `{auth:{token}}`. El canal `/tracking` recibe `position` con `{appId,position:{deviceId,latitude,longitude,capturedAt}}` y responde mediante acknowledgment.
