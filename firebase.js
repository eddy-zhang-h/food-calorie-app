import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc
} from "firebase/firestore";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signUp(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

export async function loadCloudRecords(userId) {
  const recordsRef = collection(db, "users", userId, "mealRecords");
  const snapshot = await getDocs(query(recordsRef, orderBy("createdAt", "desc")));
  return snapshot.docs.map((recordDoc) => ({
    id: recordDoc.id,
    ...recordDoc.data()
  }));
}

export async function saveCloudRecord(userId, record) {
  await setDoc(doc(db, "users", userId, "mealRecords", record.id), record);
}

export async function deleteCloudRecord(userId, recordId) {
  await deleteDoc(doc(db, "users", userId, "mealRecords", recordId));
}
