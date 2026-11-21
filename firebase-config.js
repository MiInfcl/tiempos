// Configuración PÚBLICA de Firebase (proyecto «tiempos-921ec», plan gratuito Spark).
// No es una clave secreta: el acceso a los datos lo protegen las reglas de firestore.rules.
// Si se pone en null, la app funciona sin cuenta y guarda las listas en el navegador.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCfTyH5dbNtl73eAOuibQ7Lvm-6sDQgIzM",
  // La página intermedia de Google vive en el propio sitio (app/__/auth/), así la pantalla
  // de Google dice «tiempos.taller.ink» y no «tiempos-921ec.firebaseapp.com».
  authDomain: "tiempos.taller.ink",
  projectId: "tiempos-921ec",
  storageBucket: "tiempos-921ec.firebasestorage.app",
  messagingSenderId: "529865819187",
  appId: "1:529865819187:web:b3355db3a06cb0237b4f46",
};
