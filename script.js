// ============================================================
// FIREBASE SETUP
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAWcAYxR5teUk1I4qeWSo4DF6ATKw2WxNQ",
  authDomain: "loveones-17269.firebaseapp.com",
  projectId: "loveones-17269",
  storageBucket: "loveones-17269.firebasestorage.app",
  messagingSenderId: "452778300476",
  appId: "1:452778300476:web:776f481afac2fcf0061f39",
  measurementId: "G-0W94VL1JXS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ============================================================
// CLOUDINARY CONFIG
// ============================================================
// Photos now go straight to Cloudinary (unsigned upload preset).
// Firestore only ever stores the resulting URL (metadata), never the
// image bytes — this sidesteps Firebase Storage's CORS setup entirely.
const CLOUDINARY_CLOUD_NAME = 'dcrr2wlh8';
const CLOUDINARY_UPLOAD_PRESET = 'Loveones';
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// ============================================================
// ANONYMOUS AUTH
// ============================================================
// Firestore/Storage rules now require request.auth != null, so every
// visitor gets silently signed in anonymously before we touch the DB.
// This doesn't identify who they are — it just satisfies the rule
// that requests must come from a signed-in Firebase user, not from
// anyone who happens to have the public API key.
const syncStatusEl = () => document.getElementById('syncStatus');

let authReadyResolve;
const authReady = new Promise(resolve => { authReadyResolve = resolve; });

onAuthStateChanged(auth, (user) => {
    if (user) {
        if (syncStatusEl()) syncStatusEl().textContent = 'synced';
        authReadyResolve(user);
    }
});

signInAnonymously(auth).catch(err => {
    console.error('anonymous auth error:', err);
    if (syncStatusEl()) syncStatusEl().textContent = 'connection error';
});

// ============================================================
// CLOUDINARY UPLOAD
// ============================================================
async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Cloudinary upload failed (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  return data.secure_url; // this is the only thing we store in Firestore
}

async function uploadAllPhotos(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return [];
  return Promise.all(files.map(file => uploadToCloudinary(file)));
}

// ============================================================
// PASSCODE LOCK (unchanged logic)
// ============================================================
const PASSCODE = '03302022';
const MAX_ATTEMPTS = 5;
let entered = '', attempts = 0, locked = false;

// Local in-memory caches, kept in sync with Firestore in real time
let memories = [];
let messages = [];
let messageRefreshTimer = null;
let datePlans = [];
let wishlists = [];

let currentDateTab = 'planned';
let currentDateSubtab = 'upcoming';
let currentViewingDateId = null;
let lastSurprise = { food: null, place: null, timeOfDay: null };

// ============================================================
// LETTER DESIGN VARIANTS (Option A — saved per letter forever)
// 6 palettes × 5 patterns × 4 seals × 4 ribbons × 5 page styles
// ============================================================
const LETTER_PALETTES = {
    cream: {
        label: 'Cream',
        paper: '#fffdf5',
        paperAccent: '#f9f0dc',
        dotColor: 'rgba(196, 92, 58, VAR_ALPHA)',
        dotColor2: 'rgba(214, 125, 83, VAR_ALPHA)',
        seal: '#c65d3c',
        sealDark: '#9d4a2f',
        sealIcon: '❤️',
        ribbon: 'var(--terracotta)',
        ribbonAlt: '#e8d9bf',
        pageBg: 'linear-gradient(135deg, #fff 0%, #fff8ed 100%)',
        pageLine: 'rgba(191, 169, 140, 0.1)',
        accentText: '#6b4a2e',
    },
    blush: {
        label: 'Blush',
        paper: '#fff6f5',
        paperAccent: '#f8e4de',
        dotColor: 'rgba(199, 96, 109, VAR_ALPHA)',
        dotColor2: 'rgba(225, 142, 151, VAR_ALPHA)',
        seal: '#c36672',
        sealDark: '#9a4e59',
        sealIcon: '💕',
        ribbon: '#c36672',
        ribbonAlt: '#f8d7db',
        pageBg: 'linear-gradient(135deg, #fff 0%, #fff2f0 100%)',
        pageLine: 'rgba(215, 163, 171, 0.1)',
        accentText: '#78413a',
    },
    sage: {
        label: 'Sage',
        paper: '#f6f9f4',
        paperAccent: '#e0ecd8',
        dotColor: 'rgba(102, 143, 100, VAR_ALPHA)',
        dotColor2: 'rgba(140, 176, 138, VAR_ALPHA)',
        seal: '#6a8f67',
        sealDark: '#527250',
        sealIcon: '🌿',
        ribbon: '#6a8f67',
        ribbonAlt: '#dce8d7',
        pageBg: 'linear-gradient(135deg, #ffffff 0%, #f4f8f2 100%)',
        pageLine: 'rgba(150, 185, 147, 0.12)',
        accentText: '#4b6642',
    },
    lavender: {
        label: 'Lavender',
        paper: '#fbf7ff',
        paperAccent: '#e8dff6',
        dotColor: 'rgba(126, 98, 172, VAR_ALPHA)',
        dotColor2: 'rgba(161, 137, 204, VAR_ALPHA)',
        seal: '#8a6fb9',
        sealDark: '#6b5393',
        sealIcon: '🌙',
        ribbon: '#8a6fb9',
        ribbonAlt: '#e3d7f2',
        pageBg: 'linear-gradient(135deg, #ffffff 0%, #f7f2ff 100%)',
        pageLine: 'rgba(160, 135, 200, 0.1)',
        accentText: '#563f7d',
    },
    honey: {
        label: 'Honey',
        paper: '#fffaf1',
        paperAccent: '#faecd1',
        dotColor: 'rgba(191, 132, 40, VAR_ALPHA)',
        dotColor2: 'rgba(225, 168, 80, VAR_ALPHA)',
        seal: '#c4841f',
        sealDark: '#986718',
        sealIcon: '🌼',
        ribbon: '#c4841f',
        ribbonAlt: '#f5e3b9',
        pageBg: 'linear-gradient(135deg, #fff 0%, #fff8e9 100%)',
        pageLine: 'rgba(214, 175, 98, 0.12)',
        accentText: '#7a5315',
    },
    rose: {
        label: 'Rose',
        paper: '#fff7fb',
        paperAccent: '#f6e2ed',
        dotColor: 'rgba(179, 86, 130, VAR_ALPHA)',
        dotColor2: 'rgba(214, 132, 170, VAR_ALPHA)',
        seal: '#b15583',
        sealDark: '#8b4368',
        sealIcon: '🌹',
        ribbon: '#b15583',
        ribbonAlt: '#f2d6e4',
        pageBg: 'linear-gradient(135deg, #ffffff 0%, #fff3f9 100%)',
        pageLine: 'rgba(190, 120, 156, 0.12)',
        accentText: '#753455',
    },
};

const LETTER_PATTERNS = [
    {
        id: 'hearts',
        // Dotted hearts pattern (radial gradients)
        apply: (palette, density = 'md') => {
            const s = density === 'sm' ? '110px 130px' : '140px 160px';
            const a1 = density === 'sm' ? '0.2' : '0.24';
            const a2 = density === 'sm' ? '0.16' : '0.19';
            const s1 = density === 'sm' ? '4.5px' : '5.5px';
            const s2 = density === 'sm' ? '3.5px' : '4.5px';
            const s3 = density === 'sm' ? '4px' : '5px';
            const s4 = density === 'sm' ? '3px' : '4px';
            const s5 = density === 'sm' ? '4.5px' : '5.5px';
            const s6 = density === 'sm' ? '3.5px' : '4.5px';
            const s7 = density === 'sm' ? '3px' : '4px';
            const s8 = density === 'sm' ? '2.5px' : '3.5px';
            const s9 = density === 'sm' ? '4px' : '5px';
            const s10 = density === 'sm' ? '4.5px' : '5.5px';
            const s11 = density === 'sm' ? '3px' : '4px';
            const c1 = palette.dotColor.replace('VAR_ALPHA', a1);
            const c2 = palette.dotColor2.replace('VAR_ALPHA', a2);
            return `
                radial-gradient(circle at 20% 25%, ${c1} ${s1}, transparent calc(${s1} + 1.5px)),
                radial-gradient(circle at 60% 65%, ${c2} ${s2}, transparent calc(${s2} + 1.5px)),
                radial-gradient(circle at 80% 18%, ${c1} ${s3}, transparent calc(${s3} + 1.5px)),
                radial-gradient(circle at 40% 82%, ${c2} ${s4}, transparent calc(${s4} + 1.5px)),
                radial-gradient(circle at 90% 50%, ${c1} ${s5}, transparent calc(${s5} + 1.5px)),
                radial-gradient(circle at 15% 60%, ${c2} ${s6}, transparent calc(${s6} + 1.5px)),
                radial-gradient(circle at 70% 40%, ${c1} ${s7}, transparent calc(${s7} + 1.5px)),
                radial-gradient(circle at 32% 48%, ${c2} ${s8}, transparent calc(${s8} + 1.5px)),
                radial-gradient(circle at 50% 10%, ${c1} ${s9}, transparent calc(${s9} + 1.5px)),
                radial-gradient(circle at 75% 85%, ${c2} ${s10}, transparent calc(${s10} + 1.5px)),
                radial-gradient(circle at 10% 42%, ${c1} ${s11}, transparent calc(${s11} + 1.5px))
            `;
        },
        backgroundSize: { sm: '110px 130px', md: '140px 160px', lg: '160px 180px' },
        opacity: { md: 0.82 },
    },
    {
        id: 'daisies',
        apply: (palette, density = 'md') => {
            const c1 = palette.dotColor.replace('VAR_ALPHA', '0.22');
            const c2 = palette.dotColor2.replace('VAR_ALPHA', '0.14');
            const c3 = palette.dotColor.replace('VAR_ALPHA', '0.12');
            return `
                radial-gradient(circle at 15% 20%, ${c1} 3px, transparent 4px),
                radial-gradient(circle at 85% 15%, ${c2} 4px, transparent 5px),
                radial-gradient(circle at 45% 75%, ${c1} 3.5px, transparent 4.5px),
                radial-gradient(circle at 70% 55%, ${c3} 2.5px, transparent 3.5px),
                radial-gradient(circle at 25% 60%, ${c2} 3px, transparent 4px),
                radial-gradient(circle at 60% 28%, ${c1} 4px, transparent 5px),
                radial-gradient(circle at 10% 85%, ${c3} 3px, transparent 4px),
                radial-gradient(circle at 90% 80%, ${c1} 3.5px, transparent 4.5px),
                radial-gradient(circle at 35% 35%, ${c2} 2.5px, transparent 3.5px),
                radial-gradient(circle at 55% 50%, ${c1} 3px, transparent 4px)
            `;
        },
        backgroundSize: { sm: '100px 110px', md: '130px 150px', lg: '160px 190px' },
        opacity: { md: 0.88 },
    },
    {
        id: 'stars',
        apply: (palette, density = 'md') => {
            const c1 = palette.dotColor.replace('VAR_ALPHA', '0.25');
            const c2 = palette.dotColor2.replace('VAR_ALPHA', '0.18');
            const s = density === 'sm' ? '100px 115px' : '130px 150px';
            return `
                radial-gradient(circle at 20% 30%, ${c1} 2.5px, transparent 3.5px),
                radial-gradient(circle at 65% 15%, ${c2} 2px, transparent 3px),
                radial-gradient(circle at 80% 65%, ${c1} 3px, transparent 4px),
                radial-gradient(circle at 30% 80%, ${c2} 2.5px, transparent 3.5px),
                radial-gradient(circle at 50% 50%, ${c1} 2px, transparent 3px),
                radial-gradient(circle at 10% 55%, ${c2} 2.5px, transparent 3.5px),
                radial-gradient(circle at 88% 35%, ${c1} 2px, transparent 3px),
                radial-gradient(circle at 40% 20%, ${c2} 2px, transparent 3px)
            `;
        },
        backgroundSize: { sm: '90px 105px', md: '120px 140px', lg: '150px 180px' },
        opacity: { md: 0.9 },
    },
    {
        id: 'polka',
        apply: (palette, density = 'md') => {
            const c = palette.dotColor.replace('VAR_ALPHA', '0.22');
            return `radial-gradient(circle, ${c} 2.8px, transparent 3.2px)`;
        },
        backgroundSize: { sm: '22px 22px', md: '28px 28px', lg: '32px 32px' },
        opacity: { md: 0.85 },
    },
    {
        id: 'plain',
        apply: () => 'none',
        backgroundSize: { sm: 'auto', md: 'auto', lg: 'auto' },
        opacity: { md: 0 },
    },
];

const LETTER_SEALS = [
    { id: 'heart', icon: '❤️', defaultFallback: true },
    { id: 'flower', icon: '🌼' },
    { id: 'star', icon: '⭐' },
    { id: 'leaf', icon: '🍃' },
];

const LETTER_RIBBONS = [
    { id: 'twine', style: 'striped' },
    { id: 'gingham', style: 'gingham' },
    { id: 'solid', style: 'solid' },
    { id: 'stripes-v', style: 'stripes-vertical' },
];

const LETTER_PAGE_STYLES = [
    { id: 'lined',      lines: 'ruled',    tint: 1 },
    { id: 'wide-ruled', lines: 'wide',     tint: 1 },
    { id: 'dot-grid',   lines: 'dotgrid',  tint: 1 },
    { id: 'aged',       lines: 'plain',    tint: 2 },
    { id: 'plain',      lines: 'plain',    tint: 0 },
];

const ALL_PALETTE_IDS = Object.keys(LETTER_PALETTES);

function pickRandomLetterVariant() {
    return {
        paletteId: ALL_PALETTE_IDS[Math.floor(Math.random() * ALL_PALETTE_IDS.length)],
        patternId: LETTER_PATTERNS[Math.floor(Math.random() * LETTER_PATTERNS.length)].id,
        sealId: LETTER_SEALS[Math.floor(Math.random() * LETTER_SEALS.length)].id,
        ribbonId: LETTER_RIBBONS[Math.floor(Math.random() * LETTER_RIBBONS.length)].id,
        pageStyleId: LETTER_PAGE_STYLES[Math.floor(Math.random() * LETTER_PAGE_STYLES.length)].id,
    };
}

function normalizeLetterVariant(v) {
    if (!v || typeof v !== 'object') return pickRandomLetterVariant();
    return {
        paletteId:   (v.paletteId   && LETTER_PALETTES[v.paletteId])   ? v.paletteId   : ALL_PALETTE_IDS[0],
        patternId:   (v.patternId   && LETTER_PATTERNS.find(p => p.id === v.patternId)) ? v.patternId   : LETTER_PATTERNS[0].id,
        sealId:      (v.sealId      && LETTER_SEALS.find(s => s.id === v.sealId))       ? v.sealId      : LETTER_SEALS[0].id,
        ribbonId:    (v.ribbonId    && LETTER_RIBBONS.find(r => r.id === v.ribbonId))   ? v.ribbonId    : LETTER_RIBBONS[0].id,
        pageStyleId: (v.pageStyleId && LETTER_PAGE_STYLES.find(p => p.id === v.pageStyleId)) ? v.pageStyleId : LETTER_PAGE_STYLES[0].id,
    };
}

window.press = function (digit) {
    if (locked || entered.length >= 8) return;
    entered += digit;
    updateDots();
    if (entered.length === 8) setTimeout(checkCode, 120);
};

window.deleteLast = function () {
    if (locked) return;
    entered = entered.slice(0, -1);
    updateDots();
    setMsg('');
};

function updateDots() {
    for (let i = 0; i < 8; i++)
        document.getElementById('d' + i).classList.toggle('filled', i < entered.length);
}

function checkCode() {
    if (entered === PASSCODE) {
        setMsg('✓ Correct', 'success');
        setTimeout(() => {
            document.getElementById('successOverlay').classList.add('show');
            setTimeout(showApp, 2400);
        }, 400);
    } else {
        attempts++;
        entered = '';
        updateDots();
        const dotsEl = document.getElementById('dots');
        dotsEl.classList.add('shake');
        setTimeout(() => dotsEl.classList.remove('shake'), 450);

        if (attempts >= MAX_ATTEMPTS) {
            locked = true;
            setMsg('Too many attempts. Try again later.', 'error');
            document.getElementById('keypad').style.opacity = '0.35';
            document.getElementById('keypad').style.pointerEvents = 'none';
            setTimeout(() => {
                locked = false; attempts = 0;
                document.getElementById('keypad').style.opacity = '1';
                document.getElementById('keypad').style.pointerEvents = '';
                setMsg('');
            }, 30000);
        } else {
            const left = MAX_ATTEMPTS - attempts;
            setMsg(`Incorrect — ${left} attempt${left !== 1 ? 's' : ''} left`, 'error');
            setTimeout(() => setMsg(''), 2000);
        }
    }
}

function setMsg(text, type = '') {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = 'msg ' + type;
}

document.addEventListener('keydown', e => {
    if (e.key >= '0' && e.key <= '9') press(e.key);
    if (e.key === 'Backspace') deleteLast();
});

document.querySelectorAll('.key[data-num]').forEach(btn => {
    btn.addEventListener('pointerdown', () => btn.classList.add('pressed'));
    btn.addEventListener('pointerup', () => btn.classList.remove('pressed'));
    btn.addEventListener('pointerout', () => btn.classList.remove('pressed'));
});

// ============================================================
// APP NAVIGATION
// ============================================================
function showApp() {
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';
}

window.openSection = function (section) {
    document.querySelector('.app-container').style.display = 'none';
    document.getElementById(`${section}Section`).style.display = 'flex';
};

window.goHome = function () {
    document.querySelectorAll('.section-screen').forEach(s => s.style.display = 'none');
    document.querySelector('.app-container').style.display = 'block';
};

window.closeModal = function (modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.querySelectorAll('.floating-heart').forEach(h => {
        h.style.animationPlayState = '';
        h.style.opacity = '';
    });
    document.querySelectorAll('.floating-pic').forEach(p => {
        p.style.animationPlayState = '';
        p.style.opacity = '';
    });
};

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
    document.querySelectorAll('.floating-heart').forEach(h => {
        h.style.animationPlayState = 'paused';
        h.style.opacity = '0.1';
    });
    document.querySelectorAll('.floating-pic').forEach(p => {
        p.style.animationPlayState = 'paused';
        p.style.opacity = '0.15';
    });
}

// ============================================================
// REAL-TIME FIRESTORE SYNC
// ============================================================
// Set up real-time listeners (only after we're signed in, since the
// rules require request.auth != null to read)
async function setupFirestoreListeners() {
    await authReady;

    // Live listener: memories
    const memoriesQuery = query(collection(db, 'memories'), orderBy('date', 'desc'));
    onSnapshot(memoriesQuery, (snapshot) => {
        memories = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMemories();
    }, err => console.error('memories listener error:', err));

    // Live listener: messages
    const messagesQuery = query(collection(db, 'messages'), orderBy('createdAt', 'desc'));
    onSnapshot(messagesQuery, (snapshot) => {
        messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMessages();
    }, err => console.error('messages listener error:', err));

    // Live listener: date plans
    const datesQuery = query(collection(db, 'datePlans'), orderBy('dateDay', 'asc'));
    onSnapshot(datesQuery, (snapshot) => {
        datePlans = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDatePlans();
    }, err => console.error('datePlans listener error:', err));

    // Live listener: wishlist
    const wishlistQuery = query(collection(db, 'wishlists'), orderBy('createdAt', 'desc'));
    onSnapshot(wishlistQuery, (snapshot) => {
        wishlists = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderWishlists();
    }, err => console.error('wishlists listener error:', err));
}

// Start listeners immediately (will wait internally for auth)
setupFirestoreListeners();

// ============================================================
// MEMORIES
// ============================================================
window.openAddMemoryForm = function () {
    document.getElementById('addMemoryForm').reset();
    openModal('addMemoryModal');
};

async function saveMemory(e) {
    e.preventDefault();
    const date = document.getElementById('memoryDate').value;
    const description = document.getElementById('memoryDescription').value;
    const photoInput = document.getElementById('memoryPhotos');
    const btn = document.getElementById('memorySubmitBtn');

    btn.disabled = true;
    btn.textContent = 'Uploading photos...';

    try {
        await authReady;
        const photos = await uploadAllPhotos(photoInput.files);
        btn.textContent = 'Saving...';

        await addDoc(collection(db, 'memories'), {
            date,
            description,
            photos,
            createdAt: serverTimestamp()
        });

        closeModal('addMemoryModal');
    } catch (err) {
        console.error(err);
        alert("Couldn't save this memory — check your Firebase settings and connection, then try again.");
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Memory';
    }
}

function renderMemories() {
    const container = document.getElementById('memoriesList');
    if (memories.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Our story hasn't started here yet — add the first memory.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = memories.map(memory => {
        const photoCount = (memory.photos && memory.photos.length) ? memory.photos.length : 0;
        let photosHtml = '';

        if (photoCount === 0) {
            photosHtml = '<div class="memory-cover-empty"><i class="fas fa-heart"></i></div>';
        } else {
            // Determine the layout
            let displayPhotos;
            let colsClass;
            let showMore = false;
            let moreCount = 0;
            let lastPhotoForMore = null;

            if (photoCount <= 3) {
                displayPhotos = memory.photos;
                colsClass = `cols-${photoCount}`;
            } else if (photoCount === 4) {
                // Exactly 4 photos: show all 4 in 2x2 grid
                displayPhotos = memory.photos;
                colsClass = 'cols-4';
            } else {
                // 5 or more: show first 3 photos + overlay (+N) as the 4th tile!
                displayPhotos = memory.photos.slice(0, 3);
                colsClass = 'cols-4'; // Use 2x2 (cols-4) layout so overlay is 4th tile (bottom-right)
                showMore = true;
                moreCount = photoCount - 3;
                lastPhotoForMore = memory.photos[3]; // Use the 4th photo as overlay background
            }

            // Build grid
            photosHtml = `<div class="memory-photos-grid ${colsClass}">`;

            if (photoCount === 1) {
                // Single photo, taller (height controlled with CSS .cols-1 .memory-photo)
                photosHtml += `<div class="memory-photo" style="background-image: url('${memory.photos[0]}');"></div>`;
            } else {
                displayPhotos.forEach(photo => {
                    photosHtml += `<div class="memory-photo" style="background-image: url('${photo}');"></div>`;
                });

                if (showMore) {
                    photosHtml += `<div class="memory-photo more-overlay" style="background-image: url('${lastPhotoForMore}');">
                        <span>+${moreCount}</span>
                    </div>`;
                }
            }

            photosHtml += `</div>`;
        }

        return `
            <div class="memory-card">
                ${photosHtml}
                <div class="memory-info">
                    <div class="memory-date">${formatDate(memory.date)}</div>
                    <div class="memory-preview">${escapeHtml(memory.description)}</div>
                    <button class="view-btn" onclick="viewMemory('${memory.id}')">View Memory</button>
                </div>
            </div>
        `;
    }).join('');
}

window.viewMemory = function (id) {
    const memory = memories.find(m => m.id === id);
    if (!memory) return;
    document.getElementById('viewMemoryDate').textContent = formatDate(memory.date);
    document.getElementById('viewMemoryDescription').textContent = memory.description;
    const gallery = document.getElementById('memoryGallery');

    if (memory.photos && memory.photos.length > 0) {
        gallery.innerHTML = memory.photos.map(photo => `<img src="${photo}" alt="Memory photo">`).join('');
    } else {
        gallery.innerHTML = '';
    }

    openModal('viewMemoryModal');
};

// ============================================================
// MESSAGES
// ============================================================
window.openAddMessageForm = function () {
    document.getElementById('addMessageForm').reset();
    openModal('addMessageModal');
};

async function saveMessage(e) {
    e.preventDefault();
    const text = document.getElementById('messageText').value;
    const displayDate = document.getElementById('messageDisplayDate').value || null;
    const photoInput = document.getElementById('messagePhotos');
    const btn = document.getElementById('messageSubmitBtn');

    btn.disabled = true;
    btn.textContent = 'Uploading photos...';

    try {
        await authReady;
        const photos = await uploadAllPhotos(photoInput.files);
        btn.textContent = 'Sealing...';

        const variant = pickRandomLetterVariant();
        await addDoc(collection(db, 'messages'), {
            text,
            photos,
            variant,
            displayDate,
            createdAt: serverTimestamp()
        });

        closeModal('addMessageModal');
    } catch (err) {
        console.error(err);
        alert("Couldn't save this letter — check your Firebase settings and connection, then try again.");
    } finally {
        btn.disabled = false;
        btn.textContent = 'Seal the Letter';
    }
}

// Build a ribbon CSS gradient string based on ribbon style + palette
function buildRibbonBackground(ribbonId, palette) {
    const a = palette.seal;
    const b = palette.paper;
    const c = palette.ribbonAlt;
    switch (ribbonId) {
        case 'solid':
            return a;
        case 'gingham':
            // Warm gingham pattern (2-tone checks)
            return `
                linear-gradient(90deg,
                    ${a}22 0%, ${a}22 12.5%,
                    ${b} 12.5%, ${b} 25%,
                    ${a}22 25%, ${a}22 37.5%,
                    ${b} 37.5%, ${b} 50%,
                    ${a}22 50%, ${a}22 62.5%,
                    ${b} 62.5%, ${b} 75%,
                    ${a}22 75%, ${a}22 87.5%,
                    ${b} 87.5%, ${b} 100%),
                linear-gradient(0deg,
                    ${a}22 0%, ${a}22 12.5%,
                    transparent 12.5%, transparent 25%,
                    ${a}22 25%, ${a}22 37.5%,
                    transparent 37.5%, transparent 50%,
                    ${a}22 50%, ${a}22 62.5%,
                    transparent 62.5%, transparent 75%,
                    ${a}22 75%, ${a}22 87.5%,
                    transparent 87.5%, transparent 100%),
                ${c}
            `;
        case 'stripes-v':
            return `repeating-linear-gradient(90deg, ${a} 0px, ${a} 6px, ${c} 6px, ${c} 11px, ${b} 11px, ${b} 18px, ${c} 18px, ${c} 23px)`;
        case 'twine':
        default:
            return `repeating-linear-gradient(45deg,
                ${a} 0px, ${a} 8px,
                ${b} 8px, ${b} 15px,
                ${c} 15px, ${c} 22px,
                ${b} 22px, ${b} 29px)`;
    }
}

// Build inline style (CSS variables) for a letter card from its variant
function buildLetterCardStyle(variant) {
    const v = normalizeLetterVariant(variant);
    const palette = LETTER_PALETTES[v.paletteId];
    const pattern = LETTER_PATTERNS.find(p => p.id === v.patternId) || LETTER_PATTERNS[0];
    const patternImage = pattern.apply(palette, 'md');
    const patternSize = pattern.backgroundSize.md;
    const patternOpacity = (typeof pattern.opacity?.md === 'number') ? pattern.opacity.md : 0.8;

    const sealIcon = LETTER_SEALS.find(s => s.id === v.sealId)?.icon || '❤️';
    const ribBg = buildRibbonBackground(v.ribbonId, palette);

    const sealHexLight = palette.seal.startsWith('#')
        ? shadeHex(palette.seal, 10)
        : shadeHex('#c65d3c', 10);
    const sealHexDark = palette.seal.startsWith('#')
        ? shadeHex(palette.seal, -18)
        : shadeHex('#c65d3c', -18);

    // Seal shadow — palette.seal with varying alpha
    const sealShadowRgb = hexToRgba(palette.seal, 0.55);
    const sealInset = hexToRgba(palette.sealDark, 0.35);
    const sealRing = hexToRgba(palette.sealDark, 0.48);

    const sealAlpha = hexToRgba(palette.seal, 0.4);
    const sealBeta = hexToRgba(palette.seal, 0.5);

    const paperPill = hexToRgba(palette.paper, 0.68);
    const border = hexToRgba(palette.sealDark, 0.22);
    const ribbonShade = hexToRgba(palette.sealDark, 0.14);

    const patternSm = pattern.apply(palette, 'sm');
    const patternSizeSm = pattern.backgroundSize.sm;

    const vars = `
        --l-paper: ${palette.paper};
        --l-shadow: ${hexToRgba(palette.sealDark, 0.12)};
        --l-pattern: ${patternImage};
        --l-pattern-size: ${patternSize};
        --l-pattern-opacity: ${patternOpacity};
        --l-border: ${border};
        --l-seal: ${palette.seal};
        --l-seal-light: ${sealHexLight};
        --l-seal-dark: ${sealHexDark};
        --l-seal-shadow: ${sealShadowRgb};
        --l-seal-inset: ${sealInset};
        --l-seal-ring: ${sealRing};
        --l-seal-alpha: ${sealAlpha};
        --l-seal-beta: ${sealBeta};
        --l-text: ${palette.accentText};
        --l-text-accent: ${palette.accentText};
        --l-paper-pill: ${paperPill};
        --l-ribbon-bg: ${ribBg};
        --l-ribbon-a: ${palette.seal};
        --l-ribbon-b: ${palette.paper};
        --l-ribbon-c: ${palette.ribbonAlt};
        --l-ribbon-shadow: ${ribbonShade};
        --l-ribbon-shadow-2: ${ribbonShade};
        --l-seal-icon: "${sealIcon}";
        --l-pattern-sm: ${patternSm};
        --l-pattern-size-sm: ${patternSizeSm};
    `;
    return { css: vars, sealIcon, palette, pattern };
}

// Build inline style for the open book modal from its variant
function buildBookModalStyle(variant) {
    const v = normalizeLetterVariant(variant);
    const palette = LETTER_PALETTES[v.paletteId];
    const pageStyle = LETTER_PAGE_STYLES.find(p => p.id === v.pageStyleId) || LETTER_PAGE_STYLES[0];

    // Aged tint: add subtle aged paper overlay
    let bg = palette.pageBg;
    let decorGlow = palette.seal;
    if (pageStyle.tint === 2) {
        bg = `linear-gradient(135deg, ${palette.paper} 0%, ${palette.paperAccent} 55%, ${shadeHex(palette.paperAccent, -8)} 100%)`;
    } else if (pageStyle.tint === 1) {
        bg = palette.pageBg;
    } else {
        bg = `linear-gradient(135deg, #fff 0%, ${palette.paper} 100%)`;
    }

    const ruleGap = pageStyle.lines === 'wide' ? '52px' : pageStyle.lines === 'dotgrid' ? '22px' : '40px';
    let lineBg;
    if (pageStyle.lines === 'dotgrid') {
        lineBg = `radial-gradient(${hexToRgba(palette.seal, 0.14)} 1.3px, transparent 1.6px)`;
    } else if (pageStyle.lines === 'plain') {
        lineBg = 'none';
    } else {
        lineBg = `repeating-linear-gradient(to bottom,
            transparent 0px,
            transparent calc(${ruleGap} - 1px),
            ${palette.pageLine} calc(${ruleGap} - 1px),
            ${palette.pageLine} ${ruleGap}
        )`;
    }

    const sealLight = palette.seal.startsWith('#')
        ? shadeHex(palette.seal, 10) : '#d96c48';
    const sealDark = palette.seal.startsWith('#')
        ? shadeHex(palette.seal, -18) : '#9d4a2f';

    const bookShadow = hexToRgba(palette.sealDark, 0.2);

    const glow1 = hexToRgba(palette.paper, 0.98);
    const glow2 = hexToRgba(palette.paper, 0.92);
    const glow3 = hexToRgba(palette.paper, 0.78);

    return `
        --book-bg: ${bg};
        --book-lines: ${lineBg};
        --book-line: ${palette.pageLine};
        --book-seal: ${palette.seal};
        --book-seal-light: ${sealLight};
        --book-seal-dark: ${sealDark};
        --book-text-accent: ${palette.accentText};
        --book-shadow: ${bookShadow};
        --book-glow: ${glow1};
        --book-glow-2: ${glow2};
        --book-glow-3: ${glow3};
    `;
}

// Lighten/darken a hex color by a positive or negative percentage
function shadeHex(hex, percent) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const num = parseInt(h, 16);
    let r = (num >> 16) + Math.round(255 * (percent / 100));
    let g = ((num >> 8) & 0x00FF) + Math.round(255 * (percent / 100));
    let b = (num & 0x0000FF) + Math.round(255 * (percent / 100));
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgba(input, alpha) {
    if (!input) return `rgba(196, 92, 58, ${alpha})`;
    let h = String(input).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(196, 92, 58, ${alpha})`;
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderMessages() {
    clearTimeout(messageRefreshTimer);
    const nextLocalMidnight = new Date();
    nextLocalMidnight.setHours(24, 0, 0, 0);
    messageRefreshTimer = setTimeout(renderMessages, nextLocalMidnight - new Date());

    const container = document.getElementById('messagesList');
    const today = getLocalDateString();
    const visibleMessages = messages.filter(msg => !msg.displayDate || msg.displayDate <= today);
    if (visibleMessages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No love letters yet — write the first one.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = visibleMessages.map(msg => {
        const styleInfo = buildLetterCardStyle(msg.variant);
        return `
        <div class="letter-card" onclick="viewMessage('${msg.id}')" style="${styleInfo.css}">
            <div class="letter-flap letter-flap-left"></div>
            <div class="letter-flap letter-flap-right"></div>
            <div class="letter-corner tl"></div>
            <div class="letter-corner tr"></div>
            <div class="letter-corner bl"></div>
            <div class="letter-corner br"></div>
            <div class="letter-ribbon"></div>
            <div class="letter-center">
                <div class="letter-seal" title="">${styleInfo.sealIcon}</div>
                <div class="letter-date">${formatMessageDisplayDate(msg)}</div>
                <div class="letter-preview">"${escapeHtml(msg.text.substring(0, 40))}${msg.text.length > 40 ? '...' : ''}"</div>
                <div class="letter-open-hint">~ tap to unwrap ~</div>
            </div>
        </div>
        `;
    }).join('');
}

window.viewMessage = function (id) {
    const msg = messages.find(m => m.id === id);
    if (!msg) return;

    const variant = normalizeLetterVariant(msg.variant);
    const palette = LETTER_PALETTES[variant.paletteId];
    const pageStyle = LETTER_PAGE_STYLES.find(p => p.id === variant.pageStyleId);
    const seal = LETTER_SEALS.find(s => s.id === variant.sealId);

    // Apply book-level styles to the modal (palette, page lines, glow)
    const modalEl = document.getElementById('viewMessageModal');
    if (!modalEl) return;
    modalEl.style.cssText = ''; // clear
    modalEl.setAttribute('style', buildBookModalStyle(variant));

    // Apply page backgrounds (left / right) via the two .book-page elements
    // Left page has an extra spine shadow gradient baked in
    const pages = modalEl.querySelectorAll('.book-page');
    pages.forEach(p => {
        const isLeft = p.classList.contains('book-page-left');
        const isRight = p.classList.contains('book-page-right');
        const edgeGradient = isLeft
            ? `linear-gradient(to right,
                transparent 0%,
                transparent calc(100% - 40px),
                ${hexToRgba(palette.seal, 0.06)} calc(100% - 2px),
                ${hexToRgba(palette.sealDark, 0.22)} 100%)`
            : isRight
                ? `linear-gradient(to left,
                    transparent 0%,
                    transparent calc(100% - 40px),
                    ${hexToRgba(palette.seal, 0.06)} calc(100% - 2px),
                    ${hexToRgba(palette.sealDark, 0.22)} 100%)`
                : 'none';
        p.style.cssText = '';
        p.style.setProperty('background-color', palette.paper);

        // Rule sizing: dot-grid uses its own small tile, lines use pageStyle ruleGap
        const lineSize = (pageStyle && pageStyle.lines === 'wide')
            ? `100% 52px, cover, cover`
            : (pageStyle && pageStyle.lines === 'dotgrid')
                ? `22px 22px, cover, cover`
                : `100% 40px, cover, cover`;
        const lineBgRepeat = 'repeat, no-repeat, no-repeat';

        if (isLeft || isRight) {
            p.style.setProperty('background-image',
                `var(--book-lines), var(--book-bg), ${edgeGradient}`);
            p.style.setProperty('background-size', lineSize);
            p.style.setProperty('background-repeat', lineBgRepeat);
        } else {
            p.style.setProperty('background-image',
                `var(--book-lines), var(--book-bg)`);
            p.style.setProperty('background-size', (pageStyle && pageStyle.lines === 'wide') ? '100% 52px, cover' : (pageStyle && pageStyle.lines === 'dotgrid') ? '22px 22px, cover' : '100% 40px, cover');
            p.style.setProperty('background-repeat', 'repeat, no-repeat');
        }
        // Start line pattern offset below header so it aligns nicely
        const lineOffset = (pageStyle && pageStyle.lines === 'wide') ? '0 44px, 0 0, 0 0' : '0 36px, 0 0, 0 0';
        p.style.setProperty('background-position', lineOffset);

        // Aged tint: very subtle brown inner vignette
        if (pageStyle && pageStyle.tint === 2) {
            p.style.setProperty('box-shadow',
                `inset 0 0 100px ${hexToRgba(palette.sealDark, 0.1)}, 0 8px 28px rgba(0,0,0,0.16)`);
        } else {
            p.style.setProperty('box-shadow', '0 8px 28px rgba(0,0,0,0.16)');
        }
    });

    // Spine color
    const spine = modalEl.querySelector('.book-spine');
    if (spine) {
        const dark = shadeHex(palette.seal, -15);
        const light = shadeHex(palette.seal, 8);
        spine.style.background = `linear-gradient(to right,
            ${dark} 0%,
            ${light} 35%,
            ${palette.seal} 50%,
            ${light} 65%,
            ${dark} 100%)`;
        spine.style.boxShadow = `0 2px 14px ${hexToRgba(palette.sealDark, 0.32)}`;
        // top/bottom bands
        spine.classList.add('styled');
    }

    document.getElementById('viewMessageText').textContent = msg.text;
    document.getElementById('viewBookDate').textContent = formatMessageDisplayDate(msg);
    document.getElementById('viewBookDate').style.color = palette.accentText;

    // Set the page decoration based on palette mood (varied)
    const decorsByPalette = {
        cream: ['💌', '💗', '❤️'],
        blush: ['💞', '🌸', '💗'],
        sage:  ['🌿', '🍃', '🌱'],
        lavender: ['🌙', '💜', '✨'],
        honey: ['🌼', '🌻', '🍯'],
        rose:  ['🌹', '🥀', '🌷'],
    };
    const decorPool = decorsByPalette[variant.paletteId] || decorsByPalette.cream;
    const decors = decorsByPalette.cream;
    document.getElementById('viewBookDecoration').textContent =
        decorPool[Math.floor(Math.random() * decorPool.length)];

    // Salutation & title tint (match palette accent)
    const sal = document.querySelector('.book-salutation');
    if (sal) sal.style.color = palette.accentText;
    const title = document.querySelector('.message-modal .modal-header h3');
    if (title) title.style.color = palette.accentText;
    const letterP = document.querySelector('.letter-text');
    if (letterP) letterP.style.color = palette.accentText;
    const closing = document.querySelector('.letter-closing');
    if (closing) closing.style.color = palette.seal;

    const scatter = document.getElementById('bookPhotosScatter');

    if (msg.photos && msg.photos.length > 0) {
        const polaroidSlots = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
        const shuffled = [...msg.photos].sort(() => Math.random() - 0.5);
        const count = Math.min(shuffled.length, 6);
        const tapeColors = ['#fff3a6', '#ffd4de', '#cfe9c5', '#e0d3f2', '#f7dab0'];
        scatter.innerHTML = shuffled.slice(0, count).map((photo, i) => {
            const tape = tapeColors[Math.floor(Math.random() * tapeColors.length)];
            const tapeRot = (Math.random() * 10 - 5).toFixed(1);
            return `
            <div class="polaroid ${polaroidSlots[i]}">
                <div class="polaroid-tape" style="background:${tape}; transform: rotate(${tapeRot}deg);"></div>
                <img src="${photo}" alt="Letter photo">
            </div>`;
        }).join('');
    } else {
        scatter.innerHTML = '';
    }

    const body = document.querySelector('#viewMessageModal .letter-body');
    if (body) body.scrollTop = 0;
    openModal('viewMessageModal');
};

// ============================================================
// LET'S DATE
// ============================================================
function getMoodMeta(moodValue) {
    const map = {
        'Romantic 🌷':    { emoji: '🌷', cls: 'romantic',    label: 'Romantic' },
        'Adventure 🌲':   { emoji: '🌲', cls: 'adventure',   label: 'Adventure' },
        'Chill 🍃':       { emoji: '🍃', cls: 'chill',       label: 'Chill' },
        'Celebratory 🎉': { emoji: '🎉', cls: 'celebratory', label: 'Celebratory' },
        'Food-trip 😋':   { emoji: '😋', cls: 'foodtrip',    label: 'Food-trip' },
        'Anniversary 💐': { emoji: '💐', cls: 'anniversary', label: 'Anniversary' },
    };
    return map[moodValue] || { emoji: '💕', cls: 'default', label: 'Our Date' };
}

function getLocationForCard(location) {
    if (!location) return 'Somewhere special';
    const parts = location.split(' ');
    const first = parts[0] || 'Somewhere';
    const rest = parts.slice(1).join(' ');
    return { primary: first, extra: rest, full: location };
}

function formatTime12h(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hh = parseInt(h, 10);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const hour = ((hh + 11) % 12) + 1;
    return `${hour}:${m} ${ampm}`;
}

function getChipSelection(groupName) {
    const group = document.querySelector(`.chips-group[data-group="${groupName}"]`);
    if (!group) return null;
    const active = group.querySelector('.chip.active');
    return active ? active.dataset.value : null;
}

function setChipSelection(groupName, value) {
    const group = document.querySelector(`.chips-group[data-group="${groupName}"]`);
    if (!group || !value) return;
    group.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('active', c.dataset.value === value);
    });
}

// Wire-up chip single-select behavior for date-plan modal
function initChips(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.querySelectorAll('.chips-group').forEach(group => {
        group.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', () => {
                group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });
    });
}

window.switchDateTab = function (tab) {
    currentDateTab = tab;
    document.getElementById('tabPlanned').classList.toggle('active', tab === 'planned');
    document.getElementById('tabWishlist').classList.toggle('active', tab === 'wishlist');
    document.getElementById('plannedDatesContainer').style.display = tab === 'planned' ? '' : 'none';
    document.getElementById('wishlistContainer').style.display = tab === 'wishlist' ? '' : 'none';
};

window.switchDateSubtab = function (sub) {
    currentDateSubtab = sub;
    document.getElementById('subtabUpcoming').classList.toggle('active', sub === 'upcoming');
    document.getElementById('subtabPast').classList.toggle('active', sub === 'past');
    renderDatePlans();
};

window.openAddDateForm = function () {
    document.getElementById('addDateForm').reset();
    // Set date to today
    const today = new Date();
    const iso = today.toISOString().split('T')[0];
    document.getElementById('dateDay').value = iso;
    document.getElementById('dateTime').value = '18:00';
    // Reset chips
    document.querySelectorAll('#addDateModal .chip').forEach(c => c.classList.remove('active'));
    initChips('addDateModal');
    openModal('addDateModal');
};

async function saveDatePlan(e) {
    e.preventDefault();
    const cuisine = getChipSelection('cuisine');
    const dish = document.getElementById('dateDish').value.trim();
    const location = getChipSelection('location');
    const dateDay = document.getElementById('dateDay').value;
    const dateTime = document.getElementById('dateTime').value;
    const timeOfDay = getChipSelection('timeOfDay');
    const budget = getChipSelection('budget');
    const mood = getChipSelection('mood');
    const note = document.getElementById('dateNote').value.trim();

    const btn = document.getElementById('dateSubmitBtn');

    if (!cuisine || !location || !dateDay || !dateTime) {
        alert('Please choose at least: cuisine, location, date, and time 💕');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving the plan...';

    try {
        await authReady;
        await addDoc(collection(db, 'datePlans'), {
            cuisine,
            dish,
            location,
            dateDay,
            dateTime,
            timeOfDay: timeOfDay || '',
            budget: budget || '',
            mood: mood || '',
            note,
            createdAt: serverTimestamp()
        });
        closeModal('addDateModal');
    } catch (err) {
        console.error(err);
        alert("Couldn't save the plan — check Firebase settings and try again.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Save the plan 💕';
    }
}

function renderDatePlans() {
    const container = document.getElementById('plannedDatesList');
    if (!container) return;

    const todayIso = new Date().toISOString().split('T')[0];
    let filtered;
    if (currentDateSubtab === 'upcoming') {
        filtered = datePlans.filter(p => p.dateDay >= todayIso);
        filtered.sort((a, b) => (a.dateDay + a.dateTime).localeCompare(b.dateDay + b.dateTime));
    } else {
        filtered = datePlans.filter(p => p.dateDay < todayIso);
        filtered.sort((a, b) => (b.dateDay + b.dateTime).localeCompare(a.dateDay + a.dateTime));
    }

    if (filtered.length === 0) {
        const msg = currentDateSubtab === 'upcoming'
            ? 'Our next chapter is still unwritten — plan our first date ❤️'
            : 'No past dates here yet. Live in the moment with upcoming ones 💕';
        container.innerHTML = `
            <div class="empty-state">
                <p>${msg}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(plan => {
        const meta = getMoodMeta(plan.mood);
        const loc = getLocationForCard(plan.location);
        const noteHtml = plan.note
            ? `<div class="date-card-note">${escapeHtml(plan.note)}</div>`
            : '';
        return `
            <div class="date-card" onclick="viewDatePlan('${plan.id}')">
                <div class="date-card-tape"></div>
                <div class="date-card-hero mood-${meta.cls}">
                    <div class="date-card-emoji">${meta.emoji}</div>
                    <div class="date-card-mood">${meta.label}</div>
                </div>
                <div class="date-card-body">
                    <div class="date-card-date">
                        <span>${formatDate(plan.dateDay)}</span>
                        <span class="date-card-time">${formatTime12h(plan.dateTime)}${plan.timeOfDay ? ' · ' + escapeHtml(plan.timeOfDay) : ''}</span>
                    </div>
                    <div class="date-card-location"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(loc.full)}</div>
                    <div class="date-card-food">
                        <strong>${escapeHtml(plan.cuisine || '')}</strong>
                        ${plan.dish ? ` · ${escapeHtml(plan.dish)}` : ''}
                        ${plan.budget ? `<br><span style="color:#999;font-size:0.82rem;">💰 ${escapeHtml(plan.budget)}</span>` : ''}
                    </div>
                    ${noteHtml}
                </div>
            </div>
        `;
    }).join('');

    // Apply grid layout to container
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
    container.style.gap = '22px';
    container.style.alignItems = 'stretch';
}

window.viewDatePlan = function (id) {
    const plan = datePlans.find(p => p.id === id);
    if (!plan) return;
    currentViewingDateId = id;

    const meta = getMoodMeta(plan.mood);
    const hero = document.getElementById('dateCardHero');
    hero.className = 'date-card-hero mood-' + meta.cls;
    document.getElementById('viewDateHeroEmoji').textContent = meta.emoji;
    document.getElementById('viewDateHeroMood').textContent = meta.label;
    document.getElementById('viewDateTitle').textContent = meta.label === 'Our Date' ? 'Our Date 💕' : meta.label + ' Date';

    document.getElementById('viewDateFood').textContent = plan.cuisine || '—';
    document.getElementById('viewDateDish').textContent = plan.dish || '—';
    document.getElementById('viewDateLocation').textContent = plan.location || '—';
    document.getElementById('viewDateWhen').textContent = `${formatDate(plan.dateDay)} · ${formatTime12h(plan.dateTime)}`;
    document.getElementById('viewDateTimeOfDay').textContent = plan.timeOfDay || '—';
    document.getElementById('viewDateBudget').textContent = plan.budget || '—';

    const noteBox = document.getElementById('viewDateNoteBox');
    if (plan.note) {
        noteBox.style.display = '';
        document.getElementById('viewDateNote').textContent = plan.note;
    } else {
        noteBox.style.display = 'none';
    }

    const created = plan.createdAt && typeof plan.createdAt.toDate === 'function'
        ? plan.createdAt.toDate()
        : new Date();
    document.getElementById('viewDateCreated').textContent =
        created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    openModal('viewDateModal');
};

window.deleteDate = async function () {
    if (!currentViewingDateId) return;
    if (!confirm('Cancel this date plan? You can always make a new one later 💕')) return;
    try {
        await authReady;
        await deleteDoc(doc(db, 'datePlans', currentViewingDateId));
        closeModal('viewDateModal');
    } catch (err) {
        console.error(err);
        alert("Couldn't cancel the plan.");
    }
};

// ============================================================
// WISHLIST + SURPRISE ME
// ============================================================
window.openAddWishlistForm = function (type) {
    type = type || 'food';
    document.getElementById('wishlistType').value = type;
    document.getElementById('addWishlistForm').reset();
    document.getElementById('wishlistType').value = type;
    document.getElementById('wishlistModalTitle').textContent =
        type === 'food' ? '🍽️ Add a food craving' : '📍 Add a place idea';
    document.getElementById('wishlistText').placeholder =
        type === 'food' ? 'e.g. Unlimited samgyupsal, mango sticky rice...' : 'e.g. Tagaytay, beach, MOA seaside...';
    openModal('addWishlistModal');
    setTimeout(() => document.getElementById('wishlistText').focus(), 100);
};

async function saveWishlist(e) {
    e.preventDefault();
    const type = document.getElementById('wishlistType').value;
    const text = document.getElementById('wishlistText').value.trim();
    const note = document.getElementById('wishlistNote').value.trim();
    if (!text) return;

    const btn = document.getElementById('wishlistSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        await authReady;
        await addDoc(collection(db, 'wishlists'), {
            type,
            text,
            note,
            createdAt: serverTimestamp()
        });
        closeModal('addWishlistModal');
    } catch (err) {
        console.error(err);
        alert("Couldn't save the idea.");
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save idea 💕';
    }
}

window.deleteWishlist = async function (id) {
    try {
        await authReady;
        await deleteDoc(doc(db, 'wishlists', id));
    } catch (err) {
        console.error(err);
        alert("Couldn't delete that idea.");
    }
};

function renderWishlists() {
    const renderCol = (containerId, type) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        const items = wishlists.filter(w => w.type === type);
        if (items.length === 0) {
            const msg = type === 'food'
                ? 'No food ideas yet... what are you craving?'
                : 'No places yet... anywhere you want to go?';
            container.innerHTML = `<div class="empty-state mini"><p>${msg}</p></div>`;
            return;
        }
        container.innerHTML = items.map(w => `
            <div class="wishlist-item">
                <div class="wishlist-item-main">
                    <div class="wishlist-item-text">${escapeHtml(w.text)}</div>
                    ${w.note ? `<div class="wishlist-item-note">${escapeHtml(w.note)}</div>` : ''}
                </div>
                <button class="wishlist-item-del" onclick="deleteWishlist('${w.id}')" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    };
    renderCol('wishlistFoodList', 'food');
    renderCol('wishlistPlaceList', 'place');
}

const FALLBACK_FOODS = [
    'Unlimited samgyupsal', 'Sinigang na baboy', 'Ramen + gyoza',
    'Strawberry cheesecake', 'Kwek-kwek street food crawl', 'Silog breakfast',
    'Sushi & sashimi', 'Homemade pasta night', 'Mango sticky rice',
    'Buffet, all the way', 'Fishball + isaw', 'Taho morning run'
];
const FALLBACK_PLACES = [
    'Tagaytay for cool air', 'MOA seaside + sunset',
    'Cozy café with plants', 'Drive-in cinema',
    'Beach day trip', 'City mall crawl', 'Stay-in movie marathon',
    'Road trip to nowhere ✨', 'Rooftop restaurant', 'Park + picnic'
];
const FALLBACK_TIMES = [
    'Breakfast ☀️', 'Lunch 🌤️', 'Afternoon coffee ☕', 'Dinner 🌙', 'Late night ✨'
];

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

window.surpriseMe = function () {
    const foodIdeas = wishlists.filter(w => w.type === 'food').map(w => w.text);
    const placeIdeas = wishlists.filter(w => w.type === 'place').map(w => w.text);

    const foods = foodIdeas.length > 0 ? foodIdeas : FALLBACK_FOODS;
    const places = placeIdeas.length > 0 ? placeIdeas : FALLBACK_PLACES;

    lastSurprise.food = pickRandom(foods);
    lastSurprise.place = pickRandom(places);
    lastSurprise.timeOfDay = pickRandom(FALLBACK_TIMES);

    // If already open, just retrigger animations
    const modal = document.getElementById('surpriseModal');
    const modalDisplay = modal.style.display;

    document.getElementById('surpriseFood').textContent = lastSurprise.food;
    document.getElementById('surprisePlace').textContent = lastSurprise.place;
    document.getElementById('surpriseTime').textContent = lastSurprise.timeOfDay;

    if (modalDisplay !== 'flex' && modalDisplay !== 'block') {
        openModal('surpriseModal');
    } else {
        // replay surprise-pop animations
        modal.querySelectorAll('.surprise-line').forEach((l, i) => {
            l.style.animation = 'none';
            // eslint-disable-next-line no-unused-expressions
            l.offsetHeight;
            l.style.animation = `surprisePop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.1 + i * 0.15}s both`;
        });
    }
};

window.applySurpriseToPlan = function () {
    closeModal('surpriseModal');
    setTimeout(() => {
        openAddDateForm();
        // Pre-populate cuisine (fallback), dish from food, place from location, timeOfDay
        if (lastSurprise.food) {
            const dishInput = document.getElementById('dateDish');
            dishInput.value = lastSurprise.food;
            // If the food matches any cuisine chip label substring, activate it, else no cuisine
            const cuisineGroup = document.querySelector('#addDateModal .chips-group[data-group="cuisine"]');
            if (cuisineGroup) {
                cuisineGroup.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            }
        }
        if (lastSurprise.place) {
            const locGroup = document.querySelector('#addDateModal .chips-group[data-group="location"]');
            if (locGroup) {
                let matched = false;
                locGroup.querySelectorAll('.chip').forEach(chip => {
                    const v = chip.dataset.value || '';
                    const short = lastSurprise.place.toLowerCase();
                    const hay = v.toLowerCase();
                    for (const token of ['tagaytay', 'beach', 'cafe', 'café', 'mall', 'cinema', 'park',
                        'restaurant', 'stay-in', 'stay in', 'road trip', 'wander', 'rooftop']) {
                        if (short.includes(token) && hay.includes(token)) { matched = true; chip.classList.add('active'); return; }
                    }
                });
                if (!matched) {
                    const wander = locGroup.querySelector('.chip.surprise, .chip[data-value="Let\'s wander ✨"]');
                    if (wander) wander.classList.add('active');
                }
            }
        }
        if (lastSurprise.timeOfDay) {
            setChipSelectionInModal('addDateModal', 'timeOfDay', lastSurprise.timeOfDay);
        }
    }, 250);
};

function setChipSelectionInModal(modalId, groupName, value) {
    const modal = document.getElementById(modalId);
    if (!modal || !value) return;
    const group = modal.querySelector(`.chips-group[data-group="${groupName}"]`);
    if (!group) return;
    let matched = false;
    group.querySelectorAll('.chip').forEach(chip => {
        const eq = chip.dataset.value === value;
        chip.classList.toggle('active', eq);
        if (eq) matched = true;
    });
    if (!matched) {
        // fuzzy by first word
        const firstWord = value.split(' ')[0];
        const any = [...group.querySelectorAll('.chip')].find(c => (c.dataset.value || '').startsWith(firstWord));
        if (any) any.classList.add('active');
    }
}

// ============================================================
// UTILITIES
// ============================================================
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatLetterDate(timestamp) {
    // Firestore serverTimestamp() arrives as a Timestamp object with .toDate()
    const date = timestamp && typeof timestamp.toDate === 'function'
        ? timestamp.toDate()
        : new Date();
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatMessageDisplayDate(message) {
    if (!message.displayDate) return formatLetterDate(message.createdAt);
    const [year, month, day] = message.displayDate.split('-').map(Number);
    return formatDate(new Date(year, month - 1, day));
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addMemoryForm').addEventListener('submit', saveMemory);
    document.getElementById('addMessageForm').addEventListener('submit', saveMessage);

    const addDateForm = document.getElementById('addDateForm');
    if (addDateForm) addDateForm.addEventListener('submit', saveDatePlan);

    const addWishlistForm = document.getElementById('addWishlistForm');
    if (addWishlistForm) addWishlistForm.addEventListener('submit', saveWishlist);

    // Chip single-select (delegation, for any modal with .chips-group)
    document.body.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const group = chip.closest('.chips-group');
        if (!group) return;
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });

});
