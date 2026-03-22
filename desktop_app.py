import subprocess
import time
import sys
import os
import webview

def resource_path(rel_path: str) -> str:
    # PyInstaller onefile bo'lsa, resurslar sys._MEIPASS ichida bo'ladi
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, rel_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), rel_path)

def run():
    backend = resource_path("backend")

    if not os.path.isdir(backend):
        raise FileNotFoundError(f"Backend papkasi topilmadi: {backend}")

    # MUHIM: --reload YO'Q! (aks holda qayta-qayta ishga tushib ketadi)
    p = subprocess.Popen(
        ["python", "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=backend,
        shell=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    time.sleep(2.0)

    # Brauzersiz UI (WebView oynasi)
    webview.create_window("RealTime Teacher", "http://127.0.0.1:8000/app/", width=1200, height=800)
    webview.start()

    # Oyna yopilganda backend ham yopilsin
    try:
        p.terminate()
    except Exception:
        pass

if __name__ == "__main__":
    run()
