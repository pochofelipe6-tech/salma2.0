# Detección automática de vía y límite: Atlántico

La app reconoce en el teléfono la vía por la que va el conductor, le dice dónde está («Vas por Autopista de La Cordialidad, Galapa») y alerta en pantalla, con pitido y voz, si supera el límite preventivo SST del tramo.

## Límites SST

| Situación | Límite | Cómo se detecta |
|---|---|---|
| Vía nacional fuera de cascos urbanos | 70 km/h | Troncales y autopistas, rutas 25 y 90 (y variantes) y vías con nombre de corredor nacional: La Cordialidad, Vía Oriental, Circunvalar de la Prosperidad, Vía al Mar, Troncal de Occidente, etc. |
| Vía urbana en ciudad o pueblo | 50 km/h | Perímetro urbano de Barranquilla, barrios, centros poblados y usos residenciales/comerciales de OSM, más densidad de calles locales (pueblos sin polígonos). Una vía nacional que atraviesa un pueblo pasa a 50. |
| Colegio | 30 km/h | Hasta 50 m del predio del colegio u 80 m de su punto (393 colegios). No se aplica en autopistas fuera del casco urbano ni en puentes. |
| Curva | 35 km/h | Radio de giro calculado con la geometría: menos de 110 m en vías nacionales y 90 m en las demás, con giro total de 30° o más. Incluye 25 m de aproximación. Glorietas y rampas incluidas. |
| Zona residencial (`living_street`) | 30 km/h | Etiqueta de OSM. |
| Vía rural menor | 50 km/h | Caminos sin clasificar fuera de cascos urbanos. |

Las calles residenciales dentro de ciudades y pueblos son vía urbana (50). Si OSM tiene un límite publicado (`maxspeed`), la app lo muestra aparte y recuerda respetar la señalización. Los límites son preventivos SST; no reemplazan la señalización oficial.

«La Oriental» es la ruta 25 entre Malambo y Ponedera. En OSM figura como Autopista Malambo, Variante Palmar de Varela o Troncal de Occidente, y la app la anuncia como «Vía Oriental (…)».

## Funcionamiento

1. `npm run maps:build` clasifica cada vía en tramos (zona, límite, barrio y municipio) y genera cuadrículas de 0,02° (≈2,2 km) en `public/map-tiles/`: 647 archivos, 4,4 MB en total (la mayor pesa 132 KB sin comprimir).
2. Durante la ruta, el teléfono descarga las cuadrículas en ≈1,5 km alrededor y reconoce la vía en cada lectura GPS, sin esperar al servidor. Así la alerta funciona aunque la conexión sea lenta.
3. El reconocimiento combina distancia, rumbo de marcha, sentido de las vías de una sola dirección y continuidad con la vía anterior. Un salto a una vía paralela sin cambio de rumbo se confirma con dos lecturas. Requiere precisión GPS de 35 m o mejor.
4. Al haber exceso, el teléfono envía a `POST /api/event` el tramo identificado. El servidor comprueba con las mismas cuadrículas que el tramo esté junto a la posición GPS y que la velocidad supere su límite. Se guarda un evento por episodio y por vía.
5. Las zonas confirmadas por el administrador (`GET /api/confirmed-zones`) tienen prioridad sobre el mapa base, y se aplica la más restrictiva.

`next.config.mjs` incluye las cuadrículas en la función del servidor (`outputFileTracingIncludes`). No requiere migraciones nuevas: los eventos se guardan con `zone` y la base calcula `limit_speed` (migraciones 001 a 009).

## Voz y avisos

- Al iniciar la ruta: «Iniciando ruta. Te diré por dónde vas».
- Al cambiar de vía: «Vas por …, barrio, municipio. Vía nacional, límite 70 kilómetros por hora». Al cambiar solo el límite en la misma vía, anuncia la nueva zona (por ejemplo, zona escolar).
- Durante un exceso: aviso en pantalla «Reduce la velocidad a N km/h», pitido cada 5 s y voz cada 15 s.
- El conductor puede desactivar la voz; la preferencia se guarda en el teléfono.

## Datos y actualización

Fuente: https://download.geofabrik.de/south-america/colombia.html. Polígono departamental: OpenStreetMap/Nominatim, relación 1315209 (CO-ATL). Licencia ODbL 1.0: https://www.openstreetmap.org/copyright

1. `node scripts/download-colombia-map.mjs`: descarga y verifica el PBF de Colombia en `data/maps/` (fuera de Git).
2. `npm install --prefix data/map-tools --no-audit --no-fund osm-pbf-parser`.
3. Obtener `data/maps/atlantico-boundary.json` desde https://nominatim.openstreetmap.org/search?state=Atl%C3%A1ntico&country=Colombia&format=jsonv2&polygon_geojson=1&limit=1
4. `npm run maps:extract`: dos pasadas sobre el PBF (≈45 s). Extrae vías, colegios, barrios, centros poblados, municipios, localidades, perímetro urbano y usos del suelo. El resumen queda en `docs/atlantico-map-coverage.json`.
5. `npm run maps:build`: genera `public/map-tiles/` y `assets/maps/atlantico-schools.json` (≈10 s).
6. `npm run test:maps` y desplegar.

## Pruebas

- `npm run test:maps`: casos sintéticos (cruces, calzadas paralelas, vía principal frente a calle de servicio, giros, zonas confirmadas) y recorridos simulados con ruido GPS de ±6 m sobre La Cordialidad, la Oriental, la Prosperidad y calles urbanas. Exige 90 % o más de lecturas en la vía correcta (actualmente 98–99,9 %).
- `npx playwright test tests/driver.spec.ts`: flujo, «Vas por», alerta con el límite de cada zona, cambio de límite y ausencia de alerta sin datos.
- `npm run build`: compilación y verificación de que las cuadrículas están en la función de la API.

## Limitaciones

- Depende de la calidad de OpenStreetMap: colegios o barrios no mapeados no se reconocen. El 90 % de las calles urbanas de Barranquilla tienen barrio asignado.
- Requiere la app abierta y GPS con precisión de 35 m o mejor. El seguimiento en segundo plano no está garantizado.
- Falta validar en campo con recorridos reales.

## Registrar zonas del recorrido

El modo de registro sigue disponible (migración 009). Propone tramos, colegios y curvas al administrador, que puede confirmarlos con su categoría y margen. Las zonas confirmadas se descargan al teléfono y tienen prioridad sobre la clasificación automática. `npm run test:survey` verifica propuestas, aislamiento, confirmación solo por el administrador y alertas posteriores.
