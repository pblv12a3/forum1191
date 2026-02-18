// app_v3.js?v=5 — Homepage logic + Settings (edit username/pfp) + show username in topbar

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc, getDoc, setDoc,
  collection, addDoc, getDocs,
  query, orderBy, limit,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const msg = (el, text) => el && (el.textContent = text || "");

const userLabel = $("userLabel");
const btnLogout = $("btnLogout");

// cards
const profileCard = $("profileCard");
const composerCard = $("composerCard");
const feed = $("feed");
const postsEl = $("posts");

// profile create (existing)
const profileUsername = $("profileUsername");
const profilePhotoUrl = $("profilePhotoUrl");
const btnSaveProfile = $("btnSaveProfile");
const profileMsg = $("profileMsg");

// composer
const postTitle = $("postTitle");
const postBody = $("postBody");
const imageUrl = $("imageUrl");
const videoUrl = $("videoUrl");
const btnPublish = $("btnPublish");
const publishMsg = $("publishMsg");

// reply dialog
const replyDialog = $("replyDialog");
const replyToTitle = $("replyToTitle");
const replyText = $("replyText");
const btnSendReply = $("btnSendReply");
const replyMsg = $("replyMsg");

// settings (NEW)
const settingsCard = $("settingsCard");
const btnOpenSettings = $("btnOpenSettings");
const btnCloseSettings = $("btnCloseSettings");
const settingsUsername = $("settingsUsername");
const settingsPhotoUrl = $("settingsPhotoUrl");
const btnSaveSettings = $("btnSaveSettings");
const settingsMsg = $("settingsMsg");

let replyingToPostId = null;

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

async function getMyProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// --- Settings open/close ---
btnOpenSettings?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  const prof = await getMyProfile(user.uid);
  if (settingsUsername) settingsUsername.value = prof?.username || "";
  if (settingsPhotoUrl) settingsPhotoUrl.value = prof?.photoUrl || "";
  msg(settingsMsg, "");
  show(settingsCard, true);
});

btnCloseSettings?.addEventListener("click", () => {
  show(settingsCard, false);
});

// --- Save profile (create) ---
btnSaveProfile?.addEventListener("click", async () => {
  try {
    msg(profileMsg, "");
    const user = auth.currentUser;
    if (!user) return;

    const username = (profileUsername?.value || "").trim();
    if (username.length < 3) throw new Error("Username must be at least 3 characters.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Username can contain letters, numbers, _ . - only.");

    const photoRaw = (profilePhotoUrl?.value || "").trim();
    const photoUrl = photoRaw ? normalizeUrl(photoRaw) : null;
    if (photoRaw && !photoUrl) throw new Error("Profile photo must be a valid http/https URL.");

    await setDoc(doc(db, "users", user.uid), {
      username,
      photoUrl: photoUrl || null,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await refreshUIForUser(user);
    await loadPosts();
  } catch (e) {
    console.error(e);
    msg(profileMsg, e?.message || String(e));
  }
});

// --- Save settings (edit username/pfp) ---
btnSaveSettings?.addEventListener("click", async () => {
  try {
    msg(settingsMsg, "");
    const user = auth.currentUser;
    if (!user) return;

    const username = (settingsUsername?.value || "").trim();
    if (username.length < 3) throw new Error("Username must be at least 3 characters.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Username can contain letters, numbers, _ . - only.");

    const photoRaw = (settingsPhotoUrl?.value || "").trim();
    const photoUrl = photoRaw ? normalizeUrl(photoRaw) : null;
    if (photoRaw && !photoUrl) throw new Error("Profile photo must be a valid http/https URL.");

    await setDoc(doc(db, "users", user.uid), {
      username,
      photoUrl: photoUrl || null,
      updatedAt: serverTimestamp()
    }, { merge: true });

    msg(settingsMsg, "Saved!");
    await refreshUIForUser(user);
    await loadPosts();
  } catch (e) {
    console.error(e);
    msg(settingsMsg, e?.message || String(e));
  }
});

// --- Logout ---
btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "login.html";
});

// --- Post ---
btnPublish?.addEventListener("click", async () => {
  try {
    msg(publishMsg, "");
    const user = auth.currentUser;
    if (!user) return;

    const prof = await getMyProfile(user.uid);
    if (!prof?.username) throw new Error("Set your username first.");

    const title = (postTitle?.value || "").trim();
    const body = (postBody?.value || "").trim();
    if (!title || !body) throw new Error("Title and text are required.");

    await addDoc(collection(db, "posts"), {
      title,
      body,
      imageUrl: normalizeUrl(imageUrl?.value || "") || null,
      videoUrl: normalizeUrl(videoUrl?.value || "") || null,
      authorUid: user.uid,
      authorUsername: prof.username,
      authorPhotoUrl: prof.photoUrl || null,
      createdAt: serverTimestamp(),
      likeCount: 0,
      dislikeCount: 0
    });

    if (postTitle) postTitle.value = "";
    if (postBody) postBody.value = "";
    if (imageUrl) imageUrl.value = "";
    if (videoUrl) videoUrl.value = "";

    msg(publishMsg, "Posted!");
    await loadPosts();
  } catch (e) {
    console.error(e);
    msg(publishMsg, e?.message || String(e));
  }
});

// --- Votes ---
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

// --- Replies ---
function openReply(postId, title) {
  replyingToPostId = postId;
  if (replyToTitle) replyToTitle.textContent = `Reply to: ${title || "Post"}`;
  if (replyText) replyText.value = "";
  msg(replyMsg, "");
  replyDialog?.showModal?.();
}

btnSendReply?.addEventListener("click", async () => {
  try {
    msg(replyMsg, "");
    const user = auth.currentUser;
    if (!user || !replyingToPostId) return;

    const prof = await getMyProfile(user.uid);
    if (!prof?.username) throw new Error("Set your username first.");

    const text = (replyText?.value || "").trim();
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
  } catch (e) {
    console.error(e);
    msg(replyMsg, e?.message || String(e));
  }
});

async function loadReplies(postId) {
  const q = query(collection(db, "posts", postId, "replies"), orderBy("createdAt", "desc"), limit(5));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach(d => out.push(d.data()));
  return out;
}

// --- Backward compatible feed load ---
async function loadPosts() {
  postsEl.innerHTML = "";

  let docs = [];
  try {
    const qNew = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
    const snapNew = await getDocs(qNew);
    docs = snapNew.docs;
  } catch (e) {
    console.warn("Fallback fetch:", e);
    const snapAny = await getDocs(collection(db, "posts"));
    docs = snapAny.docs;
  }

  docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });

  for (const d of docs.slice(0, 50)) {
    const p = d.data();
    const postId = d.id;

    const displayName = p.authorUsername || p.author || "Anonymous";
    const avatar = p.authorPhotoUrl || defaultPersonAvatar(displayName);

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
        <button class="pill off" data-reply="1">⚑ Settings</button>
        <button class="pill off" data-replypost="1">💬 Reply</button>
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
    div.querySelector('[data-replypost="1"]').addEventListener("click", () => openReply(postId, p.title));
    // settings button opens settings panel
    div.querySelector('[data-reply="1"]').addEventListener("click", () => btnOpenSettings?.click());

    postsEl.appendChild(div);
  }
}

// --- UI refresh for user (show username in topbar) ---
async function refreshUIForUser(user) {
  const prof = await getMyProfile(user.uid);
  const hasProfile = !!(prof && prof.username);

  // Display username instead of email
  if (userLabel) userLabel.textContent = hasProfile ? prof.username : (user.isAnonymous ? "Anonymous user" : (user.email || "Phone user"));

  show(profileCard, !hasProfile);
  show(composerCard, hasProfile);
  show(feed, hasProfile);

  // settings button only if profile exists
  if (btnOpenSettings) btnOpenSettings.classList.toggle("hidden", !hasProfile);
}

// --- Require login ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }
  btnLogout?.classList.remove("hidden");
  await refreshUIForUser(user);

  const prof = await getMyProfile(user.uid);
  if (prof?.username) await loadPosts();
});

// expose for internal call safety
window.loadPosts = loadPosts;
