// app_v2.js — minimal, safe

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
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const show = (el, on) => el && (el.style.display = on ? "" : "none");

// ---------- elements ----------
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

const profileUsername = $("profileUsername");
const profilePhotoUrl = $("profilePhotoUrl");
const btnSaveProfile = $("btnSaveProfile");

const postTitle = $("postTitle");
const postBody = $("postBody");
const imageUrl = $("imageUrl");
const videoUrl = $("videoUrl");
const btnPublish = $("btnPublish");

// ---------- auth ----------
btnLogin.onclick = () =>
  signInWithEmailAndPassword(auth, email.value, password.value);

btnRegister.onclick = () =>
  createUserWithEmailAndPassword(auth, email.value, password.value);

btnLogout.onclick = () => signOut(auth);

// ---------- auth state ----------
onAuthStateChanged(auth, async user => {
  if (!user) {
    show(authCard, true);
    show(profileCard, false);
    show(composerCard, false);
    show(feed, false);
    userLabel.textContent = "";
    return;
  }

  userLabel.textContent = user.email;
  show(authCard, false);
  btnLogout.classList.remove("hidden");

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
  loadPosts();
});

// ---------- profile ----------
btnSaveProfile.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  await setDoc(doc(db, "users", user.uid), {
    username: profileUsername.value,
    photoUrl: profilePhotoUrl.value || null,
    createdAt: serverTimestamp()
  });

  show(profileCard, false);
  show(composerCard, true);
  show(feed, true);
};

// ---------- post ----------
btnPublish.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  await addDoc(collection(db, "posts"), {
    title: postTitle.value,
    body: postBody.value,
    imageUrl: imageUrl.value || null,
    videoUrl: videoUrl.value || null,
    author: user.email,
    createdAt: serverTimestamp()
  });

  postTitle.value = "";
  postBody.value = "";
  loadPosts();
};

// ---------- feed ----------
async function loadPosts() {
  posts.innerHTML = "";
  const snap = await getDocs(collection(db, "posts"));
  snap.forEach(d => {
    const p = d.data();
    posts.innerHTML += `
      <div style="border:1px solid #333;padding:8px;margin:6px">
        <b>${p.title}</b>
        <p>${p.body}</p>
      </div>`;
  });
}
