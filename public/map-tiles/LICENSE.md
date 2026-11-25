# Datos geográficos de Atlántico

© OpenStreetMap contributors. Las cuadrículas (`<x>_<y>.json`, `index.json`) son una base de datos derivada de OpenStreetMap, distribuida bajo Open Database License (ODbL) 1.0: vías, zonas SST y lugares (colegios, iglesias, centros comerciales, salud, policía...).

- Atribución y licencia: https://www.openstreetmap.org/copyright
- Extracto original: https://download.geofabrik.de/south-america/colombia.html
- Preparación reproducible: `scripts/extract-atlantico-map.mjs`, `scripts/extract-atlantico-pois.mjs` y `scripts/build-road-catalog.mjs`.

`colegios-oficiales.json` es una base de datos aparte, bajo Creative Commons Atribución-CompartirIgual 4.0 (CC BY-SA 4.0): sedes educativas del Ministerio de Educación Nacional (MEN_SEDES_EDUCATIVAS_PREESCOLAR_BÁSICA_Y_MEDIA, https://www.datos.gov.co/d/x5ay-984n) de la Gobernación del Atlántico (https://www.datos.gov.co/d/7tec-5fhs) e instituciones de educación superior del MEN (MEN_INSTITUCIONES EDUCACIÓN SUPERIOR, https://www.datos.gov.co/d/n5yy-8nav; campo `u`, solo íconos), ubicadas por dirección con `scripts/geocode-schools.mjs`. La ubicación es aproximada.

Los límites son preventivos SST por categoría (nacional 70, urbana 50, curva 35, colegio 30). No constituyen un inventario oficial de señalización.
