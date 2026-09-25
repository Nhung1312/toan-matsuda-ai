import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json());

// Configure multer in-memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
});

// Initialize Gemini Client
const getGeminiClient = (customKey?: string) => {
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY. Vui lòng thêm API key trong Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

const SYSTEM_PROMPT = `Bạn là chuyên gia giáo viên Toán THCS và THPT hàng đầu, tận tâm và chính xác tuyệt đối.
Khi chấm một bài làm Toán, bạn PHẢI tạo ra 3 lớp thông tin chuẩn hóa:

1. ĐÁP ÁN CHUẨN (AI TỰ GIẢI ĐỘC LẬP TỪ ĐẦU):
- Trước khi chấm bài của học sinh, bạn PHẢI tự giải bài toán từ đầu.
- Trình bày lời giải chuẩn hoàn chỉnh gồm: các bước biến đổi, công thức, phép tính, giải thích bằng lời, kết luận đóng khung dạng \\boxed{...}. Không chỉ đưa ra mỗi đáp số.

2. BÀI LÀM CỦA HỌC SINH & TỌA ĐỘ VÙNG VIẾT (BBOX):
- Đọc bài làm từ ảnh gốc. Giữ nguyên ý nghĩa toán học, phân biệt rõ số mũ, dấu âm, ngoặc, phân số, căn, dấu bằng.
- Xác định tọa độ chữ viết của từng bước trên ảnh: { x, y, width, height } từ 0 đến 100 theo tỷ lệ phần trăm (%).
- Nếu không xác định rõ vùng trên ảnh cho bước đó thì để bbox rỗng hoặc null, tuyệt đối KHÔNG tự tạo tọa độ giả.
- Nếu nét chữ quá mờ không đọc rõ: ghi rõ "Không đọc rõ phần này. Vui lòng kiểm tra ảnh bài làm gốc", không được tự đoán.

3. PHÂN TÍCH ĐỐI CHIẾU TỪNG BƯỚC:
- Đối chiếu từng bước của học sinh với đáp án chuẩn.
- KHÔNG SO SÁNH CƠ HỌC TỪNG DÒNG: Học sinh có thể viết khác cách giải mẫu, bỏ qua bước trung gian hợp lệ, hoặc dùng phương pháp khác. Miễn đúng về mặt toán học là đánh giá ĐÚNG (status: "correct").
- XÁC ĐỊNH LỖI ĐẦU TIÊN (isFirstError: true): Nếu học sinh sai ở bước X và các bước sau sai do kéo theo kết quả sai của bước X, thì đánh dấu các bước sau là "cascading_error" với nhận xét "Sai do kéo theo lỗi ở bước X", không trừ điểm 2 lần độc lập.
- Nêu rõ nhận xét từng bước và cách sửa bằng công thức toán (correctionLatex).

QUY TẮC BẮT BUỘC VỀ KÝ HIỆU TOÁN HỌC (LATEX):
- TẤT CẢ biểu thức Toán trong đề bài, đáp án chuẩn, bài làm được OCR, nhận xét, cách sửa, phân tích từng bước PHẢI dùng định dạng LaTeX chuẩn (ví dụ: (a^m)^n = a^{mn}, 3^2 \\times 3^5 = 3^7, (-25)^3, x^2 + 3x + 2, \\frac{a}{b}, \\sqrt{x+1}, x_1, x_2, \\leq, \\geq, \\neq, \\Rightarrow, \\in, \\boxed{...}).
- TUYỆT ĐỐI KHÔNG dùng plain text thô như "3^2 * 3^4 = 3^6" hay "x2 + 3x + 2".`;

// Upload & Grade API endpoint
app.post('/api/v1/upload', upload.single('file') as any, async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn một tệp hình ảnh để chấm bài.',
      });
    }

    const customKey = (req.headers['x-api-key'] as string) || (req.headers['x-gemini-api-key'] as string);
    const ai = getGeminiClient(customKey);

    const imagePart = {
      inlineData: {
        mimeType: file.mimetype || 'image/jpeg',
        data: file.buffer.toString('base64'),
      },
    };

    const textPart = {
      text: 'Hãy đọc ảnh bài làm môn Toán đính kèm. Thực hiện quy trình: (1) Tự giải câu hỏi độc lập tạo ĐÁP ÁN CHUẨN với công thức LaTeX; (2) Đọc bài làm học sinh, xác định bbox từng bước nếu có; (3) Phân tích đối chiếu từng bước (đúng/sai/sai kéo theo, lỗi đầu tiên, nhận xét, cách sửa); (4) Cho điểm và nhận xét chung. Trả về đúng cấu trúc JSON đã định nghĩa.',
    };

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        success: { type: Type.BOOLEAN },
        score: { type: Type.NUMBER, description: 'Tổng điểm bài làm từ 0.0 đến 10.0' },
        maxScore: { type: Type.NUMBER, description: 'Điểm tối đa của toàn bài (ví dụ 10)' },
        summary: { type: Type.STRING, description: 'Tóm tắt nhận xét tổng quan bài làm' },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionId: { type: Type.STRING, description: 'Tên hoặc số thứ tự câu hỏi (ví dụ: "1", "2a", "Câu 1")' },
              question: { type: Type.STRING, description: 'Tên hiển thị của câu hỏi' },
              problemStatementLatex: { type: Type.STRING, description: 'Đề bài toán dạng LaTeX (nếu đọc được)' },
              score: { type: Type.NUMBER, description: 'Điểm câu này đạt được' },
              maxScore: { type: Type.NUMBER, description: 'Điểm tối đa của câu' },
              max_score: { type: Type.NUMBER, description: 'Điểm tối đa (dự phòng tương thích)' },
              status: { type: Type.STRING, description: 'correct | incorrect | partial' },
              result: { type: Type.STRING, description: 'Kết quả: Đúng, Sai, hoặc Chưa hoàn thiện' },
              feedback: { type: Type.STRING, description: 'Tóm tắt nhận xét nhanh cho câu' },
              referenceSolution: {
                type: Type.OBJECT,
                description: 'Lớp 1: Đáp án chuẩn do AI tự giải độc lập từ đầu',
                properties: {
                  steps: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        stepNumber: { type: Type.INTEGER },
                        solutionLatex: { type: Type.STRING, description: 'Công thức/biến đổi toán học bằng LaTeX' },
                        explanation: { type: Type.STRING, description: 'Giải thích bước giải bằng tiếng Việt' },
                      },
                      required: ['stepNumber', 'solutionLatex', 'explanation'],
                    },
                  },
                  finalAnswerLatex: { type: Type.STRING, description: 'Đáp số cuối cùng, đóng khung dạng \\boxed{...}' },
                },
                required: ['steps', 'finalAnswerLatex'],
              },
              studentWork: {
                type: Type.OBJECT,
                properties: {
                  originalImage: { type: Type.BOOLEAN },
                },
              },
              analysis: {
                type: Type.ARRAY,
                description: 'Lớp 3: Phân tích đối chiếu từng bước',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER },
                    status: { type: Type.STRING, description: 'correct | incorrect | cascading_error' },
                    referenceStepLatex: { type: Type.STRING, description: 'Biểu thức đáp án chuẩn tương ứng' },
                    studentLatex: { type: Type.STRING, description: 'Biểu thức học sinh viết dưới dạng LaTeX' },
                    bbox: {
                      type: Type.OBJECT,
                      description: 'Tọa độ vùng chữ của bước này trên ảnh (0-100%), nếu không rõ để rỗng hoặc null',
                      properties: {
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER },
                        width: { type: Type.NUMBER },
                        height: { type: Type.NUMBER },
                      },
                    },
                    comment: { type: Type.STRING, description: 'Nhận xét chi tiết bước này' },
                    errorType: { type: Type.STRING, description: 'Loại lỗi nếu sai: sign | calculation | formula | logical | None' },
                    correctionLatex: { type: Type.STRING, description: 'Cách sửa bước này bằng biểu thức LaTeX' },
                    isFirstError: { type: Type.BOOLEAN, description: 'true nếu đây là bước đầu tiên học sinh bị sai' },
                  },
                  required: ['stepNumber', 'status', 'studentLatex', 'comment'],
                },
              },
              generalComment: {
                type: Type.OBJECT,
                properties: {
                  strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Điểm mạnh của học sinh ở câu này' },
                  mainErrors: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Lỗi chính (đặc biệt là lỗi đầu tiên)' },
                  knowledgeToReview: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Kiến thức cần củng cố' },
                },
                required: ['strengths', 'mainErrors', 'knowledgeToReview'],
              },
            },
            required: ['questionId', 'score', 'maxScore', 'status', 'result', 'feedback', 'referenceSolution', 'analysis'],
          },
        },
        overall_feedback: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Danh sách các lời khuyên và nhận xét chung toàn bài',
        },
        generalComment: {
          type: Type.OBJECT,
          properties: {
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            mainErrors: { type: Type.ARRAY, items: { type: Type.STRING } },
            knowledgeToReview: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      required: ['success', 'score', 'summary', 'questions', 'overall_feedback'],
    };

    // Try models with fallback: gemini-3.1-flash-lite -> gemini-flash-latest -> gemini-3.8-flash
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let lastError: any = null;
    let responseText: string | undefined;

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts: [imagePart, textPart] },
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            responseSchema,
          },
        });
        if (response.text) {
          responseText = response.text;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} failed, trying fallback if available:`, err?.message || err);
      }
    }

    if (!responseText) {
      throw lastError || new Error('Không nhận được phản hồi từ AI.');
    }

    let cleanText = responseText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const result = JSON.parse(cleanText);
    if (result.score !== undefined && result.summary) {
      result.success = true;
    }

    if (Array.isArray(result.questions)) {
      result.questions.forEach((q: any, idx: number) => {
        if (!q.questionId) q.questionId = q.question || String(idx + 1);
        if (!q.question) q.question = q.questionId;
        if (q.maxScore && !q.max_score) q.max_score = q.maxScore;
        if (q.max_score && !q.maxScore) q.maxScore = q.max_score;
        if (!q.result) {
          q.result = q.status === 'correct' ? 'Đúng' : (q.status === 'incorrect' ? 'Sai' : 'Chưa hoàn thiện');
        }
        if (!q.feedback) {
          q.feedback = q.status === 'correct' ? 'Giải đúng và trình bày tốt.' : 'Có bước giải cần xem lại đối chiếu.';
        }
      });
    }

    return res.json(result);
  } catch (error: any) {
    console.error('Error grading image:', error);
    let friendlyMessage = error?.message || 'Lỗi xử lý khi chấm bài với AI.';

    // Try parsing if message contains JSON error details
    try {
      if (friendlyMessage.includes('RESOURCE_EXHAUSTED') || friendlyMessage.includes('429')) {
        friendlyMessage = 'Hệ thống AI đang nhận nhiều yêu cầu cùng lúc hoặc tạm thời hết lượt giới hạn miễn phí. Vui lòng thử lại sau 15-30 giây.';
      } else if (friendlyMessage.includes('503') || friendlyMessage.includes('high demand')) {
        friendlyMessage = 'Mô hình AI đang quá tải trong giây lát. Vui lòng nhấn thử lại sau ít giây.';
      }
    } catch (_) {}

    return res.status(500).json({
      success: false,
      message: friendlyMessage,
    });
  }
});

// Serve frontend static assets
const frontendPath = path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));

// SPA fallback to frontend/index.html
app.get('*', (req: Request, res: Response, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server is running at http://${HOST}:${PORT}`);
});
