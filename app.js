const SUPABASE_URL =
  "https://jdyisdaazmbfhcfudfuz.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_X0UjmoIYbVj4lrqEmslPyQ_OHvM8AhR";

const ADMIN_CODE = "PPT2026ADMIN";

const CANDIDATE_TABLE = "tataaig_candidates";
const ATTENDANCE_TABLE = "tataaig_attendance";

const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const zoomSlider = document.getElementById("zoomSlider");
const zoomValue = document.getElementById("zoomValue");
const startBtn = document.getElementById("startBtn");
const cameraMessage = document.getElementById("cameraMessage");

let stream = null;
let track = null;
let scanning = false;
let processing = false;
let lastScanned = "";
let lastScanTime = 0;


/* =========================
   PAGE NAVIGATION
========================= */

const scannerPage = document.getElementById("scannerPage");
const loginPage = document.getElementById("loginPage");
const dashboardPage = document.getElementById("dashboardPage");

function showPage(page) {
  scannerPage.classList.add("hidden");
  loginPage.classList.add("hidden");
  dashboardPage.classList.add("hidden");

  page.classList.remove("hidden");
}


/* =========================
   CAMERA
========================= */

async function startCamera() {

  try {

    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: "environment"
        },
        width: {
          ideal: 1920
        },
        height: {
          ideal: 1080
        }
      },
      audio: false
    });

    video.srcObject = stream;

    await video.play();

    track = stream.getVideoTracks()[0];

    cameraMessage.textContent =
      "Point camera at enrollment number";

    setupZoom();

    scanning = true;

    scanLoop();

  } catch (error) {

    console.error(error);

    cameraMessage.textContent =
      "Camera permission required";

    alert(
      "Please allow camera access and reload the page."
    );
  }
}


/* =========================
   ZOOM
========================= */

function setupZoom() {

  if (!track) return;

  const capabilities =
    track.getCapabilities
      ? track.getCapabilities()
      : {};

  if (
    capabilities.zoom &&
    capabilities.zoom.min !== undefined
  ) {

    const min = capabilities.zoom.min;
    const max = Math.min(
      capabilities.zoom.max,
      3
    );

    zoomSlider.min = min;
    zoomSlider.max = max;
    zoomSlider.step =
      capabilities.zoom.step || 0.1;

    zoomSlider.value = min;

    zoomValue.textContent =
      `${Number(min).toFixed(1)}×`;

    zoomSlider.disabled = false;

  } else {

    zoomSlider.disabled = true;
    zoomValue.textContent = "Unavailable";
  }
}


zoomSlider.addEventListener(
  "input",
  async () => {

    if (!track) return;

    const zoom =
      Number(zoomSlider.value);

    zoomValue.textContent =
      `${zoom.toFixed(1)}×`;

    try {

      await track.applyConstraints({
        advanced: [
          {
            zoom: zoom
          }
        ]
      });

    } catch (error) {
      console.log("Zoom unavailable");
    }
  }
);


/* =========================
   OCR
========================= */

async function scanLoop() {

  if (!scanning) return;

  if (
    !processing &&
    video.readyState >= 2 &&
    Date.now() - lastScanTime > 1000
  ) {

    processing = true;
    lastScanTime = Date.now();

    try {
      await performOCR();
    } catch (error) {
      console.error(error);
    }

    processing = false;
  }

  requestAnimationFrame(scanLoop);
}


async function performOCR() {

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) return;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    video,
    0,
    0,
    width,
    height
  );

  /*
    OCR is focused on the middle section
    where the enrollment number is expected.
  */

  const cropWidth =
    Math.floor(width * 0.84);

  const cropHeight =
    Math.floor(height * 0.45);

  const cropX =
    Math.floor((width - cropWidth) / 2);

  const cropY =
    Math.floor((height - cropHeight) / 2);

  const imageData =
    ctx.getImageData(
      cropX,
      cropY,
      cropWidth,
      cropHeight
    );

  const tempCanvas =
    document.createElement("canvas");

  tempCanvas.width = cropWidth;
  tempCanvas.height = cropHeight;

  tempCanvas
    .getContext("2d")
    .putImageData(imageData, 0, 0);

  const result =
    await Tesseract.recognize(
      tempCanvas,
      "eng",
      {
        logger: data => {

          if (
            data.status === "recognizing text"
          ) {

            cameraMessage.textContent =
              `Reading ${Math.round(
                data.progress * 100
              )}%`;

          }
        }
      }
    );

  const text =
    result.data.text
      .toUpperCase()
      .replace(/\s+/g, "");

  const enrollNo =
    extractEnrollment(text);

  if (enrollNo) {

    cameraMessage.textContent =
      `Detected ${enrollNo}`;

    await processAttendance(enrollNo);
  }
}


/* =========================
   ENROLLMENT EXTRACTION
========================= */

function extractEnrollment(text) {

  /*
    Expected format:

    25BSPHH01C####
  */

  const cleaned =
    text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  const pattern =
    /25BSPHH01C\d{4}/;

  const match =
    cleaned.match(pattern);

  if (match) {
    return match[0];
  }

  /*
    OCR sometimes misreads characters.
    Try common OCR substitutions.
  */

  const corrected =
    cleaned
      .replace(/O/g, "0")
      .replace(/I/g, "1")
      .replace(/L/g, "1")
      .replace(/S/g, "5");

  const secondMatch =
    corrected.match(pattern);

  return secondMatch
    ? secondMatch[0]
    : null;
}


/* =========================
   ATTENDANCE
========================= */

async function processAttendance(enrollNo) {

  if (
    enrollNo === lastScanned &&
    Date.now() - lastScanTime < 5000
  ) {
    return;
  }

  lastScanned = enrollNo;

  /*
    Check candidate list
  */

  const {
    data: candidate,
    error: candidateError
  } = await supabaseClient
    .from(CANDIDATE_TABLE)
    .select("enroll_no, full_name")
    .eq("enroll_no", enrollNo)
    .maybeSingle();

  if (candidateError) {

    console.error(candidateError);

    showResult(
      "error",
      "DATABASE ERROR",
      "Could not check candidate list.",
      enrollNo,
      ""
    );

    return;
  }

  if (!candidate) {

    showResult(
      "not-found",
      "NOT IN LIST",
      "This enrollment number is not shortlisted.",
      enrollNo,
      ""
    );

    return;
  }


  /*
    Check whether already marked
  */

  const {
    data: existing,
    error: existingError
  } = await supabaseClient
    .from(ATTENDANCE_TABLE)
    .select("enroll_no, full_name, marked_at")
    .eq("enroll_no", enrollNo)
    .maybeSingle();

  if (existingError) {

    console.error(existingError);

    showResult(
      "error",
      "DATABASE ERROR",
      "Could not check attendance.",
      enrollNo,
      ""
    );

    return;
  }


  if (existing) {

    showResult(
      "duplicate",
      "ALREADY MARKED",
      existing.full_name,
      enrollNo,
      formatDate(existing.marked_at)
    );

    return;
  }


  /*
    Mark attendance
  */

  const {
    data: inserted,
    error: insertError
  } = await supabaseClient
    .from(ATTENDANCE_TABLE)
    .insert({
      enroll_no: candidate.enroll_no,
      full_name: candidate.full_name
    })
    .select()
    .single();


  if (insertError) {

    /*
      If another scan inserted the same
      candidate milliseconds earlier,
      show ALREADY MARKED.
    */

    if (
      insertError.code === "23505"
    ) {

      showResult(
        "duplicate",
        "ALREADY MARKED",
        candidate.full_name,
        enrollNo,
        ""
      );

      return;
    }

    console.error(insertError);

    showResult(
      "error",
      "ERROR",
      "Attendance could not be marked.",
      enrollNo,
      ""
    );

    return;
  }


  showResult(
    "present",
    "PRESENT",
    candidate.full_name,
    enrollNo,
    formatDate(inserted.marked_at)
  );
}


/* =========================
   RESULT
========================= */

function showResult(
  type,
  title,
  name,
  enrollNo,
  time
) {

  const result =
    document.getElementById("result");

  const icon =
    document.getElementById("resultIcon");

  const resultTitle =
    document.getElementById("resultTitle");

  const resultName =
    document.getElementById("resultName");

  const resultEnroll =
    document.getElementById("resultEnroll");

  const resultTime =
    document.getElementById("resultTime");

  result.className =
    `result ${type}`;

  result.classList.remove("hidden");

  if (type === "present") {
    icon.textContent = "✓";
  } else if (type === "duplicate") {
    icon.textContent = "!";
  } else {
    icon.textContent = "×";
  }

  resultTitle.textContent = title;
  resultName.textContent = name;
  resultEnroll.textContent =
    enrollNo
      ? `Enrollment: ${enrollNo}`
      : "";

  resultTime.textContent =
    time
      ? `Marked: ${time}`
      : "";

  setTimeout(() => {

    if (type !== "present") {
      return;
    }

    result.classList.add("hidden");

  }, 4000);
}


function formatDate(date) {

  if (!date) return "";

  return new Date(date)
    .toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium"
    });
}


/* =========================
   ADMIN
========================= */

document
  .getElementById("adminBtn")
  .addEventListener(
    "click",
    () => {

      scanning = false;

      showPage(loginPage);

    }
  );


document
  .getElementById("backFromLogin")
  .addEventListener(
    "click",
    () => {

      showPage(scannerPage);

      if (!stream) {
        startCamera();
      } else {
        scanning = true;
        scanLoop();
      }
    }
  );


document
  .getElementById("loginBtn")
  .addEventListener(
    "click",
    () => {

      const code =
        document
          .getElementById("adminCode")
          .value;

      if (code === ADMIN_CODE) {

        sessionStorage.setItem(
          "tataaig_admin",
          "true"
        );

        document
          .getElementById("adminCode")
          .value = "";

        document
          .getElementById("loginError")
          .textContent = "";

        showPage(dashboardPage);

        loadDashboard();

      } else {

        document
          .getElementById("loginError")
          .textContent =
            "Incorrect admin code.";
      }
    }
  );


document
  .getElementById("logoutBtn")
  .addEventListener(
    "click",
    () => {

      sessionStorage.removeItem(
        "tataaig_admin"
      );

      showPage(scannerPage);

      scanning = true;

      scanLoop();
    }
  );


/* =========================
   DASHBOARD
========================= */

async function loadDashboard() {

  const {
    data: candidates,
    error: candidateError
  } = await supabaseClient
    .from(CANDIDATE_TABLE)
    .select("*")
    .order("enroll_no");

  if (candidateError) {
    console.error(candidateError);
    return;
  }


  const {
    data: attendance,
    error: attendanceError
  } = await supabaseClient
    .from(ATTENDANCE_TABLE)
    .select("*")
    .order("marked_at", {
      ascending: false
    });

  if (attendanceError) {
    console.error(attendanceError);
    return;
  }


  const total =
    candidates.length;

  const present =
    attendance.length;

  const remaining =
    Math.max(total - present, 0);

  const percentage =
    total === 0
      ? 0
      : ((present / total) * 100)
          .toFixed(1);


  document
    .getElementById("totalCandidates")
    .textContent = total;

  document
    .getElementById("presentCount")
    .textContent = present;

  document
    .getElementById("remainingCount")
    .textContent = remaining;

  document
    .getElementById("attendancePercent")
    .textContent = `${percentage}%`;


  renderTable(
    candidates,
    attendance
  );
}


function renderTable(
  candidates,
  attendance
) {

  const tbody =
    document.getElementById(
      "attendanceTable"
    );

  const search =
    document
      .getElementById("searchInput")
      .value
      .toUpperCase()
      .trim();

  const attendanceMap =
    new Map(
      attendance.map(row => [
        row.enroll_no,
        row
      ])
    );


  tbody.innerHTML = "";


  candidates.forEach(candidate => {

    const rowAttendance =
      attendanceMap.get(
        candidate.enroll_no
      );

    const searchable =
      `${candidate.enroll_no} ${candidate.full_name}`
        .toUpperCase();

    if (
      search &&
      !searchable.includes(search)
    ) {
      return;
    }


    const tr =
      document.createElement("tr");

    const status =
      rowAttendance
        ? `<span class="status-present">PRESENT</span>`
        : `<span class="status-absent">ABSENT</span>`;

    const markedAt =
      rowAttendance
        ? formatDate(
            rowAttendance.marked_at
          )
        : "—";


    tr.innerHTML = `
      <td>${escapeHtml(
        candidate.enroll_no
      )}</td>

      <td>${escapeHtml(
        candidate.full_name
      )}</td>

      <td>${status}</td>

      <td>${markedAt}</td>
    `;

    tbody.appendChild(tr);
  });
}


function escapeHtml(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================
   SEARCH / REFRESH
========================= */

document
  .getElementById("searchInput")
  .addEventListener(
    "input",
    async () => {

      await loadDashboard();
    }
  );


document
  .getElementById("refreshBtn")
  .addEventListener(
    "click",
    loadDashboard
  );


/* =========================
   CSV EXPORT
========================= */

document
  .getElementById("csvBtn")
  .addEventListener(
    "click",
    async () => {

      const {
        data: candidates
      } = await supabaseClient
        .from(CANDIDATE_TABLE)
        .select("*")
        .order("enroll_no");

      const {
        data: attendance
      } = await supabaseClient
        .from(ATTENDANCE_TABLE)
        .select("*")
        .order("marked_at");


      const map =
        new Map(
          attendance.map(row => [
            row.enroll_no,
            row
          ])
        );


      const rows = [
        [
          "Enrollment No",
          "Full Name",
          "Status",
          "Marked At"
        ]
      ];


      candidates.forEach(candidate => {

        const record =
          map.get(
            candidate.enroll_no
          );

        rows.push([
          candidate.enroll_no,
          candidate.full_name,
          record
            ? "PRESENT"
            : "ABSENT",
          record
            ? formatDate(
                record.marked_at
              )
            : ""
        ]);
      });


      const csv =
        rows
          .map(row =>
            row
              .map(value =>
                `"${String(value)
                  .replace(/"/g, '""')}"`
              )
              .join(",")
          )
          .join("\n");


      const blob =
        new Blob(
          [csv],
          {
            type:
              "text/csv;charset=utf-8;"
          }
        );

      const url =
        URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = url;

      link.download =
        `Tata_AIG_Attendance_${new Date()
          .toISOString()
          .slice(0,10)}.csv`;

      link.click();

      URL.revokeObjectURL(url);
    }
  );


/* =========================
   START
========================= */

startBtn.addEventListener(
  "click",
  startCamera
);


/*
  Automatically start camera
  when page loads.
*/

window.addEventListener(
  "load",
  () => {

    setTimeout(
      startCamera,
      500
    );
  }
);
