import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInAnonymously,
  RecaptchaVerifier,
  signInWithPhoneNumber
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
  orderBy,
  limit,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const msg = (el, text) => el && (el.textContent = text || "");

const authCard = $("authCard");
const profileCard = $("profileCard");
const composerCard = $("composerCard");
const feed = $("feed");
const postsEl = $("posts");

const email = $("email");
const password = $("password");
const btnLogin = $("btnLogin");
const btnRegister = $("btnRegister");
const btnLogout = $("btnLogout");
const btnAnon = $("btnAnon");
const userLabel = $("userLabel");
const authMsg = $("authMsg");

const phoneNumber = $("phoneNumber");
const btnSendCode = $("btnSendCode");
const smsCode = $("smsCode");
const btnVerifyCode = $("btnVerifyCode");

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

const replyDialog = $("replyDialog");
const replyToTitle = $("replyToTitle");
const replyText = $("replyText");
const btnSendReply = $("btnSendReply");
const replyMsg = $("replyMsg");

let confirmationResult = null;
let recaptchaVerifier = null;
let replyingToPostId = null;
let replyingToPostTitle = "";

function defaultPersonAvatar(seed) {
  const s = encodeURIComponent(seed || "anonymous");
  return `https://api.dicebear.com/9.x/personas/svg?seed=${s}`;
}

function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function explainAuthError(e) {
  const code = e?.code || "";
  if (code === "auth/unauthorized-domain") return "Unauthorized domain. Add pblv12a3.github.io in Firebase Auth → Settings → Authorized domains.";
  if (code === "auth/operation-not-allowed") return "Enable this sign-in method in Firebase Authentication → Sign-in method.";
  return e?.message || String(e || "Unknown error");
}

async function safe(fn, el = authMsg) {
  try { msg(el, ""); await fn(); }
  catch (e) { console.error(e); msg(el, explainAuthError(e)); }
}

async function getMyProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function ensureProfileUI(user) {
  const prof = await getMyProfile(user.uid);
  const hasProfile = !!(prof && prof.username);
  show(profileCard, !hasProfile);
  show(composerCard, hasProfile);
  show(feed, hasProfile);
  if (!hasProfile) {
    profileUsername.value = prof?.username || "";
    profilePhotoUrl.value = prof?.photoUrl || "";
  }
}

// -------- Auth buttons --------
btnLogin.onclick = () => safe(() => signInWithEmailAndPassword(auth, email.value.trim(), password.value.trim()));
btnRegister.onclick = () => safe(() => createUserWithEmailAndPassword(auth, email.value.trim(), password.value.trim()));
btnLogout.onclick = () => safe(() => signOut(auth));
btnAnon.onclick = () => safe(() => signInAnonymously(auth));

// -------- Phone auth (reCAPTCHA verifier) --------
function ensureRecaptcha() {
  if (recaptchaVerifier) return;
  recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
}

btnSendCode.onclick = () => safe(async () => {
  ensureRecaptcha();
  const phone = phoneNumber.value.trim();
  if (!phone.startsWith("+")) throw new Error("Use full international format, e.g. +1 312 555 1234");
  confirmationResult = await signInWithPhoneNumber(auth, phone, recaptchaVerifier);
  msg(authMsg, "Code sent. Enter it below.");
});

btnVerifyCode.onclick = () => safe(async () => {
  if (!confirmationResult) throw new Error("Send the code first.");
  const code = smsCode.value.trim();
  if (code.length < 4) throw new Error("Enter the SMS code.");
  await confirmationResult.confirm(code);
  msg(authMsg, "Phone login successful.");
});

// -------- Save profile --------
btnSaveProfile.onclick = () => safe(async () => {
  const user = auth.currentUser;
  if (!user) return;

  const username = profileUsername.value.trim();
  if (username.length < 3) throw new Error("Username must be at least 3 characters.");
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Username can contain letters, numbers, _ . - only.");

  const photoUrlRaw = profilePhotoUrl.value.trim();
  const photoUrl = photoUrlRaw ? normalizeUrl(photoUrlRaw) : null;
  if (photoUrlRaw && !photoUrl) throw new Error("Profile photo must be a valid http/https URL.");

  await setDoc(doc(db, "users", user.uid), {
    username,
    photoUrl: photoUrl || null,
    updatedAt: serverTimestamp(),
    isAnonymous: !!user.isAnonymous
  }, { merge: true });

  await ensureProfileUI(user);
  await loadPosts();
}, profileMsg);

// -------- Post --------
btnPublish.onclick = () => safe(async () => {
  const user = auth.currentUser;
  if (!user) return;

  const prof = await getMyProfile(user.uid);
  if (!prof?.username) throw new Error("Set your username first.");

  await addDoc(collection(db, "posts"), {
    title: postTitle.value.trim(),
    body: postBody.value.trim(),
    imageUrl: normalizeUrl(imageUrl.value) || null,
    videoUrl: normalizeUrl(videoUrl.value) || null,
    authorUid: user.uid,
    authorUsername: prof.username,
    authorPhotoUrl: prof.photoUrl || null,
    createdAt: serverTimestamp(),
    likeCount: 0,
    dislikeCount: 0
  });

  postTitle.value = "";
  postBody.value = "";
  imageUrl.value = "";
  videoUrl.value = "";

  msg(publishMsg, "Posted!");
  await loadPosts();
}, publishMsg);

// -------- Voting --------
// posts/{postId}/votes/{uid} = { value: 1 | -1 | 0 }
async function getMyVote(postId) {
  const user = auth.currentUser;
  if (!user) return 0;
  const vref = doc(db, "posts", postId, "votes", user.uid);
  const snap = await getDoc(vref);
  return snap.exists() ? (snap.data().value || 0) : 0;
}

async function vote(postId, value) {
  const user = auth.currentUser;
  if (!user) return;

  const postRef = doc(db, "posts", postId);
  const voteRef = doc(db, "posts", postId, "votes", user.uid);

  const [postSnap, voteSnap] = await Promise.all([getDoc(postRef), getDoc(voteRef)]);
  if (!postSnap.exists()) return;

  const post = postSnap.data();
  const prev = voteSnap.exists() ? (voteSnap.data().value || 0) : 0;
  const next = (prev === value) ? 0 : value;

  let likeCount = post.likeCount || 0;
  let dislikeCount = post.dislikeCount || 0;

  if (prev === 1) likeCount--;
  if (prev === -1) dislikeCount--;
  if (next === 1) likeCount++;
  if (next === -1) dislikeCount++;

  likeCount = Math.max(0, likeCount);
  dislikeCount = Math.max(0, dislikeCount);

  await Promise.all([
    updateDoc(postRef, { likeCount, dislikeCount }),
    setDoc(voteRef, { value: next }, { merge: true })
  ]);

  await loadPosts();
}

// -------- Replies --------
function openReply(postId, title) {
  replyingToPostId = postId;
  replyingToPostTitle = title || "Post";
  if (replyToTitle) replyToTitle.textContent = `Reply to: ${replyingToPostTitle}`;
  if (replyText) replyText.value = "";
  msg(replyMsg, "");
  replyDialog?.showModal?.();
}

btnSendReply.onclick = () => safe(async () => {
  const user = auth.currentUser;
  if (!user || !replyingToPostId) return;

  const prof = await getMyProfile(user.uid);
  if (!prof?.username) throw new Error("Set your username first.");

  const text = (replyText.value || "").trim();
  if (!text) throw new Error("Reply text is required.");

  await addDoc(collection(db, "posts", replyingToPostId, "replies"), {
    text,
    authorUid: user.uid,
    authorUsername: prof.username,
    authorPhotoUrl: prof.photoUrl || null,
    createdAt: serverTimestamp()
  });

  replyDialog?.close?.();
  await loadPosts();
}, replyMsg);

async function loadReplies(postId) {
  const q = query(
    collection(db, "posts", postId, "replies"),
    orderBy("createdAt", "desc"),
    limit(5)
  );
  const snap = await getDocs(q);
  const out = [];
  snap.forEach(d => out.push(d.data()));
  return out;
}

// -------- Feed --------
async function loadPosts() {
  postsEl.innerHTML = "";

  // Try the "new" query first (new posts have createdAt)
  let docs = [];
  try {
    const qNew = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
    const snapNew = await getDocs(qNew);
    docs = snapNew.docs;
  } catch (e) {
    // If orderBy fails due to missing createdAt on older docs, fall back:
    console.warn("Falling back to unordered posts fetch:", e);
    const snapAny = await getDocs(collection(db, "posts"));
    docs = snapAny.docs;
  }

  // Client-side sort: createdAt desc if present
  docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });

  for (const d of docs.slice(0, 50)) {
    const p = d.data();
    const postId = d.id;

    // Backward-compatible author display:
    // - prefer authorUsername saved on post
    // - else use legacy "author" (email)
    // - else show "Anonymous"
    const displayName = p.authorUsername || p.author || "Anonymous";

    // Backward-compatible avatar:
    const avatar =
      p.authorPhotoUrl ||
      defaultPersonAvatar(displayName);

    const myVote = await getMyVote(postId);
    const replies = await loadReplies(postId);

    const div = document.createElement("div");
    div.className = "post2014";
    div.innerHTML = `
      <div class="postHead">
        <img class="avatar2014" src="${avatar}" alt="pfp" />
        <div>
          <div class="postTitle">${(p.title || "").replaceAll("<","&lt;")}</div>
          <div class="postMeta">by <b>${String(displayName).replaceAll("<","&lt;")}</b></div>
        </div>
      </div>

      <div class="postBody">${(p.body || "").replaceAll("<","&lt;").replaceAll("\n","<br>")}</div>

      <div class="pills">
        <button class="pill ${myVote === 1 ? "" : "off"}" data-like="1">👍 Like (${p.likeCount || 0})</button>
        <button class="pill ${myVote === -1 ? "" : "off"}" data-like="-1">👎 Dislike (${p.dislikeCount || 0})</button>
        <button class="pill off" data-reply="1">💬 Reply</button>
      </div>

      <div class="replyBox">
        <div class="postMeta"><b>Replies</b></div>
        ${replies.length ? replies.map(r => `
          <div class="replyItem">
            <div class="replyMeta">
              <img src="${r.authorPhotoUrl || defaultPersonAvatar(r.authorUsername || "user")}" />
              <span><b>${(r.authorUsername || "Anonymous").replaceAll("<","&lt;")}</b></span>
            </div>
            <div>${(r.text || "").replaceAll("<","&lt;").replaceAll("\n","<br>")}</div>
          </div>
        `).join("") : `<div class="muted">No replies yet.</div>`}
      </div>
    `;

    div.querySelector('[data-like="1"]').addEventListener("click", () => vote(postId, 1));
    div.querySelector('[data-like="-1"]').addEventListener("click", () => vote(postId, -1));
    div.querySelector('[data-reply="1"]').addEventListener("click", () => openReply(postId, p.title));

    postsEl.appendChild(div);
  }
}

    div.className = "post2014";
    div.innerHTML = `
      <div class="postHead">
        <img class="avatar2014" src="${avatar}" alt="pfp" />
        <div>
          <div class="postTitle">${(p.title || "").replaceAll("<","&lt;")}</div>
          <div class="postMeta">by <b>${(p.authorUsername || "Anonymous").replaceAll("<","&lt;")}</b></div>
        </div>
      </div>

      <div class="postBody">${(p.body || "").replaceAll("<","&lt;").replaceAll("\n","<br>")}</div>

      <div class="pills">
        <button class="pill ${myVote === 1 ? "" : "off"}" data-like="1">👍 Like (${p.likeCount || 0})</button>
        <button class="pill ${myVote === -1 ? "" : "off"}" data-like="-1">👎 Dislike (${p.dislikeCount || 0})</button>
        <button class="pill off" data-reply="1">💬 Reply</button>
      </div>

      <div class="replyBox">
        <div class="postMeta"><b>Replies</b></div>
        ${replies.length ? replies.map(r => `
          <div class="replyItem">
            <div class="replyMeta">
              <img src="${r.authorPhotoUrl || defaultPersonAvatar(r.authorUsername || "user")}" />
              <span><b>${(r.authorUsername || "Anonymous").replaceAll("<","&lt;")}</b></span>
            </div>
            <div>${(r.text || "").replaceAll("<","&lt;").replaceAll("\n","<br>")}</div>
          </div>
        `).join("") : `<div class="muted">No replies yet.</div>`}
      </div>
    `;

// -------- Auth state --------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    msg(userLabel, "");
    show(btnLogout, false);
    show(authCard, true);
    show(profileCard, false);
    show(composerCard, false);
    show(feed, false);
    postsEl.innerHTML = "";
    return;
  }

  msg(userLabel, user.isAnonymous ? "Anonymous user" : (user.email || "Phone user"));
  show(btnLogout, true);
  show(authCard, false);

  await ensureProfileUI(user);
  const prof = await getMyProfile(user.uid);
  if (prof?.username) await loadPosts();
});

