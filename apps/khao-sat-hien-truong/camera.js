/**
 * camera.js - Quản lý camera sau & trích xuất frame sắc nét thông minh
 */

let mediaStream = null;
let captureTimer = null;
const capturedFrames = [];

/**
 * Khởi chạy camera sau của điện thoại
 */
export async function startCamera(videoElement) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Trình duyệt không hỗ trợ mở camera (yêu cầu HTTPS hoặc localhost)");
  }

  // Ưu tiên camera sau
  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // Fallback nếu camera sau không tìm thấy
    console.warn("Thử fallback camera thông thường:", err);
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  videoElement.srcObject = mediaStream;
  await videoElement.play();
  return mediaStream;
}

/**
 * Tắt camera
 */
export function stopCamera() {
  stopFrameCapture();
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

/**
 * Bắt đầu thu thập frame tự động (1.2 - 1.5 giây / frame)
 */
export function startFrameCapture(videoElement, onFrameCaptured, getGPS) {
  capturedFrames.length = 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const intervalMs = 1300; // Mỗi 1.3 giây chụp 1 frame

  captureTimer = setInterval(() => {
    if (!videoElement || videoElement.readyState < 2) return;

    const vw = videoElement.videoWidth || 640;
    const vh = videoElement.videoHeight || 480;

    // Giảm kích thước xuất ảnh về mức tối ưu (HD: 1280x720 hoặc 960x720) để lưu nhanh và nhẹ
    const scale = Math.min(1, 1024 / Math.max(vw, vh));
    const targetW = Math.round(vw * scale);
    const targetH = Math.round(vh * scale);

    canvas.width = targetW;
    canvas.height = targetH;
    ctx.drawImage(videoElement, 0, 0, targetW, targetH);

    // Tính độ sắc nét (Laplacian variance)
    const sharpness = calculateSharpness(ctx, targetW, targetH);

    // Xuất DataURL JPEG chất lượng 0.78
    const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
    const gps = getGPS ? getGPS() : null;

    const frameItem = {
      id: "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      dataUrl,
      timestamp: Date.now(),
      timeFormatted: new Date().toLocaleTimeString("vi-VN"),
      sharpness,
      gps: gps ? { ...gps } : null
    };

    capturedFrames.push(frameItem);
    if (onFrameCaptured) onFrameCaptured(frameItem, capturedFrames.length);
  }, intervalMs);
}

/**
 * Dừng thu thập frame
 */
export function stopFrameCapture() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}

/**
 * Tính toán độ nét của ảnh (Laplacian variance trên ma trận ảnh xám thu nhỏ)
 */
function calculateSharpness(ctx, width, height) {
  try {
    // Thu nhỏ mẫu về 160x120 để tính cực nhanh trên di động
    const sampleW = 160;
    const sampleH = Math.round((height / width) * sampleW);

    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = sampleW;
    sampleCanvas.height = sampleH;
    const sCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    sCtx.drawImage(ctx.canvas, 0, 0, sampleW, sampleH);

    const imgData = sCtx.getImageData(0, 0, sampleW, sampleH);
    const data = imgData.data;

    // Chuyển ảnh xám
    const gray = new Float32Array(sampleW * sampleH);
    for (let i = 0; i < gray.length; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }

    // Nhân chập kernel Laplace [0, 1, 0; 1, -4, 1; 0, 1, 0]
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = 1; y < sampleH - 1; y++) {
      const row = y * sampleW;
      for (let x = 1; x < sampleW - 1; x++) {
        const val =
          gray[row - sampleW + x] +
          gray[row + sampleW + x] +
          gray[row + x - 1] +
          gray[row + x + 1] -
          4 * gray[row + x];
        sum += val;
        sumSq += val * val;
        count++;
      }
    }

    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    return Math.max(0, Math.round(variance));
  } catch (err) {
    return 100;
  }
}

/**
 * Chọn lọc danh sách các frame tốt nhất: rõ nét, phân bổ đều, loại bỏ frame nhòe
 */
export function selectUsefulFrames(frames, maxCount = 20) {
  if (!frames || frames.length === 0) return [];
  if (frames.length <= maxCount) return [...frames];

  // Sắp xếp theo độ nét giảm dần
  const sorted = [...frames].sort((a, b) => b.sharpness - a.sharpness);

  // Lấy top 50% nét nhất rồi chọn trải đều theo thời gian để bao quát hiện trường
  const topSharp = sorted.slice(0, Math.max(maxCount * 2, Math.floor(frames.length * 0.7)));

  // Sắp xếp lại theo thời gian
  topSharp.sort((a, b) => a.timestamp - b.timestamp);

  // Chọn đều theo bước nhảy
  const step = topSharp.length / maxCount;
  const result = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.min(Math.floor(i * step), topSharp.length - 1);
    if (!result.includes(topSharp[idx])) {
      result.push(topSharp[idx]);
    }
  }
  return result;
}

export function getCapturedFrames() {
  return capturedFrames;
}

export function hasTorch() {
  if (!mediaStream) return false;
  const track = mediaStream.getVideoTracks()[0];
  if (!track) return false;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  return Boolean(caps.torch);
}

export async function toggleTorch(on) {
  if (!mediaStream) return false;
  const track = mediaStream.getVideoTracks()[0];
  if (!track || !track.applyConstraints) return false;
  try {
    await track.applyConstraints({
      advanced: [{ torch: Boolean(on) }]
    });
    return true;
  } catch (_) {
    return false;
  }
}
