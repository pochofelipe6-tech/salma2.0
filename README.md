# Seguimiento de Ruta · Seguridad vial SST

Aplicación React, Next.js y TypeScript con servidor Node.js y SQLite persistente. Requiere Node.js 24 o superior.

## Inicio

```sh
npm install
npm run dev
```

Abre http://localhost:3000. Crea una cuenta de conductor, registra un vehículo en «Vehículos» y configura zona y sector antes de iniciar un viaje. Permite ubicación y notificaciones. El GPS debe entregar velocidad y precisión de hasta 60 metros; de lo contrario se indica que la velocidad no está disponible. No se inventan velocidades a partir de posiciones imprecisas.

## Asignar administrador después

Registra la cuenta normalmente y ejecuta en el servidor:

```sh
npm run admin -- correo@empresa.com
```

Actualiza la página. El administrador ve vehículos, viajes y eventos de todos los conductores. Los permisos se verifican en el servidor; el registro público no permite elegir rol.

## Funcionalidades

- Contraseñas con scrypt, sesiones opacas en cookie HttpOnly, caducidad de siete días y comprobación de origen.
- Vehículos con placa única, viajes y eventos persistentes en `data/salma.db`.
- Límites preventivos: urbana 50, nacional 70, curvas 35 y escolar/residencial 30 km/h.
- GPS en primer plano, alerta visual y pitido cada cinco segundos durante el exceso; notificación del navegador cuando tiene permiso.
- Un evento por episodio de exceso, con placa, conductor, sector declarado, zona, coordenadas, velocidad, límite y hora UTC. Un nuevo episodio comienza al bajar al menos 3 km/h por debajo del límite.
- Historial, búsqueda, conteos por zona en administrador y exportación CSV.
- Actualización del panel cada 15 segundos.

## Alcance operativo

La zona y el sector se seleccionan manualmente antes del viaje. No hay identificación automática de zonas, cartografía de límites ni seguimiento garantizado en segundo plano. Mantén la app abierta; si el navegador se suspende, pierde permisos o no proporciona velocidad, no puede vigilar los excesos. Después de recargar una pestaña con viaje activo, finalízalo y comienza otro para recuperar el seguimiento. No manipules la pantalla mientras conduces.

Los límites son preventivos SST aportados por el usuario. La base de datos reside en el servidor y debe respaldarse. Para producción utiliza HTTPS, almacenamiento persistente y una única instancia Node.js; no uses un sistema de archivos efímero. Las notificaciones dependen del navegador y sus permisos. El registro de eventos necesita conexión al servidor; si falla, se informa y se reintenta durante el exceso. No existe cola offline.

## Producción

```sh
npm run build
npm start
```

Esta implementación utiliza `node:sqlite` y requiere alojamiento Node.js. No es compatible directamente con el runtime Cloudflare Workers de Sites. No se ha publicado en un servicio externo.
