import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCchHGv_dbSOh4XDB67x2A2REw5h1f07OU",
  authDomain: "cloudusb-f5f7e.firebaseapp.com",
  projectId: "cloudusb-f5f7e",
  storageBucket: "cloudusb-f5f7e.firebasestorage.app",
  messagingSenderId: "301912742557",
  appId: "1:301912742557:web:placeholder"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function test() {
  console.log("Signing in anonymously...");
  const userCred = await signInAnonymously(auth);
  console.log("Signed in anonymously with UID:", userCred.user.uid);

  // Check settings/config
  try {
    const cfgSnap = await getDoc(doc(db, "vaults", "default", "settings", "config"));
    console.log("Config exists:", cfgSnap.exists(), cfgSnap.data());
  } catch (err) {
    console.log("Read config error:", err.message);
  }

  // Check sources
  try {
    const srcSnap = await getDocs(collection(db, "vaults", "default", "sources"));
    console.log("Sources count:", srcSnap.docs.length);
    srcSnap.docs.forEach(d => console.log(" - Source:", d.id, d.data()));
  } catch (err) {
    console.log("Read sources error:", err.message);
  }

  // Check files
  try {
    const filesSnap = await getDocs(collection(db, "vaults", "default", "files"));
    console.log("Files count:", filesSnap.docs.length);
    filesSnap.docs.forEach(d => console.log(" - File:", d.id, d.data().originalName, d.data().relativePath));
  } catch (err) {
    console.log("Read files error:", err.message);
  }

  // Check contentHashes
  try {
    const hashesSnap = await getDocs(collection(db, "vaults", "default", "contentHashes"));
    console.log("ContentHashes count:", hashesSnap.docs.length);
    hashesSnap.docs.forEach(d => console.log(" - Hash:", d.id));
  } catch (err) {
    console.log("Read hashes error:", err.message);
  }
}

test().catch(console.error);
