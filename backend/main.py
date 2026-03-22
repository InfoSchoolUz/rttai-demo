import os
import json
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from google import genai
from google.genai import types

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
MODEL_ID = os.getenv("MODEL_ID", "gemini-3-flash-preview")

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY topilmadi. backend/.env faylga qo'ying yoki env var qilib bering.")

client = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI(title="Real-Time Teacher MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo uchun. prod'da domen bilan cheklang.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Frontend static (localhost:8000/app)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
if os.path.isdir(FRONTEND_DIR):
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


def _pick_audio_mime(filename: str, content_type: Optional[str]) -> str:
    if content_type and content_type.startswith("audio/"):
        return content_type
    ext = (filename or "").lower().split(".")[-1]
    if ext in ("webm",):
        return "audio/webm"
    if ext in ("wav",):
        return "audio/wav"
    if ext in ("mp3",):
        return "audio/mpeg"
    if ext in ("ogg", "opus"):
        return "audio/ogg"
    return "audio/webm"


def _safe_json(text: str) -> dict:
    """
    Model ba'zan JSONni ``` ichida qaytaradi yoki ozgina 'text' qo'shib yuboradi.
    Shuni iloji boricha tozalab, JSON parse qilamiz.
    """
    t = (text or "").strip()

    # ```json ... ``` ni tozalash
    if t.startswith("```"):
        parts = t.split("```")
        if len(parts) >= 2:
            t = parts[1].strip()
        if t.lower().startswith("json"):
            t = t[4:].strip()

    # Agar baribir JSON bo'lmasa, xom matnni qaytarib yuboramiz
    try:
        return json.loads(t)
    except Exception:
        return {
            "detected_topic": "unclear",
            "language": "uz",
            "transcript_summary": "",
            "lesson_explanation": "",
            "key_points": [],
            "quick_quiz": [],
            "homework": [],
            "teacher_tip": "Model JSON qaytarmadi. Audio/formatni tekshiring.",
            "_raw": t[:4000],
        }


@app.post("/api/teach")
async def teach(
    audio: UploadFile = File(...),
    image: Optional[UploadFile] = File(None),
    grade: str = Form("7"),
    subject: str = Form("Informatika"),
    language: str = Form("uz"),
):
    audio_bytes = await audio.read()
    audio_mime = _pick_audio_mime(audio.filename, audio.content_type)

    parts = []
    parts.append(types.Part.from_bytes(data=audio_bytes, mime_type=audio_mime))

    if image is not None:
        img_bytes = await image.read()
        img_mime = image.content_type or "image/jpeg"
        parts.append(types.Part.from_bytes(data=img_bytes, mime_type=img_mime))

    prompt = f"""
You are "Real-Time Teacher", a classroom assistant.

Context:
- Subject: {subject}
- Grade: {grade}
- Output language: {language}

Input contains:
- short teacher speech audio (and maybe a classroom snapshot image).

Goal:
1) Detect the topic from audio (and image if helpful).
2) Produce a lesson explanation suitable for grade {grade}.
3) Output MUST be strict JSON (no markdown).

JSON schema:
{{
  "detected_topic": "string",
  "language": "string",
  "transcript_summary": "string",
  "lesson_explanation": "string",
  "key_points": ["string"],
  "quick_quiz": [
    {{"q":"string","choices":["A","B","C","D"],"answer":"A|B|C|D","why":"string"}}
  ],
  "homework": ["string"],
  "teacher_tip": "string"
}}

Rules:
- Keep it practical, classroom-ready.
- Avoid medical/mental health advice.
- If audio is unclear, set detected_topic="unclear" and ask 2 clarification questions inside teacher_tip.
""".strip()

    parts.append(types.Part(text=prompt))

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=[types.Content(parts=parts)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.4,
            ),
        )
        data = _safe_json(getattr(response, "text", "") or "")
        return JSONResponse(data)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Gemini call failed",
                "details": str(e),
                "hint": "API key/model_id yoki audio mime_type muammosi bo'lishi mumkin."
            },
        )
