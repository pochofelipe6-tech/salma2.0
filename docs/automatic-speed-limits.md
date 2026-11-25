# Detección automática de vía y límite: Atlántico

La app reconoce en el teléfono la vía por la que va el conductor, le dice dónde está («Vas por Autopista de La Cordialidad, Galapa») y alerta en pantalla, con sirena y voz, si supera el límite preventivo SST del tramo.

## Límites SST

| Situación | Límite | Cómo se detecta |
|---|---|---|
| Vía nacional fuera de cascos urbanos | 70 km/h | Troncales y autopistas, rutas 25 y 90 (y variantes) y vías con nombre de corredor nacional: La Cordialidad, Vía Oriental, Circunvalar de la Prosperidad, Vía al Mar, Troncal de Occidente, etc. |
| Vía urbana en ciudad o pueblo | 50 km/h | Perímetro urbano de Barranquilla, barrios, centros poblados y usos residenciales/comerciales de OSM, más densidad de calles locales (pueblos sin polígonos). Una vía nacional que atraviesa un pueblo pasa a 50. |
| Colegio | 30 km/h | Hasta 50 m del predio u 80 m del punto de los 1.039 colegios de OpenStreetMap (colegios, jardines, guarderías y edificios escolares), y hasta 80 m de las 651 sedes oficiales que OSM no tiene (ver «Colegios oficiales»). No se aplica en autopistas fuera del casco urbano ni en puentes. Con esto hay zona escolar en 22 de los 25 municipios. |
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

`next.config.mjs` incluye las cuadrículas en la función del servidor (`outputFileTracingIncludes`). No requiere migraciones nuevas: los eventos se guardan con `zone` y la base calcula `limit_speed`. El antiguo registro manual de zonas (migración 009) ya no se usa; sus tablas quedan en la base sin cambios.

## Colegios oficiales

OpenStreetMap tenía colegios en solo 13 municipios (249 de 393 en Barranquilla). Para el resto del departamento se usan las sedes oficiales de datos.gov.co (licencia CC BY-SA 4.0): [MEN_SEDES_EDUCATIVAS_PREESCOLAR_BÁSICA_Y_MEDIA](https://www.datos.gov.co/d/x5ay-984n) del Ministerio de Educación (1.240 sedes del Atlántico) y el [listado de instituciones de la Gobernación del Atlántico](https://www.datos.gov.co/d/7tec-5fhs). Sus coordenadas vienen redondeadas a ≈1 km, así que `npm run maps:schools` ubica cada sede por su dirección: «CL 15 15 82» es la Calle 15 a 82 m de la Carrera 15, hacia la Carrera 16, usando las calles numeradas del extracto OSM de cada municipio. Reconoce las calles «Sur» de Barranquilla («CR 3SUR # 90-06» es la Carrera 3 Sur) y, si la transversal no está en el mapa o no se toca con la calle, estima la posición entre las transversales vecinas (entre la Carrera 18 y la 20 para la 19). Ubica 936 sedes únicas (53 por estimación); frente a los colegios que OSM sí tiene, la mediana del error es 17 m y el 80 % queda a 150 m o menos del predio. Las rurales sin dirección («VEREDA…») y las de dirección sin número («CL 30 AU AEROPUERTO») no se pueden ubicar.

También ubica las universidades y corporaciones del [listado de educación superior del MEN](https://www.datos.gov.co/d/n5yy-8nav) (13 de 18 con sede en el Atlántico). Solo se muestran como íconos: no generan zona escolar.

Por licencia, las sedes oficiales no se mezclan con las cuadrículas (ODbL): quedan aparte en `public/map-tiles/colegios-oficiales.json` (651 colegios en `s` y 7 universidades en `u`, solo los que OSM no tiene: se descarta una sede si OSM tiene el mismo nombre a menos de 1,5 km o un colegio a menos de 40 m) y `lib/school-zones.ts` las cruza al momento con la vía reconocida, igual en el teléfono y en el servidor.

## Lugares y edificios

- `npm run maps:pois` extrae de OSM 1.677 lugares del Atlántico (colegios, universidades y corporaciones reconocidas también por su nombre, sin los edificios internos de los campus, iglesias, centros comerciales, salud, policía, bomberos, alcaldías, mercados, terminales y escenarios deportivos). Van en las cuadrículas (campo `p`) y los mapas 2D y 3D los muestran con ícono y nombre; los colegios oficiales también.
- `npm run maps:buildings` completa los edificios que OSM no tiene con las huellas de Microsoft Global ML Building Footprints (ODbL): 128.354 edificios en `public/building-tiles/` (5 MB), sobre todo en los pueblos (Sabanalarga +20.488, Baranoa +10.625, Palmar de Varela +7.262). Se descartan las que se cruzan con un edificio de OSM. Las huellas se descargan de https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv (Colombia, quadkeys 032230100–032230103) a `data/maps/ms-buildings/`.

## Mapa 2D

El mapa de calles muestra los edificios en todo zoom con color por altura, sombra y contorno, las vías coloreadas por zona SST (con las zonas de los colegios oficiales) con su leyenda durante la ruta, y los íconos de lugares.

## Mapa 3D

El botón 3D muestra relieve (AWS Terrain Tiles), cielo, vías con asfalto, bordillo y línea de carril, con el color de su zona SST en los bordes; la vía actual se tiñe completa. Cerca del conductor (≈750 m) los edificios de OpenFreeMap y los complementarios se separan casa por casa, con su altura (o de uno a tres pisos) y colores de fachada, y se siembran árboles 3D en parques, zonas verdes y aceras (decorativos, nunca encima de edificios o calles). La cámara sigue al vehículo con el rumbo arriba, hay estela del recorrido, íconos de lugares, modo día/noche e indicador de velocidad y límite.

## Voz y avisos

- Al iniciar la ruta: «Iniciando ruta. Te diré por dónde vas».
- Al cambiar de vía: «Vas por …, barrio, municipio. Vía nacional, límite 70 kilómetros por hora». Al cambiar solo el límite en la misma vía, anuncia la nueva zona (por ejemplo, zona escolar).
- Durante un exceso: aviso en pantalla «Reduce la velocidad a N km/h», sirena cada 5 s y voz cada 15 s (la voz espera a que termine la sirena). Si entra a la vía con exceso, la anuncia al volver al límite.
- El conductor puede desactivar la voz; la preferencia se guarda en el teléfono.

## Datos y actualización

Fuente: https://download.geofabrik.de/south-america/colombia.html. Polígono departamental: OpenStreetMap/Nominatim, relación 1315209 (CO-ATL). Licencia ODbL 1.0: https://www.openstreetmap.org/copyright

1. `node scripts/download-colombia-map.mjs`: descarga y verifica el PBF de Colombia en `data/maps/` (fuera de Git).
2. `npm install --prefix data/map-tools --no-audit --no-fund osm-pbf-parser`.
3. Obtener `data/maps/atlantico-boundary.json` desde https://nominatim.openstreetmap.org/search?state=Atl%C3%A1ntico&country=Colombia&format=jsonv2&polygon_geojson=1&limit=1
4. `npm run maps:extract`: dos pasadas sobre el PBF (≈45 s). Extrae vías, colegios, barrios, centros poblados, municipios, localidades, perímetro urbano y usos del suelo. El resumen queda en `docs/atlantico-map-coverage.json`.
5. `npm run maps:pois`: lugares del Atlántico (≈75 s).
6. `npm run maps:schools`: descarga las sedes oficiales y las instituciones de educación superior de datos.gov.co y las ubica por dirección (≈30 s).
7. `npm run maps:build`: genera `public/map-tiles/` (cuadrículas con vías, zonas y lugares, y `colegios-oficiales.json`) (≈15 s).
8. `npm run maps:buildings`: edificios complementarios en `public/building-tiles/` (≈3 min; requiere las huellas de Microsoft en `data/maps/ms-buildings/`).
9. `npm run test:maps` y desplegar.

## Pruebas

- `npm run test:maps`: casos sintéticos (cruces, calzadas paralelas, vía principal frente a calle de servicio y giros) y recorridos simulados con ruido GPS de ±6 m sobre La Cordialidad, la Oriental, la Prosperidad y calles urbanas. Exige 90 % o más de lecturas en la vía correcta (actualmente 98–99,9 %).
- `npx playwright test tests/driver.spec.ts`: flujo, «Vas por», alerta con el límite de cada zona, cambio de límite y ausencia de alerta sin datos.
- `npm run build`: compilación y verificación de que las cuadrículas están en la función de la API.

## Limitaciones

- Depende de la calidad de OpenStreetMap y de los listados oficiales: un colegio que no esté en ninguno de los dos, o una sede rural sin dirección, no genera zona escolar. Las sedes oficiales ubicadas por dirección pueden quedar en otra calle (≈11 % a más de 400 m del predio real). El 90 % de las calles urbanas de Barranquilla tienen barrio asignado.
- Los edificios complementarios se detectaron automáticamente en imágenes satelitales (Microsoft, 2026) y los árboles 3D son decorativos.
- Requiere la app abierta y GPS con precisión de 35 m o mejor. El seguimiento en segundo plano no está garantizado.
- Falta validar en campo con recorridos reales.
