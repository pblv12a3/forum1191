// app.js (crash-safe + redirect to uhoh.html on fatal errors)

// ========= Crash Guard (redirect to uhoh.html) =========
const CRASH_PAGE = "uhoh.html";
const CRASH_KEY = "__forum_crash_redirected__";

function redirectToCrashPage(err) {
  try {
    // Prevent infinite loops
    if (sessionStorage.getItem(CRASH_KEY) === "1") return;
    sessionStorage.setItem(CRASH_KEY, "1");

    console.error("Forum crashed:", err);
    // Optional: attach error info as hash (keep it short)
    const msg = encodeURIComponent(String(err?.message || err || "Unknown error").slice(0, 250));
    window.location.href = `${CRASH_PAGE}#err=${msg}`;
  } catch {
    // If even this fails, do nothing.
  }
}

window.addEventListener("error", (e) => {
  // Ignore extension scripts as much as possible
  if (String(e?.filename || "").startsWith("chrome-extension://")) return;
  redirectToCrashPage(e?.error || e?.message || "Window error");
});

window.addEventListener("unhandledrejection", (e) => {
  redirectToCrashPage(e?.reason || "Unhandled promise rejection");
});

// ========= Safe DOM helpers =========
function $(id) {
  return document.getElementById(id);
}
function show(el, on) {
  if (!el) return;
  el.classList.toggle("hidden", !on);
}
function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
}
function setMsg(el, text, kind = "muted") {
  if (!el) return;
  el.textContent = text || "";
  el.style.color =
    kind === "danger" ? "var(--danger)" :
    kind === "ok" ? "var(--ok)" :
    "var(--muted)";
}
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function fmtTime(ts) {
  if (!ts) return "just now";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString();
}
function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}
function defaultAvatar(email) {
  const seed = encodeURIComponent((email || "user").toLowerCase());
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${seed}`;
}
function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url);
}
function isVideoFileUrl(url) {
  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
}
function youtubeEmbed(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
}
function renderVideo(videoUrl) {
  if (!videoUrl) return "";
  const yt = youtubeEmbed(videoUrl);
  if (yt) {
    return `<iframe
      style="width:100%;height:420px;border-radius:14px;border:1px solid var(--border);background:#000"
      src="${escapeHtml(yt)}"
      title="YouTube video"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen></iframe>`;
  }
  if (isVideoFileUrl(videoUrl)) {
    return `<video controls src="${escapeHtml(videoUrl)}"></video>`;
  }
  return `<a class="muted" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">Open video link</a>`;
}

// ========= Firebase imports =========
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ========= UI (IDs) =========
const authCard = $("authCard");
const composerCard = $("composerCard");
const feed = $("feed");
const postsEl = $("posts");

const userLabel = $("userLabel");
const btnLogout = $("btnLogout");

const emailEl = $("email");
const passEl = $("password");
const btnLogin = $("btnLogin");
const btnRegister = $("btnRegister");
const authMsg = $("authMsg");

const titleEl = $("postTitle");
const bodyEl = $("postBody");
const imageUrlEl = $("imageUrl");
const videoUrlEl = $("videoUrl");
const btnPublish = $("btnPublish");
const publishMsg = $("publishMsg");
const btnRefresh = $("btnRefresh");

const profileCard = $("profileCard");
const profileUsername = $("profileUsername");
const profilePhotoUrl = $("profilePhotoUrl");
const btnSaveProfile = $("btnSaveProfile");
const profileMsg = $("profileMsg");
const profilePreview = $("profilePreview");

const replyDialog = $("replyDialog");
const replyToTitle = $("replyToTitle");
const replyText = $("replyText");
const btnSendReply = $("btnSendReply");
const replyMsg = $("replyMsg");

// If your HTML is missing lots of IDs, we still won't crash —
// but the UI obviously can’t show those parts. We'll warn:
const REQUIRED_IDS = [
  "authCard","email","password","btnLogin","btnRegister","authMsg",
  "userLabel","btnLogout",
  "profileCard","profileUsername","profilePhotoUrl","btnSaveProfile","profileMsg","profilePreview",
  "composerCard","postTitle","postBody","imageUrl","videoUrl","btnPublish","publishMsg",
  "feed","btnRefresh","posts",
  "replyDialog","replyToTitle","replyText","btnSendReply","replyMsg"
];
const missing = REQUIRED_IDS.filter(id => !$(id));
if (missing.length) {
  console.warn("Missing elements in index.html (IDs):", missing);
  // Not fatal; app continues. If you want this to be fatal, uncomment:
  // redirectToCrashPage(new Error("Missing required HTML IDs: " + missing.join(", ")));
}

// ========= App state =========
let currentUser = null;
let replyingToPostId = null;

// ========= Profile helpers =========
async function getMyProfile() {
  if (!currentUser) return null;
  const uref = doc(db, "users", currentUser.uid);
  const snap = await getDoc(uref);
  return snap.exists() ? snap.data() : null;
}

async function ensureProfileUI() {
  const prof = await getMyProfile();
  const hasProfile = !!(prof && prof.username);

  show(profileCard, !hasProfile);
  show(composerCard, hasProfile);

  if (!hasProfile) {
    if (profileUsername) profileUsername.value = prof?.username || "";
    if (profilePhotoUrl) profilePhotoUrl.value = prof?.photoUrl || "";
    if (profilePreview) {
      profilePreview.src = (profilePhotoUrl?.value || "").trim() || defaultAvatar(currentUser?.email);
    }
  }
}

// ========= Auth wiring =========
btnRegister?.addEventListener("click", async () => {
  setMsg(authMsg, "");
  const email = (emailEl?.value || "").trim();
  const password = (passEl?.value || "").trim();
  if (!email || password.length < 6) return setMsg(authMsg, "Enter email + password (min 6 chars).", "danger");

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    setMsg(authMsg, "Registered & logged in.", "ok");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "danger");
  }
});

btnLogin?.addEventListener("click", async () => {
  setMsg(authMsg, "");
  const email = (emailEl?.value || "").trim();
  const password = (passEl?.value || "").trim();
  if (!email || !password) return setMsg(authMsg, "Enter email + password.", "danger");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    setMsg(authMsg, "Logged in.", "ok");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "danger");
  }
});

btnLogout?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (e) { console.warn(e); }
});

// ========= Profile save =========
profilePhotoUrl?.addEventListener("input", () => {
  const url = normalizeUrl(profilePhotoUrl.value);
  if (profilePreview) profilePreview.src = url || defaultAvatar(currentUser?.email);
});

btnSaveProfile?.addEventListener("click", async () => {
  if (!currentUser) return;
  setMsg(profileMsg, "");

  const username = (profileUsername?.value || "").trim();
  const photoUrlRaw = (profilePhotoUrl?.value || "").trim();
  const photoUrl = normalizeUrl(photoUrlRaw);

  if (!username || username.length < 3) return setMsg(profileMsg, "Username must be at least 3 characters.", "danger");
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return setMsg(profileMsg, "Use only letters, numbers, _ . -", "danger");
  if (photoUrlRaw && !photoUrl) return setMsg(profileMsg, "Profile picture must be a valid http/https URL.", "danger");

  try {
    const uref = doc(db, "users", currentUser.uid);
    await setDoc(uref, {
      username,
      photoUrl: photoUrl || null,
      email: currentUser.email,
      updatedAt: serverTimestamp()
    }, { merge: true });

    setMsg(profileMsg, "Saved!", "ok");
    await ensureProfileUI();
    await loadFeed();
  } catch (e) {
    setMsg(profileMsg, e?.message || String(e), "danger");
  }
});

// ========= Posting =========
btnPublish?.addEventListener("click", async () => {
  if (!currentUser) return;
  setMsg(publishMsg, "");
  if (btnPublish) btnPublish.disabled = true;

  try {
    const prof = await getMyProfile();
    if (!prof?.username) throw new Error("Set your profile (username) first.");

    const title = (titleEl?.value || "").trim();
    const body = (bodyEl?.value || "").trim();
    if (!title || !body) throw new Error("Title and body are required.");

    const imageUrlRaw = (imageUrlEl?.value || "");
    const videoUrlRaw = (videoUrlEl?.value || "");

    const imageUrl = normalizeUrl(imageUrlRaw);
    const videoUrl = normalizeUrl(videoUrlRaw);

    if (imageUrlRaw.trim() && !imageUrl) throw new Error("Image URL must be a valid http/https link.");
    if (videoUrlRaw.trim() && !videoUrl) throw new Error("Video URL must be a valid http/https link.");

    await addDoc(collection(db, "posts"), {
      title,
      body,
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      authorUid: currentUser.uid,
      authorEmail: currentUser.email,
      authorUsername: prof.username,
      authorPhotoUrl: prof.photoUrl || null,
      createdAt: serverTimestamp(),
      likeCount: 0,
      dislikeCount: 0
    });

    if (titleEl) titleEl.value = "";
    if (bodyEl) bodyEl.value = "";
    if (imageUrlEl) imageUrlEl.value = "";
    if (videoUrlEl) videoUrlEl.value = "";

    setMsg(publishMsg, "Posted!", "ok");
    await loadFeed();
  } catch (e) {
    setMsg(publishMsg, e?.message || String(e), "danger");
  } finally {
    if (btnPublish) btnPublish.disabled = false;
    setTimeout(() => setMsg(publishMsg, ""), 2500);
  }
});

btnRefresh?.addEventListener("click", loadFeed);

// ========= Voting =========
async function vote(postId, value) {
  if (!currentUser) return;

  const postRef = doc(db, "posts", postId);
  const voteRef = doc(db, "posts", postId, "votes", currentUser.uid);

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

  await loadFeed();
}

// ========= Replies =========
function openReply(postId, postTitle) {
  replyingToPostId = postId;
  setText(replyToTitle, `Replying to: ${postTitle}`);
  if (replyText) replyText.value = "";
  setMsg(replyMsg, "");
  replyDialog?.showModal?.();
}

btnSendReply?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  if (!currentUser || !replyingToPostId) return;

  const text = (replyText?.value || "").trim();
  if (!text) return setMsg(replyMsg, "Reply text required.", "danger");

  try {
    if (btnSendReply) btnSendReply.disabled = true;
    const prof = await getMyProfile();
    if (!prof?.username) return setMsg(replyMsg, "Set your profile first.", "danger");

    await addDoc(collection(db, "posts", replyingToPostId, "replies"), {
      text,
      authorUid: currentUser.uid,
      authorEmail: currentUser.email,
      authorUsername: prof.username,
      authorPhotoUrl: prof.photoUrl || null,
      createdAt: serverTimestamp()
    });

    replyDialog?.close?.();
    await loadFeed();
  } catch (e) {
    setMsg(replyMsg, e?.message || String(e), "danger");
  } finally {
    if (btnSendReply) btnSendReply.disabled = false;
  }
});

// ========= Feed loading =========
async function loadReplies(postId, max = 8) {
  const qy = query(
    collection(db, "posts", postId, "replies"),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(qy);
  const replies = [];
  snap.forEach(d => replies.push({ id: d.id, ...d.data() }));
  return replies;
}

async function getMyVote(postId) {
  if (!currentUser) return 0;
  const voteRef = doc(db, "posts", postId, "votes", currentUser.uid);
  const snap = await getDoc(voteRef);
  if (!snap.exists()) return 0;
  return snap.data().value || 0;
}

async function loadFeed() {
  if (!postsEl) return;
  postsEl.innerHTML = `<div class="card muted">Loading…</div>`;

  const qy = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  const snap = await getDocs(qy);

  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

  if (rows.length === 0) {
    postsEl.innerHTML = `<div class="card muted">No posts yet. Be the first!</div>`;
    return;
  }

  postsEl.innerHTML = "";
  for (const p of rows) {
    const myVote = await getMyVote(p.id);
    const replies = await loadReplies(p.id, 8);

    const avatar = p.authorPhotoUrl || defaultAvatar(p.authorEmail);
    const imageHtml = p.imageUrl
      ? (isImageUrl(p.imageUrl)
          ? `<img src="${escapeHtml(p.imageUrl)}" alt="image" />`
          : `<a class="muted" href="${escapeHtml(p.imageUrl)}" target="_blank" rel="noopener">Open image link</a>`)
      : "";

    const videoHtml = renderVideo(p.videoUrl);

    const postDiv = document.createElement("div");
    postDiv.className = "post";
    postDiv.innerHTML = `
      <h3>${escapeHtml(p.title)}</h3>

      <div class="meta metaUser">
        <img class="avatar" src="${escapeHtml(avatar)}" alt="avatar" />
        <span>by <strong>${escapeHtml(p.authorUsername || "unknown")}</strong></span>
        <span>•</span>
        <span>${fmtTime(p.createdAt)}</span>
      </div>

      <p>${escapeHtml(p.body).replace(/\n/g, "<br>")}</p>

      <div class="media">
        ${imageHtml}
        ${videoHtml}
      </div>

      <div class="actions">
        <button class="pill" data-like="1">
          <strong>${myVote === 1 ? "👍 Liked" : "👍 Like"}</strong>
          <span class="muted">${p.likeCount || 0}</span>
        </button>
        <button class="pill" data-like="-1">
          <strong>${myVote === -1 ? "👎 Disliked" : "👎 Dislike"}</strong>
          <span class="muted">${p.dislikeCount || 0}</span>
        </button>
        <button class="pill" data-reply="1"><strong>💬 Reply</strong></button>
      </div>

      <div class="replyList">
        ${replies.length ? replies.map(r => `
          <div class="reply">
            <div class="meta metaUser">
              <img class="avatar" src="${escapeHtml(r.authorPhotoUrl || defaultAvatar(r.authorEmail))}" alt="avatar" />
              <span><strong>${escapeHtml(r.authorUsername || "unknown")}</strong></span>
              <span>•</span>
              <span>${fmtTime(r.createdAt)}</span>
            </div>
            <div>${escapeHtml(r.text).replace(/\n/g,"<br>")}</div>
          </div>
        `).join("") : `<div class="muted">No replies yet.</div>`}
      </div>
    `;

    postDiv.querySelector('[data-like="1"]').addEventListener("click", () => vote(p.id, 1));
    postDiv.querySelector('[data-like="-1"]').addEventListener("click", () => vote(p.id, -1));
    postDiv.querySelector('[data-reply="1"]').addEventListener("click", () => openReply(p.id, p.title));

    postsEl.appendChild(postDiv);
  }
}

// ========= Auth state =========
onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (!currentUser) {
    setText(userLabel, "");
    show(btnLogout, false);
    show(authCard, true);
    show(feed, false);
    show(profileCard, false);
    show(composerCard, false);
    if (postsEl) postsEl.innerHTML = "";
    // Allow another crash redirect next time
    try { sessionStorage.removeItem(CRASH_KEY); } catch {}
    return;
  }

  setText(userLabel, `Signed in: ${currentUser.email}`);
  show(btnLogout, true);
  show(authCard, false);
  show(feed, true);

  // Clear crash-loop prevention now that we're stable
  try { sessionStorage.removeItem(CRASH_KEY); } catch {}

  await ensureProfileUI();
  await loadFeed();
});

