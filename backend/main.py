import os
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from services.gemini_service import grade_math_image

app = FastAPI(title="Toán Matsuda API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

@app.post("/api/v1/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        # GỌI GEMINI SERVICE ĐỂ CHẤM BÀI TỪ ẢNH
        grade_result = await grade_math_image(file_path)
        
        return grade_result
    except Exception as e:
        return {
            "success": False,
            "message": str(e)
        }
