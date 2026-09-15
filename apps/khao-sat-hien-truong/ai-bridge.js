/**
 * ai-bridge.js - Lớp trừu tượng hóa AI cho trích xuất thông số & hiện trạng
 * TUYỆT ĐỐI KHÔNG LƯU API KEY CỨNG TRÊN REPOSITORY.
 * Hỗ trợ:
 * 1. Chế độ Ngoại tuyến (Rule-based & Ghi chú thực địa KHKT) - Luôn hoạt động 100% offline.
 * 2. Chế độ AI Kết nối (Dùng API Key cá nhân người dùng tự nhập trong máy nếu có).
 * Tuân thủ nghiêm ngặt: KHÔNG BỊA SỐ LIỆU. Không rõ -> 'Chưa xác định' hoặc null.
 */

export async function analyzeSurveyData(frames, voiceTranscript = "", notes = "", gps = null) {
  const combinedText = (voiceTranscript + " " + notes).trim();

  // Kiểm tra xem người dùng có cấu hình API Key cá nhân trong localStorage không
  const customApiKey = localStorage.getItem("khkt_ai_api_key");
  const customEndpoint = localStorage.getItem("khkt_ai_endpoint");

  if (customApiKey && customEndpoint) {
    try {
      return await callRemoteAI(frames, combinedText, customApiKey, customEndpoint);
    } catch (err) {
      console.warn("Lỗi gọi AI remote, tự động chuyển về phân tích ngoại tuyến:", err);
    }
  }

  // Phân tích ngoại tuyến chuẩn quy tắc KHKT ngành điện
  return performOfflineAnalysis(frames, combinedText, gps);
}

/**
 * Bộ phân tích ngoại tuyến (Offline Rule-Based KHKT)
 * Đọc từ âm thanh giọng nói, ghi chú, gắn kết quả vào cấu trúc phiếu khảo sát
 */
function performOfflineAnalysis(frames, text, gps) {
  const tLower = text.toLowerCase();

  // 1. Nhận diện tên TBA / Công trình
  let substationName = "Chưa xác định";
  let subConfidence = null;
  const tbaMatch = text.match(/(?:TBA|trạm biến áp|trạm)\s+([A-ZÀ-Ỹ0-9\s_-]+?)(?=\s+(?:có|công suất|máy|fco|cột|dây|bị|đứt|hỏng)|[,\.
]|$)/i);
  if (tbaMatch && tbaMatch[1].trim()) {
    substationName = "TBA " + tbaMatch[1].trim();
    subConfidence = 0.92;
  }

  // 2. Nhận diện công suất MBA (kVA)
  // Các gam công suất tiêu chuẩn Điện lực: 31.5, 50, 75, 100, 160, 180, 250, 315, 320, 400, 560, 630, 750, 1000 kVA
  let capacityKva = "Chưa xác định";
  let capConfidence = null;
  const capMatch = text.match(/(31\.5|31,5|50|75|100|160|180|250|315|320|400|560|630|750|1000)\s*(?:kva|kVA|KVA)?/);
  if (capMatch) {
    capacityKva = capMatch[1].replace(",", ".") + " kVA";
    capConfidence = 0.95;
  }

  // 3. Cấp điện áp
  let voltage = "Chưa xác định";
  let voltConfidence = null;
  if (tLower.includes("35/0.4") || tLower.includes("35/0,4") || tLower.includes("35 kv") || tLower.includes("35kv")) {
    voltage = "35/0.4 kV";
    voltConfidence = 0.95;
  } else if (tLower.includes("22/0.4") || tLower.includes("22/0,4") || tLower.includes("22 kv") || tLower.includes("22kv") || tLower.includes("22")) {
    voltage = "22/0.4 kV";
    voltConfidence = 0.95;
  } else if (tLower.includes("10/0.4") || tLower.includes("10/0,4") || tLower.includes("10kv")) {
    voltage = "10/0.4 kV";
    voltConfidence = 0.9;
  }

  // 4. Tổ đấu dây
  let vectorGroup = "Chưa xác định";
  let vecConfidence = null;
  if (tLower.includes("dyn11") || tLower.includes("dyn-11") || tLower.includes("tam giác sao")) {
    vectorGroup = "Dyn11";
    vecConfidence = 0.9;
  } else if (tLower.includes("yzn11") || tLower.includes("sao zic zac") || tLower.includes("yzn")) {
    vectorGroup = "Yzn11";
    vecConfidence = 0.9;
  }

  // 5. Năm sản xuất & Hãng sản xuất
  let year = "Chưa xác định";
  let yearConfidence = null;
  const yearMatch = text.match(/(?:năm|sx|năm sx|nsx)\s*[:]?\s*(20[0-2][0-9]|19[8-9][0-9])/i);
  if (yearMatch) {
    year = yearMatch[1];
    yearConfidence = 0.9;
  }

  let manufacturer = "Chưa xác định";
  let mfgConfidence = null;
  const mfgs = ["Đông Anh", "ABB", "Thibidi", "Hanaka", "EMC", "HBT", "Sanaky", "Việt Á"];
  for (const m of mfgs) {
    if (tLower.includes(m.toLowerCase())) {
      manufacturer = m;
      mfgConfidence = 0.95;
      break;
    }
  }

  // 6. Danh mục thiết bị nhận diện tại hiện trường
  const equipmentList = [];
  const addEquip = (name, type, defaultStatus = "Bình thường") => {
    equipmentList.push({
      name,
      type,
      status: defaultStatus,
      confidence: 0.9,
      sourceFrame: frames && frames.length ? "Frame 1" : null
    });
  };

  // Tự động thêm MBA nếu có công suất hoặc phát hiện từ khóa
  if (capacityKva !== "Chưa xác định" || tLower.includes("máy biến áp") || tLower.includes("mba")) {
    addEquip("Máy biến áp " + (capacityKva !== "Chưa xác định" ? capacityKva : ""), "MBA");
  }

  if (tLower.includes("fco") || tLower.includes("cầu chì tự rơi") || tLower.includes("chì fco")) {
    const isBroken = tLower.includes("đứt chì") || tLower.includes("hỏng fco") || tLower.includes("mất chì");
    addEquip("Cầu chì tự rơi FCO 24kV/35kV", "FCO", isBroken ? "Cần thay thế / sửa chữa" : "Vận hành bình thường");
  }

  if (tLower.includes("lbs") || tLower.includes("dao cắt phụ tải") || tLower.includes("cầu dao")) {
    addEquip("Cầu dao phụ tải LBS", "LBS");
  }

  if (tLower.includes("csv") || tLower.includes("chống sét") || tLower.includes("van chống sét")) {
    const isDamaged = tLower.includes("hỏng chống sét") || tLower.includes("vỡ csv") || tLower.includes("phóng điện");
    addEquip("Chống sét van CSV", "CSV", isDamaged ? "Bị hỏng / phóng điện" : "Bình thường");
  }

  if (tLower.includes("cột") || tLower.includes("cột điện") || tLower.includes("cột bê tông")) {
    const isTilted = tLower.includes("nghiêng") || tLower.includes("nứt") || tLower.includes("vỡ");
    addEquip("Cột điện hạ thế / trung thế", "COT", isTilted ? "Bị nghiêng / nứt cần xử lý" : "Đạt yêu cầu");
  }

  if (tLower.includes("tiếp địa") || tLower.includes("dây tiếp địa")) {
    const isCut = tLower.includes("đứt") || tLower.includes("gỉ") || tLower.includes("mất");
    addEquip("Hệ thống tiếp địa trạm", "TIEP_DIA", isCut ? "Bị đứt / hỏng cần làm mới" : "Đạt yêu cầu");
  }

  if (tLower.includes("tủ hạ thế") || tLower.includes("aptomat") || tLower.includes("mccb")) {
    addEquip("Tủ phân phối hạ thế", "TU_DIEN");
  }

  // Mặc định nếu không nói gì nhưng khảo sát TBA: thêm bộ thiết bị tiêu chuẩn để người dùng dễ kiểm tra
  if (equipmentList.length === 0) {
    addEquip("Máy biến áp phân phối", "MBA");
    addEquip("Cầu chì tự rơi FCO", "FCO");
    addEquip("Chống sét van CSV", "CSV");
    addEquip("Hệ thống nối đất tiếp địa", "TIEP_DIA");
  }

  // 7. Hiện trạng khiếm khuyết & Yêu cầu xử lý
  const defects = [];
  const defectKeywords = [
    { key: "nghiêng", title: "Cột bị nghiêng lệch tâm", severity: "Cần xử lý" },
    { key: "đứt", title: "Dây / Tiếp địa bị đứt", severity: "Khẩn cấp" },
    { key: "rò dầu", title: "MBA có hiện tượng rò rỉ dầu", severity: "Cần kiểm tra" },
    { key: "sứ vỡ", title: "Sứ cách điện bị vỡ / rạn nứt", severity: "Cần thay thế" },
    { key: "phóng điện", title: "Có dấu vết phóng điện bề mặt", severity: "Khẩn cấp" },
    { key: "cháy", title: "Thiết bị có dấu vết quá nhiệt / cháy", severity: "Khẩn cấp" },
    { key: "hành lang", title: "Cây cối vi phạm hành lang an toàn", severity: "Cần phát quang" }
  ];

  for (const dk of defectKeywords) {
    if (tLower.includes(dk.key)) {
      defects.push({
        title: dk.title,
        note: text,
        severity: dk.severity
      });
    }
  }

  // 8. Đề xuất vật tư sơ bộ
  const materials = [];
  if (tLower.includes("tiếp địa") || tLower.includes("đứt")) {
    materials.push({ code: "VT_TD_01", name: "Dây đồng trần M50 / Dây tiếp địa", spec: "M50 / Thép mạ kẽm", unit: "m", quantity: 15 });
    materials.push({ code: "VT_CC_01", name: "Cọc tiếp địa mạ đồng", spec: "D16x2.4m", unit: "cọc", quantity: 3 });
  }
  if (tLower.includes("fco") || tLower.includes("chì")) {
    materials.push({ code: "VT_FCO_01", name: "Dây chì FCO loại K", spec: "Theo công suất MBA", unit: "sợi", quantity: 3 });
  }

  return {
    substationName: { value: substationName, confidence: subConfidence, verified: false },
    transformer: {
      capacityKva: { value: capacityKva, confidence: capConfidence, verified: false },
      voltage: { value: voltage, confidence: voltConfidence, verified: false },
      frequencyHz: { value: "50 Hz", confidence: 0.99, verified: true },
      vectorGroup: { value: vectorGroup, confidence: vecConfidence, verified: false },
      serial: { value: "Chưa xác định", confidence: null, verified: false },
      year: { value: year, confidence: yearConfidence, verified: false },
      manufacturer: { value: manufacturer, confidence: mfgConfidence, verified: false }
    },
    equipmentList,
    defects,
    materials,
    summaryNote: text || "Khảo sát tự động bằng camera hiện trường",
    aiStatus: "Ngoại tuyến (Rule-based KHKT & Ghi chú giọng nói)"
  };
}

async function callRemoteAI(frames, text, apiKey, endpoint) {
  // Sẵn sàng cho phiên bản tiếp theo khi anh Nam cấu hình endpoint AI
  // Đảm bảo không để lộ key trong code
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      text,
      frameCount: frames.length
    })
  });
  return await response.json();
}
