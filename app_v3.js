import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, setDoc,
  collection, addDoc, getDocs,
  query, orderBy, limit,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const show = (el, on) => el && el.classList.toggle("hidden", !on);
const msg = (el, text) => el && (el.textContent = text || "");

const loadingBanner = $("loadingBanner");

const userLabel = $("userLabel");
const btnLogout = $("btnLogout");
const btnOpenSettings = $("btnOpenSettings");

const settingsCard = $("settingsCard");
const btnCloseSettings = $("btnCloseSettings");
const settingsUsername = $("settingsUsername");
const settingsPhotoUrl = $("settingsPhotoUrl");
const btnSaveSettings = $("btnSaveSettings");
const settingsMsg = $("settingsMsg");

const profileCard = $("profileCard");
const profileUsername = $("profileUsername");
const profilePhotoUrl = $("profilePhotoUrl");
const btnSaveProfile = $("btnSaveProfile");
const profileMsg = $("profileMsg");

const composerCard = $("composerCard");
const postCategory = $("postCategory");
const postTitle = $("postTitle");
const postBody = $("postBody");
const imageUrl = $("imageUrl");
const videoUrl = $("videoUrl");
const btnPublish = $("btnPublish");
const publishMsg = $("publishMsg");

const feed = $("feed");
const categoryFilter = $("categoryFilter");
const postsEl = $("posts");

const replyDialog = $("replyDialog");
const replyToTitle = $("replyToTitle");
const replyText = $("replyText");
const btnSendReply = $("btnSendReply");
const replyMsg = $("replyMsg");

let replyingToPostId = null;

/* ---------------- URL state (category + post) ---------------- */

function readCategoryFromUrl() {
  const params = new URLSearchParams(location.search);
  const c = params.get("c");
  return c && c.trim() ? c.trim() : null;
}
function readPostFromUrl() {
  const params = new URLSearchParams(location.search);
  const p = params.get("p");
  return p && p.trim() ? p.trim() : null;
}
function buildUrl({ c, p }) {
  const url = new URL(location.href);
  url.searchParams.delete("c");
  url.searchParams.delete("p");
  if (c && c !== "all") url.searchParams.set("c", c);
  if (p) url.searchParams.set("p", p);
  return `${url.pathname}${url.search}`;
}
function setCategoryInUrl(cat) {
  const url = new URL(location.href);
  if (!cat || cat === "all") url.searchParams.delete("c");
  else url.searchParams.set("c", cat);
  history.replaceState({}, "", `${url.pathname}${url.search}`);
}
function setPostInUrl(postId) {
  const url = new URL(location.href);
  if (!postId) url.searchParams.delete("p");
  else url.searchParams.set("p", postId);
  history.replaceState({}, "", `${url.pathname}${url.search}`);
}

let currentCategory = "all";
let currentPostId = null;

function syncStateFromUrl() {
  const urlCat = readCategoryFromUrl();
  const urlPost = readPostFromUrl();
  currentPostId = urlPost || null;

  if (urlCat && categoryFilter) {
    const optExists = Array.from(categoryFilter.options).some(o => o.value === urlCat);
    if (optExists) {
      currentCategory = urlCat;
      categoryFilter.value = urlCat;
    } else {
      currentCategory = "all";
      categoryFilter.value = "all";
    }
  } else {
    currentCategory = categoryFilter?.value || "all";
  }
}

syncStateFromUrl();

window.addEventListener("popstate", () => {
  syncStateFromUrl();
  loadPosts();
});

categoryFilter?.addEventListener("change", () => {
  currentCategory = categoryFilter.value || "all";
  setCategoryInUrl(currentCategory);

  currentPostId = null;
  setPostInUrl(null);

  loadPosts();
});

/* ---------------- Verified + username uniqueness ---------------- */

// Cache verified status to avoid extra reads
const verifiedCache = new Map(); // uid -> boolean

async function getVerifiedByUid(uid) {
  if (!uid) return false;
  if (verifiedCache.has(uid)) return verifiedCache.get(uid);

  try {
    const snap = await getDoc(doc(db, "users", uid));
    const v = !!(snap.exists() && snap.data()?.verified);
    verifiedCache.set(uid, v);
    return v;
  } catch {
    verifiedCache.set(uid, false);
    return false;
  }
}

function verifiedBadge(isVerified) {
  return isVerified ? " ☑️" : "";
}

function normalizeUsername(name) {
  return (name || "").trim();
}
function usernameKey(name) {
  // case-insensitive + trim
  return normalizeUsername(name).toLowerCase();
}

// Ensure usernames are unique using collection: usernames/{lowercaseUsername} -> { uid }
async function ensureUsernameUnique(username, uid) {
  const key = usernameKey(username);
  if (!key) throw new Error("Username required.");

  const ref = doc(db, "usernames", key);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const owner = snap.data()?.uid;
    if (owner && owner !== uid) throw new Error("That username is taken. Choose another.");
  }

  // claim (or re-claim)
  await setDoc(ref, { uid, username }, { merge: true });
}

/* ---------------- utility ---------------- */

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

function setLoading(on, text = "Loading ForumsR…") {
  if (!loadingBanner) return;
  loadingBanner.style.display = on ? "" : "none";
  loadingBanner.textContent = text;
}

/* ---------------- auth UI ---------------- */

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "login.html";
});

// settings open/close
btnOpenSettings?.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  const prof = await getMyProfile(user.uid);
  if (settingsUsername) settingsUsername.value = prof?.username || "";
  if (settingsPhotoUrl) settingsPhotoUrl.value = prof?.photoUrl || "";
  msg(settingsMsg, "");
  show(settingsCard, true);
});
btnCloseSettings?.addEventListener("click", () => show(settingsCard, false));

// save profile (first time)
btnSaveProfile?.addEventListener("click", async () => {
  try {
    msg(profileMsg, "");
    const user = auth.currentUser;
    if (!user) return;

    const username = normalizeUsername(profileUsername?.value || "");
    if (username.length < 3) throw new Error("Username must be at least 3 characters.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Username can contain letters, numbers, _ . - only.");

    const photoRaw = (profilePhotoUrl?.value || "").trim();
    const photoUrl = photoRaw ? normalizeUrl(photoRaw) : null;
    if (photoRaw && !photoUrl) throw new Error("Profile photo must be a valid http/https URL.");

    // claim username (unique)
    await ensureUsernameUnique(username, user.uid);

    // create/update profile (verified defaults to false unless you set it true in DB)
    await setDoc(doc(db, "users", user.uid), {
      username,
      photoUrl: photoUrl || null,
      verified: false,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await refreshUI(user);
    await loadPosts();
  } catch (e) {
    console.error(e);
    msg(profileMsg, e?.message || String(e));
  }
});

// save settings (edit anytime)
btnSaveSettings?.addEventListener("click", async () => {
  try {
    msg(settingsMsg, "");
    const user = auth.currentUser;
    if (!user) return;

    const username = normalizeUsername(settingsUsername?.value || "");
    if (username.length < 3) throw new Error("Username must be at least 3 characters.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Username can contain letters, numbers, _ . - only.");

    const photoRaw = (settingsPhotoUrl?.value || "").trim();
    const photoUrl = photoRaw ? normalizeUrl(photoRaw) : null;
    if (photoRaw && !photoUrl) throw new Error("Profile photo must be a valid http/https URL.");

    // claim username (unique)
    await ensureUsernameUnique(username, user.uid);

    await setDoc(doc(db, "users", user.uid), {
      username,
      photoUrl: photoUrl || null,
      updatedAt: serverTimestamp()
    }, { merge: true });

    msg(settingsMsg, "Saved!");
    await refreshUI(user);
    await loadPosts();
  } catch (e) {
    console.error(e);
    msg(settingsMsg, e?.message || String(e));
  }
});

/* ---------------- posting ---------------- */

btnPublish?.addEventListener("click", async () => {
  try {
    msg(publishMsg, "");
    const user = auth.currentUser;
    if (!user) return;

    const prof = await getMyProfile(user.uid);
    if (!prof?.username) throw new Error("Set your username first.");

    const isVerified = !!prof?.verified;

    const title = (postTitle?.value || "").trim();
    const body = (postBody?.value || "").trim();
    if (!title || !body) throw new Error("Title and text are required.");

    await addDoc(collection(db, "posts"), {
      category: (postCategory?.value || "fr/general"),
      title,
      body,
      imageUrl: normalizeUrl(imageUrl?.value || "") || null,
      videoUrl: normalizeUrl(videoUrl?.value || "") || null,

      authorUid: user.uid,
      authorUsername: prof.username,
      authorPhotoUrl: prof.photoUrl || null,
      authorVerified: isVerified, // ✅ denormalized for fast display

      createdAt: serverTimestamp(),
      likeCount: 0,
      dislikeCount: 0
    });

    if (postTitle) postTitle.value = "";
    if (postBody) postBody.value = "";
    if (imageUrl) imageUrl.value = "";
    if (videoUrl) videoUrl.value = "";
    if (postCategory) postCategory.value = "fr/general";

    msg(publishMsg, "Posted!");

    currentPostId = null;
    setPostInUrl(null);

    await loadPosts();
  } catch (e) {
    console.error(e);
    msg(publishMsg, e?.message || String(e));
  }
});

/* ---------------- votes ---------------- */

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

/* ---------------- replies ---------------- */

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
      authorVerified: !!prof?.verified, // ✅ denormalized
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
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
}

/* ---------------- feed load: category + single post ---------------- */

async function loadPosts() {
  if (!postsEl) return;

  syncStateFromUrl();

  postsEl.innerHTML = "";
  setLoading(true, "Loading posts…");

  const singlePostMode = !!currentPostId;

  let docs = [];
  try {
    const qNew = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(160));
    const snapNew = await getDocs(qNew);
    docs = snapNew.docs;
  } catch {
    const snapAny = await getDocs(collection(db, "posts"));
    docs = snapAny.docs;
  }

  docs.sort((a, b) => {
    const ta = a.data().createdAt?.toMillis?.() || 0;
    const tb = b.data().createdAt?.toMillis?.() || 0;
    return tb - ta;
  });

  let rendered = 0;

  for (const d of docs) {
    if (rendered >= 160) break;

    const p = d.data();
    const postId = d.id;
    const cat = p.category || "fr/general";

    if (!singlePostMode && currentCategory !== "all" && cat !== currentCategory) continue;
    if (singlePostMode && postId !== currentPostId) continue;

    const displayName = p.authorUsername || p.author || "Anonymous";
    const avatar = p.authorPhotoUrl || defaultPersonAvatar(displayName);

    // ✅ verified flag (fast if stored on post; fallback to user lookup for old posts)
    let isVerified = !!p.authorVerified;
    if (!("authorVerified" in p) && p.authorUid) {
      isVerified = await getVerifiedByUid(p.authorUid);
    }

    const myVote = await getMyVote(postId);
    const replies = await loadReplies(postId);

    const safeCat = String(cat).replaceAll("<", "&lt;");
    const safeTitle = (p.title || "").replaceAll("<", "&lt;");
    const safeBody = (p.body || "").replaceAll("<", "&lt;").replaceAll("\n", "<br>");

    const postHref = buildUrl({ c: currentCategory !== "all" ? currentCategory : null, p: postId });
    const catHref = buildUrl({ c: cat, p: null });

    const div = document.createElement("div");
    div.className = "post2014";
    div.innerHTML = `
      <div class="postHead">
        <img class="avatar2014" src="${avatar}" alt="pfp" />
        <div>
          <div class="postTitle">
            <a class="postLink" href="${postHref}">${safeTitle}</a>
            <a class="tagCat" href="${catHref}">${safeCat}</a>
          </div>
          <div class="postMeta">
            by <b>${String(displayName).replaceAll("<","&lt;")}${verifiedBadge(isVerified)}</b>
          </div>
        </div>
      </div>

      <div class="postBody">${safeBody}</div>

      <div class="pills">
        <button class="pill ${myVote === 1 ? "" : "off"}" data-like="1">👍 Like (${p.likeCount || 0})</button>
        <button class="pill ${myVote === -1 ? "" : "off"}" data-like="-1">👎 Dislike (${p.dislikeCount || 0})</button>
        <button class="pill off" data-reply="1">💬 Reply</button>
        <button class="pill off" data-copy="1">🔗 Link</button>
        ${singlePostMode ? `<button class="pill off" data-back="1">⬅ Back</button>` : ""}
      </div>

      <div class="replyBox">
        <div class="postMeta"><b>Replies</b></div>
        ${replies.length ? replies.map(r => {
          const rName = (r.authorUsername || "Anonymous").replaceAll("<","&lt;");
          const rAvatar = r.authorPhotoUrl || defaultPersonAvatar(r.authorUsername || "user");
          const rVerified = !!r.authorVerified;
          const rText = (r.text || "").replaceAll("<","&lt;").replaceAll("\n","<br>");
          return `
            <div class="replyItem">
              <div class="replyMeta">
                <img src="${rAvatar}" />
                <span><b>${rName}${verifiedBadge(rVerified)}</b></span>
              </div>
              <div>${rText}</div>
            </div>
          `;
        }).join("") : `<div class="muted">No replies yet.</div>`}
      </div>
    `;

    div.querySelector('[data-like="1"]').addEventListener("click", () => vote(postId, 1));
    div.querySelector('[data-like="-1"]').addEventListener("click", () => vote(postId, -1));
    div.querySelector('[data-reply="1"]').addEventListener("click", () => openReply(postId, p.title));

    // copy link
    div.querySelector('[data-copy="1"]').addEventListener("click", async () => {
      const share = `${location.origin}${location.pathname}?p=${postId}`;
      try {
        await navigator.clipboard.writeText(share);
        alert("Post link copied!");
      } catch {
        prompt("Copy post link:", share);
      }
    });

    // back button
    const backBtn = div.querySelector('[data-back="1"]');
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        currentPostId = null;
        setPostInUrl(null);
        loadPosts();
      });
    }

    postsEl.appendChild(div);
    rendered++;

    if (singlePostMode) break;
  }

  setLoading(false);
}

/* ---------------- show username in header + gate UI ---------------- */

async function refreshUI(user) {
  const prof = await getMyProfile(user.uid);
  const hasProfile = !!prof?.username;

  if (btnLogout) btnLogout.classList.remove("hidden");

  if (userLabel) {
    const badge = verifiedBadge(!!prof?.verified);
    userLabel.textContent = hasProfile
      ? `${prof.username}${badge}`
      : (user.isAnonymous ? "Anonymous user" : (user.email || "Phone user"));
  }

  if (btnOpenSettings) btnOpenSettings.classList.toggle("hidden", !hasProfile);

  show(profileCard, !hasProfile);
  show(composerCard, hasProfile);
  show(feed, hasProfile);

  if (hasProfile) await loadPosts();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }
  await refreshUI(user);
});

