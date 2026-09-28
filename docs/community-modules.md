# Comunidades y submodulos

Al crear una comunidad se requieren nombre, correo y contrasena (10 a 200 caracteres) de una cuenta raiz independiente. La contrasena se almacena con scrypt; no se copian las credenciales del solicitante. Se conserva el flujo de aprobacion existente.

El superadministrador selecciona Acceso y foto, Dashboard y Formulario al crear la comunidad y puede cambiarlos desde Comunidades > Configurar submodulos. Las solicitudes de otros usuarios comienzan con los submodulos deshabilitados. La raiz de una comunidad no puede habilitarlos por su cuenta.

Deshabilitar Formulario impide configurar sus campos; el registro de afiliados sigue usando el formulario existente. Deshabilitar Acceso y foto impide cambiar el limite por nivel y la foto de comunidad; no desactiva el inicio de sesion. Dashboard bloquea consulta y configuracion. Los permisos se aplican en el servidor y en el menu.

## Actualizacion

El permiso **Crear comunidades** está deshabilitado de forma predeterminada. El superadministrador puede activarlo desde Configurar submódulos para que la cuenta raíz de esa comunidad pueda solicitar nuevas comunidades. El permiso se verifica en el servidor; no permite asignar submódulos a las nuevas comunidades ni aprobarlas. Las solicitudes siguen pendientes hasta su revisión.

El superadministrador inicia en Comunidades. Al seleccionar **Administrar comunidad**, puede registrar y editar afiliados, configurar Acceso y foto, Dashboard y Formulario, y crear comunidades usando el formulario de la comunidad seleccionada. Todos los submodulos estan disponibles para el superadministrador aunque esten deshabilitados para sus usuarios. La sesion sigue perteneciendo al superadministrador; las operaciones se limitan a la comunidad seleccionada y la auditoria conserva al actor real. Volver a Comunidades limpia la seleccion.

**Descargar CSV de todas las comunidades** exporta todos los afiliados de las comunidades de la plataforma, incluidas las pendientes o suspendidas. La primera columna contiene la comunidad; incluye identificadores, nombre, correo, superior, rol, estado, fecha de registro, indicador de foto y la union de campos personalizados. Los campos con el mismo nombre y tipo comparten columna; los de tipos diferentes se separan. Los campos que no corresponden a la comunidad de una fila quedan vacios. Tambien conserva valores guardados de campos retirados del formulario. No exporta contrasenas, sesiones ni archivos binarios. La descarga usa una lectura consistente y paginada de PostgreSQL, sin el limite de 500 comunidades del listado visual.

El CSV individual conserva Comunidad como primera columna. El arrastre del arbol funciona con raton o gesto tactil; Ajustar restablece su posicion.

La migración `202609270002_create_communities_permission` incorpora el nuevo permiso, inicialmente deshabilitado, sin cambiar los permisos existentes.

La entrada principal identifica la comunidad mediante el correo y la contraseña, crea una sesión limitada a esa comunidad y redirige a su dirección. Esto funciona tanto para cuentas raíz como para afiliados. Si las mismas credenciales corresponden a varias comunidades, se pide seleccionar una después de verificarlas. Los accesos por enlace directo siguen limitados a su comunidad. Una cuenta activa no permite entrar si la comunidad sigue pendiente, rechazada o suspendida; el superadministrador debe aprobarla desde Comunidades.

Desde **Comunidades > Cambiar usuario raíz**, el superadministrador puede actualizar el nombre, correo y contraseña de la cuenta raíz de una comunidad creada. Se conserva el identificador de la cuenta y su árbol de afiliados; se revocan sus sesiones anteriores. El correo no puede pertenecer a otro afiliado de esa comunidad. El cambio se registra en auditoría sin guardar la contraseña. Esta opción no modifica la cuenta del superadministrador ni cambia el estado de aprobación o los submódulos de la comunidad.

Con DATABASE_URL configurada para la instalacion, ejecutar antes de iniciar la nueva version:

```sh
npm run db:generate
npm run db:migrate
npm run build
```

La migracion 202609270001_community_modules conserva habilitados los tres submodulos en las comunidades existentes. No modifica sus cuentas raiz.
