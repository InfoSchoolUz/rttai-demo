// Real-Time Teacher frontend (stable audio)
// Fix: separate camera stream (video-only) and mic stream (audio-only)
// Auto snapshots every N seconds, push-to-talk or live chunks

const video = document.getElementById("video");
const btnSnap = document.getElementById("btnSnap");
const snapPreview = document.getElementById("snapPreview");
const snapStatus = document.getElementById("snapStatus");
const camStatus = document.getElementById("camStatus");

const autoSnap = document.getElementById("autoSnap");
const snapEvery = document.getElementById("snapEvery");

const btnRec = document.getElementById("btnRec");
const recStatus = document.getElementById("recStatus");
const btnSend = document.getElementById("btnSend");
const audioPreview = document.getElementById("audioPreview");

const grade = document.getElementById("grade");
const subject = document.getElementById("subject");
const language = document.getElementById("language");
const mode = document.getElementById("mode");

const out = document.getElementById("out");
const pretty = document.getElementById("pretty");
const prettyOut = document.getElementById("prettyOut");

const btnClear = document.getElementById("btnClear");
const apiStatus = document.getElementById("apiStatus");

// pretty fields
const p_observation = document.getElementById("p_observation");
const p_topic = document.getElementById("p_topic");
const p_summary = document.getElementById("p_summary");
const p_expl = document.getElementById("p_expl");
const p_points = document.getElementById("p_points");
const p_quiz = document.getElementById("p_quiz");
const p_hw = document.getElementById("p_hw");
const p_tip = document.getElementById("p_tip");

// Streams
let camStream = null;   // video-only
let micStream = null;   // audio-only

// Image
let lastImageBlob = null;
let snapTimer = null;
let lastSnapAt = 0;

// Audio
let recorder = null;
let audioChunks = [];
let lastAudioBlob = null;

// Live mode settings
const liveIntervalMs = 2000;   // chunk every 2s
const liveThrottleMs = 4500;   // don't spam backend too hard
let lastSendAt = 0;
let sending = false;

function setApiState(state, text) {
  apiStatus.classList.remove("ok", "warn", "bad");
  apiStatus.classList.add(state);
  apiStatus.textContent = text;
}
function logOut(text) { out.textContent = text; }
function now() { return Date.now(); }

function showJson(data) {
  // raw JSON
  out.textContent = JSON.stringify(data, null, 2);

  if (!pretty.checked) {
    prettyOut.style.display = "none";
    out.style.display = "block";
    return;
  }

  prettyOut.style.display = "block";
  out.style.display = "none";

  p_observation.textContent = data.observation || "—";
  p_topic.textContent = data.detected_topic || "—";
  p_summary.textContent = data.transcript_summary || "—";
  p_expl.textContent = data.lesson_explanation || "—";

  p_points.innerHTML = "";
  (data.key_points || []).forEach(x => {
    const li = document.createElement("li");
    li.textContent = x;
    p_points.appendChild(li);
  });

  p_quiz.innerHTML = "";
  (data.quick_quiz || []).forEach((q, i) => {
    const box = document.createElement("div");
    box.className = "qcard";

    const head = document.createElement("div");
    head.className = "qhead";

    const title = document.createElement("div");
    title.className = "qtitle";
    title.textContent = `Q${i + 1}: ${q.q || ""}`;

    const ans = document.createElement("div");
    ans.className = "qans";
    ans.textContent = `Answer: ${q.answer || "—"}`;

    head.appendChild(title);
    head.appendChild(ans);

    const ul = document.createElement("ul");
    ul.className = "qchoices";
    (q.choices || []).forEach(c => {
      const li = document.createElement("li");
      li.textContent = c;
      ul.appendChild(li);
    });

    const why = document.createElement("div");
    why.className = "qwhy";
    why.textContent = q.why || "";

    box.appendChild(head);
    box.appendChild(ul);
    if (q.why) box.appendChild(why);
    p_quiz.appendChild(box);
  });

  p_hw.innerHTML = "";
  (data.homework || []).forEach(x => {
    const li = document.createElement("li");
    li.textContent = x;
    p_hw.appendChild(li);
  });

  p_tip.textContent = data.teacher_tip || "—";
}

function bestAudioMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return ""; // browser decides
}

// Resize snapshot to reduce API load
async function makeSnapshotBlob(targetW = 640, targetH = 360, quality = 0.75) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(video, 0, 0, targetW, targetH);
  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

async function takeSnapshot({ quiet = false } = {}) {
  const t = now();
  if (t - lastSnapAt < 800) return;

  const blob = await makeSnapshotBlob(640, 360, 0.75);
  if (!blob) return;

  lastSnapAt = t;
  lastImageBlob = blob;

  if (!quiet) {
    snapPreview.src = URL.createObjectURL(blob);
    snapPreview.style.display = "block";
  }

  snapStatus.textContent = `snapshot OK (${Math.round(blob.size / 1024)} KB)`;
}

function startAutoSnapshots() {
  stopAutoSnapshots();
  const sec = Math.max(1, Math.min(10, parseInt(snapEvery.value || "3", 10)));
  snapEvery.value = String(sec);

  snapTimer = setInterval(async () => {
    if (!autoSnap.checked) return;
    await takeSnapshot({ quiet: true });
  }, sec * 1000);
}

function stopAutoSnapshots() {
  if (snapTimer) clearInterval(snapTimer);
  snapTimer = null;
}

// --- init streams ---
async function initMedia() {
  setApiState("warn", "starting…");
  logOut("Requesting permissions…");

  // Permission warm-up (helps device labels + stability)
  const warm = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  warm.getTracks().forEach(t => t.stop());

  // Camera stream (video-only)
  camStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = camStream;

  // Microphone stream (audio-only) — FIX for 0KB
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });

  const v = camStream.getVideoTracks()[0];
  const a = micStream.getAudioTracks()[0];
  camStatus.textContent = `tracks: video=${v ? "on" : "off"}, audio=${a ? "on" : "off"}`;

  // Kick off snapshot after video ready
  video.addEventListener("loadedmetadata", async () => {
    await takeSnapshot({ quiet: false });
    startAutoSnapshots();
  });

  setApiState("ok", "ready");
  logOut("Ready. Hold to speak (or Live chunks).");
}

// --- recorder ---
function setupRecorder() {
  if (!micStream) throw new Error("Mic stream is missing.");

  const mimeType = bestAudioMime();
  const options = mimeType ? { mimeType } : undefined;

  recorder = new MediaRecorder(micStream, options);

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data);

      // Live mode: each chunk becomes "latest audio"
      if (mode.value === "live") {
        const chunkBlob = new Blob([e.data], { type: recorder.mimeType || e.data.type || "audio/webm" });
        lastAudioBlob = chunkBlob;
        audioPreview.src = URL.createObjectURL(lastAudioBlob);
        recStatus.textContent = `live… (chunk ${Math.round(chunkBlob.size / 1024)} KB)`;
        maybeAutoSendLive();
      }
    }
  };

  recorder.onstop = () => {
    if (mode.value === "ptt") {
      if (!audioChunks.length) {
        lastAudioBlob = null;
        btnSend.disabled = true;
        recStatus.textContent = "recorded (0 KB) — mic device/permission issue.";
        return;
      }
      lastAudioBlob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
      audioChunks = [];
      audioPreview.src = URL.createObjectURL(lastAudioBlob);
      btnSend.disabled = false;
      recStatus.textContent = `recorded (${Math.round(lastAudioBlob.size / 1024)} KB)`;
    } else {
      audioChunks = [];
      recStatus.textContent = "live stopped";
    }
  };
}

function startRecording() {
  if (!recorder) setupRecorder();

  btnSend.disabled = true;
  lastAudioBlob = null;
  audioChunks = [];

  if (mode.value === "live") {
    recStatus.textContent = "live recording…";
    recorder.start(liveIntervalMs); // fires dataavailable every 2s
  } else {
    recStatus.textContent = "recording…";
    recorder.start(250); // IMPORTANT: prevents 0KB in Chrome
  }
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

// --- send ---
async function sendToBackend() {
  if (sending) return;
  if (!lastAudioBlob) { logOut("No audio captured yet."); return; }

  sending = true;
  btnSend.disabled = true;
  setApiState("warn", "sending…");
  logOut("Sending latest audio + latest snapshot…");

  // Make sure we have a recent snapshot
  await takeSnapshot({ quiet: true });

  const fd = new FormData();
  fd.append("audio", lastAudioBlob, "speech.webm");
  if (lastImageBlob) fd.append("image", lastImageBlob, "snap.jpg");
  fd.append("grade", grade.value || "7");
  fd.append("subject", subject.value || "Informatics");
  fd.append("language", language.value || "en");

  try {
    const res = await fetch("/api/teach", { method: "POST", body: fd });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: "Bad JSON from server", raw: text }; }

    if (!res.ok) setApiState("bad", "error");
    else setApiState("ok", "ready");

    showJson(data);
  } catch (e) {
    setApiState("bad", "network");
    logOut("Network error: " + e.message);
  } finally {
    sending = false;
    btnSend.disabled = false;
    lastSendAt = now();
  }
}

async function maybeAutoSendLive() {
  const t = now();
  if (sending) return;
  if (!lastAudioBlob) return;
  if (t - lastSendAt < liveThrottleMs) return;
  await sendToBackend();
}

// --- UI events ---
btnSnap.addEventListener("click", () => takeSnapshot({ quiet: false }));

autoSnap.addEventListener("change", () => autoSnap.checked ? startAutoSnapshots() : stopAutoSnapshots());
snapEvery.addEventListener("change", () => startAutoSnapshots());

btnRec.addEventListener("mousedown", () => {
  btnRec.textContent = (mode.value === "live") ? "Recording (live)…" : "Recording…";
  startRecording();
});
btnRec.addEventListener("mouseup", () => {
  btnRec.textContent = "Hold to speak";
  stopRecording();
});

// Touch
btnRec.addEventListener("touchstart", (e) => { e.preventDefault(); btnRec.dispatchEvent(new Event("mousedown")); });
btnRec.addEventListener("touchend", (e) => { e.preventDefault(); btnRec.dispatchEvent(new Event("mouseup")); });

btnSend.addEventListener("click", sendToBackend);

btnClear.addEventListener("click", () => {
  out.textContent = "—";
  prettyOut.style.display = "none";
  out.style.display = "block";
});

pretty.addEventListener("change", () => {
  try {
    const data = JSON.parse(out.textContent);
    showJson(data);
  } catch {}
});

mode.addEventListener("change", () => {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  audioChunks = [];
  lastAudioBlob = null;
  btnSend.disabled = true;
  recStatus.textContent = "—";
  btnRec.textContent = "Hold to speak";
});

// --- boot ---
initMedia().catch(err => {
  setApiState("bad", "blocked");
  logOut("Camera/microphone permission failed: " + err.message);
});
