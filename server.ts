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

const SYSTEM_PROMPT = `Bạn là giáo viên Toán giỏi và tận tâm. Hãy đọc ảnh bài làm và chấm điểm chi tiết.
Nhiệm vụ của bạn:
1. Đọc toàn bộ ảnh bài làm Toán của học sinh. Nếu ảnh quá mờ hoặc không có bài toán, hãy giải thích rõ trong feedback.
2. Xác định từng câu hỏi hoặc bài tập có trong bài và đọc kỹ lời giải của học sinh.
3. Tự giải từng câu và so sánh đối chiếu từng bước với bài làm của học sinh.
4. Chấm điểm chi tiết từng câu theo thang điểm 10 cho toàn bài.
5. Đưa ra nhận xét chung và các lời khuyên thiết thực để học sinh tiến bộ.`;

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
      text: 'Hãy đọc ảnh bài làm môn Toán đính kèm, phân tích và chấm điểm chi tiết từng câu. Trả về đúng cấu trúc JSON đã định nghĩa với success: true, tổng điểm score (thang 10), summary, danh sách từng câu questions (question, score, max_score, result: "Đúng"|"Sai"|"Chưa hoàn thiện", feedback), và overall_feedback.',
    };

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        success: { type: Type.BOOLEAN },
        score: { type: Type.NUMBER, description: 'Tổng điểm bài làm từ 0.0 đến 10.0' },
        summary: { type: Type.STRING, description: 'Tóm tắt nhận xét tổng quan bài làm' },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: 'Số hoặc mã câu hỏi, ví dụ: "1", "2", "3a"' },
              score: { type: Type.NUMBER, description: 'Điểm câu này đạt được' },
              max_score: { type: Type.NUMBER, description: 'Điểm tối đa của câu' },
              result: { type: Type.STRING, description: 'Kết quả: Đúng, Sai, hoặc Chưa hoàn thiện' },
              feedback: { type: Type.STRING, description: 'Nhận xét chi tiết các bước làm' },
            },
            required: ['question', 'score', 'max_score', 'result', 'feedback'],
          },
        },
        overall_feedback: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Danh sách các lời khuyên và nhận xét chung',
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
