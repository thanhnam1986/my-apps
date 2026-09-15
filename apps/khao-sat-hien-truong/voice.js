/**
 * voice.js - Nhận diện giọng nói tiếng Việt ngoài hiện trường & Ghi chú nhanh
 */

let recognition = null;
let isListening = false;
let accumulatedTranscript = "";

export function isSpeechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startVoiceRecognition(onResult, onError) {
  accumulatedTranscript = "";
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRec) {
    if (onError) onError(new Error("Trình duyệt không hỗ trợ Web Speech Recognition"));
    return false;
  }

  try {
    recognition = new SpeechRec();
    recognition.lang = "vi-VN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (final) {
        accumulatedTranscript += final;
      }

      const currentDisplay = (accumulatedTranscript + " " + interim).trim();
      if (onResult) onResult(currentDisplay, interim);
    };

    recognition.onerror = (event) => {
      console.warn("Speech error:", event.error);
      if (onError) onError(event.error);
    };

    recognition.onend = () => {
      // Tự động khởi động lại nếu đang trong chế độ quay
      if (isListening && recognition) {
        try { recognition.start(); } catch (_) {}
      }
    };

    recognition.start();
    isListening = true;
    return true;
  } catch (err) {
    console.warn("Không thể khởi động Speech:", err);
    if (onError) onError(err);
    return false;
  }
}

export function stopVoiceRecognition() {
  isListening = false;
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
    recognition = null;
  }
  return accumulatedTranscript.trim();
}

export function getAccumulatedTranscript() {
  return accumulatedTranscript.trim();
}
