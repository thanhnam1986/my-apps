/**
 * export.js - Xuất dữ liệu khảo sát ra định dạng JSON và CSV phục vụ BBKS / PAKT / Vật tư
 */

export function exportSurveyJSON(survey) {
  const cleanSurvey = { ...survey };
  // Loại bỏ base64 ảnh khỏi file JSON xuất để file nhẹ và mở nhanh
  const exportData = {
    metadata: {
      app: "KHKT Khảo sát hiện trường",
      version: "1.0",
      exportedAt: new Date().toISOString(),
      unit: "Điện lực Nam Trực"
    },
    survey: {
      id: cleanSurvey.id,
      title: cleanSurvey.title || "Phiếu khảo sát",
      createdAt: cleanSurvey.createdAt,
      gps: cleanSurvey.gps,
      summaryNote: cleanSurvey.summaryNote,
      extractedData: cleanSurvey.extractedData,
      photoCount: cleanSurvey.frames ? cleanSurvey.frames.length : 0,
      framesInfo: (cleanSurvey.frames || []).map((f, idx) => ({
        index: idx + 1,
        id: f.id,
        timestamp: f.timestamp,
        timeFormatted: f.timeFormatted,
        sharpness: f.sharpness,
        gps: f.gps
      }))
    }
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `KhaoSat_${cleanSurvey.id || "data"}.json`);
}

export function exportSurveyCSV(survey) {
  const ext = survey.extractedData || {};
  const tf = ext.transformer || {};
  const gps = survey.gps || {};

  const rows = [];
  rows.push(["BIÊN BẢN / PHIẾU KHẢO SÁT HIỆN TRƯỜNG KHKT"]);
  rows.push(["Đơn vị", "Điện lực Nam Trực"]);
  rows.push(["Mã khảo sát", survey.id || ""]);
  rows.push(["Thời gian khảo sát", survey.createdAt ? new Date(survey.createdAt).toLocaleString("vi-VN") : ""]);
  rows.push(["Vĩ độ (Latitude)", gps.lat || ""]);
  rows.push(["Kinh độ (Longitude)", gps.lon || ""]);
  rows.push(["Độ chính xác GPS (m)", gps.accuracy || ""]);
  rows.push(["Số lượng ảnh hữu ích", survey.frames ? survey.frames.length : 0]);
  rows.push(["Ghi chú hiện trường", `"${(survey.summaryNote || "").replace(/"/g, '""')}"`]);
  rows.push([]);

  // Bảng thông số MBA
  rows.push(["I. THÔNG SỐ MÁY BIẾN ÁP (MBA)"]);
  rows.push(["Hạng mục", "Giá trị trích xuất", "Độ tin cậy", "Xác nhận"]);
  rows.push(["Tên trạm biến áp", ext.substationName ? ext.substationName.value : "", ext.substationName ? formatConfidence(ext.substationName.confidence) : "", ""]);
  rows.push(["Công suất (kVA)", tf.capacityKva ? tf.capacityKva.value : "", formatConfidence(tf.capacityKva ? tf.capacityKva.confidence : null), ""]);
  rows.push(["Cấp điện áp", tf.voltage ? tf.voltage.value : "", formatConfidence(tf.voltage ? tf.voltage.confidence : null), ""]);
  rows.push(["Tổ đấu dây", tf.vectorGroup ? tf.vectorGroup.value : "", formatConfidence(tf.vectorGroup ? tf.vectorGroup.confidence : null), ""]);
  rows.push(["Tần số", tf.frequencyHz ? tf.frequencyHz.value : "50 Hz", "99%", ""]);
  rows.push(["Hãng chế tạo", tf.manufacturer ? tf.manufacturer.value : "", formatConfidence(tf.manufacturer ? tf.manufacturer.confidence : null), ""]);
  rows.push(["Năm sản xuất", tf.year ? tf.year.value : "", formatConfidence(tf.year ? tf.year.confidence : null), ""]);
  rows.push([]);

  // Bảng thiết bị
  rows.push(["II. DANH MỤC THIẾT BỊ KHẢO SÁT"]);
  rows.push(["STT", "Tên thiết bị", "Loại", "Tình trạng vận hành", "Ghi chú"]);
  const eqList = ext.equipmentList || [];
  eqList.forEach((eq, idx) => {
    rows.push([idx + 1, `"${eq.name}"`, eq.type || "", `"${eq.status || "Bình thường"}"`, ""]);
  });
  rows.push([]);

  // Bảng khiếm khuyết
  rows.push(["III. HIỆN TRẠNG KHIẾM KHUYẾT & YÊU CẦU"]);
  rows.push(["STT", "Nội dung khiếm khuyết", "Mức độ ưu tiên", "Ghi chú xử lý"]);
  const defects = ext.defects || [];
  if (defects.length === 0) {
    rows.push(["-", "Không phát hiện khiếm khuyết nghiêm trọng", "Bình thường", ""]);
  } else {
    defects.forEach((d, idx) => {
      rows.push([idx + 1, `"${d.title}"`, d.severity || "", `"${(d.note || "").replace(/"/g, '""')}"`]);
    });
  }
  rows.push([]);

  // Bảng vật tư đề xuất
  rows.push(["IV. VẬT TƯ ĐỀ XUẤT"]);
  rows.push(["STT", "Mã vật tư", "Tên vật tư", "Quy cách", "ĐVT", "Số lượng"]);
  const mats = ext.materials || [];
  mats.forEach((m, idx) => {
    rows.push([idx + 1, m.code || "", `"${m.name}"`, `"${m.spec || ""}"`, m.unit || "", m.quantity || 1]);
  });

  const csvContent = rows.map((r) => r.join(",")).join("
");
  // Thêm UTF-8 BOM để Excel hiển thị đúng tiếng Việt không bị lỗi font
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `KhaoSat_${survey.id || "data"}.csv`);
}

function formatConfidence(conf) {
  if (conf === null || conf === undefined) return "Chưa xác định";
  return Math.round(conf * 100) + "%";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
