let examEnded = false;
let camStream = null;
let micStream = null;
let terminationTriggered = false;

const candidate = localStorage.getItem("candidate") || "Student";
const candidateEmail = localStorage.getItem("candidateEmail");

const socket = typeof io !== "undefined" ? io() : null;

/* ================= SAFE LOG ================= */
function log(type) {
  if (examEnded || !candidateEmail) return;

  try {
    if (socket && socket.connected) {
      socket.emit("violation", {
        candidate,
        email: candidateEmail,
        type,
        time: new Date().toISOString()
      });
    }

    fetch("/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate, email: candidateEmail, type })
    }).catch(() => {});
  } catch (e) {}
}

/* ================= SNAPSHOT ================= */
function captureSnapshot(reason) {
  try {
    const v = document.getElementById("video");
    if (!v || !v.videoWidth) return;

    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);

    c.toBlob(b => {
      const f = new FormData();
      f.append("image", b);
      f.append("email", candidateEmail);
      f.append("reason", reason);
      fetch("/upload-snapshot", { method: "POST", body: f });
    });
  } catch (e) {}
}

/* ================= TERMINATE ================= */
function terminate(reason) {
  if (examEnded || terminationTriggered) return;
  terminationTriggered = true;

  log(reason);
  captureSnapshot(reason);

  alert(`❌ ${reason}. Exam terminated.`);
  submitExam();
}

/* ================= TAB / FULLSCREEN ================= */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) terminate("Tab switched");
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !examEnded)
    terminate("Exited fullscreen");
});

/* ================= FACE PROCTOR ================= */
async function startFaceProctoring() {
  const v = document.getElementById("video");

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    v.srcObject = camStream;
    await v.play();

    document.getElementById("camStatus").textContent = "📷 Camera: ON";
    document.getElementById("camStatus").className = "status-on";

    camStream.getVideoTracks()[0].onended = () =>
      terminate("Camera turned off");

    if (
      typeof FaceDetection === "undefined" ||
      typeof Camera === "undefined"
    ) {
      console.warn("FaceDetection libs not loaded");
      return;
    }

    let noFace = 0,
      multi = 0,
      last = Date.now();

    const fd = new FaceDetection({
      locateFile: f =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${f}`
    });

    fd.setOptions({ model: "short", minDetectionConfidence: 0.6 });

    fd.onResults(r => {
      const now = Date.now();
      const d = (now - last) / 1000;
      last = now;

      if (!r.detections || r.detections.length === 0) {
        noFace += d;
        if (noFace >= 3) terminate("Face not detected");
      } else noFace = 0;

      if (r.detections && r.detections.length > 1) {
        multi += d;
        if (multi >= 1) terminate("Multiple faces detected");
      } else multi = 0;
    });

    const cam = new Camera(v, {
      onFrame: async () => !examEnded && fd.send({ image: v }),
      width: 640,
      height: 480
    });

    cam.start();
  } catch (err) {
    terminate("Camera permission denied");
  }
}

/* ================= VOICE ================= */
async function startVoiceDetection() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    document.getElementById("micStatus").textContent = "🎤 Microphone: ON";
    document.getElementById("micStatus").className = "status-on";

    micStream.getAudioTracks()[0].onended = () =>
      terminate("Microphone turned off");

    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    const src = ctx.createMediaStreamSource(micStream);
    src.connect(an);
    an.fftSize = 2048;

    const data = new Uint8Array(an.frequencyBinCount);
    let sec = 0,
      warned = false;

    setInterval(() => {
      an.getByteTimeDomainData(data);
      let sum = 0;

      for (let i = 0; i < data.length; i++) {
        let v = (data[i] - 128) / 128;
        sum += v * v;
      }

      if (Math.sqrt(sum / data.length) > 0.1) {
        sec++;
        if (sec === 5 && !warned) {
          warned = true;
          log("Voice detected");
        }
        if (sec >= 12) terminate("Repeated voice detected");
      } else {
        sec = 0;
        warned = false;
      }
    }, 1000);
  } catch (err) {
    terminate("Microphone permission denied");
  }
}

/* ================= PHONE ================= */
let phoneModel = null;

async function loadPhoneModel() {
  if (typeof cocoSsd === "undefined") return;
  phoneModel = await cocoSsd.load();
}

function startPhoneDetection() {
  const v = document.getElementById("video");
  setInterval(async () => {
    if (!phoneModel || examEnded) return;
    const p = await phoneModel.detect(v);
    if (p.some(x => x.class === "cell phone" && x.score > 0.6))
      terminate("Mobile phone detected");
  }, 2000);
}

/* ❌ REMOVE false device termination */
navigator.mediaDevices.ondevicechange = () => {
  console.warn("Device change detected (ignored)");
};

/* ================= TIMER ================= */
let remainingTime = 0;

function startExamTimer(m = 50) {
  remainingTime = m * 60;

  setInterval(() => {
    if (examEnded) return;
    remainingTime--;

    if (remainingTime === 300)
      alert("⚠️ 5 minutes remaining");

    if (remainingTime <= 0) submitExam();

    const t = document.getElementById("timer");
    t.textContent =
      String(Math.floor(remainingTime / 60)).padStart(2, "0") +
      ":" +
      String(remainingTime % 60).padStart(2, "0");
  }, 1000);
}

/* ================= OFFLINE ================= */
let offline = 0;
setInterval(() => {
  if (!navigator.onLine) {
    offline++;
    if (offline === 5) alert("⚠️ Internet disconnected");
    if (offline >= 15) submitExam();
  } else offline = 0;
}, 1000);

/* ================= SUBMIT ================= */
function submitExam() {
  if (examEnded) return;
  examEnded = true;

  fetch("/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: candidateEmail,
      answers: collectAnswers()
    })
  }).finally(() => {
    alert("✅ Exam submitted");
    localStorage.clear();
    location.href = "login.html";
  });
}



//collect answers
function collectAnswers() {
  const finalAnswers = [];

  questions.forEach((q, i) => {
    if (answers[i] !== undefined) {
      finalAnswers.push({
        questionNumber: i + 1,
        question: q.q,
        selectedOptionIndex: answers[i] + 1, // OPTION NUMBER
        selectedOptionText: q.o[answers[i]]
      });
    }
  });

  return finalAnswers;
}





/* ================= START ================= */
async function beginExam() {
  await document.documentElement.requestFullscreen();
  document.getElementById("startScreen").remove();

  await startFaceProctoring();
  await loadPhoneModel();
  startPhoneDetection();
  await startVoiceDetection();
  startExamTimer(50);
}






