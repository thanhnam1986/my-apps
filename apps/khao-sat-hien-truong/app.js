/**
 * app.js - Bộ điều khiển trung tâm cho ứng dụng Khảo sát hiện trường KHKT
 */

import { initDB, saveSurvey, getAllSurveys, deleteSurvey, getSurvey } from "./storage.js";
import { startGPSWatch, stopGPSWatch, getLatestGPS, formatCoords } from "./gps.js";
import { startCamera, stopCamera, startFrameCapture, stopFrameCapture, selectUsefulFrames, getCapturedFrames, hasTorch, toggleTorch } from "./camera.js";
import { startVoiceRecognition, stopVoiceRecognition, isSpeechSupported } from "./voice.js";
import { analyzeSurveyData } from "./ai-bridge.js";
import { exportSurveyJSON, exportSurveyCSV } from "./export.js";

// Trạng thái phiên khảo sát hiện thời
let currentSurvey = null;
let recordingStartTime = null;
let recordTimerInterval = null;
let editingFieldKey = null;
let isTorchOn = false;

// DOM Elements
const views = {
  home: document.getElementById("view-home"),
  record: document.getElementById("view-record"),
  processing: document.getElementById("view-processing"),
  result: document.getElementById("view-result")
};

function switchView(viewName) {
  Object.values(views).forEach(v => v.classList.remove("active"));
  if (views[viewName]) views[viewName].classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Khởi chạy ứng dụng
document.addEventListener("DOMContentLoaded", async () => {
  await initDB();
  await loadSurveyHistory();
  bindEvents();
});

function bindEvents() {
  // Bấm bắt đầu luồng quay khảo sát
  document.getElementById("btn-start-record-flow").addEventListener("click", onStartRecordingFlow);

  // Nút dừng quay trong Camera View
  document.getElementById("btn-stop-recording").addEventListener("click", onStopRecordingFlow);

  // Nút hủy quay
  document.getElementById("btn-cancel-recording").addEventListener("click", () => {
    if (confirm("Anh có chắc muốn hủy đợt quay này không?")) {
      cleanupRecording();
      switchView("home");
    }
  });

  // Bật/tắt Flash
  document.getElementById("btn-toggle-torch").addEventListener("click", async () => {
    isTorchOn = !isTorchOn;
    const ok = await toggleTorch(isTorchOn);
    const btn = document.getElementById("btn-toggle-torch");
    if (ok && isTorchOn) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  // Nút lưu & xuất dữ liệu
  document.getElementById("btn-save-survey").addEventListener("click", onSaveCurrentSurvey);
  document.getElementById("btn-export-json").addEventListener("click", () => {
    if (currentSurvey) exportSurveyJSON(currentSurvey);
  });
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    if (currentSurvey) exportSurveyCSV(currentSurvey);
  });

  // Chỉnh sửa inline
  document.querySelectorAll(".btn-edit-inline[data-field]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const field = e.currentTarget.getAttribute("data-field");
      openEditModal(field);
    });
  });

  document.getElementById("btn-edit-title").addEventListener("click", () => openEditModal("title"));
  document.getElementById("btn-edit-note").addEventListener("click", () => openEditModal("note"));

  // Modal Sửa
  document.getElementById("btn-modal-cancel").addEventListener("click", closeEditModal);
  document.getElementById("btn-modal-save").addEventListener("click", saveEditModal);

  // Photo viewer modal
  document.getElementById("btn-close-photo-viewer").addEventListener("click", () => {
    document.getElementById("photo-viewer-modal").classList.remove("open");
  });

  // Settings modal
  document.getElementById("btn-open-settings").addEventListener("click", () => {
    document.getElementById("settings-ai-endpoint").value = localStorage.getItem("khkt_ai_endpoint") || "";
    document.getElementById("settings-ai-key").value = localStorage.getItem("khkt_ai_api_key") || "";
    document.getElementById("modal-settings").classList.add("open");
  });
  document.getElementById("btn-settings-close").addEventListener("click", () => {
    document.getElementById("modal-settings").classList.remove("open");
  });
  document.getElementById("btn-settings-save").addEventListener("click", () => {
    const ep = document.getElementById("settings-ai-endpoint").value.trim();
    const key = document.getElementById("settings-ai-key").value.trim();
    if (ep) localStorage.setItem("khkt_ai_endpoint", ep);
    else localStorage.removeItem("khkt_ai_endpoint");
    if (key) localStorage.setItem("khkt_ai_api_key", key);
    else localStorage.removeItem("khkt_ai_api_key");
    alert("Đã lưu cấu hình thành công!");
    document.getElementById("modal-settings").classList.remove("open");
  });
}

/**
 * 1. BẮT ĐẦU QUAY KHẢO SÁT
 */
async function onStartRecordingFlow() {
  switchView("record");

  const videoEl = document.getElementById("camera-video");
  const gpsPillText = document.getElementById("hud-gps-text");
  const timerText = document.getElementById("hud-timer-text");
  const frameCountText = document.getElementById("hud-frames-count");
  const voiceBubble = document.getElementById("live-voice-bubble");
  const voiceText = document.getElementById("live-voice-text");

  gpsPillText.textContent = "Đang bắt GPS...";
  timerText.textContent = "00:00";
  frameCountText.textContent = "0";
  voiceBubble.style.display = "none";

  // Khởi động GPS
  startGPSWatch(
    (pos) => {
      gpsPillText.textContent = `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)} (±${pos.accuracy}m)`;
    },
    (err) => {
      gpsPillText.textContent = "GPS yếu";
    }
  );

  // Khởi động Camera
  try {
    await startCamera(videoEl);
  } catch (err) {
    alert("Không thể mở camera: " + err.message + "\nVui lòng kiểm tra quyền truy cập Camera trên trình duyệt.");
    cleanupRecording();
    switchView("home");
    return;
  }

  // Khởi động chụp frame
  startFrameCapture(videoEl, (frame, count) => {
    frameCountText.textContent = count;
  }, getLatestGPS);

  // Khởi động nhận diện giọng nói nếu hỗ trợ
  if (isSpeechSupported()) {
    voiceBubble.style.display = "block";
    startVoiceRecognition((transcript) => {
      voiceText.textContent = transcript || "Đang lắng nghe...";
    });
  }

  // Bắt đầu đếm giờ
  recordingStartTime = Date.now();
  recordTimerInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - recordingStartTime) / 1000);
    const m = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const s = String(elapsedSec % 60).padStart(2, "0");
    timerText.textContent = `${m}:${s}`;
  }, 1000);
}

/**
 * 2. KẾT THÚC QUAY & XỬ LÝ DỮ LIỆU TỰ ĐỘNG
 */
async function onStopRecordingFlow() {
  // Lấy dữ liệu giọng nói trước khi tắt
  const transcript = stopVoiceRecognition();
  const allFrames = [...getCapturedFrames()];
  const latestGPS = getLatestGPS();

  cleanupRecording();

  // Chuyển sang màn hình Processing
  switchView("processing");

  // Lọc chọn 12-18 frame nét nhất
  const usefulFrames = selectUsefulFrames(allFrames, 18);

  // Phân tích bóc tách qua AI Bridge (hoạt động ngoại tuyến/online)
  const extracted = await analyzeSurveyData(usefulFrames, transcript, "", latestGPS);

  // Tạo đối tượng survey hoàn chỉnh
  const now = new Date();
  const dateStr = now.toLocaleDateString("vi-VN").replace(/\//g, "");
  const timeStr = now.toLocaleTimeString("vi-VN").replace(/:/g, "").slice(0, 4);
  const surveyId = `KS_${dateStr}_${timeStr}_${Math.random().toString(36).slice(2, 6)}`;

  currentSurvey = {
    id: surveyId,
    title: extracted.substationName.value !== "Chưa xác định" ? extracted.substationName.value : "Khảo sát hiện trường TBA",
    createdAt: now.toISOString(),
    gps: latestGPS,
    frames: usefulFrames,
    summaryNote: transcript || "Khảo sát tự động bằng camera hiện trường",
    extractedData: extracted,
    status: "done"
  };

  // Tự động lưu bản ghi vào IndexedDB
  await saveSurvey(currentSurvey);
  await loadSurveyHistory();

  // Hiển thị kết quả khảo sát
  renderSurveyResult(currentSurvey);
  switchView("result");
}

function cleanupRecording() {
  stopCamera();
  stopFrameCapture();
  stopGPSWatch();
  stopVoiceRecognition();
  if (recordTimerInterval) {
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
  }
}

/**
 * 3. RENDER KẾT QUẢ KHẢO SÁT
 */
function renderSurveyResult(survey) {
  const ext = survey.extractedData || {};
  const tf = ext.transformer || {};
  const gps = survey.gps;

  // Header info
  document.getElementById("result-title").textContent = survey.title || "Phiếu khảo sát";
  document.getElementById("useful-photos-text").textContent = `Đã tìm thấy ${survey.frames ? survey.frames.length : 0} ảnh khảo sát hữu ích.`;
  document.getElementById("res-gps").textContent = formatCoords(gps);
  document.getElementById("res-time").textContent = new Date(survey.createdAt).toLocaleString("vi-VN");
  document.getElementById("ai-status-badge").textContent = ext.aiStatus || "Ngoại tuyến KHKT";

  // Thông số MBA
  setFieldValue("tba", ext.substationName?.value, ext.substationName?.confidence);
  setFieldValue("cap", tf.capacityKva?.value, tf.capacityKva?.confidence);
  setFieldValue("volt", tf.voltage?.value, tf.voltage?.confidence);
  setFieldValue("vec", tf.vectorGroup?.value, tf.vectorGroup?.confidence);
  setFieldValue("mfg", tf.manufacturer?.value, tf.manufacturer?.confidence);
  setFieldValue("year", tf.year?.value, tf.year?.confidence);

  // Thiết bị
  const eqBox = document.getElementById("equipment-list-box");
  eqBox.innerHTML = "";
  (ext.equipmentList || []).forEach((eq, idx) => {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255,255,255,0.03); border-radius: 8px;";
    item.innerHTML = `
      <div>
        <b style="font-size: 0.9rem; color: #fff;">${eq.name}</b>
        <div style="font-size: 0.78rem; color: #94a3b8;">Trạng thái: <span style="color: #60a5fa;">${eq.status}</span></div>
      </div>
      <button class="btn-edit-inline" onclick="window.editEquipment(${idx})">✏️</button>
    `;
    eqBox.appendChild(item);
  });

  // Hiện trạng / Ghi chú
  document.getElementById("val-notes").textContent = survey.summaryNote || "Không có ghi chú bất thường.";
  const defectBox = document.getElementById("defects-list-box");
  defectBox.innerHTML = "";
  (ext.defects || []).forEach(d => {
    const dItem = document.createElement("div");
    dItem.style.cssText = "padding: 8px 10px; background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444; border-radius: 6px; font-size: 0.85rem;";
    dItem.innerHTML = `<b style="color: #fca5a5;">${d.title}</b>: ${d.severity}`;
    defectBox.appendChild(dItem);
  });

  // Thư viện ảnh
  const galBox = document.getElementById("photo-gallery-container");
  galBox.innerHTML = "";
  document.getElementById("gallery-count-label").textContent = `${survey.frames ? survey.frames.length : 0} ảnh`;

  (survey.frames || []).forEach((frame, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "photo-thumb-box";
    thumb.innerHTML = `
      <img src="${frame.dataUrl}" alt="Ảnh ${idx + 1}" loading="lazy">
      <span class="photo-badge-sharpness">#${idx + 1}</span>
    `;
    thumb.addEventListener("click", () => {
      openPhotoViewer(frame.dataUrl, `Ảnh #${idx + 1} (${frame.timeFormatted || ""})`);
    });
    galBox.appendChild(thumb);
  });
}

function setFieldValue(key, value, confidence) {
  const valEl = document.getElementById(`val-${key}`);
  const confEl = document.getElementById(`conf-${key}`);
  if (valEl) valEl.textContent = value || "Chưa xác định";
  if (confEl) {
    confEl.textContent = confidence !== null && confidence !== undefined ? `(${Math.round(confidence * 100)}%)` : "";
  }
}

/**
 * 4. SỬA NHANH THÔNG SỐ (INLINE MODAL)
 */
function openEditModal(fieldKey) {
  editingFieldKey = fieldKey;
  const modal = document.getElementById("modal-edit-field");
  const titleEl = document.getElementById("modal-edit-title");
  const inputEl = document.getElementById("modal-edit-input");

  const fieldLabels = {
    title: "Tiêu đề khảo sát",
    tba: "Tên Trạm biến áp (TBA)",
    cap: "Công suất MBA (kVA)",
    volt: "Cấp điện áp",
    vec: "Tổ đấu dây",
    mfg: "Hãng sản xuất",
    year: "Năm sản xuất",
    note: "Ghi chú hiện trường"
  };

  titleEl.textContent = "Chỉnh sửa: " + (fieldLabels[fieldKey] || fieldKey);

  // Lấy giá trị hiện tại
  if (fieldKey === "title") inputEl.value = currentSurvey.title || "";
  else if (fieldKey === "note") inputEl.value = currentSurvey.summaryNote || "";
  else {
    const valEl = document.getElementById(`val-${fieldKey}`);
    inputEl.value = valEl ? valEl.textContent : "";
  }

  modal.classList.add("open");
  setTimeout(() => inputEl.focus(), 80);
}

function closeEditModal() {
  document.getElementById("modal-edit-field").classList.remove("open");
  editingFieldKey = null;
}

async function saveEditModal() {
  if (!currentSurvey || !editingFieldKey) return;
  const inputEl = document.getElementById("modal-edit-input");
  const newVal = inputEl.value.trim();

  const ext = currentSurvey.extractedData;
  const tf = ext.transformer;

  if (editingFieldKey === "title") {
    currentSurvey.title = newVal;
    document.getElementById("result-title").textContent = newVal;
  } else if (editingFieldKey === "note") {
    currentSurvey.summaryNote = newVal;
    document.getElementById("val-notes").textContent = newVal;
  } else if (editingFieldKey === "tba") {
    ext.substationName.value = newVal;
    setFieldValue("tba", newVal, 1.0);
  } else if (editingFieldKey === "cap") {
    tf.capacityKva.value = newVal;
    setFieldValue("cap", newVal, 1.0);
  } else if (editingFieldKey === "volt") {
    tf.voltage.value = newVal;
    setFieldValue("volt", newVal, 1.0);
  } else if (editingFieldKey === "vec") {
    tf.vectorGroup.value = newVal;
    setFieldValue("vec", newVal, 1.0);
  } else if (editingFieldKey === "mfg") {
    tf.manufacturer.value = newVal;
    setFieldValue("mfg", newVal, 1.0);
  } else if (editingFieldKey === "year") {
    tf.year.value = newVal;
    setFieldValue("year", newVal, 1.0);
  }

  await saveSurvey(currentSurvey);
  await loadSurveyHistory();
  closeEditModal();
}

async function onSaveCurrentSurvey() {
  if (!currentSurvey) return;
  await saveSurvey(currentSurvey);
  alert("Đã lưu phiếu khảo sát thành công!");
  await loadSurveyHistory();
}

/**
 * 5. XEM ẢNH PHÓNG TO
 */
function openPhotoViewer(dataUrl, title) {
  const modal = document.getElementById("photo-viewer-modal");
  document.getElementById("photo-viewer-img").src = dataUrl;
  document.getElementById("photo-viewer-title").textContent = title || "Ảnh khảo sát";
  modal.classList.add("open");
}

/**
 * 6. TẢI DANH SÁCH LỊCH SỬ KHẢO SÁT
 */
async function loadSurveyHistory() {
  const list = await getAllSurveys();
  const container = document.getElementById("survey-list-container");
  const badge = document.getElementById("survey-count-badge");
  badge.textContent = `${list.length} bản ghi`;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>📋</span>
        <p>Chưa có phiếu khảo sát nào.</p>
        <p class="text-dim" style="font-size: 0.8rem; margin-top: 4px;">Bấm "QUAY KHẢO SÁT" ở trên để bắt đầu đợt mới.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  list.forEach(item => {
    const card = document.createElement("div");
    card.className = "survey-card";
    const thumbSrc = item.frames && item.frames.length ? item.frames[0].dataUrl : "";

    card.innerHTML = `
      <div class="survey-card-header">
        <div class="survey-card-title">${item.title || "Phiếu khảo sát"}</div>
        <span class="survey-badge">${item.frames ? item.frames.length : 0} ảnh</span>
      </div>
      <div class="survey-meta">
        <div class="survey-meta-item">⏱ ${new Date(item.createdAt).toLocaleString("vi-VN")}</div>
        <div class="survey-meta-item">📍 ${formatCoords(item.gps)}</div>
      </div>
      <div class="survey-actions">
        <button class="btn-action-sm btn-open" data-id="${item.id}">👁 Xem & Sửa</button>
        <button class="btn-action-sm btn-csv" data-id="${item.id}">📊 CSV</button>
        <button class="btn-action-sm btn-json" data-id="${item.id}">📤 JSON</button>
        <button class="btn-action-sm btn-action-danger btn-del" data-id="${item.id}">🗑 Xóa</button>
      </div>
    `;

    card.querySelector(".btn-open").addEventListener("click", () => {
      currentSurvey = item;
      renderSurveyResult(item);
      switchView("result");
    });
    card.querySelector(".btn-csv").addEventListener("click", () => exportSurveyCSV(item));
    card.querySelector(".btn-json").addEventListener("click", () => exportSurveyJSON(item));
    card.querySelector(".btn-del").addEventListener("click", async () => {
      if (confirm(`Anh có chắc muốn xóa bản ghi "${item.title}"?`)) {
        await deleteSurvey(item.id);
        await loadSurveyHistory();
      }
    });

    container.appendChild(card);
  });
}

// Window helpers
window.editEquipment = function(idx) {
  if (!currentSurvey) return;
  const eq = currentSurvey.extractedData.equipmentList[idx];
  const nextStatus = prompt(`Cập nhật tình trạng cho "${eq.name}":`, eq.status);
  if (nextStatus !== null && nextStatus.trim()) {
    eq.status = nextStatus.trim();
    saveSurvey(currentSurvey).then(() => renderSurveyResult(currentSurvey));
  }
};
