# TOÁN MATSUDA AI - SPRINT 4 (AI CHẤM BÀI THỰC TẾ)

Dự án đã nâng cấp thành công hệ thống chấm bài bằng Trí Tuệ Nhân Tạo (Google Gemini Vision).

## 🌟 Tính năng cập nhật:
- **Tích hợp Gemini 2.5 Flash Vision:** AI trực tiếp đọc, phân tích và giải toán từ ảnh upload mà không cần qua OCR trung gian.
- **Quy trình xử lý hoàn chỉnh:** Upload Ảnh -> FastAPI -> Gemini -> Trả JSON -> Render Giao diện Kết quả.
- **Trang Kết quả Dynamic:** Tự động vẽ các thẻ (Card) "Chi tiết từng câu", chấm điểm đúng/sai, và nhận xét chung dựa trên JSON thật từ AI.

---

## 🛠 HƯỚNG DẪN CÀI ĐẶT & CHẠY

### 1. Cách lấy Gemini API Key
- Truy cập: [Google AI Studio](https://aistudio.google.com/)
- Đăng nhập bằng tài khoản Google.
- Chọn **Get API key** ở thanh menu bên trái.
- Nhấn **Create API key** và copy đoạn mã vừa tạo.

### 2. Cấu hình file .env
- Trong thư mục `backend/`, copy file `.env.example` và đổi tên thành `.env`.
- Dán API key vào: `GEMINI_API_KEY=mã_của_bạn_ở_đây`

### 3. Cài đặt và Chạy Backend
- Mở Terminal vào thư mục `backend`.
- Cài đặt thư viện:
  ```bash
  pip install -r requirements.txt
  ```
- Chạy Server:
  ```bash
  uvicorn main:app --reload
  ```

### 4. Chạy Frontend và Test AI
- Mở VS Code, chuột phải vào `frontend/index.html` chọn **Open with Live Server**.
- Kéo thả một ảnh chứa bài tập toán lớp 6-9 vào web.
- Nhấn **🤖 CHẤM BÀI**.
- Theo dõi thông báo Loading thay đổi linh hoạt. Chờ khoảng 5-10s để AI suy nghĩ. Website sẽ tự động chuyển sang trang Kết quả chi tiết.

### 5. Xử lý lỗi thường gặp
- *Lỗi Thiếu API Key:* Hãy kiểm tra lại đã tạo file `.env` chưa.
- *Lỗi Connection Refused:* Đảm bảo Server FastAPI (`uvicorn`) vẫn đang chạy song song với Live Server của Frontend.
