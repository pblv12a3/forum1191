import { auth, db, storage } from "./firebase.js";

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
  updateDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

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
const imageEl = document.getElementById("imageFile");
const videoEl = document.getElementById("videoFile");
const btnPublish = document.getElementById("btnPublish");
const publishMsg = document.getElementById("publishMsg");
const btnRefresh = document.getElementById("btnRefresh");

const replyDialog = document.getElementById("replyDialog");
const replyToTitle = document.getElementById("replyToTitle");
const replyText = document.getElementById("replyText");
const btnSendReply = document.getElementById("btnSendReply");
const replyMsg = document.getElementById("replyMsg");

let currentUser = null;
let replyingToPostId = null;

// ---------- helpers ----------
function setMsg(el, text, kind = "muted") {
  el.textContent = text || "";
  el.style.color = kind === "danger" ? "var(--danger)" : (kind === "ok" ? "var(--ok)" : "var(--muted)");
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

async function uploadIfPresent(file, folder) {
  if (!file) return null;
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${folder}/${Date.now()}_${safeName}`;
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return await getDownloadURL(r);
}

// ---------- auth ----------
btnRegister.addEventListener("click", async () => {
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

btnLogin.addEventListener("click", async () => {
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

btnLogout.addEventListener("click", async () => {
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
    postsEl.innerHTML = "";
    return;
  }

  userLabel.textContent = `Signed in: ${currentUser.email}`;
  btnLogout.classList.remove("hidden");
  authCard.classList.add("hidden");
  composerCard.classList.remove("hidden");
  feed.classList.remove("hidden");

  await loadFeed();
});

// ---------- posting ----------
btnPublish.addEventListener("click", async () => {
  if (!currentUser) return;
  setMsg(publishMsg, "");
  btnPublish.disabled = true;

  try {
    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();
    if (!title || !body) throw new Error("Title and body are required.");

    const imageFile = imageEl.files?.[0] || null;
    const videoFile = videoEl.files?.[0] || null;

    // Optional: basic size guard (you can adjust)
    if (imageFile && imageFile.size > 15 * 1024 * 1024) throw new Error("Image too large (max 15MB).");
    if (videoFile && videoFile.size > 150 * 1024 * 1024) throw new Error("Video too large (max 150MB).");

    setMsg(publishMsg, "Uploading media…");

    const [imageUrl, videoUrl] = await Promise.all([
      uploadIfPresent(imageFile, "uploads/images"),
      uploadIfPresent(videoFile, "uploads/videos")
    ]);

    setMsg(publishMsg, "Saving post…");

    await addDoc(collection(db, "posts"), {
      title,
      body,
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      authorUid: currentUser.uid,
      authorEmail: currentUser.email,
      createdAt: serverTimestamp(),
      likeCount: 0,
      dislikeCount: 0
    });

    titleEl.value = "";
    bodyEl.value = "";
    imageEl.value = "";
    videoEl.value = "";

    setMsg(publishMsg, "Posted!", "ok");
    await loadFeed();
  } catch (e) {
    setMsg(publishMsg, e.message || String(e), "danger");
  } finally {
    btnPublish.disabled = false;
    setTimeout(() => setMsg(publishMsg, ""), 3000);
  }
});

btnRefresh.addEventListener("click", loadFeed);

// ---------- voting (like/dislike per user) ----------
// We store votes at: posts/{postId}/votes/{uid} = { value: 1 | -1 }
async function vote(postId, value) {
  if (!currentUser) return;

  const postRef = doc(db, "posts", postId);
  const voteRef = doc(db, "posts", postId, "votes", currentUser.uid);

  const [postSnap, voteSnap] = await Promise.all([getDoc(postRef), getDoc(voteRef)]);
  if (!postSnap.exists()) return;

  const post = postSnap.data();
  const prev = voteSnap.exists() ? (voteSnap.data().value || 0) : 0;

  // toggle logic:
  // clicking same vote removes it
  const next = (prev === value) ? 0 : value;

  let likeCount = post.likeCount || 0;
  let dislikeCount = post.dislikeCount || 0;

  // remove prev
  if (prev === 1) likeCount--;
  if (prev === -1) dislikeCount--;

  // apply next
  if (next === 1) likeCount++;
  if (next === -1) dislikeCount++;

  likeCount = Math.max(0, likeCount);
  dislikeCount = Math.max(0, dislikeCount);

  const writes = [];
  writes.push(updateDoc(postRef, { likeCount, dislikeCount }));

  if (next === 0) {
    // delete vote doc
    writes.push(setDoc(voteRef, { value: deleteField() }, { merge: true }));
    // Firestore doesn't support true deleteField-only doc cleanup, so we instead delete the doc:
    // But deleteDoc import would be another import; to keep simple, just write value:0:
    writes.pop();
    writes.push(setDoc(voteRef, { value: 0 }, { merge: true }));
  } else {
    writes.push(setDoc(voteRef, { value: next }, { merge: true }));
  }

  await Promise.all(writes);
  await loadFeed();
}

// ---------- replies ----------
function openReply(postId, postTitle) {
  replyingToPostId = postId;
  replyToTitle.textContent = `Replying to: ${postTitle}`;
  replyText.value = "";
  setMsg(replyMsg, "");
  replyDialog.showModal();
}

btnSendReply.addEventListener("click", async (ev) => {
  ev.preventDefault();
  if (!currentUser || !replyingToPostId) return;

  const text = replyText.value.trim();
  if (!text) return setMsg(replyMsg, "Reply text required.", "danger");

  try {
    btnSendReply.disabled = true;
    await addDoc(collection(db, "posts", replyingToPostId, "replies"), {
      text,
      authorUid: currentUser.uid,
      authorEmail: currentUser.email,
      createdAt: serverTimestamp()
    });
    setMsg(replyMsg, "Reply posted.", "ok");
    replyDialog.close();
    await loadFeed();
  } catch (e) {
    setMsg(replyMsg, e.message || String(e), "danger");
  } finally {
    btnSendReply.disabled = false;
  }
});

// ---------- feed ----------
async function loadReplies(postId, max = 5) {
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
    const replies = await loadReplies(p.id, 5);

    const postDiv = document.createElement("div");
    postDiv.className = "post";

    const imageHtml = p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="image" />` : "";
    const videoHtml = p.videoUrl ? `<video controls src="${escapeHtml(p.videoUrl)}"></video>` : "";

    postDiv.innerHTML = `
      <h3>${escapeHtml(p.title)}</h3>
      <div class="meta">
        <span>by ${escapeHtml(p.authorEmail || "unknown")}</span>
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
            <div class="meta"><span>${escapeHtml(r.authorEmail || "unknown")}</span><span>•</span><span>${fmtTime(r.createdAt)}</span></div>
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
