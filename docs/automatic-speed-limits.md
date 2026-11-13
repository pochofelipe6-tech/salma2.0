# Deteccion automatica de limites: Atlantico

La app identifica el tramo con el GPS y aplica el limite preventivo SST de su categoria: urbana 50, nacional 70, curvas 35 y escolar/residencial 30 km/h. Ya no pide seleccionar zona. El detector se ejecuta en el servidor, usa un indice geografico local y no necesita cuentas de HERE/TomTom ni consultas publicas por cada posicion.

## Activacion

1. Ejecutar completo `supabase/enable-automatic-limits.sql` en Supabase > SQL Editor. Equivale a las migraciones 006, 007 y 008, en ese orden. Si ya se aplicaron 006 y 007, basta ejecutar 008_sst_zone_limits.sql. No elimina viajes ni alertas anteriores.
2. Desplegar esta version en Vercel. `assets/maps/atlantico-roads.json` se incluye en el paquete del servidor, verificado en el trace de produccion.
3. Iniciar una ruta, permitir GPS y esperar dos posiciones recientes, con precision de 25 m o menos, sobre un tramo inequivoco.

La alerta visual y sonora funciona con el detector. Para guardar los eventos en el administrador es necesario aplicar el SQL. No se ha aplicado remotamente: este entorno solo dispone de la clave publica de Supabase, sin acceso administrativo SQL.

## Cobertura y comportamiento

- 35.168 objetos de vias y 2.921 limites fijos numericos utilizables (8,3 % por numero de objetos; no por kilometros).
- Las alertas usan exclusivamente 50/70/35/30 como politica preventiva SST por categoria. No son limites legales consultados del mapa. El limite numerico registrado en OSM se conserva por separado en posted_limit/postedLimit. Si falta informacion para identificar el tramo, muestra Limite no disponible.
- Descarta GPS impreciso, ubicacion fuera de cobertura, cruces o vias paralelas ambiguos, cambios de tramo sin confirmar y limites direccionales/condicionales que esta version no puede resolver.
- Las tarjetas de 50/70/35/30 muestran los umbrales de alerta SST configurados por el usuario. El valor registrado en el mapa puede ser diferente; la interfaz lo muestra aparte y recuerda respetar la senalizacion.
- Las etiquetas Via principal/local/residencial describen el tipo de via en OSM. No demuestran que una carretera sea nacional ni que sea una zona escolar.
- Hay 380 objetos escolares en el inventario original. No se convierten en zonas de velocidad: la cercania a un colegio no define un limite de 30, ni una curva geometrica define un limite de 35.
- Requiere app abierta y conexion al servidor. GPS y audio dependen del navegador/dispositivo. Probar el sonido antes de salir.
- Al perder GPS o informacion del limite se suspende la alerta automatica. La senalizacion vial sigue siendo la referencia al conducir.

## Registro y seguridad

POST /api/road requiere sesion y dos posiciones para devolver tramo/limite o un motivo de desconocido.
POST /api/event vuelve a calcular el tramo en el servidor y no acepta limites enviados por el cliente. La base consulta un catalogo protegido, calcula limit_speed, comprueba proximidad a la geometria y exige un viaje activo del conductor. Guarda el tramo en sector y road_id. Los eventos historicos siguen siendo compatibles.

## Datos y actualizacion

Fuente Colombia: https://download.geofabrik.de/south-america/colombia.html
Poligono departamental: OpenStreetMap/Nominatim, relacion 1315209 (CO-ATL).
Licencia ODbL 1.0: https://www.openstreetmap.org/copyright

Los originales estan en data/maps/ (fuera de Git); el extracto distribuible derivado esta en assets/maps/. Conservar atribucion y licencia: el artefacto geografico derivado se distribuye bajo ODbL.

1. `node scripts/download-colombia-map.mjs`: descarga/reanuda y verifica el MD5 publicado.
2. `npm install --prefix data/map-tools --no-audit --no-fund osm-pbf-parser`: instala el lector aislado.
3. Obtener atlantico-boundary.json desde https://nominatim.openstreetmap.org/search?state=Atl%C3%A1ntico&country=Colombia&format=jsonv2&polygon_geojson=1&limit=1
4. `node scripts/extract-atlantico-map.mjs`: extrae vias que intersectan el departamento y colegios representados por nodos/vias; no incluye colegios representados por relaciones.
5. `npm run maps:build`: genera el catalogo, SQL y archivo de activacion combinado.
6. Aplicar SQL actualizado y desplegar codigo y datos juntos.

El script download-atlantico-map.mjs ofrece una alternativa puntual con Overpass, pero las instancias publicas pueden rechazarla. No es una dependencia del seguimiento en vivo.

## Pruebas

- `npm run test:maps`: limites variables, imprecision, ambiguedad, datos ausentes, muestra real y PostgreSQL embebido.
- `npx playwright test tests/driver.spec.ts`: flujo, alertas, cambio de limites y ausencia de alertas sin datos.
- `npm run build`: compilacion, TypeScript y paquete de produccion.

Falta una prueba de campo con los dispositivos y recorridos reales. No hay cobertura completa de todas las zonas del departamento.

Para ampliar datos se investigaron HERE Route Matching y TomTom Snap to Roads. Requieren cuenta y revisar cobertura/plan; no se contrataron servicios:
https://docs.here.com/routing/docs/detect-speeding-gps
https://docs.tomtom.com/snap-to-roads-api/documentation/snap-to-roads-api/synchronous-snap-to-roads

## Clasificacion SST

Se mantiene la identificacion conservadora de tramos. Las vias de categoria residencial se agrupan con escolar/residencial; eso no significa que se haya detectado un colegio. Las vias nacionales requieren referencia 25, 90 o 90A en el mapa, en vez de considerar nacional cualquier avenida principal. La etiqueta urbana del resto de tramos es una clasificacion operativa aproximada del catalogo, no una delimitacion oficial. No hay etiquetas explicitas de curvas ni zonas escolares en el extracto; el umbral de curvas queda configurado, pero no se inventa una deteccion de curva.
