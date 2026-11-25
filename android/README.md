# App Android · Ruta SST

App nativa mínima que abre la versión publicada (`https://salma20-beta.vercel.app/`) en un WebView con:

- Permiso de ubicación del sistema conectado al GPS de la página.
- Desde la versión 1.1, al tocar «Iniciar ruta» o «Reanudar GPS» pide el permiso de ubicación y, si el GPS está apagado, muestra el aviso de Google «Activa la ubicación» para encenderlo de un toque. En celulares sin Google Play Services, o si el permiso quedó en «No volver a preguntar», ofrece abrir Ajustes. La página espera la respuesta (`SalmaaAndroid.ensureLocation` → `window.salmaaLocationResult`) antes de leer el GPS.
- Pantalla siempre encendida mientras la app está abierta.
- Voz nativa de Android (TextToSpeech, español) para «Vas por…» y las alertas: el WebView no trae `speechSynthesis`, así que la página usa el puente `window.SalmaaAndroid`.
- Sirena de alerta sin necesidad de tocar la pantalla primero.
- Enlaces externos en el navegador y pantalla de «Sin conexión» con botón para reintentar.
- Desde la versión 1.2:
  - La página queda debajo de la barra de estado y encima de la barra de navegación (Android 15 dibuja la app de borde a borde): la hora y la batería ya no tapan la barra «Vas por».
  - El botón «Ampliar mapa» pone el mapa en pantalla completa; el botón Atrás sale de ella.
  - Si el motor web se cae (por ejemplo, sin memoria con el mapa 3D), la app lo recrea y recarga en lugar de cerrarse.
  - En la compilación de depuración se puede inspeccionar la página desde Chrome (`chrome://inspect`) con el celular conectado por USB.

La lógica, los mapas y las alertas son los de la web: al publicar en Vercel, la app se actualiza sin reinstalar. Los cambios del código nativo (como el aviso para encender el GPS de la 1.1) sí requieren instalar la nueva APK; sube `versionCode` para que Android la instale como actualización.

## Requisitos

- JDK 17 o superior (probado con Temurin 21).
- Android SDK con `platforms;android-35` y `build-tools;35.0.0`. Indica su ruta en `local.properties` (`sdk.dir=...`) o en `ANDROID_HOME`.

## Compilar

```sh
cd android
./gradlew assembleDebug                      # Windows: gradlew.bat assembleDebug
./gradlew assembleDebug -PappUrl=https://otra-direccion.vercel.app/
```

El APK queda en `app/build/outputs/apk/debug/app-debug.apk`, firmado con la clave de depuración. Para publicarlo en la web, cópialo a `public/RutaSST.apk` y súbelo a `main`. Para publicarlo en Google Play hay que crear una firma de publicación (`assembleRelease` con keystore propio).

## Instalar en el celular

1. Desde el celular, abre https://salma20-beta.vercel.app/RutaSST.apk en Chrome y abre el archivo descargado. También puedes pasar el APK por cable USB, Drive, WhatsApp o correo.
2. Android pedirá permitir «Instalar apps desconocidas» para la aplicación con la que lo abriste. Acéptalo e instala.
3. Abre «Ruta SST», permite la ubicación («Mientras se usa la app» y «Ubicación precisa») e inicia sesión.

Mantén la app en primer plano durante la ruta: si se minimiza o se bloquea el teléfono, Android puede pausar el GPS de la página.
