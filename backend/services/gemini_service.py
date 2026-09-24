import os
import json
import base64
import requests
from dotenv import load_dotenv

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

async def grade_math_image(file_path: str):
    # Ép hệ thống đọc file .env mới nhất và nạp trực tiếp vào đây
    load_dotenv(override=True)
    api_key = os.getenv("OPENROUTER_API_KEY")

    if not api_key:
        raise Exception("Thiếu OPENROUTER_API_KEY trong file .env. Vui lòng kiểm tra lại.")

    try:
        base64_image = encode_image(file_path)
    except Exception as e:
        raise Exception("Không thể đọc được file ảnh: " + str(e))

    prompt = """Bạn là giáo viên Toán THCS giỏi và tận tâm. Hãy đọc ảnh bài làm và chấm điểm.
    Nhiệm vụ của bạn:
    1. Đọc toàn bộ ảnh. Nếu ảnh quá mờ, hãy báo rõ trong feedback. Không tự đoán nếu không đọc được.
    2. Xác định từng câu hỏi có trong bài và đọc kỹ lời giải của học sinh.
    3. Tự giải từng câu và so sánh đối chiếu với bài làm của học sinh.
    4. Chấm điểm theo thang điểm 10.
    5. Đưa ra nhận xét chung và các lời khuyên để học sinh cải thiện.
    
    BẮT BUỘC TRẢ VỀ KẾT QUẢ ĐÚNG THEO ĐỊNH DẠNG JSON SAU:
    {
      "success": true,
      "score": 8.5,
      "summary": "Bài làm khá tốt.",
      "questions": [
        {
          "question": 1,
          "score": 1,
          "max_score": 1,
          "result": "Đúng",
          "feedback": "Giải đúng và trình bày tốt."
        }
      ],
      "overall_feedback": [
        "Trình bày sạch.",
        "Cần chú ý dấu âm."
      ]
    }
    """

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "meta-llama/llama-3.2-11b-vision-instruct:free",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]
            }
        ],
        "response_format": {"type": "json_object"}
    }

    try:
        response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        
        result_data = response.json()
        content = result_data['choices'][0]['message']['content'].strip()
        
        if content.startswith('```json'):
            content = content[7:-3]
        elif content.startswith('```'):
            content = content[3:-3]
            
        return json.loads(content)
    except Exception as e:
        raise Exception(f"Lỗi OpenRouter: {str(e)}")