import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (id) => document.getElementById(id);
const msg = (el, text) => el && (el.textContent = text || "");

const email = $("email");
const password = $("password");
const btnLogin = $("btnLogin");
const btnRegister = $("btnRegister");
const btnAnon = $("btnAnon");
const authMsg = $("authMsg");

const phoneNumber = $("phoneNumber");
const btnSendCode = $("btnSendCode");
const smsCode = $("smsCode");
const btnVerifyCode = $("btnVerifyCode");

let confirmationResult = null;
let recaptchaVerifier = null;

function explain(e) {
  const code = e?.code || "";
  if (code === "auth/unauthorized-domain") {
    return "Add only your host in Firebase Authorized domains, for example: pblv12a3.github.io";
  }
  if (code === "auth/operation-not-allowed") {
    return "Enable this sign-in method in Firebase Authentication → Sign-in method.";
  }
  return e?.message || String(e || "Unknown error");
}

async function safe(fn) {
  try {
    msg(authMsg, "");
    await fn();
  } catch (e) {
    console.error(e);
    msg(authMsg, explain(e));
  }
}

btnLogin.onclick = () => safe(() =>
  signInWithEmailAndPassword(auth, email.value.trim(), password.value.trim())
);

btnRegister.onclick = () => safe(() =>
  createUserWithEmailAndPassword(auth, email.value.trim(), password.value.trim())
);

btnAnon.onclick = () => safe(() => signInAnonymously(auth));

function ensureRecaptcha() {
  if (recaptchaVerifier) return;
  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
}

btnSendCode.onclick = () => safe(async () => {
  ensureRecaptcha();
  const phone = phoneNumber.value.trim();
  if (!phone.startsWith("+")) throw new Error("Use format like +1 312 555 1234");
  confirmationResult = await signInWithPhoneNumber(auth, phone, recaptchaVerifier);
  msg(authMsg, "Code sent. Enter it below.");
});

btnVerifyCode.onclick = () => safe(async () => {
  if (!confirmationResult) throw new Error("Send the code first.");
  await confirmationResult.confirm(smsCode.value.trim());
});

onAuthStateChanged(auth, (user) => {
  if (user) location.href = "index.html";
});
