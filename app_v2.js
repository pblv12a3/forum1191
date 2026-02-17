// app_v2.js — safe auth errors (no uhoh redirect for normal auth failures)

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
const msg = (el, text) => { if (el) el.textContent = text || ""; };

const authCard = $("authCard");
const profileCard = $("profileCard");
const composerCard = $("composerCard");
const feed = $("feed");
const posts = $("posts");

const email = $("email");
const password = $("password");
const btnLogin = $("btnLogin");
const btnRegister = $("btnRegister");
const btnLogout = $("btnLogout");
const userLabel = $("userLabel");
const authMsg = $("authMsg");

const profileUsername = $("profileUsername");
const profilePhotoUrl = $("profilePhotoUrl");
const btnSaveProfile = $("btnSaveProfile");
const profileMsg = $("profileMsg");

const postTitle = $("postTitle");
const postBody = $("postBody");
const imageUrl = $("imageUrl");
const videoUrl = $("videoUrl");
const btnPublish = $("btnPublish");
const publishMsg = $("publishMsg");

function explainAuthError(e) {
  const code = e?.code || "";
  if (code === "auth/unauthorized-domain") {
    return "Unauthorized domain. Add YOURNAME.github.io to Firebase Auth → Settings → Authorized domains.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/Password sign-in is disabled. Enable it in Firebase Authentication → Sign-in method.";
  }
  if (code === "auth/invalid-email") return "Invalid email address.";
  if (code === "auth/wrong-password") return "Wrong password.";
  if (code === "auth/user-not-found") return "No account found for that email.";
  if (code === "auth/email-already-in-use") return "That email is already registered.";
  if (code === "auth/weak-password") return "Password too weak (min 6 chars).";
  return e?.message || String(e || "Unknown error");
}

async function safe(fn, showEl) {
  try {
    msg(showEl, "");
    await fn();
  } catch (e) {
    console.error(e);
    msg(showEl, explainAuthError(e));
  }
}

// --- buttons ---
btnLogin.onclick = () => safe(
  () => signInWithEmailAndPassword(auth, email.value.trim(), password.value.trim()),
  authMsg
);

btnRegister.onclick = () => safe(
  () => createUserWithEmailAndPassword(auth, email.value.trim(), password.value.trim()),
  authMsg
);

btnLogout.onclick = () => safe(() => signOut(auth), authMsg);

// --- auth state ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    msg(userLabel, "");
    show(btnLogout, false);
    show(authCard, true);
    show(profileCard, false);
    show(composerCard, false);
    show(feed, false);
    if (posts) posts.innerHTML = "";
    return;
  }

  msg(userLabel, user.email);
  show(btnLogout, true);
  show(authCard, false);

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    show(profileCard, true);
    show(composerCard, false);
    show(feed, false);
    return;
  }

  show(profileCard, false);
  show(composerCard, true);
  show(feed, true);
  await loadPosts();
});

// --- profile ---
btnSaveProfile.onclick = () => safe(async () => {
  const user = auth.currentUser;
  if (!user) return;

  const username = profileUsername.value.trim();
  if (username.length < 3) throw new Error("Username must be at least 3 characters.");

  await setDoc(doc(db, "users", user.uid), {
    username,
    photoUrl: profilePhotoUrl.value.trim() || null,
    createdAt: serverTimestamp()
  }, { merge: true });

  show(profileCard, false);
  show(composerCard, true);
  show(feed, true);
}, profileMsg);

// --- post ---
btnPublish.onclick = () => safe(async () => {
  const user = auth.currentUser;
  if (!user) return;

  await addDoc(collection(db, "posts"), {
    title: postTitle.value.trim(),
    body: postBody.value.trim(),
    imageUrl: imageUrl.value.trim() || null,
    videoUrl: videoUrl.value.trim() || null,
    author: user.email,
    createdAt: serverTimestamp()
  });

  postTitle.value = "";
  postBody.value = "";
  imageUrl.value = "";
  videoUrl.value = "";

  msg(publishMsg, "Posted!");
  await loadPosts();
}, publishMsg);

// --- feed ---
async function loadPosts() {
  if (!posts) return;
  posts.innerHTML = "";

  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  snap.forEach(d => {
    const p = d.data();
    const div = document.createElement("div");
    div.style.border = "1px solid #333";
    div.style.padding = "10px";
    div.style.margin = "8px 0";
    div.innerHTML = `
      <b>${(p.title || "").replaceAll("<","&lt;")}</b>
      <div style="opacity:.7;font-size:12px">${p.author || ""}</div>
      <p>${(p.body || "").replaceAll("<","&lt;")}</p>
    `;
    posts.appendChild(div);
  });
}
