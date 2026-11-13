# Seguimiento de Ruta · Seguridad vial SST

## Inicio directo de rutas

El botón «Iniciar ruta» solicita ubicación e inicia el viaje sin formularios. No se asigna un vehículo automáticamente. Se utiliza la zona urbana (50 km/h) por defecto y el sector «Recorrido GPS»; no existe detección automática de zonas. Las coordenadas identifican el recorrido real.

Para activar este flujo en una base existente, ejecuta `supabase/migrations/003_quick_start.sql` después de las migraciones 001 y 002. Esta actualización permite viajes sin vehículo y mantiene el aislamiento por conductor.

Aplicación React, Next.js y TypeScript con Supabase Auth y PostgreSQL. Las cuentas, perfiles, vehículos, viajes y alertas se guardan en Supabase; la app ya no escribe en SQLite. Requiere Node.js 24 o superior.

## Configurar Supabase

1. Copia `.env.example` a `.env.local` si el archivo local aún no existe. Completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con los datos de tu proyecto.
2. Abre el SQL Editor del proyecto y ejecuta [supabase/migrations/001_initial.sql](supabase/migrations/001_initial.sql) y después [supabase/migrations/002_route_points.sql](supabase/migrations/002_route_points.sql). Si ya ejecutaste 001, solo necesitas 002 para el trazado GPS. Las migraciones crean tablas, índices, validaciones, perfiles automáticos y políticas de acceso; se pueden ejecutar otra vez sin borrar los datos.
3. En Authentication > URL Configuration configura `http://localhost:3000` como Site URL para desarrollo y agrega `http://localhost:3000/auth/callback` a Redirect URLs. Configura también la URL HTTPS y el callback de producción al publicar.
4. Mantén habilitada la confirmación de correo si deseas verificar las cuentas. Después de registrarse, el conductor verá un mensaje para confirmar su correo y luego ingresar.
5. Comprueba la configuración con `npm run check:supabase`. Este diagnóstico comprueba disponibilidad de endpoints; las pruebas de permisos están en `npm run test:db`.

La clave publicable sirve para Auth y consultas protegidas por RLS. No permite crear tablas. La migración necesita el SQL Editor o una conexión administrativa autorizada. No desactives RLS para solucionar un error de permisos.

## Inicio local

```sh
npm install
npm run dev
```

Abre http://localhost:3000. Crea una cuenta y confirma el correo. Todas las cuentas nuevas abren la vista de conductor, con un único flujo de «Iniciar ruta», mapa GPS y límites preventivos. Desde ese botón puedes seleccionar o registrar el vehículo y configurar zona y sector. El navegador pedirá permiso de ubicación. El GPS debe entregar velocidad y precisión de hasta 60 metros; de lo contrario se informa que la señal o la velocidad no están disponibles.

## Probar el GPS en el celular

Un computador sin GPS calcula su ubicación con las redes Wi-Fi cercanas y puede equivocarse de país. Para probar con el GPS real, abre la app en el celular. El navegador solo entrega la ubicación por HTTPS, así que existe un acceso HTTPS para la red local:

1. Deja `npm run dev` corriendo y, en otra terminal, ejecuta `npm run movil`.
2. Conecta el celular al mismo Wi-Fi del computador y abre la dirección `https://<IP>:3443` que muestra la terminal.
3. El navegador avisará que la conexión no es privada, porque el certificado es local. Toca «Configuración avanzada» → «Continuar», inicia sesión, toca «Iniciar ruta» y permite la ubicación.

- Si la página no carga, la red bloquea las conexiones entre dispositivos; pasa a menudo en redes corporativas o de invitados. Activa el punto de acceso del celular, conecta el computador a esa red y vuelve a ejecutar `npm run movil`: detecta la nueva IP y renueva el certificado.
- Para quitar el aviso, instala el certificado raíz que ofrece la dirección `https://<IP>:3443/__certificado-movil.crt`. Hazlo también si usas iPhone o si la página se recarga sola cada pocos segundos. En Android, búscalo en Ajustes como «Instalar certificado» → «Certificado de CA». En iPhone, instala el perfil descargado y activa la confianza total en Ajustes → General → Información → Ajustes de confianza de certificados. Ese certificado solo es válido para direcciones de red local y `localhost`.
- Los certificados se crean con OpenSSL (incluido en Git para Windows) en `certificates/`, carpeta excluida de Git. No compartas `movil-ca.key`.
- Para medir la velocidad y guardar el recorrido, el GPS necesita una precisión de 60 m o mejor. Prueba al aire libre.

## Asignar administrador después

Registra primero la cuenta. Abre [supabase/assign-admin.sql](supabase/assign-admin.sql), reemplaza el correo y ejecuta la consulta en SQL Editor. Actualiza el panel después de asignar el rol.

También puedes configurar `SUPABASE_SECRET_KEY` solo en el entorno del servidor y ejecutar:

```sh
npm run admin -- correo@empresa.com
```

La clave secreta es opcional y no se utiliza en las rutas de la aplicación. Nunca lleva el prefijo `NEXT_PUBLIC_`. `.env.local` está excluido de Git.

## Datos y permisos

- Supabase Auth gestiona contraseñas, verificación de correo y sesiones. El servidor verifica la identidad y conserva la sesión en cookies HttpOnly.
- `profiles` guarda nombre y rol. Cada cuenta nueva comienza como conductor, aunque intente enviar otro rol durante el registro.
- `vehicles` guarda placa única, modelo y propietario.
- `trips` guarda vehículo, conductor, zona, sector, inicio y fin; solo permite un viaje activo por conductor.
- `events` guarda viaje, conductor, zona, sector, velocidad, límite, coordenadas y fecha.
- `route_points` guarda las posiciones del recorrido con coordenadas, precisión y hora GPS. La aplicación muestra el punto actual y una línea con el trazado, enviando lotes al servidor cada siete segundos. Las posiciones se muestrean como máximo cada cinco segundos y la base evita duplicados por viaje y hora.
- RLS permite que el conductor consulte solo sus registros y el administrador lea la flota completa. El administrador no puede crear eventos como otro conductor.
- PostgreSQL calcula los límites preventivos: urbana 50, nacional 70, curvas 35 y escolar/residencial 30 km/h. Rechaza alertas sin exceso, posiciones inválidas y viajes cerrados o de otro conductor.
- El historial y los conteos se consultan desde Supabase cada 15 segundos. La búsqueda y la exportación CSV incluyen los registros disponibles para el usuario.

La antigua base local no se elimina ni se importa automáticamente. Las cuentas anteriores de SQLite no son cuentas de Supabase Auth. En esta instalación se comprobó que la base local estaba vacía antes del cambio.

## GPS y alertas

La zona y el sector se seleccionan manualmente antes de salir. No hay detección automática de curvas ni zonas escolares. Mantén la app abierta: no hay seguimiento garantizado en segundo plano. Al recargar, se recuperan los puntos guardados del viaje abierto y el botón «Reanudar GPS» vuelve a solicitar la ubicación sin crear otro viaje. Si la señal se pierde, el mapa identifica la última ubicación conocida y deja de mostrar velocidad actual.

Durante el exceso hay alerta visual y un pitido cada cinco segundos; las notificaciones dependen de los permisos del navegador. Se registra un evento por episodio. Un nuevo episodio comienza al bajar al menos 3 km/h por debajo del límite. Se necesita conexión al servidor para guardar; los errores se muestran y se reintenta durante el exceso. Las posiciones pendientes se conservan solo en la memoria de la pestaña; no hay cola offline persistente. Para finalizar, la app intenta guardar los puntos pendientes primero. El mapa base usa teselas de OpenStreetMap con atribución visible y necesita conexión. La distancia es una estimación del trazado GPS, no una lectura del odómetro.

## Verificación y producción

```sh
npm run check
npm run test:db
npm run test:ui
npm run check:supabase
npm run build
npm start
```

`test:db` ejecuta la migración real en PostgreSQL embebido con PGlite y comprueba restricciones, roles y aislamiento RLS. No crea usuarios ni eventos en tu proyecto de Supabase. La confirmación por correo y el GPS requieren una prueba con una cuenta y un dispositivo reales.

`test:ui` usa Microsoft Edge instalado y Playwright para comprobar registro, vista exclusiva del conductor, GPS simulado, denegación de permisos, posiciones del mapa, alertas, reanudación, finalización y adaptación móvil. No escribe datos en Supabase.

En producción configura las variables en el alojamiento y usa HTTPS. Los registros viven en Supabase; no necesitas un disco local persistente para la app.

## Credenciales en Vercel

En el proyecto Vercel, abre Settings > Environment Variables y agrega para Production:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

Usa los valores del mismo proyecto que en .env.local, sin comillas. El archivo .env.local no se publica en Git. Tambien se admite NEXT_PUBLIC_SUPABASE_ANON_KEY para proyectos que usen la clave anon.
Despues abre Deployments > Redeploy para aplicar las variables. Configura en Supabase Authentication > URL Configuration el dominio de produccion y su ruta /auth/callback.
Una respuesta 503 de /api/state indica un problema del servidor; sin sesion y con configuracion correcta debe responder 401.

## Deteccion automatica en Atlantico

La nueva version consulta limites por tramo con el GPS y el catalogo OSM incluido. Ejecutar `supabase/enable-automatic-limits.sql` en Supabase antes de guardar eventos automaticos. Ver [docs/automatic-speed-limits.md](docs/automatic-speed-limits.md) para activar, actualizar datos y conocer la cobertura. No requiere una API de mapas de pago. Los tramos sin dato se muestran como limite no disponible.
