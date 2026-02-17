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

// ---------- UI refs ----------
const authCard = document.getElementById("authCard");
const composerCard = document.getElementById("composerCard");
const feed = document.getElementById("feed");
const postsEl = document.getElementById("posts");

const userLabel = document.getElementById("userLabel");
const btnLogout = document.getElementById("btnLogout");

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const btnRegister = document.getElementById("btnRegister");
const authMsg = document.getElementById("authMsg");

const titleEl = document.getElementById("postTitle");
const bodyEl = document.getElementById("postBody");
const btnPublish = document.getElementById("btnPublish");
const publishMsg = document.getElementById("publishMsg");
const btnRefresh = document.getElementById("btnRefresh");

// URL inputs (must exist in your updated index.html)
const imageUrlEl = document.getElementById("imageUrl");
const videoUrlEl = document.getElementById("videoUrl");

// Profile UI (must exist in your updated index.html)
const profileCard = document.getElementById("profileCard");
const profileUsername = document.getElementById("profileUsername");
const profilePhotoUrl = document.getElementById("profilePhotoUrl");
const btnSaveProfile = document.getElementById("btnSaveProfile");
const profileMsg = document.getElementById("profileMsg");
const profilePreview = document.getElementById("profilePreview");

// Reply modal
const replyDialog = document.getElementById("replyDialog");
const replyToTitle = document.getElementById("replyToTitle");
const replyText = document.getElementById("replyText");
const btnSendReply = document.getElementById("btnSendReply");
const replyMsg = document.getElementById("replyMsg");

let currentUser = null;
let replyingToPostId = null;

// ---------- helpers ----------
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

function defaultAvatar(email) {
  const seed = encodeURIComponent((email || "user").toLowerCase());
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${seed}`;
}

function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  // allow https links only for safety
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url);
}

function isMp4Url(url) {
  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
}

function youtubeEmbed(url) {
  // Basic YouTube embed support (youtu.be or youtube.com/watch?v=)
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

async function getMyProfile() {
  if (!currentUser) return null;
  const uref = doc(db, "users", currentUser.uid);
  const snap = await getDoc(uref);
  return snap.exists() ? snap.data() : null;
}

async function ensureProfileUI() {
  const prof = await getMyProfile();
  const hasProfile = !!(prof && prof.username);

  if (profileCard) profileCard.classList.toggle("hidden", hasProfile);
  if (composerCard) composerCard.classList.toggle("hidden", !hasProfile);

  if (!hasProfile && profilePreview) {
    profileUsername.value = prof?.username || "";
    profilePhotoUrl.value = prof?.photoUrl || "";
    profilePreview.src = profilePhotoUrl.value.trim() || defaultAvatar(currentUser?.email);
  }
}

// ---------- auth ----------
btnRegister?.addEventListener("click", async () => {
  setMsg(authMsg, "");
  const email = emailEl.value.trim();
  const password = passEl.value.trim();
  if (!email || password.length < 6) return setMsg(authMsg, "Enter email + password (min 6 chars).", "danger");

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    setMsg(authMsg, "Registered & logged in.", "ok");
  } catch (e) {
    setMsg(authMsg, e.message, "danger");
  }
});

btnLogin?.addEventListener("click", async () => {
  setMsg(authMsg, "");
  const email = emailEl.value.trim();
  const password = passEl.value.trim();
  if (!email || !password) return setMsg(authMsg, "Enter email + password.", "danger");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    setMsg(authMsg, "Logged in.", "ok");
  } catch (e) {
    setMsg(authMsg, e.message, "danger");
  }
});

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (!currentUser) {
    userLabel.textContent = "";
    btnLogout.classList.add("hidden");
    authCard.classList.remove("hidden");
    composerCard.classList.add("hidden");
    feed.classList.add("hidden");
    if (profileCard) profileCard.classList.add("hidden");
    postsEl.innerHTML = "";
    return;
  }

  userLabel.textContent = `Signed in: ${currentUser.email}`;
  btnLogout.classList.remove("hidden");
  authCard.classList.add("hidden");
  feed.classList.remove("hidden");

  await ensureProfileUI();
  await loadFeed();
});

// ---------- profile ----------
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
    setMsg(profileMsg, e.message || String(e), "danger");
  }
});

// ---------- posting ----------
btnPublish?.addEventListener("click", async () => {
  if (!currentUser) return;
  setMsg(publishMsg, "");
  btnPublish.disabled = true;

  try {
    const prof = await getMyProfile();
    if (!prof?.username) throw new Error("Set your profile (username) first.");

    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();
    if (!title || !body) throw new Error("Title and body are required.");

    const imageUrlRaw = imageUrlEl?.value || "";
    const videoUrlRaw = videoUrlEl?.value || "";

    const imageUrl = normalizeUrl(imageUrlRaw);
    const videoUrl = normalizeUrl(videoUrlRaw);

    if (imageUrlRaw.trim() && !imageUrl) throw new Error("Image URL must be a valid http/https link.");
    if (videoUrlRaw.trim() && !videoUrl) throw new Error("Video URL must be a valid http/https link.");

    // optional: nudge users to use typical formats
    if (imageUrl && !isImageUrl(imageUrl)) {
      // allow anyway, but it might not display
    }

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

    titleEl.value = "";
    bodyEl.value = "";
    if (imageUrlEl) imageUrlEl.value = "";
    if (videoUrlEl) videoUrlEl.value = "";

    setMsg(publishMsg, "Posted!", "ok");
    await loadFeed();
  } catch (e) {
    setMsg(publishMsg, e.message || String(e), "danger");
  } finally {
    btnPublish.disabled = false;
    setTimeout(() => setMsg(publishMsg, ""), 2500);
  }
});

btnRefresh?.addEventListener("click", loadFeed);

// ---------- voting ----------
// posts/{postId}/votes/{uid} = { value: 1 | -1 | 0 }
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

// ---------- replies ----------
function openReply(postId, postTitle) {
  replyingToPostId = postId;
  if (replyToTitle) replyToTitle.textContent = `Replying to: ${postTitle}`;
  if (replyText) replyText.value = "";
  setMsg(replyMsg, "");
  replyDialog?.showModal();
}

btnSendReply?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  if (!currentUser || !replyingToPostId) return;

  const text = (replyText?.value || "").trim();
  if (!text) return setMsg(replyMsg, "Reply text required.", "danger");

  try {
    btnSendReply.disabled = true;

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

    replyDialog?.close();
    await loadFeed();
  } catch (e) {
    setMsg(replyMsg, e.message || String(e), "danger");
  } finally {
    btnSendReply.disabled = false;
  }
});

// ---------- feed ----------
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
  if (isMp4Url(videoUrl)) {
    return `<video controls src="${escapeHtml(videoUrl)}"></video>`;
  }
  // generic link fallback
  return `<a class="muted" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">Open video link</a>`;
}

async function loadFeed() {
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

