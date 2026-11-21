# Activar «Entrar con Google» (Firebase, plan gratuito)

Sin esto la app funciona igual y guarda las listas en el navegador. Estos pasos crean cosas en tu
cuenta de Google, por eso los haces tú o los apruebas antes.

1. Entra a https://console.firebase.google.com con tu cuenta y crea un proyecto (por ejemplo
   `tiempos`). Google Analytics no hace falta. Queda en el plan Spark (gratis).
2. **Authentication** → Comenzar → Método de acceso → **Google** → Habilitar → elige el correo de
   asistencia → Guardar.
3. **Authentication** → Configuración → **Dominios autorizados**: agrega el dominio donde quede
   publicada la app (por ejemplo `miinfcl.github.io`). `localhost` ya viene.
4. **Firestore Database** → Crear base de datos → modo producción → región `southamerica-east1`
   (São Paulo) o la que prefieras.
5. Firestore → **Reglas**: pega el contenido de `firestore.rules` de esta carpeta y publica.
6. Configuración del proyecto (engranaje) → Tus apps → **Web** (`</>`) → registra la app (sin
   Hosting). Copia el objeto `firebaseConfig` que muestra.
7. Pega esos valores en `firebase-config.js`, en lugar de `null`:

   ```js
   window.FIREBASE_CONFIG = { apiKey: "…", authDomain: "…", projectId: "…", appId: "…" };
   ```

   Esa configuración es pública (va en cualquier app web de Firebase); lo que protege tus datos
   son las reglas del paso 5: cada cuenta solo ve sus propias listas.

Al entrar con Google, las listas que ya tenías en ese navegador se copian a tu cuenta. Los tiempos
en curso siguen guardándose en cada dispositivo; lo que se sincroniza son las listas.

Datos: `users/{tu-uid}/listas/{id}` con `nombre`, `personas` (hasta 100) y `actualizado`.
