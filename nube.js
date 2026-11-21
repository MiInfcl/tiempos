// Cuenta de Google y listas en Firestore. Solo se carga si firebase-config.js trae una configuración.
// Ruta de datos: users/{uid}/listas/{idLista} = { nombre, personas: [..], actualizado: ms }
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, collection, doc, setDoc, deleteDoc, getDocs, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let auth, db, uid = null, unsub = null;

const toList = (d) => {
  const x = d.data();
  return { id: d.id, name: x.nombre || 'Lista', people: Array.isArray(x.personas) ? x.personas : [], updatedAt: x.actualizado || 0 };
};
const col = () => collection(db, 'users', uid, 'listas');

export function start(config, { onUser, onLists }) {
  const app = initializeApp(config);
  auth = getAuth(app);
  auth.languageCode = 'es';
  db = initializeFirestore(app, { localCache: persistentLocalCache() });
  onAuthStateChanged(auth, (u) => {
    if (unsub) { unsub(); unsub = null; }
    uid = u ? u.uid : null;
    if (u) unsub = onSnapshot(col(), (snap) => onLists(snap.docs.map(toList)), (e) => console.warn(e));
    onUser(u ? { uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL } : null);
  });
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else throw e;
  }
}

export const signOut = () => fbSignOut(auth);

export async function saveList(l) {
  await setDoc(doc(col(), l.id), { nombre: l.name, personas: l.people, actualizado: l.updatedAt });
}

export async function deleteList(id) {
  await deleteDoc(doc(col(), id));
}

// Copia a la cuenta las listas del navegador que todavía no están en ella. Devuelve cuántas copió.
export async function migrate(localLists) {
  if (!uid || !localLists.length) return 0;
  const have = new Set((await getDocs(col())).docs.map((d) => d.id));
  const todo = localLists.filter((l) => !have.has(l.id));
  await Promise.all(todo.map((l) => saveList(l)));
  return todo.length;
}
