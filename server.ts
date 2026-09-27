import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-gemini-api-key'],
}));
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

const SYSTEM_PROMPT = `Bạn là chuyên gia giáo viên Toán THCS (Lớp 6 đến Lớp 9) hàng đầu, giàu kinh nghiệm sư phạm và chính xác tuyệt đối.

HỆ THỐNG CHẤM BÀI TOÁN THCS ĐA DẠNG:
Bạn KHÔNG ĐƯỢC giới hạn vào một chuyên đề cụ thể nào. Bạn phải xử lý linh hoạt mọi dạng toán THCS:
1. Số học & Đại số: Số tự nhiên, số nguyên, phân số, số thập phân, tỉ số & tỉ lệ thức, phần trăm, lũy thừa, căn bậc hai, đơn thức, đa thức, hằng đẳng thức đáng nhớ, phân tích đa thức thành nhân tử, phân thức đại số, rút gọn biểu thức, giải phương trình, bất phương trình, hệ phương trình, bài toán tìm x, tìm GTLN/GTNN.
2. Bài toán thực tế: Chuyển động, năng suất, công việc chung - riêng, kinh tế (lãi suất, giảm giá), hình học thực tế (diện tích, thể tích bể nước, bóng cây...).
3. Hình học: Tam giác bằng nhau, tam giác đồng dạng, định lý Pytago, hệ thức lượng, đường tròn, góc ở tâm, góc nội tiếp, tứ giác nội tiếp, tiếp tuyến, diện tích, chu vi, hình học không gian (hình trụ, hình nón, hình cầu).
4. Thống kê & Xác suất: Bảng số liệu, biểu đồ, trung bình cộng, mốt, trung vị, không gian mẫu, xác suất biến cố.

QUY TRÌNH CHẤM BẮT BUỘC:
Bước 1 - Đọc đề & Nhận diện dạng toán:
- Xác định cấp học, lớp học (Lớp 6/7/8/9), chủ đề (topic), nhánh bài (subtopic) và dạng bài (problemType). Nếu gặp dạng mới, đặt topic/problemType="other".

Bước 2 - TỰ GIẢI ĐỘC LẬP TỪ ĐẦU (Không nhìn bài học sinh để giải):
- Tự giải bài toán độc lập từ đề bài để tạo ĐÁP ÁN CHUẨN.
- Cấu trúc đáp án chuẩn phải linh hoạt theo từng dạng bài:
  + Dạng tính toán/rút gọn: Từng bước biến đổi toán học kèm giải thích, kết quả cuối cùng.
  + Dạng phương trình/hệ phương trình: ĐKXĐ, các phép biến đổi tương đương, giải, đối chiếu nghiệm, kết luận.
  + Dạng hình học & chứng minh: Giả thiết (GT), Kết luận (KL), định lý/tiên đề áp dụng, chuỗi lập luận logic chặt chẽ.
  + Dạng toán thực tế: Gọi ẩn & điều kiện, lập phương trình/hệ, giải, đối chiếu điều kiện thực tế, đơn vị và kết luận.
  + Dạng thống kê & xác suất: Đọc dữ liệu, tính toán, kết luận.

Bước 3 - Đọc bài làm học sinh từ ảnh gốc:
- Giữ nguyên ảnh gốc, không sửa ảnh. Phân biệt rõ số mũ ($3^5$ vs $5^3$), dấu âm, phân số, căn, ngoặc, ký hiệu hình học.
- Nếu nét chữ quá mờ hoặc ký hiệu không chắc chắn: status="unclear", gán confidence thấp (< 0.70) và ghi rõ trong comment để giáo viên kiểm tra.

Bước 4 - Phân tích đối chiếu từng bước (QUY TẮC BẮT BUỘC):
- ĐỌC VÀ CHẤM ĐẦY ĐỦ TỪNG DÒNG BIẾN ĐỔI: Phải phân tích mọi dòng biến đổi học sinh viết từ đầu đến kết quả cuối cùng. Nếu học sinh viết 5 dòng thì mảng \`analysis\` BẮT BUỘC PHẢI CÓ ĐỦ 5 BƯỚC (Bước 1, Bước 2, Bước 3, Bước 4, Bước 5...). TUYỆT ĐỐI KHÔNG chỉ chấm mỗi dòng đầu tiên (Bước 1) rồi dừng lại!
- Ngay cả khi bước 1 sai đề hay chép nhầm, VẪN PHẢI CHẤM TIẾP tất cả các dòng tiếp theo: chỉ rõ bước nào học sinh tính đúng theo đề sai đó (lỗi kéo theo cascading_error, không trừ điểm thêm), bước nào học sinh tính sai tiếp (lỗi độc lập isIndependentError).
- Đánh giá tính tương đương toán học: $3/4 \\equiv 0.75$, $2(x+3) \\equiv 2x+6$, $x=3 \\equiv 3=x$. Học sinh làm theo cách khác mẫu hoặc làm tắt hợp lệ vẫn là ĐÚNG (status: "correct").
- Phân loại lỗi chính xác:
  + ❌ LỖI ĐẦU TIÊN (isFirstError: true): Bước đầu tiên học sinh bị sai bản chất toán học.
  + ⚠️ LỖI KÉO THEO (isFollowUpError: true hoặc status: "cascading_error"): Các bước sau sử dụng tiếp kết quả của bước sai trước đó nhưng bản thân phép tính sau đúng. Không bị trừ điểm lặp lại.
  + ❌ LỖI ĐỘC LẬP (isIndependentError: true): Lỗi mới phát sinh độc lập sau lỗi trước đó.
  + ⚠️ CHƯA HOÀN THIỆN (status: "incomplete"): Thiếu bước biến đổi hoặc chưa đến kết quả cuối.
  + ⚠️ KHÔNG ĐỌC RÕ (status: "unclear"): Nét chữ mờ.

Bước 5 - Ký hiệu & Công thức Toán học (CHUẨN LATEX CAO CẤP):
- TẤT CẢ công thức Toán học trong \`studentLatex\`, \`solutionLatex\`, \`correctionLatex\`, \`problemStatementLatex\`, \`finalAnswerLatex\` PHẢI viết bằng cú pháp LaTeX chuẩn và đẹp:
  + Phân số: BẮT BUỘC dùng \\frac{tử}{mẫu} (ví dụ: \\frac{6^7}{9^2 \\cdot 125}, \\frac{(-3)^{10} \\cdot 15^3}{25^3 \\cdot (-9)^7}). Tuyệt đối KHÔNG dùng dấu gạch chéo thô a/b hay a/(b*c).
  + Phép nhân: BẮT BUỘC dùng \\cdot (ví dụ: 2^7 \\cdot 3^7, tuyệt đối KHÔNG dùng \\times để tránh lỗi escape JSON, tuyệt đối KHÔNG dùng ký tự sao * hay dấu chấm văn bản).
  + Lũy thừa: Luôn bọc ngoặc nhọn: (-3)^{10}, 15^3, 25^3, 2^{11}, (-9)^7.
  + Trong các phần lời văn (nhận xét \`comment\`, \`feedback\`, \`solutionText\`, \`explanation\`, \`summary\`): Mọi số liệu toán học, biểu thức, lũy thừa, phân số (như $125$, $4^2$, $\\frac{2}{9}$, $x$, $y$) BẮT BUỘC bọc trong cặp dấu $...$ để hiển thị công thức chuẩn đẹp!

Bước 6 - BBox, PageIndex & Confidence:
- pageIndex: Số nguyên (0 cho trang 1, 1 cho trang 2, ...) chỉ định bước này xuất hiện ở trang ảnh nào.
- bbox: { x, y, width, height } từ 0-100% tỷ lệ ảnh của trang đó. Nếu không xác định được rõ thì để null, KHÔNG bịa tọa độ.
- confidence: Số thực từ 0.0 đến 1.0 phản ánh độ chắc chắn của AI.

Bước 7 - Nguyên tắc cho điểm sư phạm:
- Điểm mỗi câu (score / maxScore) phản ánh chính xác các bước học sinh làm được:
  + Đúng hoàn toàn: score = maxScore, status = "correct", result = "Đúng".
  + Sai ở bước nào đó: Cho điểm thành phần cho các bước đúng trước đó, TRỪ ĐIỂM bước sai và kết quả sai. KHÔNG ĐƯỢC cho điểm tối đa nếu câu có lỗi sai hoặc kết quả sai!
  + Lỗi kéo theo: Không bị trừ điểm lặp lại nhưng vẫn bị mất điểm của bước sai gốc và kết quả cuối.
- Tổng điểm toàn bài (score ở root) phải khớp với tổng điểm đạt được của các câu hỏi.
- Tóm tắt tổng quan (summary) phải nêu rõ tình trạng bài làm trung thực: nếu có lỗi sai thì chỉ rõ lỗi ở câu nào, bước nào; không nhận xét "làm đúng hoàn toàn" khi có bước bị sai!

Bước 8 - Phân loại ma trận đề & mức độ năng lực theo Thông tư 22/27 của Bộ GD&ĐT:
- Mỗi câu hỏi BẮT BUỘC gán thuộc tính 'level' thuộc đúng 1 trong 4 mức độ:
  + "Nhận biết": Nhận diện công thức, định nghĩa, phát biểu quy tắc hoặc tính toán số học 1 bước cơ bản.
  + "Thông hiểu": Áp dụng trực tiếp quy tắc, biến đổi đơn giản, giải phương trình/hệ cơ bản.
  + "Vận dụng": Phối hợp nhiều bước tư duy, rút gọn phân thức phức tạp, giải phương trình chứa căn, chứng minh hình học.
  + "Vận dụng cao": Bài toán thực tế tối ưu, bất đẳng thức, tìm GTLN/GTNN, câu phân loại học sinh giỏi.`;

// Health check endpoint (for monitoring and frontend debug verification)
app.get(['/api/health', '/api/health/', '/health'], (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    service: 'TOAN-MATSUDA-AI',
    backend: 'online',
  });
});

// AI Studio preview iframe upload fallback handler
app.all(['/_/upload*', '/upload*'], (req: Request, res: Response) => {
  return res.status(200).json({ success: true, message: 'Upload endpoint ready' });
});

// Upload & Grade API endpoint (Supports single or multiple images/pages)
app.post(
  ['/api/v1/upload', '/api/v1/upload/', '/api/upload'],
  (req: Request, res: Response, next) => {
    (upload.any() as any)(req, res, (err: any) => {
      if (err) {
        console.error('Multer upload error:', err);
        return res.status(400).json({
          success: false,
          message: err.code === 'LIMIT_FILE_SIZE'
            ? 'Dung lượng ảnh vượt quá giới hạn 20MB. Vui lòng chọn ảnh nhẹ hơn.'
            : (err.message || 'Lỗi khi xử lý tệp ảnh tải lên.')
        });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const files: Express.Multer.File[] = [];
      if (Array.isArray(req.files) && req.files.length > 0) {
        files.push(...(req.files as Express.Multer.File[]));
      } else if (req.file) {
        files.push(req.file);
      }

      if (files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng chọn ít nhất một hình ảnh bài làm để chấm bài.',
        });
      }

    const customKey = (req.headers['x-api-key'] as string) || (req.headers['x-gemini-api-key'] as string);
    let ai;
    try {
      ai = getGeminiClient(customKey);
    } catch (keyErr: any) {
      return res.status(401).json({
        success: false,
        message: keyErr.message || 'Chưa cấu hình GEMINI_API_KEY. Vui lòng cấu hình API key.',
      });
    }

    const imageParts = files.map((f) => ({
      inlineData: {
        mimeType: f.mimetype || 'image/jpeg',
        data: f.buffer.toString('base64'),
      },
    }));

    const textPart = {
      text: files.length > 1
        ? `Bài làm học sinh gồm ${files.length} ảnh/trang tương ứng thứ tự pageIndex từ 0 đến ${files.length - 1}. Hãy đọc tất cả các trang ảnh bài làm môn Toán THCS đính kèm theo đúng trình tự. QUAN TRỌNG:
1. Đọc và chấm ĐẦY ĐỦ TẤT CẢ CÁC DÒNG BIẾN ĐỔI của học sinh (Bước 1, Bước 2, Bước 3, Bước 4, Bước 5...), tuyệt đối không dừng lại ở mỗi Bước 1!
2. Viết công thức Toán bằng LaTeX chuẩn đẹp: bắt buộc dùng \\frac{tử}{mẫu} cho phân số, \\cdot cho phép nhân, a^{b} cho lũy thừa (ví dụ: \\frac{6^7}{9^2 \\cdot 125}, \\frac{(-3)^{10} \\cdot 15^3}{25^3 \\cdot (-9)^7}). Tuyệt đối không dùng dấu gạch chéo / hay dấu hoa thị *.
3. Bọc mọi số liệu, công thức trong lời nhận xét bằng dấu $...$ (ví dụ: $125$, $4^2$). Trả về đúng cấu trúc JSON.`
        : `Hãy đọc ảnh bài làm môn Toán THCS đính kèm. QUAN TRỌNG:
1. Đọc và chấm ĐẦY ĐỦ TẤT CẢ CÁC DÒNG BIẾN ĐỔI của học sinh (Bước 1, Bước 2, Bước 3, Bước 4, Bước 5...), tuyệt đối không dừng lại ở mỗi Bước 1!
2. Viết công thức Toán bằng LaTeX chuẩn đẹp: bắt buộc dùng \\frac{tử}{mẫu} cho phân số, \\cdot cho phép nhân, a^{b} cho lũy thừa (ví dụ: \\frac{6^7}{9^2 \\cdot 125}, \\frac{(-3)^{10} \\cdot 15^3}{25^3 \\cdot (-9)^7}). Tuyệt đối không dùng dấu gạch chéo / hay dấu hoa thị *.
3. Bọc mọi số liệu, công thức trong lời nhận xét bằng dấu $...$ (ví dụ: $125$, $4^2$). Trả về đúng cấu trúc JSON.`,
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
              classification: {
                type: Type.OBJECT,
                description: 'Nhận diện dạng toán THCS',
                properties: {
                  grade: { type: Type.STRING, description: 'Lớp 6, Lớp 7, Lớp 8, hoặc Lớp 9' },
                  topic: { type: Type.STRING, description: 'Đại số, Hình học, Số học, Toán thực tế, Thống kê & Xác suất, hoặc Khác' },
                  subtopic: { type: Type.STRING, description: 'Tên chuyên đề cụ thể (ví dụ: Phân tích đa thức, Tam giác đồng dạng)' },
                  problemType: { type: Type.STRING, description: 'Loại bài toán (ví dụ: calculate, equation, geometry_proof, word_problem, other)' },
                },
              },
              problemStatementLatex: { type: Type.STRING, description: 'Đề bài toán dạng LaTeX' },
              level: { type: Type.STRING, description: 'Phân loại mức độ theo Thông tư 22/27 Bộ GD&ĐT: "Nhận biết" | "Thông hiểu" | "Vận dụng" | "Vận dụng cao"' },
              score: { type: Type.NUMBER, description: 'Điểm câu này đạt được' },
              maxScore: { type: Type.NUMBER, description: 'Điểm tối đa của câu' },
              max_score: { type: Type.NUMBER, description: 'Điểm tối đa (dự phòng tương thích)' },
              status: { type: Type.STRING, description: 'correct | incorrect | partial | incomplete | unclear' },
              result: { type: Type.STRING, description: 'Kết quả: Đúng, Sai, hoặc Chưa hoàn thiện' },
              feedback: { type: Type.STRING, description: 'Tóm tắt nhận xét nhanh cho câu' },
              referenceSolution: {
                type: Type.OBJECT,
                description: 'Lớp 1: Đáp án chuẩn do AI tự giải độc lập từ đầu',
                properties: {
                  structureType: { type: Type.STRING, description: 'standard | geometry_proof | word_problem | equation | statistics_probability' },
                  domainConditionLatex: { type: Type.STRING, description: 'Điều kiện xác định (ĐKXĐ) nếu là phương trình, phân thức hoặc căn thức' },
                  variableDeclaration: { type: Type.STRING, description: 'Lời gọi ẩn và điều kiện của ẩn nếu là bài toán thực tế' },
                  hypothesisLatex: { type: Type.STRING, description: 'Giả thiết (GT) nếu là bài toán hình học' },
                  conclusionLatex: { type: Type.STRING, description: 'Kết luận (KL) nếu là bài toán hình học' },
                  steps: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        stepNumber: { type: Type.INTEGER },
                        solutionText: { type: Type.STRING, description: 'Diễn giải bước giải chuẩn bằng lời' },
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
                    pageIndex: { type: Type.INTEGER, description: 'Chỉ số trang ảnh bài làm (0 cho trang 1, 1 cho trang 2...), mặc định 0' },
                    status: { type: Type.STRING, description: 'correct | incorrect | cascading_error | incomplete | unclear' },
                    referenceStepLatex: { type: Type.STRING, description: 'Biểu thức đáp án chuẩn tương ứng' },
                    studentText: { type: Type.STRING, description: 'Chữ viết/lời giải học sinh' },
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
                    errorType: { type: Type.STRING, description: 'Loại lỗi: sign | calculation | formula | logical | condition | independent_error | None' },
                    correctionLatex: { type: Type.STRING, description: 'Cách sửa bước này bằng biểu thức LaTeX' },
                    isFirstError: { type: Type.BOOLEAN, description: 'true nếu đây là bước đầu tiên học sinh bị sai' },
                    isFollowUpError: { type: Type.BOOLEAN, description: 'true nếu bước này sai do kéo theo lỗi từ bước trước' },
                    isIndependentError: { type: Type.BOOLEAN, description: 'true nếu đây là lỗi sai độc lập mới phát sinh' },
                    confidence: { type: Type.NUMBER, description: 'Độ tin cậy từ 0.0 đến 1.0 (ví dụ 0.95)' },
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
          contents: { parts: [...imageParts, textPart] },
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
        // Delay 500ms before trying fallback model if 503 or 429
        await new Promise((r) => setTimeout(r, 500));
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

    let result: any;
    try {
      result = JSON.parse(cleanText);
    } catch (parseErr) {
      const match = cleanText.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        throw parseErr;
      }
    }

    // Tự động làm sạch và chuẩn hóa triệt để các chuỗi công thức LaTeX (sửa lỗi JSON escape \times -> imes, \text, \boxed...)
    const sanitizeMathData = (val: any): any => {
      if (typeof val === 'string') {
        return val
          .replace(/[\t\\]?imes\b/g, '\\cdot')
          .replace(/\\times\b/g, '\\cdot')
          .replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2')
          .replace(/[\t\\]?ext\{/g, '\\text{')
          .replace(/[\x08\\]?oxed\{/g, '\\boxed{')
          .replace(/[\x0c\\]?rac\{/g, '\\frac{')
          .replace(/[\x08\\]?egin\{/g, '\\begin{');
      }
      if (Array.isArray(val)) {
        return val.map(sanitizeMathData);
      }
      if (val && typeof val === 'object') {
        const out: any = {};
        for (const k of Object.keys(val)) {
          out[k] = sanitizeMathData(val[k]);
        }
        return out;
      }
      return val;
    };

    result = sanitizeMathData(result);

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

        // Default classification if missing
        if (!q.classification) {
          q.classification = {
            grade: 'THCS',
            topic: 'Toán',
            subtopic: 'Bài tập',
            problemType: 'other',
          };
        }

        // Circular 22 Level fallback normalization
        const validLevels = ['Nhận biết', 'Thông hiểu', 'Vận dụng', 'Vận dụng cao'];
        if (!q.level || !validLevels.includes(q.level)) {
          const textProbe = `${q.question || ''} ${q.classification?.subtopic || ''} ${q.classification?.problemType || ''} ${q.problemStatementLatex || ''}`.toLowerCase();
          if (textProbe.includes('bất đẳng thức') || textProbe.includes('gtln') || textProbe.includes('gtnn') || textProbe.includes('nâng cao') || textProbe.includes('thực tế') || (q.maxScore && q.maxScore >= 3)) {
            q.level = 'Vận dụng cao';
          } else if (textProbe.includes('chứng minh') || textProbe.includes('phương trình') || textProbe.includes('hệ phương trình') || textProbe.includes('rút gọn') || (q.analysis && q.analysis.length >= 4)) {
            q.level = 'Vận dụng';
          } else if (textProbe.includes('tính') || textProbe.includes('biến đổi') || textProbe.includes('tìm x') || (q.analysis && q.analysis.length >= 2)) {
            q.level = 'Thông hiểu';
          } else {
            q.level = 'Nhận biết';
          }
        }

        if (Array.isArray(q.analysis)) {
          let hasError = false;
          let totalSteps = q.analysis.length;
          let correctSteps = 0;

          q.analysis.forEach((step: any) => {
            if (step.confidence === undefined || step.confidence === null) {
              step.confidence = 0.95;
            }
            if (step.pageIndex === undefined || step.pageIndex === null || step.pageIndex < 0) {
              step.pageIndex = 0;
            }
            step.isFirstError = !!step.isFirstError;
            step.isFollowUpError = !!step.isFollowUpError || step.status === 'cascading_error';
            step.isIndependentError = !!step.isIndependentError;
            if (step.bbox && (step.bbox.width <= 0 || step.bbox.height <= 0)) {
              step.bbox = null;
            }

            if (step.status === 'incorrect' || step.isFirstError || step.isIndependentError) {
              hasError = true;
            } else if (step.status === 'correct') {
              correctSteps++;
            }
          });

          // If question has an error but was awarded 100% score, adjust score pedagogically
          if (hasError && q.score >= q.maxScore) {
            const ratio = totalSteps > 0 ? (correctSteps / totalSteps) : 0.5;
            q.score = Math.max(0, Math.round(q.maxScore * ratio * 4) / 4);
            q.status = q.score > 0 ? 'partial' : 'incorrect';
            q.result = q.score > 0 ? 'Chưa hoàn thiện' : 'Sai';
          }
        }
      });

      // Synchronize overall total score with question scores
      const totalQScore = result.questions.reduce((sum: number, q: any) => sum + (Number(q.score) || 0), 0);
      const totalQMax = result.questions.reduce((sum: number, q: any) => sum + (Number(q.maxScore || q.max_score) || 0), 0);

      if (totalQMax > 0) {
        // Scaled to standard 10-point scale
        result.score = Math.round((totalQScore / totalQMax) * 10 * 10) / 10;
        result.maxScore = 10;
      }

      // Ensure summary reflects score accurately if AI returned contradictory praise
      if (result.score < 9.0 && typeof result.summary === 'string') {
        const lowerSummary = result.summary.toLowerCase();
        if (lowerSummary.includes('đúng hoàn toàn') || lowerSummary.includes('chính xác hoàn toàn') || lowerSummary.includes('đạt điểm tuyệt đối')) {
          result.summary = 'Bài làm đã giải được một số bước biến đổi, tuy nhiên vẫn còn bước có sai sót hoặc lỗi kéo theo cần đối chiếu và khắc phục.';
        }
      }
    }

    return res.json(result);
  } catch (error: any) {
    console.error('Error grading image:', error);
    const errStr = `${error?.message || ''} ${error?.status || ''} ${String(error)}`;
    let friendlyMessage = error?.message || 'Lỗi xử lý khi chấm bài với AI.';

    if (errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('429') || errStr.toLowerCase().includes('quota')) {
      friendlyMessage = 'Hệ thống AI đang nhận nhiều yêu cầu cùng lúc hoặc tạm thời hết lượt giới hạn miễn phí. Vui lòng thử lại sau 15-30 giây.';
    } else if (errStr.includes('503') || errStr.includes('high demand') || errStr.toLowerCase().includes('overloaded')) {
      friendlyMessage = 'Mô hình AI đang quá tải trong giây lát. Vui lòng nhấn thử lại sau ít giây.';
    } else if (errStr.includes('API_KEY') || errStr.includes('API key not valid')) {
      friendlyMessage = 'GEMINI_API_KEY không hợp lệ hoặc chưa được kích hoạt. Vui lòng kiểm tra lại cấu hình API key.';
    }

    return res.status(500).json({
      success: false,
      message: friendlyMessage,
    });
  }
});

// ========================================================
// MỤC 1: GIA SƯ SOCRATIC AI - DẪN DẮT TƯ DUY, KHÔNG GIẢI HỘ
// ========================================================
app.post(['/api/tutor/socratic', '/api/v1/tutor/socratic'], async (req: Request, res: Response) => {
  try {
    const customKey = (req.headers['x-api-key'] || req.headers['x-gemini-api-key']) as string | undefined;
    const ai = getGeminiClient(customKey);

    const { problem, context, level, studentMessage, chatHistory, mode } = req.body || {};
    if (!problem && !studentMessage) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đề bài toán hoặc câu hỏi thắc mắc của bạn.',
      });
    }

    const socraticSystemInstruction = `Bạn là Gia sư Socratic môn Toán THCS thuộc nền tảng TOÁN MATSUDA AI (Thầy/Cô Matsuda AI).
TÔN CHỈ SƯ PHẠM CỐT LÕI: Dẫn dắt tư duy từng nấc (Scaffolding / Socratic). Tuyệt đối KHÔNG giải hộ hay tuôn ra toàn bộ đáp án ngay từ đầu để học sinh tự mình tư duy và làm chủ kiến thức.

CÁC CẤP ĐỘ GỢI Ý (3 NẤC GỢI MỞ):
1. Khi level = 'hint1' (GỢI Ý 1 - Nhẹ: Khái niệm & Công thức nền tảng):
   - Nhắc lại định nghĩa, tính chất, định lý hoặc công thức Toán học chuẩn cần áp dụng (Ví dụ: Quy tắc dấu lũy thừa $(-a)^{2n} = a^{2n}$ và $(-a)^{2n+1} = -a^{2n+1}$, lũy thừa của một tích $(x \\cdot y)^n = x^n \\cdot y^n$, nhân chia lũy thừa cùng cơ số, phân tích cơ số ra thừa số nguyên tố...).
   - Đặt 1 câu hỏi gợi mở ngắn gọn kích thích học sinh tự đối chiếu vào bài của mình.
   - TUYỆT ĐỐI CHƯA tính toán hộ hay ghi kết quả số cụ thể của bài toán.

2. Khi level = 'hint2' (GỢI Ý 2 - Vừa: Hướng biến đổi & Nút thắt tư duy):
   - Chỉ ra điểm mấu chốt và hướng dẫn bước biến đổi đầu tiên (Ví dụ: "Trước hết em hãy biến đổi cơ số $6 = 2 \\cdot 3$, $(-12)^6 = 12^6 = (2^2 \\cdot 3)^6$ xem tử số thành gì nhé...").
   - Gợi ý cách bước 2 kết nối với bước 1, sau đó dừng lại để học sinh tự làm tiếp.

3. Khi level = 'hint3' (GỢI Ý 3 - Sâu: Dẫn dắt chi tiết từng bước):
   - Dành cho khi học sinh thực sự bế tắc hoặc muốn đối chiếu sâu: Phân tích tường minh từng bước suy luận, giải thích rõ nguyên nhân "Tại sao lại biến đổi như vậy" theo chuẩn sư phạm THCS.

4. Khi level = 'chat' (Đàm thoại Socratic trực tiếp cùng học sinh):
   - Đóng vai người thầy ân cần, kiên nhẫn, khen ngợi tinh thần tự học của em.
   - Nếu học sinh đưa ra dự đoán hoặc câu trả lời nháp: Chỉ ra chỗ em đã làm đúng để khích lệ, phân tích nhẹ nhàng chỗ em nhầm (nếu có), và đặt câu hỏi để em tự sửa.
   - Nếu học sinh nói "Cho em đáp án luôn đi thầy": Nhẹ nhàng từ chối giải hộ, động viên em giải từng bước cùng thầy cô.

QUY TẮC TOÁN HỌC & LATEX:
- BẮT BUỘC bọc mọi ký hiệu, số liệu, công thức toán học trong cặp dấu $...$ (inline) hoặc $$...$$ (block).
- Phép nhân dùng \\cdot (TUYỆT ĐỐI KHÔNG dùng \\times để tránh lỗi ký tự escape), phân số dùng \\frac{a}{b}, lũy thừa luôn bọc ngoặc nhọn.
- Giọng văn: Tiếng Việt sư phạm chuẩn mực, ấm áp, truyền cảm hứng học Toán.`;

    let activeSystemInstruction = socraticSystemInstruction;
    if (mode === 'teacher') {
      activeSystemInstruction = `Bạn là Trợ lý Giáo viên & Chuyên gia Cố vấn Sư phạm Toán THCS của TOÁN MATSUDA AI.
Đối tượng trao đổi: Thầy / Cô giáo bộ môn Toán.
Phong cách làm việc: Chuyên nghiệp, chuẩn mực sư phạm Việt Nam (Chương trình GDPT 2018).
Nhiệm vụ: Hỗ trợ giáo viên giải đáp sư phạm, soạn đề toán phân hóa, hoàn thiện tin nhắn gửi phụ huynh hoặc đề xuất hoạt động dạy học.

QUY TẮC CÔNG THỨC TOÁN:
- BẮT BUỘC bọc mọi ký hiệu, số liệu, công thức toán học trong cặp dấu $...$ (inline) hoặc $$...$$ (block).
- Phép nhân dùng \\cdot (TUYỆT ĐỐI KHÔNG dùng \\times để tránh lỗi ký tự escape), phân số dùng \\frac{a}{b}, lũy thừa luôn bọc ngoặc nhọn.`;
    }

    let userPrompt = '';
    if (level === 'hint1') {
      userPrompt = `Đề bài toán: ${problem || ''}\n${context ? `Ngữ cảnh lỗi sai của học sinh: ${context}\n` : ''}Hãy đưa ra GỢI Ý 1 (Nhẹ: Nhắc lại công thức / định lý / quy tắc toán học cần dùng và 1 câu hỏi gợi mở, chưa tính hộ số liệu).`;
    } else if (level === 'hint2') {
      userPrompt = `Đề bài toán: ${problem || ''}\n${context ? `Ngữ cảnh lỗi sai của học sinh: ${context}\n` : ''}Hãy đưa ra GỢI Ý 2 (Vừa: Hướng dẫn bước biến đổi đầu tiên và chỉ ra nút thắt tư duy để học sinh tự làm tiếp).`;
    } else if (level === 'hint3') {
      userPrompt = `Đề bài toán: ${problem || ''}\n${context ? `Ngữ cảnh lỗi sai của học sinh: ${context}\n` : ''}Hãy đưa ra GỢI Ý 3 (Sâu: Dẫn dắt chi tiết từng bước suy luận sư phạm để học sinh thông suốt phương pháp).`;
    } else {
      userPrompt = `Đề bài toán: ${problem || 'Không có đề bài cụ thể'}\n${context ? `Ngữ cảnh bài làm: ${context}\n` : ''}`;
      if (Array.isArray(chatHistory) && chatHistory.length > 0) {
        userPrompt += `Lịch sử trao đổi trước đó:\n` + chatHistory.map((m: any) => `${m.role === 'model' ? (mode === 'teacher' ? 'Trợ lý AI' : 'Gia sư AI') : (mode === 'teacher' ? 'Giáo viên' : 'Học sinh')}: ${m.text}`).join('\n') + `\n`;
      }
      userPrompt += `Câu hỏi / yêu cầu mới từ ${mode === 'teacher' ? 'Thầy/Cô' : 'học sinh'}: "${studentMessage || 'Em cần thầy/cô hướng dẫn gợi ý phương pháp giải bài này ạ'}"`;
    }

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let replyText = '';

    for (const m of candidateModels) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: userPrompt,
          config: {
            systemInstruction: activeSystemInstruction,
            temperature: 0.35,
          },
        });
        if (resp.text) {
          replyText = resp.text;
          break;
        }
      } catch (err: any) {
        console.warn(`Socratic model ${m} failed:`, err.message);
      }
    }

    if (!replyText) {
      replyText = 'Thầy/Cô Matsuda AI đang kết nối tư duy cùng em. Em hãy kiểm tra lại đề bài hoặc thử diễn đạt lại câu hỏi nhé!';
    }

    // Làm sạch triệt để lỗi escape toán học
    replyText = replyText
      .replace(/[\t\\]?imes\b/g, '\\cdot')
      .replace(/\\times\b/g, '\\cdot')
      .replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2')
      .replace(/[\t\\]?ext\{/g, '\\text{')
      .replace(/[\x08\\]?oxed\{/g, '\\boxed{')
      .replace(/[\x0c\\]?rac\{/g, '\\frac{')
      .replace(/[\x08\\]?egin\{/g, '\\begin{');

    return res.json({
      success: true,
      level: level || 'chat',
      reply: replyText,
    });
  } catch (error: any) {
    console.error('Lỗi Socratic Tutor:', error);
    return res.status(500).json({
      success: false,
      message: 'Gia sư AI tạm thời bận. Em vui lòng bấm thử lại nhé!',
    });
  }
});

// ========================================================
// MỤC 2: THỬ SỨC LÀM LẠI TẠI CHỖ (INTERACTIVE SCRATCHPAD VERIFIER)
// ========================================================
app.post(['/api/tutor/verify-scratchpad', '/api/v1/tutor/verify-scratchpad'], async (req: Request, res: Response) => {
  try {
    const customKey = (req.headers['x-api-key'] || req.headers['x-gemini-api-key']) as string | undefined;
    const ai = getGeminiClient(customKey);

    const { problem, context, scratchpadText, scratchpadImage } = req.body || {};
    if (!scratchpadText && !scratchpadImage) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập lời giải làm lại hoặc tải lên ảnh nháp của bạn.',
      });
    }

    const verifySystemPrompt = `Bạn là Giám khảo & Gia sư Socratic TOÁN MATSUDA AI.
Nhiệm vụ: Chấm và đánh giá bài làm lại / bước làm lại thử sức tại chỗ (Interactive Scratchpad) của học sinh THCS.

YÊU CẦU ĐÁNH GIÁ:
1. So sánh bài làm lại của học sinh với Đề bài và Ngữ cảnh lỗi sai trước đó (nếu có).
2. Xác định:
   - isCorrect: true nếu bước/lời giải làm lại đã hoàn toàn đúng đắn về mặt toán học.
   - isProgress: true nếu học sinh đã sửa được lỗi sai cũ (dù có thể còn sót sơ suất khác) hoặc thể hiện sự tiến bộ rõ rệt.
   - evaluationTitle: Tiêu đề khích lệ ngắn gọn (Ví dụ: "🎉 Xuất sắc! Em đã khắc phục hoàn toàn lỗi sai", "💡 Rất tốt! Em đã sửa được dấu nhưng còn một chút sơ suất", "⚠️ Hãy quan sát kỹ lại số mũ nhé").
   - feedback: Nhận xét chi tiết, giải thích rõ bước làm lại đúng ở đâu, còn nhầm chỗ nào nếu có.
   - nextAdvice: Lời khuyên bước tiếp theo cho học sinh.

QUY TẮC TOÁN HỌC:
- Mọi công thức Toán viết theo cú pháp LaTeX bọc trong $...$ hoặc $$...$$.
- Phép nhân dùng \\cdot (TUYỆT ĐỐI KHÔNG dùng \\times để tránh lỗi escape), phân số dùng \\frac{a}{b}, lũy thừa luôn bọc ngoặc {}.
- Giọng điệu ấm áp, khen ngợi tinh thần tự giác sửa bài của học sinh.`;

    const contents: any[] = [];
    let promptText = `Đề bài toán: ${problem || 'Không có đề bài cụ thể'}\n`;
    if (context) {
      promptText += `Ngữ cảnh lỗi sai học sinh từng mắc phải: ${context}\n`;
    }
    if (scratchpadText) {
      promptText += `Học sinh thử sức làm lại như sau:\n"${scratchpadText}"\n`;
    }
    promptText += `Hãy đánh giá xem lời giải làm lại này đã đúng chưa và học sinh đã khắc phục được lỗi sai chưa.`;

    const parts: any[] = [{ text: promptText }];

    // If an image of scratchpad was provided
    if (scratchpadImage && typeof scratchpadImage === 'string') {
      const match = scratchpadImage.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.unshift({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        isCorrect: { type: Type.BOOLEAN, description: 'True nếu lời giải làm lại hoàn toàn chính xác' },
        isProgress: { type: Type.BOOLEAN, description: 'True nếu học sinh có tiến bộ hoặc sửa được lỗi cũ' },
        evaluationTitle: { type: Type.STRING, description: 'Tiêu đề đánh giá khích lệ' },
        feedback: { type: Type.STRING, description: 'Nhận xét chi tiết kèm công thức LaTeX' },
        nextAdvice: { type: Type.STRING, description: 'Lời khuyên bước tiếp theo' },
      },
      required: ['isCorrect', 'isProgress', 'evaluationTitle', 'feedback', 'nextAdvice'],
    };

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let resultJson: any = null;

    for (const m of candidateModels) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: { parts },
          config: {
            systemInstruction: verifySystemPrompt,
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0.2,
          },
        });
        if (resp.text) {
          resultJson = JSON.parse(resp.text);
          break;
        }
      } catch (err: any) {
        console.warn(`Scratchpad verify model ${m} failed:`, err.message);
      }
    }

    if (!resultJson) {
      resultJson = {
        isCorrect: false,
        isProgress: true,
        evaluationTitle: 'Gia sư AI đã ghi nhận bài làm lại của em',
        feedback: 'Thầy/Cô thấy em đã rất nỗ lực thử sức lại. Hãy cùng đối chiếu từng bước với gợi ý nhé!',
        nextAdvice: 'Em hãy thử bấm Gợi ý 2 để xem hướng biến đổi mấu chốt nhé.',
      };
    }

    // Sanitize LaTeX math
    const cleanMath = (str: string) => {
      if (!str) return '';
      return str
        .replace(/[\t\\]?imes\b/g, '\\cdot')
        .replace(/\\times\b/g, '\\cdot')
        .replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2')
        .replace(/[\t\\]?ext\{/g, '\\text{')
        .replace(/[\x08\\]?oxed\{/g, '\\boxed{')
        .replace(/[\x0c\\]?rac\{/g, '\\frac{');
    };

    resultJson.evaluationTitle = cleanMath(resultJson.evaluationTitle);
    resultJson.feedback = cleanMath(resultJson.feedback);
    resultJson.nextAdvice = cleanMath(resultJson.nextAdvice);

    return res.json({
      success: true,
      ...resultJson,
    });
  } catch (error: any) {
    console.error('Lỗi verify-scratchpad:', error);
    return res.status(500).json({
      success: false,
      message: 'Không thể đánh giá nháp lúc này. Em vui lòng thử lại nhé!',
    });
  }
});

// ========================================================
// MỤC 3: TRỢ LÝ GIÁO VIÊN (TEACHER ASSISTANT MODE)
// ========================================================
app.post(['/api/tutor/teacher-assist', '/api/v1/tutor/teacher-assist'], async (req: Request, res: Response) => {
  try {
    const customKey = (req.headers['x-api-key'] || req.headers['x-gemini-api-key']) as string | undefined;
    const ai = getGeminiClient(customKey);

    const { action, problem, context, studentName, teacherName, schoolName } = req.body || {};
    if (!problem && !context) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đề bài toán hoặc ngữ cảnh bài làm.',
      });
    }

    const teacherSystemInstruction = `Bạn là Chuyên gia Cố vấn Sư phạm Toán THCS và Trợ lý Giáo viên đắc lực thuộc TOÁN MATSUDA AI.
Phong cách làm việc: Chuyên nghiệp, chuẩn mực sư phạm Việt Nam (Chương trình GDPT 2018), hỗ trợ giáo viên tiết kiệm tối đa thời gian soạn bài và trao đổi với phụ huynh.

QUY TẮC CÔNG THỨC TOÁN:
- BẮT BUỘC bọc mọi ký hiệu, số liệu, công thức toán học trong cặp dấu $...$ (inline) hoặc $$...$$ (block).
- Phép nhân dùng \\cdot (TUYỆT ĐỐI KHÔNG dùng \\times để tránh lỗi ký tự escape), phân số dùng \\frac{a}{b}, lũy thừa luôn bọc ngoặc {}.`;

    let userPrompt = '';
    if (action === 'generate_exercises') {
      userPrompt = `Dựa vào đề bài toán sau:
Đề bài gốc: ${problem}
${context ? `Lỗi sai học sinh thường mắc phải: ${context}` : ''}

Hãy soạn 3 bài tập toán mới cùng dạng kiến thức, phân hóa theo 3 cấp độ rõ ràng:
1. Mức độ Dễ (Nhận biết / Thông hiểu - Củng cố công thức trực tiếp)
2. Mức độ Vừa (Vận dụng - Tương đương bài gốc nhưng đổi số liệu để học sinh tự luyện)
3. Mức độ Nâng cao (Vận dụng cao - Mở rộng tư duy toán học)

Mỗi bài tập phải có đầy đủ:
- Đề bài (viết bằng LaTeX chuẩn $...$)
- Gợi ý tư duy nhanh cho học sinh
- Đáp số và lời giải tóm tắt chuẩn xác.`;
    } else if (action === 'parent_message') {
      userPrompt = `Dựa vào kết quả bài làm toán của học sinh:
- Học sinh: ${studentName || 'em học sinh'}
- Giáo viên: ${teacherName || 'Thầy/Cô bộ môn Toán'}
- Trường: ${schoolName || ''}
- Đề bài: ${problem}
- Điểm cần khắc phục / Lỗi sai: ${context || 'Cần chú ý cẩn thận hơn trong các bước tính toán và quy tắc biến đổi'}

Hãy soạn một mẫu tin nhắn Zalo / Sổ liên lạc điện tử gửi phụ huynh:
- Lời chào trân trọng, lịch sự, chuẩn mực nhà giáo.
- Điểm tích cực: Khen ngợi tinh thần làm bài và nỗ lực của em.
- Điểm cần phối hợp: Chỉ rõ cụ thể lỗi sai/lỗ hổng kiến thức em đang gặp phải một cách tích cực, mang tính xây dựng.
- Lời dặn dò: Nhờ phụ huynh nhắc em làm thêm bài tập rèn luyện củng cố (hệ thống Toán Matsuda AI đã đính kèm bài tập tương tự).
- Lời chúc và cảm ơn chân thành.`;
    } else {
      // pedagogical_analysis
      userPrompt = `Dựa vào bài toán và lỗi sai của học sinh:
- Đề bài: ${problem}
- Lỗi sai phát hiện: ${context || 'Học sinh biến đổi sai quy tắc toán học'}

Hãy phân tích sư phạm chuyên sâu cho giáo viên:
1. NGUYÊN NHÂN GỐC RỄ (Chướng ngại nhận thức / Lỗ hổng kiến thức tiền đề khiến học sinh dễ mắc lỗi này).
2. THỐNG KÊ LỖI PHỔ BIẾN (Những bẫy toán học học sinh hay gặp ở dạng bài này).
3. GỢI Ý HOẠT ĐỘNG KHỞI ĐỘNG 5 PHÚT (Một câu hỏi hoặc mini-game 5 phút đầu giờ tiết sau để giáo viên củng cố cho cả lớp).`;
    }

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    let replyText = '';

    for (const m of candidateModels) {
      try {
        const resp = await ai.models.generateContent({
          model: m,
          contents: userPrompt,
          config: {
            systemInstruction: teacherSystemInstruction,
            temperature: 0.3,
          },
        });
        if (resp.text) {
          replyText = resp.text;
          break;
        }
      } catch (err: any) {
        console.warn(`Teacher assist model ${m} failed:`, err.message);
      }
    }

    if (!replyText) {
      replyText = 'Trợ lý Giáo viên đang kết nối, Thầy/Cô vui lòng bấm thử lại nhé!';
    }

    // Làm sạch triệt để lỗi escape toán học
    replyText = replyText
      .replace(/[\t\\]?imes\b/g, '\\cdot')
      .replace(/\\times\b/g, '\\cdot')
      .replace(/([0-9a-zA-Z\)\}])\s*imes\s*([0-9a-zA-Z\(\{])/g, '$1 \\cdot $2')
      .replace(/[\t\\]?ext\{/g, '\\text{')
      .replace(/[\x08\\]?oxed\{/g, '\\boxed{')
      .replace(/[\x0c\\]?rac\{/g, '\\frac{')
      .replace(/[\x08\\]?egin\{/g, '\\begin{');

    return res.json({
      success: true,
      action,
      reply: replyText,
    });
  } catch (error: any) {
    console.error('Lỗi teacher-assist:', error);
    return res.status(500).json({
      success: false,
      message: 'Trợ lý Giáo viên tạm thời bận. Thầy/Cô vui lòng thử lại nhé!',
    });
  }
});

// Explicit method-not-allowed for upload endpoint when called with non-POST
app.all(['/api/v1/upload', '/api/v1/upload/', '/api/upload'], (req: Request, res: Response) => {
  return res.status(405).json({
    success: false,
    message: `Phương thức ${req.method} không được hỗ trợ cho endpoint này. Vui lòng gửi POST.`,
  });
});

// Dedicated JSON 404 for API endpoints to prevent HTML error leaks
app.all(['/api/*', '/api'], (req: Request, res: Response) => {
  return res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.path} không tồn tại trên máy chủ.`,
  });
});

// Serve frontend static assets (compatible with local, Docker, and Vercel serverless)
const frontendPath = fs.existsSync(path.join(__dirname, 'frontend'))
  ? path.join(__dirname, 'frontend')
  : path.join(process.cwd(), 'frontend');
app.use(express.static(frontendPath));

// SPA fallback to frontend/index.html (strictly non-API routes)
app.get('*', (req: Request, res: Response, next) => {
  if (req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global Express error handler to guarantee all unhandled errors return JSON
app.use((err: any, req: Request, res: Response, _next: any) => {
  console.error('Express unhandled error:', err);
  if (res.headersSent) return;
  return res.status(err.status || err.statusCode || 500).json({
    success: false,
    message: err.message || 'Lỗi hệ thống trong quá trình xử lý.',
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`Server is running at http://${HOST}:${PORT}`);
  });
}

export default app;
