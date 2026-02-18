

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyDBtwH0T67TNWxYGHe0NtFo-FhdrfTDuEw",
  authDomain: "gitforum12.firebaseapp.com",
  projectId: "gitforum12",
  appId: "1:12183523056:web:4a6b9fb9713fc9af22bc35"
};

const app = initializeApp(firebaseConfig);

// Optional: Firebase App Check (reCAPTCHA v3) — SITE KEY only
const APP_CHECK_SITE_KEY = "6LfnQG8sAAAAAGB5sEot-Yufy0oNyaGA5ydqUcWT"; // <-- put your reCAPTCHA v3 SITE KEY here (NOT secret)
if (APP_CHECK_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);

