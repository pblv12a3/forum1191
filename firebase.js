// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Paste your Firebase web app config here:
const firebaseConfig = {
  apiKey: "AIzaSyDBtwH0T67TNWxYGHe0NtFo-FhdrfTDuEw",
  authDomain: "gitforum12.firebaseapp.com",
  projectId: "gitforum12",
  appId: "1:12183523056:web:4a6b9fb9713fc9af22bc35",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
