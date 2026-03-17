// Firebase v10 (modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Your config (already correct)
const firebaseConfig = {
  apiKey: "AIzaSyDBtwH0T67TNWxYGHe0NtFo-FhdrfTDuEw",
  authDomain: "gitforum12.firebaseapp.com",
  projectId: "gitforum12",
  storageBucket: "gitforum12.firebasestorage.app",
  messagingSenderId: "12183523056",
  appId: "1:12183523056:web:e2b6faff9a1b3f6722bc35"
};

// Init
const app = initializeApp(firebaseConfig);

// Export services (VERY IMPORTANT)
export const auth = getAuth(app);
export const db = getFirestore(app);